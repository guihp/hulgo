import webpush from "web-push";
import { createServiceClient } from "@/lib/supabase/service";

export type PainelPushKind =
  | "mensagem"
  | "kanban"
  | "transferencia"
  | "documento"
  | "aprovacao"
  | "prazo";

export type EmitPainelPushInput = {
  title: string;
  body: string;
  href: string;
  kind: PainelPushKind;
  /** Se omitido → todos os app_usuarios ativos */
  userIds?: string[];
  tag?: string;
};

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject =
    process.env.VAPID_SUBJECT?.trim() || "mailto:contato@iafeoficial.com";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

/**
 * Envia Web Push para usuários do painel.
 * Destinatários padrão: todos os app_usuarios ativos.
 * Remove subscriptions mortas (410/404).
 */
export async function emitPainelPush(
  input: EmitPainelPushInput
): Promise<{ sent: number; removed: number; skipped: boolean }> {
  if (!ensureVapid()) {
    console.warn("[push] VAPID não configurado — push ignorado");
    return { sent: 0, removed: 0, skipped: true };
  }

  const service = createServiceClient();

  let userIds = input.userIds;
  if (!userIds?.length) {
    const { data: users, error } = await service
      .from("app_usuarios")
      .select("id")
      .eq("ativo", true);
    if (error) {
      console.error("[push] listar usuários:", error.message);
      return { sent: 0, removed: 0, skipped: true };
    }
    userIds = (users ?? []).map((u) => u.id);
  }

  if (!userIds.length) {
    return { sent: 0, removed: 0, skipped: false };
  }

  const { data: subs, error: subErr } = await service
    .from("app_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  if (subErr) {
    console.error("[push] listar subscriptions:", subErr.message);
    return { sent: 0, removed: 0, skipped: true };
  }

  if (!subs?.length) {
    return { sent: 0, removed: 0, skipped: false };
  }

  const payload = JSON.stringify({
    title: input.title,
    body: input.body,
    href: input.href,
    tag: input.tag ?? `${input.kind}-${Date.now()}`,
    kind: input.kind,
  });

  let sent = 0;
  let removed = 0;
  const deadIds: number[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
          { TTL: 60 * 60 * 12, urgency: "normal" }
        );
        sent += 1;
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: number }).statusCode)
            : 0;
        if (status === 404 || status === 410) {
          deadIds.push(sub.id);
          removed += 1;
        } else {
          console.warn(
            "[push] falha envio:",
            err instanceof Error ? err.message : err
          );
        }
      }
    })
  );

  if (deadIds.length) {
    await service.from("app_push_subscriptions").delete().in("id", deadIds);
  }

  return { sent, removed, skipped: false };
}
