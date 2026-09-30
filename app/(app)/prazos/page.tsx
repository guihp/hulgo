import { PrazosPageContent } from "@/components/prazos/prazos-calendario";
import { carregarPrazosPagina } from "@/lib/prazos/carregar-pagina";

export default async function PrazosPage() {
  const { prazos, processos, parceiros, todayIso } =
    await carregarPrazosPagina();

  return (
    <PrazosPageContent
      prazos={prazos}
      processos={processos}
      parceiros={parceiros}
      todayIso={todayIso}
    />
  );
}
