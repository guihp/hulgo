import "server-only";

import { getProfilePictureUrl } from "@/lib/evogo/client";
import { normalizarTelefone } from "@/lib/ia-whatsapp/config";
import { createServiceClient } from "@/lib/supabase/service";

const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

function comTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS)),
  ]);
}

/**
 * Copia a foto de perfil do WhatsApp para o bucket (a URL do WhatsApp expira)
 * e grava em app_ia_estado.foto_url. Usa só o JID que veio no webhook — não
 * adivinha o 9º dígito, para nunca mostrar a foto de outra pessoa.
 * Refaz no máximo a cada 7 dias. Nunca lança: não pode quebrar o webhook.
 */
export async function atualizarFotoPerfil(
  telefoneBruto: string,
  jidRecebido?: string | null
): Promise<string | null> {
  const telefone = normalizarTelefone(telefoneBruto);
  if (!telefone) return null;
  const supabase = createServiceClient();

  try {
    const { data: estado } = await supabase
      .from("app_ia_estado")
      .select("foto_url, foto_verificada_em, whatsapp_jid")
      .eq("telefone", telefone)
      .maybeSingle();

    const jid = jidRecebido?.endsWith("@s.whatsapp.net")
      ? jidRecebido
      : estado?.whatsapp_jid ?? null;
    if (!jid) return estado?.foto_url ?? null;

    const verificadaEm = estado?.foto_verificada_em
      ? new Date(estado.foto_verificada_em).getTime()
      : 0;
    if (jid === estado?.whatsapp_jid && Date.now() - verificadaEm < VALIDADE_MS) {
      return estado?.foto_url ?? null;
    }

    const urlWhatsapp = await comTimeout(getProfilePictureUrl(jid));
    let fotoUrl: string | null = null;
    if (urlWhatsapp) {
      const res = await comTimeout(fetch(urlWhatsapp, { cache: "no-store" }));
      if (!res.ok) throw new Error(`download da foto: HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const path = `avatars/${telefone}.jpg`;
      const { error } = await supabase.storage
        .from("mensagens-media")
        .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error(`upload da foto: ${error.message}`);
      const publica = supabase.storage.from("mensagens-media").getPublicUrl(path).data.publicUrl;
      fotoUrl = `${publica}?v=${Date.now()}`;
    }

    await supabase.from("app_ia_estado").upsert(
      {
        telefone,
        foto_url: fotoUrl,
        foto_verificada_em: new Date().toISOString(),
        whatsapp_jid: jid,
      },
      { onConflict: "telefone" }
    );
    return fotoUrl;
  } catch (e) {
    console.warn("[foto-perfil]", telefone, e instanceof Error ? e.message : e);
    return null;
  }
}
