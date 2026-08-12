import { createClient } from "@/lib/supabase/server";
import { phoneToContactNorm } from "@/lib/utils/phone";
import type { Tables } from "@/types/database";

export type CasoResumo = Pick<
  Tables<"casos_novos">,
  "id" | "nome" | "telefone" | "cpf" | "beneficio_identificado"
>;

export type DocumentoComCaso = Tables<"documentos_cliente"> & {
  caso: CasoResumo | null;
};

export type MidiaChat = {
  id: number;
  url: string;
  created_at: string;
  mensage_type: string | null;
  text: string | null;
};

export type ClienteArquivosGrupo = {
  contactNorm: string;
  phone: string;
  displayName: string | null;
  documentos: DocumentoComCaso[];
  midiasChat: MidiaChat[];
  lastAt: string | null;
};

function attachCasos(
  docs: Tables<"documentos_cliente">[],
  casos: CasoResumo[]
): DocumentoComCaso[] {
  const casoMap = new Map(casos.map((c) => [c.id, c]));
  return docs.map((doc) => ({
    ...doc,
    caso: doc.caso_id != null ? (casoMap.get(doc.caso_id) ?? null) : null,
  }));
}

export async function fetchAllDocumentos(): Promise<DocumentoComCaso[]> {
  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documentos_cliente")
    .select("*")
    .order("created_at", { ascending: false });

  if (!docs?.length) return [];

  const casoIds = [
    ...new Set(docs.map((d) => d.caso_id).filter((id): id is number => id != null)),
  ];
  const casos = casoIds.length
    ? (
        await supabase
          .from("casos_novos")
          .select("id, nome, telefone, cpf, beneficio_identificado")
          .in("id", casoIds)
      ).data
    : [];

  return attachCasos(docs, casos ?? []);
}

export async function fetchMidiasChatByContact(
  contactNorm: string
): Promise<MidiaChat[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("mensagens")
    .select("id, conteudo_media, created_at, mensage_type, text")
    .eq("contact_norm", contactNorm)
    .not("conteudo_media", "is", null)
    .order("created_at", { ascending: false });

  return (data ?? [])
    .filter((m) => m.conteudo_media?.trim())
    .map((m) => ({
      id: m.id,
      url: m.conteudo_media!,
      created_at: m.created_at,
      mensage_type: m.mensage_type,
      text: m.text,
    }));
}

export async function fetchArquivosByContact(
  contactNorm: string
): Promise<{
  documentos: DocumentoComCaso[];
  midiasChat: MidiaChat[];
  casos: CasoResumo[];
}> {
  const supabase = await createClient();

  const { data: casos } = await supabase
    .from("casos_novos")
    .select("id, nome, telefone, cpf, beneficio_identificado");

  const casosDoContato = (casos ?? []).filter(
    (c) => phoneToContactNorm(c.telefone) === contactNorm
  );

  let documentos: DocumentoComCaso[] = [];
  if (casosDoContato.length) {
    const casoIds = casosDoContato.map((c) => c.id);
    const { data: docs } = await supabase
      .from("documentos_cliente")
      .select("*")
      .in("caso_id", casoIds)
      .order("created_at", { ascending: false });

    documentos = attachCasos(docs ?? [], casosDoContato);
  }

  const midiasChat = await fetchMidiasChatByContact(contactNorm);
  const urlsRegistradas = new Set(
    documentos.map((d) => d.url_media).filter(Boolean)
  );
  const midiasNaoRegistradas = midiasChat.filter(
    (m) => !urlsRegistradas.has(m.url)
  );

  return {
    documentos,
    midiasChat: midiasNaoRegistradas,
    casos: casosDoContato,
  };
}

export function groupDocumentosPorCliente(
  documentos: DocumentoComCaso[],
  contactNames: Record<string, string>
): ClienteArquivosGrupo[] {
  const groups = new Map<string, ClienteArquivosGrupo>();

  for (const doc of documentos) {
    const contactNorm = phoneToContactNorm(doc.caso?.telefone);
    if (!contactNorm) continue;

    const existing = groups.get(contactNorm);
    if (existing) {
      existing.documentos.push(doc);
      if (doc.created_at > (existing.lastAt ?? "")) {
        existing.lastAt = doc.created_at;
      }
      continue;
    }

    groups.set(contactNorm, {
      contactNorm,
      phone: doc.caso?.telefone ?? contactNorm,
      displayName: contactNames[contactNorm] ?? doc.caso?.nome ?? null,
      documentos: [doc],
      midiasChat: [],
      lastAt: doc.created_at,
    });
  }

  return [...groups.values()].sort((a, b) =>
    (b.lastAt ?? "").localeCompare(a.lastAt ?? "")
  );
}

export async function fetchFichaArquivos(opts: {
  cpf?: string | null;
  contactNorms: string[];
  casoIds: number[];
}): Promise<{
  documentos: Tables<"documentos_cliente">[];
  pastas: Tables<"documentos_pastas">[];
  midiasChat: MidiaChat[];
}> {
  const supabase = await createClient();
  const contacts = [...new Set(opts.contactNorms.filter(Boolean))];
  const cpf = opts.cpf?.replace(/\D/g, "") || null;

  const docParts: string[] = [];
  if (cpf) docParts.push(`cpf.eq.${cpf}`);
  for (const c of contacts) docParts.push(`contact_norm.eq.${c}`);
  for (const id of opts.casoIds) docParts.push(`caso_id.eq.${id}`);

  const pastaParts: string[] = [];
  if (cpf) pastaParts.push(`cpf.eq.${cpf}`);
  for (const c of contacts) pastaParts.push(`contact_norm.eq.${c}`);

  const [docsRes, pastasRes, midiasList] = await Promise.all([
    docParts.length
      ? supabase
          .from("documentos_cliente")
          .select("*")
          .or(docParts.join(","))
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Tables<"documentos_cliente">[] }),
    pastaParts.length
      ? supabase
          .from("documentos_pastas")
          .select("*")
          .or(pastaParts.join(","))
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as Tables<"documentos_pastas">[] }),
    Promise.all(contacts.map((c) => fetchMidiasChatByContact(c))),
  ]);

  const documentos = docsRes.data ?? [];
  const urlsRegistradas = new Set(
    documentos.map((d) => d.url_media).filter(Boolean)
  );
  const midiasChat = midiasList
    .flat()
    .filter((m) => !urlsRegistradas.has(m.url));

  return {
    documentos,
    pastas: pastasRes.data ?? [],
    midiasChat,
  };
}

