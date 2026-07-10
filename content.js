// FlertAI — Content script
// Injeta o painel flutuante no Tinder com 2 abas: Mensagens e Perfil.
//
// OBS: o Tinder usa classes CSS ofuscadas que mudam com frequência. A leitura da
// conversa e do nome do match é "melhor esforço" + heurística. Campos editáveis
// servem de rede de segurança. Seletores ficam em SELECTORS para facilitar ajuste.

(function () {
  "use strict";

  const SELECTORS = {
    messageBubbles: '[class*="msg"], [class*="message"]',
    matchName: 'h1, [class*="name"]'
  };

  // ==================== Leitura da tela ====================

  // Acha a caixa de digitar mensagem (delimita o painel da conversa aberta).
  function findComposer() {
    const els = Array.from(
      document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]')
    );
    let best = null;
    let bestTop = -Infinity;
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top > bestTop) {
        best = el;
        bestTop = r.top;
      }
    });
    return best;
  }

  // Limpa o texto de uma bolha: remove prefixos de leitor de tela ("Você:", "Nome:")
  // e espaços extras.
  function cleanBubbleText(t) {
    let s = (t || "").trim().replace(/\s+/g, " ");
    // remove prefixo colado tipo "Você:texto" ou "Samille:texto" (palavra + ":" sem espaço)
    s = s.replace(/^[A-Za-zÀ-ÿ]{1,20}:(?=\S)/, "");
    return s.trim();
  }

  // Linhas que são ruído e devem ser ignoradas.
  function isNoiseLine(s) {
    if (!s) return true;
    if (/^\d{1,2}:\d{2}$/.test(s)) return true; // horário 22:22
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s)) return true; // data
    if (/^(enviado|visto|entregue|digite uma mensagem|emoji|gif|há .* minutos?|há .* horas?)$/i.test(s)) return true;
    if (/sua última mensagem foi/i.test(s)) return true;
    return false;
  }

  // Acha o container da conversa aberta usando os separadores de data/hora,
  // que só existem dentro da conversa (a lista lateral não tem). Retorna o
  // ancestral comum desses separadores = o painel de mensagens.
  function findConversationContainer() {
    const seps = Array.from(document.querySelectorAll("div, span, time, p")).filter((el) => {
      if (el.children.length > 0) return false; // só folhas de texto
      const t = (el.textContent || "").trim();
      return (
        /^\d{1,2}\/\d{1,2}\/\d{2,4}.*\d{1,2}:\d{2}$/.test(t) || // 22/06/2026, 22:22
        /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t) || // 22/06/2026
        /^\d{1,2}:\d{2}$/.test(t) // 22:22
      );
    });
    if (seps.length === 0) return null;
    let anc = seps[0].parentElement || seps[0];
    for (let i = 1; i < seps.length; i++) {
      while (anc && !anc.contains(seps[i])) anc = anc.parentElement;
    }
    return anc;
  }

  // Fallback: a partir da caixa de digitar, sobe até o ancestral que contém
  // várias bolhas = a coluna da conversa (sem a lista lateral).
  function findConversationViaComposer(composer) {
    if (!composer) return null;
    let node = composer.parentElement;
    for (let i = 0; i < 8 && node; i++) {
      if (node.querySelectorAll(SELECTORS.messageBubbles).length >= 3) return node;
      node = node.parentElement;
    }
    return null;
  }

  function scrapeConversation() {
    const composer = findComposer();
    // 1) separadores de data/hora; 2) ancestral do composer; 3) documento inteiro.
    const container =
      findConversationContainer() || findConversationViaComposer(composer) || document;
    const crect =
      container !== document ? container.getBoundingClientRect() : null;
    const compRect = composer ? composer.getBoundingClientRect() : null;

    // Centro do painel (separar Eu × Match).
    const paneCenter = crect
      ? crect.left + crect.width / 2
      : compRect
      ? compRect.left + compRect.width / 2
      : window.innerWidth / 2;

    // Guarda extra: tudo à esquerda da caixa de digitar é a lista lateral.
    const leftBound = compRect ? compRect.left - 40 : -Infinity;
    // Ignora o que está abaixo da caixa de digitar (rodapé/composer).
    const bottomBound = compRect ? compRect.top + 8 : Infinity;

    const bubbles = Array.from(container.querySelectorAll(SELECTORS.messageBubbles))
      .filter((el) => el.textContent && el.textContent.trim().length > 0);
    if (bubbles.length === 0) return "";

    const leaves = bubbles.filter(
      (el) => !bubbles.some((o) => o !== el && el.contains(o))
    );

    const lines = [];
    const seen = new Set();

    leaves.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      if (rect.left < leftBound) return; // lista lateral
      if (rect.top >= bottomBound) return; // composer/rodapé

      const text = cleanBubbleText(el.textContent);
      if (!text || text.length > 500 || isNoiseLine(text)) return;

      const center = rect.left + rect.width / 2;
      const who = center > paneCenter ? "Eu" : "Match";
      const key = who + "|" + text;
      if (seen.has(key)) return;
      seen.add(key);
      lines.push(`${who}: ${text}`);
    });
    return lines.join("\n");
  }

  function detectMatchName() {
    // Tenta achar o nome do match no cabeçalho da conversa aberta.
    const candidates = Array.from(document.querySelectorAll(SELECTORS.matchName));
    for (const el of candidates) {
      const t = (el.textContent || "").trim();
      if (t && t.length > 1 && t.length < 40 && !/tinder|mensagens|matches/i.test(t)) {
        return t.split(/\s+/)[0]; // primeiro nome
      }
    }
    return "";
  }

  // Acha o painel do perfil pelos rótulos de seção (Sobre mim, Tô procurando,
  // Interesses...). Isso isola o perfil mesmo quando há uma conversa aberta ao lado.
  function findProfileContainer() {
    const labelRe = /^(tô procurando|to procurando|sobre mim|informações básicas|informacoes basicas|mais sobre mim|estilo de vida|interesses|o que estou procurando)$/i;
    const labels = Array.from(document.querySelectorAll("div, span, h2, h3, p")).filter((el) => {
      if (el.children.length > 0) return false;
      return labelRe.test((el.textContent || "").trim());
    });
    if (labels.length < 2) return null; // precisa de pelo menos 2 seções p/ delimitar
    let anc = labels[0].parentElement || labels[0];
    for (let i = 1; i < labels.length; i++) {
      while (anc && !anc.contains(labels[i])) anc = anc.parentElement;
    }
    return anc;
  }

  // Acha o "card" de perfil visível (do match nas recs, ou o seu na página de perfil).
  function findProfileCard() {
    const all = Array.from(document.querySelectorAll('h1, h2, [class*="name"]'));
    for (const el of all) {
      const t = (el.innerText || el.textContent || "").trim();
      // padrão "Nome 28" / "Nome, 28"
      if (/[A-Za-zÀ-ú]{2,}[, ]+\d{1,2}\b/.test(t) && t.length < 40) {
        // sobe até o container englobar a bio + infos (texto suficiente), sem ir longe demais
        let node = el;
        for (let i = 0; i < 10 && node.parentElement; i++) {
          node = node.parentElement;
          if ((node.innerText || "").trim().length > 300) break;
        }
        return node;
      }
    }
    return document.querySelector("main") || document.body;
  }

  // Lê o texto do perfil (nome, idade, bio, interesses). Best-effort.
  function scrapeProfileText() {
    // Prefere o painel do perfil (isolado da conversa); cai pro card por nome se não achar.
    const card = findProfileContainer() || findProfileCard();
    const raw = (card.innerText || "").trim();
    // Linhas de interface a descartar (sujeira).
    const drop = /^(não|curtir|super ?like|abrir perfil|fechar perfil|próxima foto|foto anterior|ocultar|mostrar|online recentemente|deu match.*|ver mais|ver menos|ver todos.*|denunciar.*|bloquear.*|desfazer match|voltar|enviar|emoji|gif|digite uma mensagem|responder a mensagem.*|conversationhistory.*|há \d+ (hora|minuto|segundo|dia|semana|mês|mes).*)$/i;
    const dropContains = /(graças ao boost|graças ao|tinder gold|tinder platinum|tinder™|você deu match|você pode denunciar)/i;
    const lines = raw
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s && !drop.test(s) && !dropContains.test(s));
    const out = [];
    const seen = new Set();
    for (const l of lines) {
      if (seen.has(l)) continue;
      seen.add(l);
      out.push(l);
      if (out.length >= 150) break;
    }
    return out.join("\n").slice(0, 6000);
  }

  // Normaliza URL de foto p/ deduplicar variações de tamanho da mesma imagem
  // (Tinder serve a mesma foto em /84x84/, /320x400/, etc.).
  function normalizePhotoUrl(u) {
    return u.split("?")[0].replace(/\/\d+x\d+\//, "/");
  }

  // Lê as URLs de TODAS as fotos do perfil visível. Varre a página inteira,
  // ignora miniaturas pequenas (avatars da lista lateral) e deduplica variações.
  function scrapeProfilePhotos() {
    const found = [];
    document.querySelectorAll("img").forEach((img) => {
      if (img.src && /^https/.test(img.src)) {
        found.push({ url: img.src, w: img.getBoundingClientRect().width });
      }
    });
    document.querySelectorAll('[style*="background-image"]').forEach((d) => {
      const m = (d.style.backgroundImage || "").match(/url\(["']?(https[^"')]+)/);
      if (m) found.push({ url: m[1], w: d.getBoundingClientRect().width });
    });

    const byKey = new Map();
    found.forEach(({ url, w }) => {
      if (!/gotinder|tinder|images/i.test(url)) return;
      if (/icon|logo|sprite|badge/i.test(url)) return;
      if (w < 120) return; // ignora miniaturas/avatars da barra lateral
      const key = normalizePhotoUrl(url);
      if (!byKey.has(key)) byKey.set(key, url);
    });
    return Array.from(byKey.values()).slice(0, 9);
  }

  // Fotos guardadas da última detecção do próprio perfil.
  let myPhotos = [];

  // ==================== UI ====================

  let panel = null;

  function createLauncher() {
    const btn = document.createElement("button");
    btn.id = "flertai-launcher";
    btn.title = "FlertAI";
    btn.textContent = "✦";
    btn.addEventListener("click", togglePanel);
    document.body.appendChild(btn);
  }

  function togglePanel() {
    if (panel) {
      panel.style.display = panel.style.display === "none" ? "flex" : "none";
      return;
    }
    buildPanel();
  }

  function buildPanel() {
    panel = document.createElement("div");
    panel.id = "flertai-panel";
    panel.innerHTML = `
      <div id="flertai-header">
        <span class="flertai-title">✦ FlertAI</span>
        <div class="flertai-header-actions">
          <span id="flertai-usage" class="flertai-usage"></span>
          <button id="flertai-close" title="Fechar">✕</button>
        </div>
      </div>
      <div id="flertai-tabs">
        <button class="flertai-tab flertai-tab-active" data-tab="msg">Mensagens</button>
        <button class="flertai-tab" data-tab="profile">Perfil</button>
      </div>
      <div id="flertai-body">

        <div class="flertai-pane" data-pane="msg">
          <div class="flertai-row">
            <button id="flertai-detect" class="flertai-secondary">↻ Conversa</button>
            <button id="flertai-detect-profile" class="flertai-secondary">↻ Perfil do match</button>
            <button id="flertai-clear-msg" class="flertai-secondary">Limpar</button>
            <select id="flertai-tone" title="Tom da mensagem">
              <option value="descontraido">Descontraído</option>
              <option value="flerte">Flerte</option>
              <option value="direto">Direto</option>
              <option value="engracado">Engraçado</option>
              <option value="fofo">Fofo</option>
              <option value="intelectual">Intelectual</option>
            </select>
          </div>
          <label class="flertai-label">Conversa (editável)</label>
          <textarea id="flertai-conv" rows="4" placeholder="Clique em 'Detectar conversa' ou cole/ajuste aqui.\nMatch: oi, tudo bem?\nEu: tudo e você?"></textarea>
          <label class="flertai-label">Bio do match (opcional)</label>
          <textarea id="flertai-bio" rows="2" placeholder="Cole a bio/interesses do match"></textarea>
          <div class="flertai-actions">
            <button id="flertai-opener" class="flertai-primary">Abertura</button>
            <button id="flertai-reply" class="flertai-primary">Resposta</button>
            <button id="flertai-rewrite" class="flertai-primary">Reescrever</button>
            <button id="flertai-revive" class="flertai-primary">Reativar</button>
          </div>
          <label class="flertai-label">Sua resposta (opcional — o coach avalia se ela é boa)</label>
          <textarea id="flertai-draft" rows="2" placeholder="Escreva aqui a resposta que você pensou em mandar"></textarea>
          <button id="flertai-analyze-conv" class="flertai-coach">Analisar conversa (crítica honesta)</button>
          <div id="flertai-status" class="flertai-status"></div>
          <div id="flertai-results"></div>
        </div>

        <div class="flertai-pane flertai-hidden" data-pane="profile">
          <div class="flertai-row">
            <button id="flertai-detect-myprofile" class="flertai-secondary">↻ Detectar meu perfil</button>
            <label class="flertai-check"><input type="checkbox" id="flertai-include-photos" /> Analisar fotos</label>
          </div>
          <label class="flertai-label">Sua bio atual</label>
          <textarea id="flertai-mybio" rows="4" placeholder="Clique em 'Detectar meu perfil' (abra sua página de perfil antes) ou cole sua bio aqui"></textarea>
          <div id="flertai-photo-info" class="flertai-status"></div>
          <div class="flertai-actions">
            <button id="flertai-analyze" class="flertai-primary">Analisar e melhorar perfil</button>
          </div>
          <div id="flertai-profile-status" class="flertai-status"></div>
          <div id="flertai-profile-results"></div>
        </div>

        <div class="flertai-footer">FlertAI v<span id="flertai-version"></span> · revise antes de enviar</div>
      </div>
    `;
    document.body.appendChild(panel);
    wireEvents();
    makeDraggable(panel, panel.querySelector("#flertai-header"));
    refreshUsage();
    const ver = panel.querySelector("#flertai-version");
    if (ver) ver.textContent = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "?";
  }

  function wireEvents() {
    panel.querySelector("#flertai-close").addEventListener("click", togglePanel);

    // Abas
    panel.querySelectorAll(".flertai-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });

    // Mensagens
    panel.querySelector("#flertai-detect").addEventListener("click", () => {
      const conv = scrapeConversation();
      const ta = panel.querySelector("#flertai-conv");
      if (conv) {
        ta.value = conv;
        setStatus("#flertai-status", "Conversa detectada. Confira antes de gerar.");
      } else {
        setStatus("#flertai-status", "Não detectei. Cole a conversa manualmente.", true);
      }
    });
    panel.querySelector("#flertai-detect-profile").addEventListener("click", () => {
      const txt = scrapeProfileText();
      const bioEl = panel.querySelector("#flertai-bio");
      if (txt) {
        bioEl.value = txt;
        setStatus("#flertai-status", "Perfil do match detectado. Confira e gere a abertura.");
      } else {
        setStatus("#flertai-status", "Não detectei o perfil. Abra o perfil do match e tente, ou cole a bio.", true);
      }
    });
    panel.querySelector("#flertai-clear-msg").addEventListener("click", () => {
      panel.querySelector("#flertai-conv").value = "";
      panel.querySelector("#flertai-bio").value = "";
      panel.querySelector("#flertai-draft").value = "";
      panel.querySelector("#flertai-results").innerHTML = "";
      setStatus("#flertai-status", "Campos limpos.");
    });
    panel.querySelector("#flertai-opener").addEventListener("click", () => generateMessage("opener"));
    panel.querySelector("#flertai-reply").addEventListener("click", () => generateMessage("reply"));
    panel.querySelector("#flertai-rewrite").addEventListener("click", () => generateMessage("rewrite"));
    panel.querySelector("#flertai-revive").addEventListener("click", () => generateMessage("revive"));
    panel.querySelector("#flertai-analyze-conv").addEventListener("click", analyzeConversation);

    // Perfil
    panel.querySelector("#flertai-detect-myprofile").addEventListener("click", () => {
      const txt = scrapeProfileText();
      myPhotos = scrapeProfilePhotos();
      if (txt) panel.querySelector("#flertai-mybio").value = txt;
      const info = panel.querySelector("#flertai-photo-info");
      const tip = myPhotos.length < 2 ? " Para pegar todas, abra 'Editar perfil' (grade com todas as fotos) e clique de novo." : "";
      info.textContent = `${myPhotos.length} foto(s) detectada(s).${tip}` + (txt ? "" : " Bio não detectada — cole manualmente.");
      info.className = "flertai-status" + (myPhotos.length < 2 || !txt ? " flertai-error" : "");
    });
    panel.querySelector("#flertai-analyze").addEventListener("click", analyzeProfile);
  }

  function switchTab(name) {
    panel.querySelectorAll(".flertai-tab").forEach((t) =>
      t.classList.toggle("flertai-tab-active", t.dataset.tab === name)
    );
    panel.querySelectorAll(".flertai-pane").forEach((p) =>
      p.classList.toggle("flertai-hidden", p.dataset.pane !== name)
    );
  }

  function setStatus(sel, msg, isError) {
    const el = panel.querySelector(sel);
    el.textContent = msg || "";
    el.className = "flertai-status" + (isError ? " flertai-error" : "");
  }

  function refreshUsage() {
    chrome.runtime.sendMessage({ type: "FLERTAI_GET_STATUS" }, (res) => {
      if (!res || !res.ok) return;
      const el = panel.querySelector("#flertai-usage");
      if (res.loggedIn === false) {
        el.textContent = "—";
        setStatus("#flertai-status", "Faça login nas opções da extensão para usar.", true);
        return;
      }
      el.textContent = res.isPro ? "PRO" : `${res.used}/${res.limit} hoje`;
    });
  }

  // ---------- Mensagens ----------

  function generateMessage(action) {
    const conversation = panel.querySelector("#flertai-conv").value;
    let bio = panel.querySelector("#flertai-bio").value;
    const tone = panel.querySelector("#flertai-tone").value;

    if (action !== "opener" && !conversation.trim()) {
      setStatus("#flertai-status", "Detecte ou cole a conversa primeiro.", true);
      return;
    }

    // Abertura sem bio preenchida: tenta ler o perfil do match automaticamente.
    if (action === "opener" && !bio.trim()) {
      const auto = scrapeProfileText();
      if (auto) {
        bio = auto;
        panel.querySelector("#flertai-bio").value = auto;
        setStatus("#flertai-status", "Perfil do match lido automaticamente.");
      }
    }
    setMsgButtonsDisabled(true);
    setStatus("#flertai-status", "Gerando sugestões…");
    panel.querySelector("#flertai-results").innerHTML = "";

    chrome.runtime.sendMessage(
      {
        type: "FLERTAI_GENERATE",
        payload: { action, conversation, bio, tone, matchName: detectMatchName() }
      },
      (res) => {
        setMsgButtonsDisabled(false);
        if (!res) return setStatus("#flertai-status", "Sem resposta. Recarregue a página.", true);
        if (!res.ok) return setStatus("#flertai-status", res.error || "Erro ao gerar.", true);
        setStatus("#flertai-status", "");
        renderCards("#flertai-results", res.suggestions || []);
        refreshUsage();
      }
    );
  }

  function setMsgButtonsDisabled(d) {
    panel.querySelectorAll('[data-pane="msg"] .flertai-primary').forEach((b) => (b.disabled = d));
  }

  function analyzeConversation() {
    const conversation = panel.querySelector("#flertai-conv").value;
    const bio = panel.querySelector("#flertai-bio").value;
    const draft = panel.querySelector("#flertai-draft").value;
    if (!conversation.trim()) {
      setStatus("#flertai-status", "Detecte ou cole a conversa primeiro.", true);
      return;
    }
    const coachBtn = panel.querySelector("#flertai-analyze-conv");
    setMsgButtonsDisabled(true);
    coachBtn.disabled = true;
    setStatus("#flertai-status", "Analisando a conversa…");
    panel.querySelector("#flertai-results").innerHTML = "";

    chrome.runtime.sendMessage(
      { type: "FLERTAI_ANALYZE_CONV", payload: { conversation, bio, draft, matchName: detectMatchName() } },
      (res) => {
        setMsgButtonsDisabled(false);
        coachBtn.disabled = false;
        if (!res) return setStatus("#flertai-status", "Sem resposta. Recarregue a página.", true);
        if (!res.ok) return setStatus("#flertai-status", res.error || "Erro ao analisar.", true);
        setStatus("#flertai-status", "");
        renderConversationAnalysis(res);
        refreshUsage();
      }
    );
  }

  function renderConversationAnalysis(res) {
    const box = panel.querySelector("#flertai-results");
    box.innerHTML = "";

    const a = document.createElement("div");
    a.className = "flertai-analysis";
    if (res.estagio) {
      const e = document.createElement("div");
      e.className = "flertai-stage";
      e.textContent = "Estágio: " + res.estagio;
      a.appendChild(e);
    }
    if (res.veredito) {
      const v = document.createElement("div");
      v.className = "flertai-verdict";
      v.textContent = "Veredito: " + res.veredito;
      a.appendChild(v);
    }
    if (res.interesse != null) {
      const s = document.createElement("span");
      s.className = "flertai-score";
      s.textContent = "Interesse dela: " + res.interesse + "/10";
      a.appendChild(s);
    }
    if (res.analise) {
      const t = document.createElement("div");
      t.style.marginTop = "6px";
      t.textContent = res.analise;
      a.appendChild(t);
    }
    box.appendChild(a);

    // Avaliação do rascunho do usuário (se ele escreveu uma resposta própria)
    if (res.rascunho && (res.rascunho.veredito || res.rascunho.comentario)) {
      const r = res.rascunho;
      const d = document.createElement("div");
      d.className = "flertai-analysis";

      const head = document.createElement("div");
      head.className = "flertai-verdict";
      head.textContent =
        "Sua resposta: " + (r.veredito || "avaliada") + (r.nota != null ? ` (${r.nota}/10)` : "");
      d.appendChild(head);

      if (r.comentario) {
        const c = document.createElement("div");
        c.style.marginTop = "6px";
        c.textContent = r.comentario;
        d.appendChild(c);
      }
      box.appendChild(d);

      if (r.versaoAjustada) {
        const lbl = document.createElement("div");
        lbl.className = "flertai-label";
        lbl.textContent = "Sua resposta, ajustada";
        box.appendChild(lbl);
        renderCardsInto(box, [r.versaoAjustada]);
      }
    }

    if (res.respostas && res.respostas.length) {
      const lbl = document.createElement("div");
      lbl.className = "flertai-label";
      lbl.textContent = res.rascunho && res.rascunho.veredito
        ? "Alternativas do coach"
        : "Resposta sugerida (alinhada à análise)";
      box.appendChild(lbl);
      renderCardsInto(box, res.respostas);
    }

    if (res.proximos && res.proximos.length) {
      const lbl = document.createElement("div");
      lbl.className = "flertai-label";
      lbl.textContent = "Próximos passos";
      box.appendChild(lbl);
      res.proximos.forEach((p) => {
        const c = document.createElement("div");
        c.className = "flertai-card";
        const pp = document.createElement("p");
        pp.textContent = p;
        c.appendChild(pp);
        box.appendChild(c);
      });
    }
  }

  // ---------- Perfil ----------

  function analyzeProfile() {
    const bio = panel.querySelector("#flertai-mybio").value;
    const includePhotos = panel.querySelector("#flertai-include-photos").checked;
    const photos = includePhotos ? myPhotos : [];

    if (!bio.trim() && photos.length === 0) {
      setStatus("#flertai-profile-status", "Detecte seu perfil ou cole sua bio primeiro.", true);
      return;
    }
    if (includePhotos && photos.length === 0) {
      setStatus("#flertai-profile-status", "Nenhuma foto detectada. Clique em 'Detectar meu perfil' na sua página de perfil.", true);
      return;
    }
    const btn = panel.querySelector("#flertai-analyze");
    btn.disabled = true;
    setStatus("#flertai-profile-status", photos.length ? "Analisando bio e fotos…" : "Analisando…");
    panel.querySelector("#flertai-profile-results").innerHTML = "";

    chrome.runtime.sendMessage({ type: "FLERTAI_PROFILE", payload: { bio, photos } }, (res) => {
      btn.disabled = false;
      if (!res) return setStatus("#flertai-profile-status", "Sem resposta. Recarregue.", true);
      if (!res.ok) return setStatus("#flertai-profile-status", res.error || "Erro.", true);
      setStatus("#flertai-profile-status", "");

      const box = panel.querySelector("#flertai-profile-results");
      const analysis = document.createElement("div");
      analysis.className = "flertai-analysis";
      if (res.score != null) {
        const s = document.createElement("span");
        s.className = "flertai-score";
        s.textContent = `Nota: ${res.score}/10`;
        analysis.appendChild(s);
        analysis.appendChild(document.createTextNode(" "));
      }
      const txt = document.createElement("span");
      txt.textContent = res.analysis || "";
      analysis.appendChild(txt);
      box.appendChild(analysis);

      const label = document.createElement("div");
      label.className = "flertai-label";
      label.textContent = "Bios sugeridas";
      box.appendChild(label);

      const wrap = document.createElement("div");
      box.appendChild(wrap);
      renderCardsInto(wrap, res.suggestions || []);
      refreshUsage();
    });
  }

  // ---------- Render de cards ----------

  function renderCards(sel, suggestions) {
    renderCardsInto(panel.querySelector(sel), suggestions, sel);
  }

  function renderCardsInto(box, suggestions) {
    if (!suggestions || suggestions.length === 0) return;
    suggestions.forEach((text) => {
      const card = document.createElement("div");
      card.className = "flertai-card";
      const p = document.createElement("p");
      p.textContent = text;
      const copy = document.createElement("button");
      copy.className = "flertai-copy";
      copy.textContent = "Copiar";
      copy.addEventListener("click", () => {
        navigator.clipboard.writeText(text).then(() => {
          copy.textContent = "Copiado ✓";
          setTimeout(() => (copy.textContent = "Copiar"), 1500);
        });
      });
      card.appendChild(p);
      card.appendChild(copy);
      box.appendChild(card);
    });
  }

  // ==================== Arrastar ====================

  function makeDraggable(el, handle) {
    let startX, startY, origX, origY, dragging = false;
    handle.style.cursor = "move";
    handle.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      el.style.right = "auto";
      el.style.bottom = "auto";
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      el.style.left = origX + (e.clientX - startX) + "px";
      el.style.top = origY + (e.clientY - startY) + "px";
    });
    document.addEventListener("mouseup", () => (dragging = false));
  }

  // ==================== Init ====================

  function init() {
    if (document.getElementById("flertai-launcher")) return;
    createLauncher();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
