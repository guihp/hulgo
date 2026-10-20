"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Gavel, Loader2, RefreshCw } from "lucide-react";
import {
  consultarTodosDataJudAgora,
  getDataJudPainel,
  salvarDataJudConfig,
  type DataJudPainel,
} from "@/lib/actions/datajud";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatDateTime } from "@/lib/utils/dates";
import { toastErroAcao } from "@/lib/client/erros";

const cardShell = "rounded-2xl border border-[#e2e8f0] bg-white p-5";

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-[#F8FAFC] px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[#64748b]">{rotulo}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-[#0b2148]">
        {valor.toLocaleString("pt-BR")}
      </p>
    </div>
  );
}

function Opcao({
  titulo,
  descricao,
  checked,
  disabled,
  onChange,
}: {
  titulo: string;
  descricao: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[#0b2148]">{titulo}</span>
        <span className="mt-0.5 block text-sm text-[#64748b]">{descricao}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-1" />
    </label>
  );
}

export function ConsultaJusticaPanel() {
  const [dados, setDados] = useState<DataJudPainel | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [disparando, setDisparando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setDados(await getDataJudPainel());
    } catch (err) {
      toastErroAcao(err, "Não foi possível carregar a consulta na Justiça");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial via server action
    void carregar();
  }, [carregar]);

  const salvar = async (patch: Partial<Pick<DataJudPainel, "auto" | "pendencias">>) => {
    if (!dados) return;
    const proximo = { auto: dados.auto, pendencias: dados.pendencias, ...patch };
    setSalvando(true);
    setDados({ ...dados, ...proximo });
    try {
      await salvarDataJudConfig(proximo);
      toast.success("Configuração salva");
    } catch (err) {
      setDados(dados);
      toastErroAcao(err, "Não foi possível salvar");
    } finally {
      setSalvando(false);
    }
  };

  const consultarAgora = async () => {
    setDisparando(true);
    try {
      await consultarTodosDataJudAgora();
      toast.success("Consulta iniciada. Leva alguns minutos — os cards vão sendo atualizados.");
    } catch (err) {
      toastErroAcao(err, "Não foi possível iniciar a consulta");
    } finally {
      setDisparando(false);
    }
  };

  if (!dados) {
    return (
      <div className={cardShell}>
        <p className="flex items-center gap-2 text-sm text-[#64748b]">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </p>
      </div>
    );
  }

  const rodada = dados.ultimaRodada;

  return (
    <div className="space-y-4">
      <div className={cardShell}>
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0b2148]/8 text-[#0b2148]">
            <Gavel className="size-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-[#0b2148]">Andamento automático dos processos</h2>
            <p className="mt-0.5 text-sm text-[#64748b]">
              Todo dia o sistema consulta na base pública do CNJ cada processo que tem número
              judicial. A última movimentação aparece no card do processo, na ficha do cliente e
              no relatório PDF, com a marca &ldquo;nova&rdquo; por 7 dias. O andamento escrito pela
              equipe continua como está.
            </p>
          </div>
        </div>

        <div className="mt-3 divide-y divide-[#e2e8f0]">
          <Opcao
            titulo="Consultar os processos automaticamente"
            descricao="Uma vez por dia, para todos os processos com número do CNJ."
            checked={dados.auto}
            disabled={salvando}
            onChange={(v) => void salvar({ auto: v })}
          />
          <Opcao
            titulo="Criar pendência em Aprovações quando houver movimentação nova"
            descricao="Para revisar e avisar o cliente pelo WhatsApp. Desligado, a novidade só aparece no card."
            checked={dados.pendencias}
            disabled={salvando || !dados.auto}
            onChange={(v) => void salvar({ pendencias: v })}
          />
        </div>
      </div>

      <div className={cardShell}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[#0b2148]">Situação</h3>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void carregar()}>
              <RefreshCw className="size-3.5" />
              Atualizar números
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={disparando}
              onClick={() => void consultarAgora()}
              className="rounded-full bg-[#0b2148] text-white hover:bg-[#163a7a]"
            >
              {disparando ? <Loader2 className="size-3.5 animate-spin" /> : <Gavel className="size-3.5" />}
              Consultar agora
            </Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Numero rotulo="Com número do CNJ" valor={dados.comNumeroCnj} />
          <Numero rotulo="Consultados (24h)" valor={dados.consultadosUltimas24h} />
          <Numero rotulo="Ainda não consultados" valor={dados.nuncaConsultados} />
          <Numero rotulo="Novidades (7 dias)" valor={dados.novidades7dias} />
          <Numero rotulo="Não achados na base" valor={dados.naoEncontrados} />
        </div>
        <p className="mt-3 text-sm text-[#64748b]">
          {rodada
            ? `Última consulta em ${formatDateTime(rodada.em)}: ${rodada.consultados} processo(s) consultado(s), ${rodada.novidades} com movimentação nova${
                rodada.restantes ? `; ${rodada.restantes} ficaram para a próxima rodada` : ""
              }.`
            : "Nenhuma consulta automática feita ainda."}
        </p>
        <p className="mt-2 text-xs text-[#94a3b8]">
          A base do CNJ costuma atrasar alguns dias em relação ao site do tribunal, não mostra
          processos em segredo de justiça e não inclui requerimentos administrativos do INSS.
        </p>
      </div>
    </div>
  );
}
