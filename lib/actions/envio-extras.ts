"use server";

import { getAppUser } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";

/* Apoio do campo de mensagem em Atendimentos: achar endereço (localização) e
   contatos já cadastrados (cartão de contato). */

export type EnderecoEncontrado = {
  nome: string;
  endereco: string;
  latitude: number;
  longitude: number;
};

type NominatimItem = {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
};

// OpenStreetMap (gratuito). Pede um User-Agent identificado e uso moderado.
const NOMINATIM = "https://nominatim.openstreetmap.org";
const NOMINATIM_HEADERS = {
  "User-Agent": "sistema-escritorio/1.0 (atendimentos)",
  "Accept-Language": "pt-BR",
};

function paraEndereco(item: NominatimItem): EnderecoEncontrado {
  const partes = item.display_name
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && p !== "Brasil" && !/^Região /.test(p));
  // "1000, Rua X, ..." → "Rua X, 1000"
  const nome =
    item.name?.trim() ||
    (/^\d+[A-Za-z]?$/.test(partes[0] ?? "") && partes[1]
      ? `${partes[1]}, ${partes[0]}`
      : partes[0]) ||
    item.display_name;
  return {
    nome,
    endereco: partes.join(", "),
    latitude: Number(item.lat),
    longitude: Number(item.lon),
  };
}

/** CEP vira "rua, cidade - UF" (o mapa não acha CEP brasileiro direito). */
async function cepParaBusca(cep: string, resto: string): Promise<string | null> {
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      erro?: boolean;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
    };
    if (d.erro || !d.localidade) return null;
    const rua = [d.logradouro, resto].filter(Boolean).join(" ");
    return [rua || d.bairro, `${d.localidade} - ${d.uf}`].filter(Boolean).join(", ");
  } catch {
    return null;
  }
}

export async function buscarEndereco(termo: string): Promise<EnderecoEncontrado[]> {
  if (!(await getAppUser())) throw new Error("Não autenticado");
  let q = termo.trim();
  if (q.length < 3) return [];
  const cep = q.match(/\b(\d{5})-?(\d{3})\b/);
  if (cep) {
    const resto = q.replace(cep[0], "").replace(/^[\s,.-]+|[\s,.-]+$/g, "");
    q = (await cepParaBusca(cep[1] + cep[2], resto)) ?? q;
  }
  const url = `${NOMINATIM}/search?format=jsonv2&countrycodes=br&limit=6&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: NOMINATIM_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error("Busca de endereço indisponível agora. Tente de novo em instantes.");
  const itens = (await res.json()) as NominatimItem[];
  return itens.map(paraEndereco);
}

/** Endereço do ponto (para "usar minha localização atual"). */
export async function enderecoDaPosicao(
  latitude: number,
  longitude: number
): Promise<EnderecoEncontrado | null> {
  if (!(await getAppUser())) throw new Error("Não autenticado");
  const url = `${NOMINATIM}/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`;
  try {
    const res = await fetch(url, { headers: NOMINATIM_HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const item = (await res.json()) as NominatimItem & { error?: string };
    if (item.error) return null;
    return { ...paraEndereco(item), latitude, longitude };
  } catch {
    return null;
  }
}

export type ContatoPlataforma = {
  nome: string;
  telefone: string;
  origem: "cliente" | "parceiro";
  detalhe: string | null;
};

export async function buscarContatosPlataforma(termo: string): Promise<ContatoPlataforma[]> {
  if (!(await getAppUser())) throw new Error("Não autenticado");
  const q = termo.trim();
  const supabase = await createClient();
  const digitos = q.replace(/\D/g, "");
  const filtro = !q
    ? null
    : digitos.length >= 3
      ? `telefone.ilike.%${digitos}%`
      : `nome.ilike.%${q.replace(/[%,()]/g, " ")}%`;

  let casosQ = supabase
    .from("casos_novos")
    .select("nome, telefone, beneficio_identificado")
    .not("telefone", "is", null)
    .order("created_at", { ascending: false })
    .limit(15);
  let parceirosQ = supabase
    .from("app_parceiros")
    .select("nome, telefone, cidade")
    .order("nome")
    .limit(10);
  if (filtro) {
    casosQ = casosQ.or(filtro);
    parceirosQ = parceirosQ.or(filtro);
  }
  const [casos, parceiros] = await Promise.all([casosQ, parceirosQ]);

  const vistos = new Set<string>();
  const lista: ContatoPlataforma[] = [];
  for (const p of parceiros.data ?? []) {
    const tel = p.telefone?.replace(/\D/g, "");
    if (!tel || vistos.has(tel)) continue;
    vistos.add(tel);
    lista.push({ nome: p.nome, telefone: tel, origem: "parceiro", detalhe: p.cidade || null });
  }
  for (const c of casos.data ?? []) {
    const tel = c.telefone?.replace(/@.*$/, "").replace(/\D/g, "");
    if (!tel || vistos.has(tel)) continue;
    vistos.add(tel);
    lista.push({
      nome: c.nome?.trim() || "Sem nome",
      telefone: tel,
      origem: "cliente",
      detalhe: c.beneficio_identificado || null,
    });
  }
  return lista;
}
