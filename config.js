// XavecAI — Configuração do backend.
// ÚNICO arquivo a preencher depois de criar o projeto no Supabase
// (passo a passo em backend/README.md).
//
// Onde achar os valores: painel do Supabase → Settings → API.
//   - SUPABASE_URL: "Project URL" (ex.: https://abcdefghij.supabase.co)
//   - SUPABASE_ANON_KEY: chave "anon / public" (pode ficar no cliente; ela NÃO dá
//     acesso a nada sozinha — o que protege os dados é o login + RLS + service_role
//     que vive só no servidor).

globalThis.FLERTAI_CONFIG = {
  SUPABASE_URL: "https://rkjqgmuoygshcjajkmjl.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_K8afhmlbCebY4QFXXvVRmw_4bvGOkpz"
};
