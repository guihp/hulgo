/** Destino e títulos de notificação por tipo de app_prazos (prazo / audiência / pagamento). */
export function rotulosPrazo(tipo: string | null | undefined) {
  if (tipo === "audiencia") {
    return {
      href: "/audiencias",
      substantivo: "Audiência",
      novo: "⚖️ Nova audiência",
      lembrete: "⚖️ Audiência",
    };
  }
  if (tipo === "pagamento") {
    return {
      href: "/pagamentos",
      substantivo: "Pagamento",
      novo: "💰 Novo pagamento",
      lembrete: "💰 Lembrete de pagamento",
    };
  }
  return {
    href: "/prazos",
    substantivo: "Prazo",
    novo: "📅 Novo prazo",
    lembrete: "🔔 Lembrete de prazo",
  };
}
