export type TipoDocumento = "procuracao" | "honorarios" | "hipossuficiencia";

export const TIPOS_DOCUMENTO: Record<TipoDocumento, string> = {
  procuracao: "Procuração ad judicia",
  honorarios: "Contrato de honorários advocatícios",
  hipossuficiencia: "Declaração de hipossuficiência",
};

export function isTipoDocumento(v: string): v is TipoDocumento {
  return v in TIPOS_DOCUMENTO;
}
