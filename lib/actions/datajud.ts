"use server";

import { revalidatePath } from "next/cache";
import { getAppUser } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { consultarDataJud, type ResultadoDataJud } from "@/lib/datajud";

export async function consultarProcessoDataJud(
  numeroProcesso: string
): Promise<ResultadoDataJud> {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  return consultarDataJud(numeroProcesso);
}

/** Liga/desliga a reconsulta automática do processo (null = desligado). */
export async function definirMonitoramento(
  processoId: number,
  dias: number | null
) {
  const user = await getAppUser();
  if (!user) throw new Error("Não autenticado");
  if (dias !== null && ![1, 3, 7, 15, 30].includes(dias)) {
    throw new Error("Frequência inválida");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("processos_clientes")
    .update({ monitorar_dias: dias })
    .eq("id", processoId);
  if (error) throw new Error(error.message);

  revalidatePath("/clientes");
  return { success: true };
}
