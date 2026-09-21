/** Client event: AgenteIaPanel should refetch draft after assistente save/revert. */
export const AGENTE_CONFIG_UPDATED_EVENT = "hulgo:agente-config-updated";

export function dispatchAgenteConfigUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENTE_CONFIG_UPDATED_EVENT));
}
