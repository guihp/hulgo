"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/actions/auth";

export type PushSubscriptionInput = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export async function subscribePush(sub: PushSubscriptionInput) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const endpoint = sub.endpoint?.trim();
  const p256dh = sub.keys?.p256dh?.trim();
  const auth = sub.keys?.auth?.trim();
  if (!endpoint || !p256dh || !auth) {
    throw new Error("Subscription inválida");
  }

  const hdrs = await headers();
  const userAgent = hdrs.get("user-agent")?.slice(0, 500) ?? null;

  const supabase = await createClient();
  const { error } = await supabase.from("app_push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: userAgent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );

  if (error) throw new Error(error.message);
  return { success: true as const };
}

export async function unsubscribePush(endpoint?: string) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");

  const supabase = await createClient();
  let q = supabase
    .from("app_push_subscriptions")
    .delete()
    .eq("user_id", user.id);
  if (endpoint?.trim()) {
    q = q.eq("endpoint", endpoint.trim());
  }
  const { error } = await q;
  if (error) throw new Error(error.message);
  return { success: true as const };
}
