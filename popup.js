// FlertAI — lógica do popup da barra de ferramentas (v0.10.0).
// Mostra o status da conta vindo do BACKEND (a extensão só reflete).

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.sendMessage({ type: "FLERTAI_GET_STATUS" }, (res) => {
  const el = document.getElementById("status");
  if (!res || !res.ok) {
    // textContent (nunca innerHTML) para texto vindo de fora — evita XSS.
    const span = document.createElement("span");
    span.className = "warn";
    span.textContent = (res && res.error) || "Não foi possível ler o status.";
    el.replaceChildren(span);
    return;
  }
  if (!res.loggedIn) {
    el.innerHTML = '<span class="warn">⚠ Faça login nas opções para usar.</span>';
    return;
  }
  if (res.isPro) {
    el.textContent = `✓ ${res.email} · PRO`;
  } else {
    const credits = res.credits ? ` (+${res.credits} créditos)` : "";
    el.textContent = `✓ ${res.email} · ${res.used}/${res.limit} hoje${credits}`;
  }
});
