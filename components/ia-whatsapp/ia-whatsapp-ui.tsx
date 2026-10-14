"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Copy,
  Hourglass,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Wrench,
} from "lucide-react";
import {
  alterarPausaIA,
  gerarNovoTokenWebhook,
  processarFilaIAAgora,
  reiniciarMemoriaIAAction,
  salvarConfigIA,
} from "@/lib/actions/ia-whatsapp";
import { toastErroAcao } from "@/lib/client/erros";
import { createClient } from "@/lib/supabase/client";
import { formatPhone } from "@/lib/utils/phone";
import type { Tables } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type Config = Tables<"app_ia_whatsapp_config">;
type Execucao = Tables<"app_ia_execucoes">;
type Fila = Tables<"app_ia_fila">;
type Modo = Config["modo"];

type Pausado = {
  telefone: string;
  nome_contato: string | null;
  pausada_em: string | null;
  pausada_motivo: string | null;
};

type Estatisticas = {
  total: number;
  respondidas: number;
  erros: number;
  conversas: number;
  tempoMedioS: number;
  ferramentasComErro: number;
};

const MODOS: { value: Modo; label: string; descricao: string }[] = [
  {
    value: "desligado",
    label: "Desligada",
    descricao: "Mensagens chegam no painel, mas a IA não responde ninguém.",
  },
  {
    value: "teste",
    label: "Modo teste",
    descricao: "Responde só os números de teste. Os outros clientes só ficam salvos.",
  },
  {
    value: "publico",
    label: "Liberada para o público",
    descricao: "Responde todos os clientes, exceto conversas pausadas.",
  },
];

const MOTIVO_PAUSA: Record<string, string> = {
  advogado_celular: "Advogado respondeu pelo celular",
  painel: "Mensagem enviada pelo painel",
  aprovacao: "Aguardando aprovação do advogado",
  aprovacao_recusada: "Aprovação recusada",
  manual: "Pausada manualmente",
};

const STATUS_EXEC: Record<Execucao["status"], { label: string; cls: string }> = {
  ok: { label: "Respondeu", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  erro: { label: "Erro", cls: "border-red-200 bg-red-50 text-red-700" },
  pausada: { label: "Pausada", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  sem_resposta: { label: "Sem resposta", cls: "border-slate-200 bg-slate-50 text-slate-600" },
};

function telefoneLegivel(t: string) {
  try {
    return formatPhone(t);
  } catch {
    return t;
  }
}

function linhas(texto: string): string[] {
  return texto
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function copiar(texto: string) {
  void navigator.clipboard.writeText(texto).then(
    () => toast.success("Copiado"),
    () => toast.error("Não foi possível copiar")
  );
}

export function IaWhatsappUi(props: {
  config: Config;
  webhookUrl: string;
  cronUrl: string;
  pausados: Pausado[];
  fila: Fila[];
  execucoes: Execucao[];
  nomes: Record<string, string>;
  estatisticas: Estatisticas;
  promptVersao: number;
  temRascunho: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Atualiza ao vivo: novas execuções e pausas.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("ia-whatsapp")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_ia_execucoes" }, () =>
        router.refresh()
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "app_ia_estado" }, () =>
        router.refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  function acao(fn: () => Promise<unknown>, sucesso: string) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(sucesso);
        router.refresh();
      } catch (e) {
        toastErroAcao(e, "Não foi possível concluir");
      }
    });
  }

  const modoAtual = MODOS.find((m) => m.value === props.config.modo)!;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-[#0b2148]">
            <Bot className="h-6 w-6" aria-hidden /> IA do WhatsApp
          </h1>
          <p className="text-sm text-[#64748B]">
            Atendimento automático rodando no próprio sistema. Teste com os números liberados e
            acompanhe as respostas antes de abrir para o público.
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "h-7 shrink-0 px-3 text-sm",
            props.config.modo === "publico" && "border-emerald-300 bg-emerald-50 text-emerald-800",
            props.config.modo === "teste" && "border-amber-300 bg-amber-50 text-amber-800",
            props.config.modo === "desligado" && "border-slate-300 bg-slate-50 text-slate-600"
          )}
        >
          {modoAtual.label}
        </Badge>
      </div>

      <Prontidao estatisticas={props.estatisticas} modo={props.config.modo} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ConfigCard
          config={props.config}
          temRascunho={props.temRascunho}
          promptVersao={props.promptVersao}
          pending={pending}
          onSalvar={(dados) => acao(() => salvarConfigIA(dados), "Configuração salva")}
        />

        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold text-[#0b2148]">
                  <PauseCircle className="h-4 w-4" aria-hidden /> Conversas pausadas ({props.pausados.length})
                </h2>
              </div>
              <p className="text-xs text-[#64748B]">
                A IA fica muda quando alguém do escritório responde (celular ou painel) ou enquanto
                uma aprovação está pendente.
              </p>
              {props.pausados.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-[#94a3b8]">
                  Nenhuma conversa pausada.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {props.pausados.map((p) => (
                    <li key={p.telefone} className="flex flex-wrap items-center justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[#0b2148]">
                          {p.nome_contato || telefoneLegivel(p.telefone)}
                        </p>
                        <p className="text-xs text-[#64748B]">
                          {MOTIVO_PAUSA[p.pausada_motivo ?? ""] ?? "Pausada"}
                          {p.pausada_em
                            ? ` · ${formatDistanceToNow(new Date(p.pausada_em), { locale: ptBR, addSuffix: true })}`
                            : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => acao(() => alterarPausaIA(p.telefone, false), "IA liberada para a conversa")}
                      >
                        <Play className="mr-1 h-3.5 w-3.5" /> Liberar IA
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold text-[#0b2148]">
                  <Hourglass className="h-4 w-4" aria-hidden /> Fila ({props.fila.length})
                </h2>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => acao(() => processarFilaIAAgora(), "Fila processada")}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> Processar agora
                </Button>
              </div>
              {props.fila.length === 0 ? (
                <p className="text-sm text-[#94a3b8]">Nenhuma conversa esperando resposta.</p>
              ) : (
                <ul className="divide-y rounded-lg border text-sm">
                  {props.fila.map((f) => (
                    <li key={f.telefone} className="flex flex-wrap justify-between gap-2 p-3">
                      <span className="text-[#0b2148]">
                        {props.nomes[f.telefone] || telefoneLegivel(f.telefone)}
                      </span>
                      <span className="text-xs text-[#64748B]">
                        {f.travado_em ? "respondendo…" : `responde ${format(new Date(f.processar_apos), "HH:mm:ss")}`}
                        {f.tentativas > 1 ? ` · tentativa ${f.tentativas}` : ""}
                        {f.ultimo_erro ? ` · ${f.ultimo_erro}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <ConexaoCard
            webhookUrl={props.webhookUrl}
            cronUrl={props.cronUrl}
            pending={pending}
            onNovoToken={() => acao(() => gerarNovoTokenWebhook(), "Novo token gerado — atualize a EvoGo")}
          />
        </div>
      </div>

      <LogExecucoes
        execucoes={props.execucoes}
        nomes={props.nomes}
        pending={pending}
        onReset={(tel) => acao(() => reiniciarMemoriaIAAction(tel), "Memória da conversa reiniciada")}
      />
    </div>
  );
}

function Prontidao({ estatisticas: e, modo }: { estatisticas: Estatisticas; modo: Modo }) {
  const taxaErro = e.total ? Math.round((e.erros / e.total) * 100) : 0;
  const itens = [
    { label: "Respostas (7 dias)", valor: e.respondidas },
    { label: "Conversas testadas", valor: e.conversas },
    { label: "Erros", valor: `${e.erros}${e.total ? ` (${taxaErro}%)` : ""}`, alerta: e.erros > 0 },
    { label: "Ferramentas com falha", valor: e.ferramentasComErro, alerta: e.ferramentasComErro > 0 },
    { label: "Tempo médio de resposta", valor: e.tempoMedioS ? `${e.tempoMedioS}s` : "—" },
  ];
  const pronta = e.respondidas >= 20 && e.conversas >= 3 && taxaErro <= 5;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-[#0b2148]">Pronta para o público?</h2>
          {modo !== "publico" ? (
            <span
              className={cn(
                "flex items-center gap-1.5 text-sm",
                pronta ? "text-emerald-700" : "text-amber-700"
              )}
            >
              {pronta ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {pronta
                ? "Os testes da semana estão estáveis."
                : "Ainda faltam testes: o ideal é 20+ respostas em 3+ conversas com até 5% de erro."}
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {itens.map((i) => (
            <div key={i.label} className="rounded-lg border bg-white p-3">
              <p className="text-xs text-[#64748B]">{i.label}</p>
              <p className={cn("text-xl font-semibold text-[#0b2148]", i.alerta && "text-red-600")}>{i.valor}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ConfigCard(props: {
  config: Config;
  temRascunho: boolean;
  promptVersao: number;
  pending: boolean;
  onSalvar: (dados: Parameters<typeof salvarConfigIA>[0]) => void;
}) {
  const c = props.config;
  const [modo, setModo] = useState<Modo>(c.modo);
  const [numerosTeste, setNumerosTeste] = useState(c.numeros_teste.join("\n"));
  const [rascunho, setRascunho] = useState(c.usar_rascunho_no_teste);
  const [debounce, setDebounce] = useState(String(c.debounce_segundos));
  const [grupo, setGrupo] = useState(c.grupo_advogado ?? "");
  const [numerosAdvogado, setNumerosAdvogado] = useState(c.numeros_advogado.join("\n"));

  const dados = {
    modo,
    numerosTeste: linhas(numerosTeste),
    usarRascunhoNoTeste: rascunho,
    debounceSegundos: Number(debounce) || 15,
    grupoAdvogado: grupo,
    numerosAdvogado: linhas(numerosAdvogado),
  };
  const virandoPublico = modo === "publico" && c.modo !== "publico";

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5">
        <h2 className="font-semibold text-[#0b2148]">Configuração</h2>

        <div className="flex flex-col gap-2">
          <Label>Quem a IA responde</Label>
          <div className="grid gap-2">
            {MODOS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setModo(m.value)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  modo === m.value
                    ? "border-[#0b2148] bg-[#0b2148]/5"
                    : "border-[#e2e8f0] hover:bg-slate-50"
                )}
              >
                <p className="text-sm font-medium text-[#0b2148]">{m.label}</p>
                <p className="text-xs text-[#64748B]">{m.descricao}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="numeros-teste">Números de teste (um por linha)</Label>
          <Textarea
            id="numeros-teste"
            rows={5}
            value={numerosTeste}
            onChange={(e) => setNumerosTeste(e.target.value)}
            placeholder="5598999999999"
          />
          <p className="text-xs text-[#64748B]">
            Com DDD; o 55 e o 9º dígito são completados sozinhos. Esses números podem mandar{" "}
            <code>/reset</code> para a IA esquecer a conversa.
          </p>
        </div>

        <label className="flex items-start gap-3 text-sm text-[#0b2148]">
          <Switch
            checked={rascunho}
            onCheckedChange={setRascunho}
            disabled={!props.temRascunho}
            className="mt-0.5 data-checked:bg-[#0b2148]"
          />
          <span>
            Usar o <strong>rascunho</strong> do prompt no modo teste
            <span className="block text-xs text-[#64748B]">
              {props.temRascunho
                ? `Assim dá para testar mudanças no WhatsApp antes de publicar. Desligado = versão publicada (v${props.promptVersao}).`
                : "Não há rascunho salvo em Configurações → Agente."}
            </span>
          </span>
        </label>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="debounce">Esperar antes de responder (segundos)</Label>
          <Input
            id="debounce"
            type="number"
            min={3}
            max={120}
            value={debounce}
            onChange={(e) => setDebounce(e.target.value)}
            className="w-32"
          />
          <p className="text-xs text-[#64748B]">
            Junta mensagens picadas: cada mensagem nova reinicia a contagem.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grupo">Grupo do advogado</Label>
            <Input id="grupo" value={grupo} onChange={(e) => setGrupo(e.target.value)} placeholder="1203…@g.us" />
            <p className="text-xs text-[#64748B]">Recebe casos novos e pedidos de aprovação.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="advogados">Quem pode usar #aprovar</Label>
            <Textarea
              id="advogados"
              rows={2}
              value={numerosAdvogado}
              onChange={(e) => setNumerosAdvogado(e.target.value)}
            />
          </div>
        </div>

        {virandoPublico ? (
          <AlertDialog>
            <AlertDialogTrigger
              disabled={props.pending}
              className={cn(buttonVariants(), "bg-[#0b2148] text-white hover:bg-[#0b2148]/90")}
            >
              Salvar e liberar para o público
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Liberar a IA para todos os clientes?</AlertDialogTitle>
                <AlertDialogDescription>
                  A partir de agora a IA responde qualquer pessoa que escrever no WhatsApp do
                  escritório. Conversas pausadas continuam com o atendimento humano. Dá para
                  voltar ao modo teste a qualquer momento.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => props.onSalvar(dados)}>Liberar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button
            disabled={props.pending}
            onClick={() => props.onSalvar(dados)}
            className="bg-[#0b2148] text-white hover:bg-[#0b2148]/90"
          >
            Salvar configuração
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ConexaoCard(props: {
  webhookUrl: string;
  cronUrl: string;
  pending: boolean;
  onNovoToken: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="flex items-center justify-between gap-2 text-left font-semibold text-[#0b2148]"
        >
          Conexão com a EvoGo
          <ChevronDown className={cn("h-4 w-4 transition-transform", aberto && "rotate-180")} />
        </button>
        {aberto ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-1.5">
              <Label>URL do webhook (EVOGO_WEBHOOK_URL)</Label>
              <div className="flex gap-2">
                <Input readOnly value={props.webhookUrl} className="font-mono text-xs" />
                <Button size="icon" variant="outline" onClick={() => copiar(props.webhookUrl)} aria-label="Copiar URL">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-[#64748B]">
                Coloque no Coolify e reconecte o WhatsApp em Configurações para a EvoGo passar a
                mandar as mensagens para cá.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tarefa agendada (a cada minuto)</Label>
              <Input
                readOnly
                value={`curl -s -H "x-cron-secret: $CRON_SECRET" ${props.cronUrl}`}
                className="font-mono text-xs"
              />
            </div>
            <AlertDialog>
              <AlertDialogTrigger
                disabled={props.pending}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
              >
                Gerar novo token
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Gerar novo token do webhook?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A URL atual para de funcionar na hora. Atualize a EvoGo com a nova URL logo em
                    seguida, senão as mensagens deixam de chegar.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={props.onNovoToken}>Gerar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LogExecucoes(props: {
  execucoes: Execucao[];
  nomes: Record<string, string>;
  pending: boolean;
  onReset: (telefone: string) => void;
}) {
  const [filtro, setFiltro] = useState<"todas" | "erro">("todas");
  const lista = useMemo(
    () => props.execucoes.filter((e) => filtro === "todas" || e.status === "erro"),
    [props.execucoes, filtro]
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-[#0b2148]">Últimas respostas</h2>
          <div className="flex gap-1">
            {(["todas", "erro"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFiltro(f)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  filtro === f ? "border-[#0b2148] bg-[#0b2148] text-white" : "border-[#e2e8f0] text-[#64748B]"
                )}
              >
                {f === "todas" ? "Todas" : "Só erros"}
              </button>
            ))}
          </div>
        </div>
        {lista.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-[#94a3b8]">
            Nenhuma resposta ainda. Mande uma mensagem de um número de teste para começar.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lista.map((e) => (
              <ExecucaoItem
                key={e.id}
                execucao={e}
                nome={props.nomes[e.telefone]}
                pending={props.pending}
                onReset={() => props.onReset(e.telefone)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ExecucaoItem(props: {
  execucao: Execucao;
  nome?: string;
  pending: boolean;
  onReset: () => void;
}) {
  const e = props.execucao;
  const [aberto, setAberto] = useState(false);
  const respostas = Array.isArray(e.respostas) ? (e.respostas as string[]) : [];
  const ferramentas = Array.isArray(e.ferramentas)
    ? (e.ferramentas as { nome: string; argumentos: unknown; resultado: unknown; erro?: string }[])
    : [];
  const status = STATUS_EXEC[e.status];

  return (
    <li className="rounded-lg border">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left"
      >
        <Badge variant="outline" className={status.cls}>
          {status.label}
        </Badge>
        <span className="text-sm font-medium text-[#0b2148]">{props.nome || telefoneLegivel(e.telefone)}</span>
        <span className="text-xs text-[#64748B]">
          {format(new Date(e.created_at), "dd/MM HH:mm")}
          {e.duracao_ms ? ` · ${(e.duracao_ms / 1000).toFixed(0)}s` : ""}
          {ferramentas.length ? ` · ${ferramentas.length} ferramenta(s)` : ""}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-[#94a3b8]">
          {e.erro ?? respostas[0] ?? e.entrada ?? ""}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-[#94a3b8] transition-transform", aberto && "rotate-180")} />
      </button>
      {aberto ? (
        <div className="flex flex-col gap-3 border-t p-3 text-sm">
          {e.entrada ? (
            <Bloco titulo="Cliente mandou">
              <pre className="whitespace-pre-wrap font-sans text-[#0b2148]">{e.entrada}</pre>
            </Bloco>
          ) : null}
          {ferramentas.length ? (
            <Bloco titulo="Ferramentas usadas">
              <ul className="flex flex-col gap-2">
                {ferramentas.map((f, i) => (
                  <li key={i} className={cn("rounded border p-2", f.erro && "border-red-200 bg-red-50")}>
                    <p className="flex items-center gap-1.5 font-mono text-xs font-semibold text-[#0b2148]">
                      <Wrench className="h-3 w-3" /> {f.nome}
                    </p>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-[#64748B]">
                      {JSON.stringify(f.argumentos, null, 1)}
                      {"\n→ "}
                      {JSON.stringify(f.resultado, null, 1)}
                    </pre>
                  </li>
                ))}
              </ul>
            </Bloco>
          ) : null}
          {respostas.length ? (
            <Bloco titulo="IA respondeu">
              <div className="flex flex-col gap-1.5">
                {respostas.map((r, i) => (
                  <p key={i} className="whitespace-pre-wrap rounded-lg bg-[#0b2148]/5 p-2 text-[#0b2148]">
                    {r}
                  </p>
                ))}
              </div>
            </Bloco>
          ) : null}
          {e.erro ? (
            <Bloco titulo="Erro">
              <p className="text-red-700">{e.erro}</p>
            </Bloco>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#94a3b8]">
            <span>
              {e.modelo ?? ""}
              {e.prompt_origem ? ` · prompt ${e.prompt_origem}` : ""}
            </span>
            <Button size="sm" variant="ghost" disabled={props.pending} onClick={props.onReset}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reiniciar memória desta conversa
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#64748B]">{titulo}</p>
      {children}
    </div>
  );
}
