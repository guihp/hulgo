"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { differenceInHours } from "date-fns";
import {
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  FileText,
  Kanban,
  MessageSquare,
  Pencil,
  Search,
  Send,
  User,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { decidirAprovacao } from "@/lib/actions/aprovacoes";
import type { AppUser } from "@/lib/actions/auth";
import type { Tables } from "@/types/database";
import { APROVACAO_STATUS, CASO_STATUS } from "@/lib/constants";
import { CpfDisplay } from "@/components/shared/cpf-display";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { formatDateTime, formatRelative, formatChatTime } from "@/lib/utils/dates";
import { formatPhone } from "@/lib/utils/phone";
import { cn } from "@/lib/utils";

type Aprovacao = Tables<"aprovacoes_pendentes">;

const MENSAGEM_RECUSA_PADRAO =
  "Olá! O advogado analisou sua solicitação e vai entrar em contato em breve para tratar do seu caso pessoalmente.";

/* ---------- urgência ---------- */

function urgencia(createdAt: string | null) {
  const horas = createdAt
    ? differenceInHours(new Date(), new Date(createdAt))
    : 0;
  if (horas >= 24)
    return {
      nivel: "alta" as const,
      classes: "border-destructive bg-destructive/5",
      badge: "destructive" as const,
    };
  if (horas >= 2)
    return {
      nivel: "media" as const,
      classes: "border-amber-500/60 bg-amber-500/5",
      badge: "outline" as const,
    };
  return {
    nivel: "baixa" as const,
    classes: "",
    badge: "secondary" as const,
  };
}

function statusVariant(status: string | null) {
  switch (status) {
    case "pendente":
      return "destructive" as const;
    case "aprovado":
      return "default" as const;
    case "recusado":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function statusLabel(status: string | null) {
  return (
    APROVACAO_STATUS.find((s) => s.value === status)?.label ?? status ?? "—"
  );
}

/* ================= LISTA ================= */

export function AprovacoesList({ initial }: { initial: Aprovacao[] }) {
  const [aprovacoes, setAprovacoes] = useState<Aprovacao[]>(initial);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<string>("todas");
  const [historicoLimite, setHistoricoLimite] = useState(10);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("aprovacoes_pendentes")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setAprovacoes(data);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("aprovacoes-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "aprovacoes_pendentes" },
        () => refresh()
      )
      .subscribe();
    const interval = setInterval(refresh, 45000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [refresh]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return aprovacoes.filter((a) => {
      if (filtroStatus !== "todas" && a.status !== filtroStatus) return false;
      if (!q) return true;
      return [a.nome_cliente, a.cpf, a.numero_processo, a.telefone_cliente]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [aprovacoes, busca, filtroStatus]);

  const pendentes = filtradas
    .filter((a) => a.status === "pendente")
    .sort(
      (a, b) =>
        new Date(a.created_at ?? 0).getTime() -
        new Date(b.created_at ?? 0).getTime()
    );
  const historico = filtradas.filter((a) => a.status !== "pendente");

  if (aprovacoes.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle}
        title="Fila de aprovações vazia"
        description="Quando a IA gerar um resumo de processo, ele aparecerá aqui para sua revisão."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, CPF, processo ou telefone…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={filtroStatus}
          onValueChange={(v) => setFiltroStatus(v ?? "todas")}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as situações</SelectItem>
            {APROVACAO_STATUS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {pendentes.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-destructive">
              Pendentes ({pendentes.length})
            </h2>
            <span className="text-xs text-muted-foreground">
              cliente aguardando resposta no WhatsApp
            </span>
          </div>
          <div className="space-y-3">
            {pendentes.map((a) => (
              <AprovacaoCard key={a.id} aprovacao={a} />
            ))}
          </div>
        </section>
      )}

      {pendentes.length === 0 && filtroStatus === "todas" && !busca && (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Nenhuma pendência aguardando decisão. 👌
        </div>
      )}

      {historico.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">
            Histórico ({historico.length})
          </h2>
          <div className="space-y-3">
            {historico.slice(0, historicoLimite).map((a) => (
              <AprovacaoCard key={a.id} aprovacao={a} />
            ))}
          </div>
          {historico.length > historicoLimite && (
            <Button
              variant="outline"
              className="mt-3 w-full"
              onClick={() => setHistoricoLimite((n) => n + 10)}
            >
              Ver mais ({historico.length - historicoLimite} restantes)
            </Button>
          )}
        </section>
      )}
    </div>
  );
}

function AprovacaoCard({ aprovacao }: { aprovacao: Aprovacao }) {
  const pendente = aprovacao.status === "pendente";
  const urg = urgencia(aprovacao.created_at);

  return (
    <Link href={`/aprovacoes/${aprovacao.id}`} className="block">
      <Card
        className={cn(
          "transition-colors hover:bg-muted/50",
          pendente && urg.classes
        )}
      >
        <CardContent className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">
                {aprovacao.nome_cliente ?? "Cliente"}
              </p>
              <Badge variant={statusVariant(aprovacao.status)}>
                {statusLabel(aprovacao.status)}
              </Badge>
              {pendente && urg.nivel !== "baixa" && (
                <Badge variant={urg.badge} className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  aguardando {formatRelative(aprovacao.created_at).replace("há ", "há ")}
                </Badge>
              )}
              {!pendente && aprovacao.enviado_whatsapp && (
                <Badge variant="outline" className="gap-1">
                  <Send className="h-3 w-3" /> enviado
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Processo: {aprovacao.numero_processo ?? "—"}
            </p>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <CpfDisplay value={aprovacao.cpf} />
              <span>
                {pendente
                  ? `recebido ${formatRelative(aprovacao.created_at)}`
                  : `decidido ${formatRelative(aprovacao.decidido_em ?? aprovacao.created_at)}`}
              </span>
            </div>
          </div>
          <p className="hidden max-w-md shrink-0 truncate text-sm text-muted-foreground lg:block">
            {aprovacao.resumo}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

/* ================= DETALHE ================= */

type Contexto = {
  contactNorm: string;
  cpf: string;
  processos: {
    id: number;
    numero_processo: string;
    tribunal: string | null;
    area: string | null;
    ativo: boolean | null;
  }[];
  casoFunil: {
    id: number;
    status: string | null;
    beneficio_identificado: string | null;
    nome: string | null;
  } | null;
  anteriores: {
    id: number;
    status: string | null;
    created_at: string | null;
    numero_processo: string | null;
    decidido_em: string | null;
  }[];
  mensagens: {
    id: number;
    type: string | null;
    text: string | null;
    created_at: string;
  }[];
  decisorNome: string | null;
};

export function AprovacaoDetail({
  aprovacao,
  user,
  contexto,
}: {
  aprovacao: Aprovacao;
  user: AppUser;
  contexto: Contexto;
}) {
  const router = useRouter();
  const isAdvogado = user.papel === "advogado";
  const isPendente = aprovacao.status === "pendente";

  const [texto, setTexto] = useState(aprovacao.resumo);
  const [modoResposta, setModoResposta] = useState(false);
  const [respostaManual, setRespostaManual] = useState("");
  const [motivoRecusa, setMotivoRecusa] = useState("");
  const [msgRecusa, setMsgRecusa] = useState(MENSAGEM_RECUSA_PADRAO);
  const [enviarMsgRecusa, setEnviarMsgRecusa] = useState(true);
  const [loading, setLoading] = useState(false);

  const editado = texto.trim() !== aprovacao.resumo.trim();

  async function decidir(
    acao: "aprovar" | "responder" | "recusar",
    conteudo?: string,
    motivo?: string
  ) {
    setLoading(true);
    try {
      const result = await decidirAprovacao({
        id: aprovacao.id,
        acao,
        texto: conteudo,
        motivoRecusa: motivo,
      });
      if (result.mensagemEnviada) {
        toast.success("Mensagem enviada ao cliente pelo WhatsApp");
      } else {
        toast.success("Decisão registrada");
      }
      if (result.warning) toast.warning(result.warning);
      if (result.webhook.configured && !result.webhook.ok) {
        toast.warning("Decisão salva, mas o n8n não confirmou o despause da IA", {
          description: "Verifique o fluxo de despause no n8n.",
        });
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao processar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* -------- coluna principal -------- */}
      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">
              {aprovacao.nome_cliente ?? "Aprovação"}
            </h1>
            <Badge variant={statusVariant(aprovacao.status)}>
              {statusLabel(aprovacao.status)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Recebido {formatRelative(aprovacao.created_at)} ·{" "}
            {formatDateTime(aprovacao.created_at)}
            {isPendente && (
              <span className="ml-2 font-medium text-destructive">
                cliente com atendimento pausado
              </span>
            )}
          </p>
        </div>

        {isPendente && isAdvogado ? (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Pencil className="h-4 w-4" />
                  Resumo a enviar ao cliente
                  {editado && <Badge variant="outline">editado</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={10}
                  className="font-normal"
                />
                {editado && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTexto(aprovacao.resumo)}
                  >
                    Restaurar texto original da IA
                  </Button>
                )}
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Como o cliente vai receber
                  </p>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-emerald-600 px-3 py-2 text-sm text-white shadow-sm">
                      {texto.trim() || "…"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Decisão</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={loading || !texto.trim()}
                    onClick={() => decidir("aprovar", texto)}
                    className="gap-2"
                  >
                    <Send className="h-4 w-4" />
                    {editado ? "Aprovar com edição e enviar" : "Aprovar e enviar"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={loading}
                    onClick={() => setModoResposta((v) => !v)}
                  >
                    Responder manualmente
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger
                      disabled={loading}
                      className={cn(
                        buttonVariants({ variant: "destructive" }),
                        "gap-2"
                      )}
                    >
                      <XCircle className="h-4 w-4" />
                      Recusar
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Recusar este resumo</AlertDialogTitle>
                        <AlertDialogDescription>
                          O resumo não será enviado. Registre o motivo (interno)
                          e escolha se o cliente recebe um aviso.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label>Motivo da recusa (interno)</Label>
                          <Textarea
                            value={motivoRecusa}
                            onChange={(e) => setMotivoRecusa(e.target.value)}
                            placeholder="Ex.: resumo com informação incorreta sobre a fase do processo"
                            rows={2}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            id="enviar-msg-recusa"
                            type="checkbox"
                            checked={enviarMsgRecusa}
                            onChange={(e) => setEnviarMsgRecusa(e.target.checked)}
                            className="h-4 w-4"
                          />
                          <Label htmlFor="enviar-msg-recusa">
                            Enviar aviso ao cliente no WhatsApp
                          </Label>
                        </div>
                        {enviarMsgRecusa && (
                          <Textarea
                            value={msgRecusa}
                            onChange={(e) => setMsgRecusa(e.target.value)}
                            rows={3}
                          />
                        )}
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            decidir(
                              "recusar",
                              enviarMsgRecusa ? msgRecusa : undefined,
                              motivoRecusa
                            )
                          }
                        >
                          Confirmar recusa
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {modoResposta && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <Label>Resposta manual ao cliente</Label>
                    <Textarea
                      placeholder="Escreva a mensagem que substituirá o resumo da IA…"
                      value={respostaManual}
                      onChange={(e) => setRespostaManual(e.target.value)}
                      rows={4}
                    />
                    <Button
                      disabled={loading || !respostaManual.trim()}
                      onClick={() => decidir("responder", respostaManual)}
                      className="gap-2"
                    >
                      <Send className="h-4 w-4" />
                      Enviar resposta manual
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Resumo gerado pela IA</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap font-sans text-sm">
                  {aprovacao.resumo}
                </pre>
              </CardContent>
            </Card>

            {!isPendente && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Decisão</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant(aprovacao.status)}>
                      {statusLabel(aprovacao.status)}
                    </Badge>
                    <span className="text-muted-foreground">
                      por {contexto.decisorNome ?? "—"} em{" "}
                      {formatDateTime(aprovacao.decidido_em)}
                    </span>
                    {aprovacao.enviado_whatsapp && (
                      <Badge variant="outline" className="gap-1">
                        <Send className="h-3 w-3" /> mensagem enviada
                      </Badge>
                    )}
                  </div>
                  {(aprovacao.resumo_final || aprovacao.resposta_manual) && (
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Texto enviado ao cliente
                      </p>
                      <div className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3">
                        {aprovacao.resumo_final ?? aprovacao.resposta_manual}
                      </div>
                    </div>
                  )}
                  {aprovacao.motivo_recusa && (
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Motivo da recusa (interno)
                      </p>
                      <p>{aprovacao.motivo_recusa}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {isPendente && !isAdvogado && (
              <p className="text-sm text-muted-foreground">
                Apenas advogados podem aprovar, recusar ou responder pendências.
              </p>
            )}
          </>
        )}
      </div>

      {/* -------- coluna de contexto -------- */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" /> Cliente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{aprovacao.nome_cliente ?? "—"}</p>
            <div className="text-muted-foreground">
              <CpfDisplay value={aprovacao.cpf} />
            </div>
            <p className="text-muted-foreground">
              {formatPhone(aprovacao.telefone_cliente)}
            </p>
            <Separator />
            <div className="flex flex-col gap-1.5">
              {contexto.cpf && (
                <Link
                  href={`/clientes/${contexto.cpf}`}
                  className="flex items-center gap-2 text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Ficha do cliente
                </Link>
              )}
              {contexto.contactNorm && (
                <Link
                  href={`/atendimentos/${contexto.contactNorm}`}
                  className="flex items-center gap-2 text-primary hover:underline"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Conversa no WhatsApp
                </Link>
              )}
              {contexto.casoFunil && (
                <Link
                  href={`/kanban/${contexto.casoFunil.id}`}
                  className="flex items-center gap-2 text-primary hover:underline"
                >
                  <Kanban className="h-3.5 w-3.5" /> Caso no funil (
                  {CASO_STATUS.find((s) => s.value === contexto.casoFunil?.status)
                    ?.label ?? contexto.casoFunil.status}
                  )
                </Link>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Processo consultado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-mono text-xs">
              {aprovacao.numero_processo ?? "—"}
            </p>
            {contexto.processos.length > 0 && (
              <>
                <Separator className="my-2" />
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Processos do CPF na base
                </p>
                {contexto.processos.map((p) => (
                  <p key={p.id} className="font-mono text-xs text-muted-foreground">
                    {p.numero_processo}
                    {p.tribunal ? ` · ${p.tribunal}` : ""}
                    {p.ativo === false ? " · inativo" : ""}
                  </p>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {contexto.mensagens.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Últimas mensagens</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {contexto.mensagens.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[90%] rounded-lg px-2.5 py-1.5 text-xs",
                    m.type === "user"
                      ? "bg-muted"
                      : "ml-auto bg-primary/10 text-right"
                  )}
                >
                  <p className="line-clamp-3 whitespace-pre-wrap">
                    {m.text || "(mídia)"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {formatChatTime(m.created_at)}
                  </p>
                </div>
              ))}
              {contexto.contactNorm && (
                <Link
                  href={`/atendimentos/${contexto.contactNorm}`}
                  className="block pt-1 text-xs text-primary hover:underline"
                >
                  Ver conversa completa →
                </Link>
              )}
            </CardContent>
          </Card>
        )}

        {contexto.anteriores.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Aprovações anteriores deste CPF
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {contexto.anteriores.map((a) => (
                <Link
                  key={a.id}
                  href={`/aprovacoes/${a.id}`}
                  className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted/50"
                >
                  <span className="text-muted-foreground">
                    {formatDateTime(a.created_at)}
                  </span>
                  <Badge variant={statusVariant(a.status)}>
                    {statusLabel(a.status)}
                  </Badge>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
