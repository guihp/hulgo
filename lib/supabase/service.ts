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

  serviceClient = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return serviceClient;
}
