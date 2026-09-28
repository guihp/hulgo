"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Cliente360, FichaHeader } from "@/components/clientes/clientes-ui";
import { DataJudPanel } from "@/components/clientes/datajud-panel";
import { FichaArquivos } from "@/components/clientes/ficha-arquivos";
import { CasoDetail } from "@/components/kanban/caso-detail";
import {
  NovoPrazoDialog,
  PrazosList,
  type PrazoEnriched,
  type PrazoProcessoOption,
} from "@/components/prazos/prazos-ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AppUser } from "@/lib/actions/auth";
import type { FichaCasoDetalhe, FichaPessoa } from "@/lib/data/ficha";
import {
  FICHA_ABAS,
  fichaPessoaHref,
  parseFichaAba,
  type FichaAba,
} from "@/lib/utils/ficha";

const ABA_LABEL: Record<FichaAba, string> = {
  resumo: "Resumo",
  caso: "Caso",
  arquivos: "Arquivos",
  datajud: "DataJud",
  prazos: "Prazos",
  audiencias: "Audiências",
};

export function FichaTabs({
  ficha,
  abaInicial,
  casoSelecionado,
  user,
}: {
  ficha: FichaPessoa;
  abaInicial: FichaAba;
  casoSelecionado: FichaCasoDetalhe | null;
  user: AppUser | null;
}) {
  const router = useRouter();
  const [aba, setAba] = useState<FichaAba>(abaInicial);

  const processoOptions = useMemo<PrazoProcessoOption[]>(
    () =>
      ficha.processos.map((p) => ({
        id: p.id,
        numero_processo: p.numero_processo,
        nome: p.nome,
        cpf: p.cpf,
      })),
    [ficha.processos]
  );
  const { audiencias, prazosSemAudiencia } = useMemo(() => {
    const numeroPorId = new Map(
      ficha.processos.map((p) => [p.id, p.numero_processo] as const)
    );
    const enriched: PrazoEnriched[] = ficha.prazos.map((p) => ({
      ...p,
      numero_processo: p.processo_id
        ? (numeroPorId.get(p.processo_id) ?? null)
        : null,
    }));
    return {
      audiencias: enriched.filter((p) => p.tipo === "audiencia"),
      prazosSemAudiencia: enriched.filter((p) => p.tipo !== "audiencia"),
    };
  }, [ficha.prazos, ficha.processos]);
  const audienciasAbertas = audiencias.filter((p) => !p.concluido).length;

  // Navegações reais (trocar de caso, links de fora) mandam na aba ativa; trocas
  // locais usam replaceState e por isso não mexem em `abaInicial`. Na primeira
  // carga, `#arquivos` (links antigos) e `?pasta=` também abrem Arquivos — ambos
  // só existem no cliente, então ficam fora do estado inicial.
  const abaDoServidor = useRef<FichaAba | null>(null);
  useEffect(() => {
    if (abaDoServidor.current === abaInicial) return;
    const primeiraCarga = abaDoServidor.current === null;
    abaDoServidor.current = abaInicial;
    const temPasta = new URLSearchParams(window.location.search).has("pasta");
    const querArquivos =
      primeiraCarga && (window.location.hash === "#arquivos" || temPasta);
    setAba(querArquivos ? "arquivos" : abaInicial);
  }, [abaInicial]);

  const trocarAba = useCallback((value: FichaAba) => {
    setAba(value);
    const params = new URLSearchParams(window.location.search);
    params.set("aba", value);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, []);

  // Trocar de caso precisa de nova carga no servidor (notas, documentos, checklist).
  const trocarCaso = useCallback(
    (casoId: number) => {
      router.replace(
        fichaPessoaHref({
          cpf: ficha.cpf,
          contactNorm: ficha.contactNorm,
          aba: "caso",
          casoId,
        })
      );
    },
    [router, ficha.cpf, ficha.contactNorm]
  );

  return (
    <div className="space-y-6">
      <FichaHeader
        cpf={ficha.cpf}
        contactNorm={ficha.contactNorm}
        processos={ficha.processos}
        casos={ficha.casos}
      />

      <Tabs
        value={aba}
        onValueChange={(value) => {
          const next = parseFichaAba(String(value));
          if (next) trocarAba(next);
        }}
      >
        <TabsList variant="line" className="max-w-full overflow-x-auto">
          {FICHA_ABAS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {ABA_LABEL[key]}
              {key === "caso" && ficha.casos.length > 1 ? (
                <span className="text-xs text-muted-foreground">
                  ({ficha.casos.length})
                </span>
              ) : null}
              {key === "audiencias" && audienciasAbertas > 0 ? (
                <span className="text-xs text-muted-foreground">
                  ({audienciasAbertas})
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="resumo" className="mt-4">
          <Cliente360
            cpf={ficha.cpf}
            contactNorm={ficha.contactNorm}
            processos={ficha.processos}
            casos={ficha.casos}
            mensagens={ficha.mensagens}
            documentos={ficha.documentos}
            pastas={ficha.pastas}
            midiasChat={ficha.midiasChat}
            showHeader={false}
            showArquivos={false}
            onAbrirCaso={trocarCaso}
            podeExcluirProcesso={user?.papel === "advogado"}
          />
        </TabsContent>

        <TabsContent value="caso" className="mt-4 space-y-4">
          {ficha.casos.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Caso</span>
              <Select
                value={String(casoSelecionado?.caso.id ?? "")}
                onValueChange={(v) => trocarCaso(Number(v))}
              >
                <SelectTrigger className="w-72">
                  <SelectValue placeholder="Selecionar caso" />
                </SelectTrigger>
                <SelectContent>
                  {ficha.casos.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      #{c.id} · {c.beneficio_identificado ?? "Sem benefício"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {casoSelecionado && user ? (
            <CasoDetail
              caso={casoSelecionado.caso}
              notas={casoSelecionado.notas}
              documentos={casoSelecionado.documentos}
              user={user}
              checklist={casoSelecionado.checklist}
              embedded
              onAbrirArquivos={() => trocarAba("arquivos")}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum caso de triagem vinculado a esta pessoa.
            </p>
          )}
        </TabsContent>

        <TabsContent value="arquivos" className="mt-4">
          <FichaArquivos
            cpf={ficha.cpf}
            contactNorm={ficha.contactNorm}
            casos={ficha.casos}
            processos={ficha.processos}
            documentos={ficha.documentos}
            pastas={ficha.pastas}
            midiasChat={ficha.midiasChat}
          />
        </TabsContent>

        <TabsContent value="datajud" className="mt-4 space-y-4">
          {ficha.processos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum processo cadastrado para consultar no DataJud.
            </p>
          ) : (
            ficha.processos.map((p) => (
              <DataJudPanel
                key={p.id}
                numeroProcesso={p.numero_processo}
                processoId={p.id}
                monitorarDias={p.monitorar_dias}
                ultimaConsulta={p.ultima_consulta_datajud}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="prazos" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Prazos deste cliente</h2>
            <NovoPrazoDialog
              cpf={ficha.cpf}
              processoId={ficha.processos[0]?.id}
              casoId={casoSelecionado?.caso.id ?? ficha.casos[0]?.id}
              triggerLabel="Novo prazo"
              triggerVariant="outline"
            />
          </div>
          {prazosSemAudiencia.length > 0 ? (
            <PrazosList prazos={prazosSemAudiencia} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum prazo cadastrado para este cliente.
            </p>
          )}
        </TabsContent>

        <TabsContent value="audiencias" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Audiências deste cliente</h2>
            <NovoPrazoDialog
              cpf={ficha.cpf}
              fixedTipo="audiencia"
              processos={processoOptions}
              processoId={ficha.processos[0]?.id}
              casoId={casoSelecionado?.caso.id ?? ficha.casos[0]?.id}
              triggerVariant="outline"
            />
          </div>
          {audiencias.length > 0 ? (
            <PrazosList prazos={audiencias} processos={processoOptions} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma audiência cadastrada para este cliente.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
