"use server";

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";

export type AppUser = {
  id: string;
  nome: string;
  papel: UserRole;
  email: string;
};

export async function getAppUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("app_usuarios")
    .select("id, nome, papel")
    .eq("id", user.id)
    .eq("ativo", true)
    .single();

  if (!profile) return null;

  return {
    id: profile.id,
    nome: profile.nome,
    papel: profile.papel as UserRole,
    email: user.email ?? "",
  };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
