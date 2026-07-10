// FlertAI — Ponte entre a landing page e a extensão.
//
// Problema: o site guarda a sessão em localStorage (origem da landing) e a
// extensão em chrome.storage.local — armazenamentos separados. Sem esta ponte,
// quem faz login no site precisaria logar de novo na extensão.
//
// Este content script roda SOMENTE na origem da landing (ver manifest.json) e:
//   1. ao abrir a página, lê uma sessão já existente e a envia ao service worker;
//   2. escuta o postMessage que a landing emite no momento do login.
//
// Nada é enviado para fora: a mensagem é local (page -> content script -> extensão).

(function () {
  "use strict";

  var SS_KEY = "flertai_session";

  function send(session) {
    if (!session || !session.access_token || !session.refresh_token) return;
    try {
      chrome.runtime.sendMessage({ type: "FLERTAI_SYNC_SESSION", payload: { session: session } });
    } catch (e) {
      // Extensão recarregada/desativada: nada a fazer.
    }
  }

  // 1) Sessão que já existia quando a página abriu.
  try {
    var raw = localStorage.getItem(SS_KEY);
    if (raw) send(JSON.parse(raw));
  } catch (e) { /* localStorage indisponível */ }

  // 2) Login acontecendo agora nesta aba.
  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;                 // só mensagens desta própria página
    if (ev.origin !== window.location.origin) return; // e da própria origem
    var d = ev.data;
    if (!d || d.source !== "flertai-landing") return;
    if (d.type === "SESSION" && d.session) send(d.session);
  });
})();
