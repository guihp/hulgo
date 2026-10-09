import { PrazosPageContent } from "@/components/prazos/prazos-calendario";
import { carregarPrazosPagina } from "@/lib/prazos/carregar-pagina";

export default async function PagamentosPage() {
  const { prazos, processos, parceiros, todayIso } =
    await carregarPrazosPagina({ modo: "pagamentos" });

  return (
    <PrazosPageContent
      prazos={prazos}
      mode="pagamentos"
      processos={processos}
      parceiros={parceiros}
      todayIso={todayIso}
    />
  );
}
