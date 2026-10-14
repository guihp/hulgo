/**
 * Resposta do agente → mensagens de WhatsApp (substitui o "Parser Chain" do n8n).
 * Regras: um parágrafo por mensagem; lista fica junto da frase que a introduz;
 * saudação curta pode ir sozinha; markdown vira formatação do WhatsApp.
 */

const MAX_MENSAGENS = 5;

export function paraWhatsapp(texto: string): string {
  return texto
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/^#{1,6}\s*(.+)$/gm, "*$1*")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1: $2")
    // "* item" / "- item" viram "• item" (asterisco solto confunde com negrito)
    .replace(/^[ \t]*[*-][ \t]+/gm, "• ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

const ITEM_LISTA = /^\s*(?:[-•*]|\d+[.)])\s+/;

export function dividirResposta(texto: string): string[] {
  const paragrafos = paraWhatsapp(texto)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const blocos: string[] = [];
  for (const p of paragrafos) {
    const anterior = blocos[blocos.length - 1];
    const ehLista = p.split("\n").every((l) => ITEM_LISTA.test(l) || !l.trim());
    if (anterior && (ehLista || /:\s*$/.test(anterior))) {
      blocos[blocos.length - 1] = `${anterior}\n${p}`;
    } else {
      blocos.push(p);
    }
  }

  if (blocos.length > MAX_MENSAGENS) {
    const cabeca = blocos.slice(0, MAX_MENSAGENS - 1);
    return [...cabeca, blocos.slice(MAX_MENSAGENS - 1).join("\n\n")];
  }
  return blocos;
}

/** Pausa proporcional ao tamanho (parece digitação, sem exagero). */
export function atrasoDigitacaoMs(texto: string): number {
  return Math.min(4000, 800 + texto.length * 15);
}
