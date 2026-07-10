# ✦ FlertAI — Extensão para Chrome (beta)

Assistente de mensagens para o Tinder: gera **aberturas**, sugere **respostas** e tem um **coach honesto** que analisa a conversa — usando IA. Você sempre revisa antes de enviar; a extensão **não** envia mensagens nem faz swipes automáticos.

> Este repositório contém **apenas a extensão** (o que roda no seu navegador). O processamento de IA acontece num backend próprio — nenhuma chave de IA fica aqui.

## ⬇️ Instalar (modo desenvolvedor)

1. Baixe o ZIP em **[Releases](../../releases/latest)** e **descompacte** numa pasta.
2. Abra o Chrome em `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta descompactada.
5. Clique no ícone ✦ → **Abrir opções** → faça login com seu e-mail (código de 6 dígitos).
   *(Ou apenas faça login em [flertai-landing.netlify.app](https://flertai-landing.netlify.app) — a extensão sincroniza a sessão sozinha.)*
6. Abra o Tinder, entre numa conversa e clique no botão ✦.

## Como funciona

- Botão flutuante ✦ dentro do `tinder.com`, com painel arrastável (abas **Mensagens** e **Perfil**).
- **Abertura / Resposta / Reescrever / Reativar** — 3 sugestões por vez, em 6 tons.
- **Analisar conversa** — estágio, nível de interesse (0–10), veredito e resposta sugerida.
- Plano grátis: 5 gerações/dia + **3 análises completas de boas-vindas**.

## Privacidade

A extensão processa tudo **sob demanda** e **não armazena** conversas, bios ou fotos. As fotos analisadas são **somente do seu próprio perfil**, quando você pede. Ela pede o mínimo de permissões (`storage`, `clipboardWrite`) e acesso restrito ao domínio do Tinder.

## Aviso

Foco em **assistência à escrita**, não em automação. Use de forma honesta e respeitosa — as sugestões são um ponto de partida; revise antes de enviar. Somente maiores de 18 anos.

© 2026 FlertAI — Todos os direitos reservados. Ver [`LICENSE`](./LICENSE).
