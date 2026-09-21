/** Mock advogado session for live assistente smoke outside Next. */
const ADV_ID =
  process.env.SMOKE_APP_USER_ID?.trim() ||
  "fccc778c-8736-47a5-865d-db91af8b5cf7";

async function getAppUser() {
  return {
    id: ADV_ID,
    nome: "Smoke Advogado",
    papel: "advogado",
    email: "smoke@local.test",
  };
}

async function signOut() {}

module.exports = { getAppUser, signOut };
