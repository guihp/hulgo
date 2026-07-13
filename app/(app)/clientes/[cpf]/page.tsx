import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Cliente360 } from "@/components/clientes/clientes-ui";
import { DataJudPanel } from "@/components/clientes/datajud-panel";
import { NovoPrazoDialog, PrazosList } from "@/components/prazos/prazos-ui";
import { LinkButton } from "@/components/ui/link-button";
import { normalizeCpf } from "@/lib/utils/cpf";
import { phoneToContactNorm } from "@/lib/utils/phone";
import type { Tables } from "@/types/database";

export default async function Cliente360Page({
  params,
}: {
  params: Promise<{ cpf: string }>;
}) {
  const { cpf: cpfParam } = await params;
  const cpf = normalizeCpf(cpfParam);
  const supabase = await createClient();

  const [{ data: processos }, { data: casos }, { data: prazos }] =
    await Promise.all([
      supabase.from("processos_clientes").select("*").eq("cpf", cpf),
      supabase.from("casos_novos").select("*").eq("cpf", cpf),
      supabase
        .from("app_prazos")
        .select("*")
        .eq("cpf", cpf)
        .order("data_prazo", { ascending: true }),
    ]);

  if (!processos?.length && !casos?.length) notFound();

  const telefones = [
    ...(processos ?? []).map((p) => phoneToContactNorm(p.telefone)),
    ...(casos ?? []).map((c) => phoneToContactNorm(c.telefone)),
  ].filter(Boolean);

  const contactNorms = [...new Set(telefones)];

  let mensagens: Tables<"mensagens">[] = [];
  if (contactNorms.length) {
    const { data } = await supabase
      .from("mensagens")
      .select("*")
      .in("contact_norm", contactNorms)
      .order("created_at", { ascending: true });
    mensagens = data ?? [];
  }

  return (
    <div className="space-y-4">
      <LinkButton href="/clientes" variant="ghost" size="icon">
        <ArrowLeft className="h-4 w-4" />
      </LinkButton>
      <Cliente360
        cpf={cpf}
        processos={processos ?? []}
        casos={casos ?? []}
        mensagens={mensagens ?? []}
      />

      {(processos ?? []).map((p) => (
        <DataJudPanel
          key={p.id}
          numeroProcesso={p.numero_processo}
          processoId={p.id}
          monitorarDias={p.monitorar_dias}
          ultimaConsulta={p.ultima_consulta_datajud}
        />
      ))}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Prazos deste cliente</h2>
          <NovoPrazoDialog
            cpf={cpf}
            processoId={processos?.[0]?.id}
            triggerLabel="Novo prazo"
            triggerVariant="outline"
          />
        </div>
        {(prazos ?? []).length > 0 ? (
          <PrazosList prazos={prazos ?? []} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhum prazo cadastrado para este cliente.
          </p>
        )}
      </div>
    </div>
  );
}
