// FlertAI — Background service worker (Manifest V3) — v0.10.0
//
// MUDANÇA DE ARQUITETURA (Fase 1 do roadmap): este arquivo NÃO chama mais a
// Anthropic. Ele é um cliente do NOSSO backend (Supabase Edge Functions):
//   - a chave da Anthropic vive só no servidor;
//   - os prompts (o diferencial do produto) vivem só no servidor;
//   - limite diário e status Pro são decididos SÓ no servidor (anti-burla);
//   - aqui fica: sessão de login (email + código), preferências locais
//     (tom/sobre mim/instruções) e a conversão das fotos para base64
//     (correção do bug de URLs do Tinder que expiram).
//
// O contrato com o content.js NÃO mudou: mesmos tipos FLERTAI_* e mesmos
// formatos de resposta { ok, ..., usage, limit }.

import "./config.js";

const CFG = globalThis.FLERTAI_CONFIG || {};

const DEFAULTS = {
  tone: "descontraido",
  customInstructions: "",
  aboutMe: ""
};

// ---------- Preferências locais (personalização enviada a cada pedido) ----------

async function getPrefs() {
  const stored = await chrome.storage.local.get(["tone", "customInstructions", "aboutMe"]);
  return { ...DEFAULTS, ...stored };
}

// ---------- Sessão (Supabase Auth: email + código de 6 dígitos) ----------

function configured() {
  return !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
}

const NOT_CONFIGURED = {
  ok: false,
  error: "Backend não configurado. Preencha config.js (ver backend/README.md)."
};

async function getSession() {
  const { session } = await chrome.storage.local.get("session");
  return session || null;
}

async function saveSession(data) {
  // data: resposta do Supabase Auth (access_token, refresh_token, expires_in, user)
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    // margem de 60s para nunca usar token no limite da expiração
    expires_at: Date.now() + (data.expires_in || 3600) * 1000 - 60000,
    email: data.user && data.user.email ? data.user.email : ""
  };
  await chrome.storage.local.set({ session });
  return session;
}

async function clearSession() {
  await chrome.storage.local.remove("session");
}

async function authRequest(path, body) {
  const res = await fetch(`${CFG.SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: CFG.SUPABASE_ANON_KEY },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.msg || data.error_description || data.message || `Erro de autenticação (${res.status})`);
  }
  return data;
}

/** Retorna um access_token válido, renovando com o refresh_token se preciso. */
async function getValidToken() {
  let session = await getSession();
  if (!session) return null;
  if (Date.now() < session.expires_at) return session.access_token;

  try {
    const data = await authRequest("token?grant_type=refresh_token", {
      refresh_token: session.refresh_token
    });
    session = await saveSession(data);
    return session.access_token;
  } catch (e) {
    // Refresh falhou (revogado/expirado): força novo login.
    await clearSession();
    return null;
  }
}

// Passo 1 do login: envia código de 6 dígitos para o email.
async function handleSendOtp({ email }) {
  if (!configured()) return NOT_CONFIGURED;
  if (!email || !email.includes("@")) return { ok: false, error: "Informe um email válido." };
  try {
    await authRequest("otp", { email: email.trim(), create_user: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Passo 2 do login: confirma o código e guarda a sessão.
async function handleVerifyOtp({ email, token }) {
  if (!configured()) return NOT_CONFIGURED;
  try {
    const data = await authRequest("verify", { type: "email", email: (email || "").trim(), token: (token || "").trim() });
    if (!data.access_token) return { ok: false, error: "Código inválido ou expirado." };
    const session = await saveSession(data);
    return { ok: true, email: session.email };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function handleLogout() {
  await clearSession();
  return { ok: true };
}

// Sessão vinda da landing page (via bridge.js). Faz o login do site valer também
// na extensão — o usuário loga uma vez só. Só grava se a sessão for utilizável e
// mais nova que a atual (evita sobrescrever um login recente por um antigo).
async function handleSyncSession({ session }) {
  if (!session || !session.access_token || !session.refresh_token) {
    return { ok: false, error: "Sessão inválida." };
  }
  const current = await getSession();
  const incomingExp = Number(session.expires_at) || 0;
  if (current && Number(current.expires_at) >= incomingExp) return { ok: true, kept: true };

  await chrome.storage.local.set({
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: incomingExp || Date.now() + 3600 * 1000 - 60000,
      email: session.email || ""
    }
  });
  return { ok: true, synced: true };
}

// ---------- Chamadas ao backend ----------

async function callBackend(fn, payload) {
  if (!configured()) return NOT_CONFIGURED;

  const token = await getValidToken();
  if (!token) {
    return { ok: false, needsLogin: true, error: "Faça login nas opções da extensão (clique no ícone ✦ → Abrir opções)." };
  }

  try {
    const res = await fetch(`${CFG.SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        apikey: CFG.SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload || {})
    });
    const data = await res.json().catch(() => null);
    if (!data) return { ok: false, error: `Resposta inválida do servidor (${res.status}).` };
    if (res.status === 401) {
      await clearSession();
      return { ok: false, needsLogin: true, error: "Sessão expirada. Faça login de novo nas opções." };
    }
    return data;
  } catch (e) {
    return { ok: false, error: "Sem conexão com o servidor. Verifique sua internet e tente de novo." };
  }
}

// ---------- Fotos: URL do Tinder → base64 redimensionado ----------
// URLs de imagem do Tinder expiram rápido; convertendo aqui, o servidor sempre
// recebe a imagem válida. Redimensionar para ~1024px corta o payload e o custo
// de visão sem perder qualidade de análise.

const PHOTO_MAX_DIM = 1024;

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function photoUrlToBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar foto (${res.status})`);
  const blob = await res.blob();

  try {
    // Redimensiona via OffscreenCanvas (disponível em service worker MV3).
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    return { media_type: "image/jpeg", data: bufferToBase64(await jpeg.arrayBuffer()) };
  } catch (e) {
    // Fallback: manda o arquivo original sem redimensionar.
    const type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
    return { media_type: type, data: bufferToBase64(await blob.arrayBuffer()) };
  }
}

async function preparePhotos(urls) {
  const list = Array.isArray(urls) ? urls.slice(0, 9) : [];
  const out = [];
  for (const url of list) {
    try {
      out.push(await photoUrlToBase64(url));
    } catch (e) {
      // Se uma foto falhar, segue com as outras (melhor análise parcial que nenhuma).
      console.warn("FlertAI: foto ignorada:", e.message);
    }
  }
  return out;
}

// ---------- Roteamento de análise: detecção de re-análise (100% local) ----------
// O uso real é ping-pong: o usuário re-analisa a MESMA conversa a cada resposta.
// Guardamos aqui (chrome.storage.local) uma impressão digital da conversa + a
// análise anterior. Se bater com uma das últimas 24h, avisamos o backend
// (reanalysis=true) e enviamos a análise anterior como contexto — o backend
// roda em Haiku (barato) mantendo a qualidade. A impressão digital NUNCA vai ao
// servidor; preserva a promessa "nada armazenado em servidor".

const ANALYSIS_CACHE_KEY = "analysisCache";
const REANALYSIS_WINDOW_MS = 24 * 60 * 60 * 1000;

function convFingerprint(conversation, matchName) {
  const head = String(conversation || "").split("\n").slice(0, 3).join("\n");
  const basis = (matchName || "") + "|" + head;
  let h = 5381;
  for (let i = 0; i < basis.length; i++) h = ((h << 5) + h + basis.charCodeAt(i)) | 0;
  return "fp" + (h >>> 0).toString(36);
}

async function getAnalysisCache() {
  const { [ANALYSIS_CACHE_KEY]: c } = await chrome.storage.local.get(ANALYSIS_CACHE_KEY);
  return c && typeof c === "object" ? c : {};
}

async function saveAnalysisSummary(fp, summary) {
  const cache = await getAnalysisCache();
  const now = Date.now();
  cache[fp] = { at: now, summary };
  for (const k of Object.keys(cache)) {
    if (now - (cache[k].at || 0) > REANALYSIS_WINDOW_MS) delete cache[k]; // poda >24h
  }
  await chrome.storage.local.set({ [ANALYSIS_CACHE_KEY]: cache });
}

function summarizeAnalysis(res) {
  const parts = [];
  if (res.estagio) parts.push(`Estágio: ${res.estagio}`);
  if (typeof res.interesse === "number") parts.push(`Interesse: ${res.interesse}/10`);
  if (res.veredito) parts.push(`Veredito: ${res.veredito}`);
  if (res.analise) parts.push(`Análise: ${res.analise}`);
  if (Array.isArray(res.respostas) && res.respostas.length) parts.push(`Resposta sugerida: ${res.respostas[0]}`);
  return parts.join("\n");
}

// ---------- Handlers (mesmo contrato do v0.9.0 com o content.js) ----------

async function handleGenerate(payload) {
  const prefs = await getPrefs();
  return callBackend("generate", {
    action: payload.action,
    conversation: payload.conversation,
    bio: payload.bio,
    matchName: payload.matchName,
    tone: payload.tone || prefs.tone,
    aboutMe: prefs.aboutMe,
    customInstructions: prefs.customInstructions
  });
}

async function handleAnalyzeConversation(payload) {
  const prefs = await getPrefs();
  const fp = convFingerprint(payload.conversation, payload.matchName);
  const cache = await getAnalysisCache();
  const prev = cache[fp];
  const isReanalysis = !!(prev && Date.now() - (prev.at || 0) < REANALYSIS_WINDOW_MS && prev.summary);

  const res = await callBackend("analyze", {
    conversation: payload.conversation,
    bio: payload.bio,
    matchName: payload.matchName,
    draft: payload.draft,
    reanalysis: isReanalysis,
    previousAnalysis: isReanalysis ? prev.summary : "",
    aboutMe: prefs.aboutMe,
    customInstructions: prefs.customInstructions
  });

  // Guarda a análise completa como contexto para a próxima re-análise desta conversa.
  if (res && res.ok && !res.locked) {
    try { await saveAnalysisSummary(fp, summarizeAnalysis(res)); } catch (_e) { /* cache é best-effort */ }
  }
  return res;
}

async function handleProfileReview(payload) {
  const prefs = await getPrefs();
  const photos = await preparePhotos(payload.photos);
  return callBackend("profile", {
    bio: payload.bio,
    photos,
    aboutMe: prefs.aboutMe,
    customInstructions: prefs.customInstructions
  });
}

async function handleGetStatus() {
  if (!configured()) return { ...NOT_CONFIGURED, loggedIn: false };

  const session = await getSession();
  if (!session) return { ok: true, loggedIn: false };

  const res = await callBackend("status", {});
  if (!res.ok) {
    if (res.needsLogin) return { ok: true, loggedIn: false };
    return res;
  }
  return {
    ok: true,
    loggedIn: true,
    email: res.email || session.email,
    plan: res.plan,
    isPro: res.isPro,
    used: res.used,
    limit: res.limit,
    credits: res.credits,
    // compat com o popup antigo:
    hasKey: true
  };
}

// ---------- Roteador ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  const routes = {
    FLERTAI_GENERATE: () => handleGenerate(msg.payload || {}),
    FLERTAI_ANALYZE_CONV: () => handleAnalyzeConversation(msg.payload || {}),
    FLERTAI_PROFILE: () => handleProfileReview(msg.payload || {}),
    FLERTAI_GET_STATUS: () => handleGetStatus(),
    FLERTAI_SEND_OTP: () => handleSendOtp(msg.payload || {}),
    FLERTAI_VERIFY_OTP: () => handleVerifyOtp(msg.payload || {}),
    FLERTAI_LOGOUT: () => handleLogout(),
    FLERTAI_SYNC_SESSION: () => handleSyncSession(msg.payload || {})
  };

  const handler = routes[msg.type];
  if (!handler) return;
  handler().then(sendResponse);
  return true;
});

// ---------- Limpeza de migração (v0.9 → v0.10) ----------
// Remove a chave de API antiga, o modo Pro client-side e os contadores usage_*
// (pendência registrada no CONTEXTO.md). Preferências de personalização ficam.

chrome.runtime.onInstalled.addListener(async () => {
  const all = await chrome.storage.local.get(null);
  const toRemove = Object.keys(all).filter(
    (k) => k === "apiKey" || k === "isPro" || k === "model" || k === "freeDailyLimit" || k.startsWith("usage_")
  );
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
});
