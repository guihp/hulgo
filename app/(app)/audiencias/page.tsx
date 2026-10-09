import { PrazosPageContent } from "@/components/prazos/prazos-calendario";
import { carregarPrazosPagina } from "@/lib/prazos/carregar-pagina";

export default async function AudienciasPage() {
  const { prazos, processos, parceiros, todayIso } =
    await carregarPrazosPagina({ modo: "audiencias" });

  return (
    <PrazosPageContent
      prazos={prazos}
      mode="audiencias"
      processos={processos}
      parceiros={parceiros}
      todayIso={todayIso}
    />
  );
}
