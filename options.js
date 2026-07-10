// FlertAI — lógica da página de opções (v0.10.0).
// Conta (login por email + código) + preferências de personalização.
// A chave de API sumiu daqui de propósito: ela agora vive só no servidor.

const PREF_FIELDS = ["tone", "aboutMe", "customInstructions"];

// ---------- Preferências ----------

async function loadPrefs() {
  const s = await chrome.storage.local.get(PREF_FIELDS);
  document.getElementById("tone").value = s.tone || "descontraido";
  document.getElementById("aboutMe").value = s.aboutMe || "";
  document.getElementById("customInstructions").value = s.customInstructions || "";
}

async function savePrefs() {
  await chrome.storage.local.set({
    tone: document.getElementById("tone").value,
    aboutMe: document.getElementById("aboutMe").value.trim(),
    customInstructions: document.getElementById("customInstructions").value.trim()
  });
  const saved = document.getElementById("saved");
  saved.style.display = "inline";
  setTimeout(() => (saved.style.display = "none"), 1800);
}

// ---------- Conta ----------

function show(id, visible) {
  document.getElementById(id).style.display = visible ? "" : "none";
}

function setError(text) {
  const el = document.getElementById("authError");
  el.textContent = text || "";
  el.style.display = text ? "" : "none";
}

function send(type, payload) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, resolve));
}

async function renderAccount() {
  setError("");
  const cfg = globalThis.FLERTAI_CONFIG || {};
  const isConfigured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  show("notConfigured", !isConfigured);

  const res = await send("FLERTAI_GET_STATUS");
  const loggedIn = res && res.ok && res.loggedIn;

  show("auth-logged", !!loggedIn);
  show("auth-step-email", !loggedIn);
  show("auth-step-code", false);

  if (loggedIn) {
    document.getElementById("accEmail").textContent = res.email || "";
    const planEl = document.getElementById("accPlan");
    planEl.textContent = res.isPro ? "PRO" : "FREE";
    planEl.className = "badge " + (res.isPro ? "pro" : "free");
    const usageEl = document.getElementById("accUsage");
    if (res.isPro) {
      usageEl.textContent = "Uso ilimitado (uso justo)";
    } else {
      const credits = res.credits ? ` · ${res.credits} créditos avulsos` : "";
      usageEl.textContent = `${res.used}/${res.limit} gerações hoje${credits}`;
    }
  }
}

async function onSendCode() {
  setError("");
  const email = document.getElementById("email").value.trim();
  const btn = document.getElementById("sendCode");
  btn.disabled = true;
  btn.textContent = "Enviando…";
  const res = await send("FLERTAI_SEND_OTP", { email });
  btn.disabled = false;
  btn.textContent = "Enviar código";
  if (!res || !res.ok) {
    setError((res && res.error) || "Não foi possível enviar o código.");
    return;
  }
  document.getElementById("sentTo").textContent = email;
  show("auth-step-email", false);
  show("auth-step-code", true);
  document.getElementById("code").focus();
}

async function onVerifyCode() {
  setError("");
  const email = document.getElementById("email").value.trim();
  const token = document.getElementById("code").value.trim();
  const btn = document.getElementById("verifyCode");
  btn.disabled = true;
  btn.textContent = "Entrando…";
  const res = await send("FLERTAI_VERIFY_OTP", { email, token });
  btn.disabled = false;
  btn.textContent = "Entrar";
  if (!res || !res.ok) {
    setError((res && res.error) || "Código inválido.");
    return;
  }
  await renderAccount();
}

async function onLogout() {
  await send("FLERTAI_LOGOUT");
  await renderAccount();
}

// ---------- Wire ----------

document.getElementById("save").addEventListener("click", savePrefs);
document.getElementById("sendCode").addEventListener("click", onSendCode);
document.getElementById("verifyCode").addEventListener("click", onVerifyCode);
document.getElementById("logout").addEventListener("click", onLogout);
document.getElementById("changeEmail").addEventListener("click", (e) => {
  e.preventDefault();
  show("auth-step-code", false);
  show("auth-step-email", true);
});
document.getElementById("code").addEventListener("keydown", (e) => {
  if (e.key === "Enter") onVerifyCode();
});
document.getElementById("email").addEventListener("keydown", (e) => {
  if (e.key === "Enter") onSendCode();
});

loadPrefs();
renderAccount();
