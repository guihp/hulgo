import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

let serviceClient: ReturnType<typeof createClient<Database>> | null = null;

export function createServiceClient() {
  if (serviceClient) return serviceClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url?.trim()) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL não configurada");
  }
  if (!serviceKey?.trim()) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada no servidor");
  }

  try {
    const payload = serviceKey.split(".")[1];
    if (payload) {
      const role = (
        JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
          role?: string;
        }
      ).role;
      if (role && role !== "service_role") {
        throw new Error(
          `SUPABASE_SERVICE_ROLE_KEY inválida (role=${role}). Use a service_role do Supabase, não a anon/publishable.`
        );
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      throw e;
    }
  }

  serviceClient = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    },
  });

  return serviceClient;
}
