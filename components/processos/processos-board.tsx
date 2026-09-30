"use client";

import { useCallback, useEffect, useId, useMemo, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Check,
  Columns3,
  ExternalLink,
  Plus,
  Scale,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  atualizarSituacaoProcesso,
  moverProcessoColuna,
} from "@/lib/actions/casos";
import {
  arquivarProcessoColuna,
  atualizarProcessoColuna,
  criarProcessoColuna,
  reordenarProcessoColunas,
} from "@/lib/actions/processo-colunas";
import type { ProcessoColunaMatch } from "@/lib/data/processo-colunas";
import type { Parceiro } from "@/lib/actions/parceiros";
import type { Tables } from "@/types/database";
import {
  FUNIL_PROCESSO_PADRAO,
  SITUACOES_PROCESSO,
  formatValorCentavos,
  labelFunilProcesso,
  situacaoProcessoInfo,
  type FunilProcesso,
} from "@/lib/utils/processos";
import { formatDate } from "@/lib/utils/dates";
import { formatNumeroProcesso } from "@/lib/utils/processo";
import { normalizeCpf } from "@/lib/utils/cpf";
import { fichaPessoaHref } from "@/lib/utils/ficha";
import { phoneToContactNorm } from "@/lib/utils/phone";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkButton } from "@/components/ui/link-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { corBorder, corDot } from "@/components/processos/cores";
import { ExcluirProcessoDialog } from "@/components/processos/excluir-processo-dialog";
import { ProcessoColunaMenu } from "@/components/processos/processo-coluna-menu";
import { TransferirProcessoDialog } from "@/components/processos/transferir-processo-dialog";
import { cn } from "@/lib/utils";

type Processo = Tables<"processos_clientes">;

const FILTER_ALL = "all";
const FILTER_NONE = "none";
const SITUACAO_LIMPAR = "__limpar__";

function stopDrag(e: React.PointerEvent) {
  e.stopPropagation();
}

function partesLabel(p: Processo): string {
  const ativo = p.polo_ativo?.trim();
  const passivo = p.polo_passivo?.trim();
  if (ativo && passivo) return `${ativo} × ${passivo}`;
  if (ativo) return ativo;
  if (passivo) return `${p.nome?.trim() || "Autor"} × ${passivo}`;
  return p.nome?.trim() || "Sem nome";
}

function SituacaoBadge({ situacao }: { situacao: string | null }) {
  const info = situacaoProcessoInfo(situacao);
  if (!info) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
        info.className
      )}
    >
      <span className={cn("size-1.5 rounded-full", info.dotClassName)} aria-hidden />
      {info.label}
    </span>
  );
}

function ProcessoCard({
  processo,
  parceiroNome,
  colunaArquivada,
  selected,
  onToggleSelect,
  isDragging,
  overlayCount,
  onDeleted,
  colunaAtual,
  colunas,
  onMove,
  onTransferir,
}: {
  processo: Processo;
  parceiroNome?: string | null;
  colunaArquivada?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
  isDragging?: boolean;
  overlayCount?: number;
  /** Presente só quando o usuário pode excluir (advogado). */
  onDeleted?: (id: number) => void;
  colunaAtual?: string;
  colunas?: ProcessoColunaMatch[];
  onMove?: (ids: number[], chave: string) => void;
  onTransferir?: (ids: number[]) => void;
}) {
  const podeMover = Boolean(onMove && colunas && colunas.length > 1);
  const cpf = processo.cpf ? normalizeCpf(processo.cpf) : "";
  const contactNorm = phoneToContactNorm(processo.telefone) || null;
  const temAndamento = Boolean(
    processo.ultimo_andamento_data || processo.ultimo_movimento?.trim()
  );

  return (
    <div
      className={cn(
        "relative rounded-lg border bg-card p-3 shadow-sm transition-shadow",
        isDragging && "opacity-50 shadow-lg",
        selected && "border-primary ring-1 ring-primary"
      )}
    >
      {overlayCount && overlayCount > 1 ? (
        <Badge className="absolute -top-2 -right-2">{overlayCount}</Badge>
      ) : null}
      <div className="flex items-start gap-2">
        {onToggleSelect ? (
          <div onPointerDown={stopDrag} className="pt-0.5">
            <Checkbox
              checked={Boolean(selected)}
              onCheckedChange={() => onToggleSelect(processo.id)}
              aria-label="Selecionar processo"
            />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {processo.numero_processo
              ? formatNumeroProcesso(processo.numero_processo)
              : "Sem nº"}
          </p>
          <p className="mt-0.5 text-sm font-medium leading-tight">
            {partesLabel(processo)}
          </p>
        </div>
      </div>

      {processo.situacao || colunaArquivada ? (
        <div className="mt-2 flex flex-wrap gap-1">
          <SituacaoBadge situacao={processo.situacao} />
          {colunaArquivada ? (
            <Badge variant="outline" className="text-[11px]">
              Sem coluna ativa
            </Badge>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        {processo.tipo_acao ? (
          <p className="line-clamp-2 text-foreground/80">{processo.tipo_acao}</p>
        ) : null}
        {processo.vara_comarca || processo.tribunal ? (
          <p className="line-clamp-1">
            {[processo.vara_comarca, processo.tribunal].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {processo.valor_centavos != null ? (
          <p className="font-semibold text-foreground">
            {formatValorCentavos(processo.valor_centavos)}
          </p>
        ) : null}
      </div>

      {temAndamento ? (
        <div className="mt-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs">
          <p className="font-medium text-muted-foreground">
            Último andamento
            {processo.ultimo_andamento_data
              ? ` · ${formatDate(processo.ultimo_andamento_data)}`
              : ""}
          </p>
          {processo.ultimo_movimento?.trim() ? (
            <p className="mt-0.5 line-clamp-3">{processo.ultimo_movimento}</p>
          ) : null}
        </div>
      ) : null}

      {parceiroNome ? (
        <p className="mt-2 truncate text-[11px] text-muted-foreground">
          Parceiro: {parceiroNome}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-end gap-2">
        {cpf || contactNorm || onDeleted || podeMover || onTransferir ? (
          <div onPointerDown={stopDrag} className="flex shrink-0 items-center gap-1">
            {onTransferir ? (
              <Button
                variant="outline"
                size="icon-sm"
                title="Transferir para outro funil"
                aria-label="Transferir para outro funil"
                onClick={() => onTransferir([processo.id])}
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
              </Button>
            ) : null}
            {podeMover ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    buttonVariants({ variant: "outline", size: "icon-sm" }),
                    "hidden lg:inline-flex"
                  )}
                  title="Mudar coluna"
                  aria-label="Mudar coluna"
                >
                  <Columns3 className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Mudar coluna</DropdownMenuLabel>
                    {colunas!.map((c) => (
                      <DropdownMenuItem
                        key={c.chave}
                        disabled={c.chave === colunaAtual}
                        onClick={() => onMove!([processo.id], c.chave)}
                      >
                        <span
                          className={cn("size-2 rounded-full", corDot(c.cor))}
                          aria-hidden
                        />
                        {c.label}
                        {c.chave === colunaAtual ? <Check className="ml-auto" /> : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {cpf || contactNorm ? (
              <LinkButton
                href={fichaPessoaHref({ cpf: cpf || null, contactNorm, aba: "resumo" })}
                size="sm"
                variant="outline"
                className="h-7 text-xs"
              >
                <ExternalLink className="mr-1 h-3 w-3" />
                Ficha
              </LinkButton>
            ) : null}
            {onDeleted ? (
              <ExcluirProcessoDialog processo={processo} compact onDeleted={onDeleted} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DraggableProcessoCard(
  props: React.ComponentProps<typeof ProcessoCard>
) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `processo-${props.processo.id}`,
    data: { processo: props.processo },
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="touch-none">
      <ProcessoCard {...props} isDragging={isDragging} />
    </div>
  );
}

type ColunaEditHandlers = {
  index: number;
  total: number;
  processosCount: number;
  onRename: (label: string) => void;
  onCor: (cor: string | null) => void;
  onMoveColuna: (dir: -1 | 1) => void;
  onArchive: (destino: string | null) => Promise<boolean>;
};

function ColunaTitulo({
  coluna,
  colunas,
  edit,
}: {
  coluna: ProcessoColunaMatch;
  colunas: ProcessoColunaMatch[];
  edit?: ColunaEditHandlers;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(coluna.label);

  function start() {
    setDraft(coluna.label);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    const label = draft.trim();
    if (label && label !== coluna.label) edit?.onRename(label);
  }

  if (editing && edit) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        aria-label="Nome da coluna"
        className="h-7 min-w-0 flex-1 text-sm font-semibold"
      />
    );
  }

  return (
    <>
      <h3
        className={cn(
          "min-w-0 flex-1 truncate text-sm font-semibold",
          edit && "cursor-text"
        )}
        title={edit ? `${coluna.label} — clique duplo para renomear` : coluna.label}
        onDoubleClick={edit ? start : undefined}
      >
        {coluna.label}
      </h3>
      {edit ? (
        <ProcessoColunaMenu
          coluna={coluna}
          colunas={colunas}
          processosCount={edit.processosCount}
          canMoveLeft={edit.index > 0}
          canMoveRight={edit.index < edit.total - 1}
          canArchive={edit.total > 1}
          onRename={start}
          onCor={edit.onCor}
          onMove={edit.onMoveColuna}
          onArchive={edit.onArchive}
        />
      ) : null}
    </>
  );
}

function ProcessoColumn({
  coluna,
  colunas,
  processos,
  parceiroNomes,
  activeChaves,
  selected,
  onToggleSelect,
  onToggleColumn,
  onMove,
  onTransferir,
  onDeleted,
  edit,
}: {
  coluna: ProcessoColunaMatch;
  colunas: ProcessoColunaMatch[];
  processos: Processo[];
  parceiroNomes: Record<string, string>;
  activeChaves: Set<string>;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onToggleColumn: (ids: number[], select: boolean) => void;
  onMove: (ids: number[], chave: string) => void;
  onTransferir: (ids: number[]) => void;
  onDeleted?: (id: number) => void;
  /** Presente só para advogados com a coluna persistida no banco. */
  edit?: ColunaEditHandlers;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: coluna.chave });
  const ids = processos.map((p) => p.id);
  const selectedCount = ids.filter((id) => selected.has(id)).length;
  const allSelected = ids.length > 0 && selectedCount === ids.length;
  const total = processos.reduce((acc, p) => acc + (p.valor_centavos ?? 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[320px] w-[85vw] max-w-72 shrink-0 snap-start flex-col rounded-xl border border-t-4 bg-muted/30 sm:w-72",
        corBorder(coluna.cor),
        isOver && "ring-2 ring-primary"
      )}
    >
      <div className="flex items-center gap-2 border-b p-3">
        <Checkbox
          checked={allSelected}
          indeterminate={selectedCount > 0 && !allSelected}
          disabled={ids.length === 0}
          onCheckedChange={() => onToggleColumn(ids, !allSelected)}
          aria-label={`Selecionar todos em ${coluna.label}`}
        />
        <span className={cn("size-2 shrink-0 rounded-full", corDot(coluna.cor))} aria-hidden />
        <ColunaTitulo coluna={coluna} colunas={colunas} edit={edit} />
        <Badge variant="secondary">{processos.length}</Badge>
      </div>
      {total > 0 ? (
        <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">
          Total: <span className="font-medium text-foreground">{formatValorCentavos(total)}</span>
        </p>
      ) : null}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {processos.map((p) => (
          <div key={p.id} className="space-y-1">
            <DraggableProcessoCard
              processo={p}
              parceiroNome={p.parceiro_id ? parceiroNomes[p.parceiro_id] : null}
              colunaArquivada={Boolean(p.funil_coluna) && !activeChaves.has(p.funil_coluna!)}
              selected={selected.has(p.id)}
              onToggleSelect={onToggleSelect}
              onDeleted={onDeleted}
              colunaAtual={coluna.chave}
              colunas={colunas}
              onMove={onMove}
              onTransferir={onTransferir}
            />
            <Select
              value={coluna.chave}
              onValueChange={(v) => {
                if (v && v !== coluna.chave) onMove([p.id], v);
              }}
            >
              <SelectTrigger className="h-7 w-full text-xs lg:hidden">
                <SelectValue placeholder="Mover para...">
                  {(v: string | null) =>
                    colunas.find((c) => c.chave === v)?.label ?? "Mover para..."
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {colunas.map((c) => (
                  <SelectItem key={c.chave} value={c.chave}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProcessosBoard({
  funil,
  initialProcessos,
  initialColunas,
  parceiros,
  canManageColunas = false,
  canExcluir = false,
}: {
  funil: FunilProcesso;
  initialProcessos: Processo[];
  initialColunas: ProcessoColunaMatch[];
  parceiros: Parceiro[];
  canManageColunas?: boolean;
  canExcluir?: boolean;
}) {
  const dndId = useId();
  const [processos, setProcessos] = useState(initialProcessos);
  const [colunas, setColunas] = useState(initialColunas);
  const [prevInitial, setPrevInitial] = useState({ initialProcessos, initialColunas });
  if (
    prevInitial.initialProcessos !== initialProcessos ||
    prevInitial.initialColunas !== initialColunas
  ) {
    setPrevInitial({ initialProcessos, initialColunas });
    setProcessos(initialProcessos);
    setColunas(initialColunas);
  }
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [activeProcesso, setActiveProcesso] = useState<Processo | null>(null);
  const [search, setSearch] = useState("");
  const [situacaoFilter, setSituacaoFilter] = useState<string>(FILTER_ALL);
  const [parceiroFilter, setParceiroFilter] = useState<string>(FILTER_ALL);
  const [novaColunaOpen, setNovaColunaOpen] = useState(false);
  const [novaColunaLabel, setNovaColunaLabel] = useState("");
  const [pendingColuna, startColunaTransition] = useTransition();
  const [pendingBulk, startBulkTransition] = useTransition();
  const [transferIds, setTransferIds] = useState<number[] | null>(null);
  const router = useRouter();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const parceiroNomes = useMemo(
    () => Object.fromEntries(parceiros.map((p) => [p.id, p.nome])),
    [parceiros]
  );

  const activeChaves = useMemo(
    () => new Set(colunas.map((c) => c.chave)),
    [colunas]
  );

  const colunaDe = useCallback(
    (p: Processo) =>
      p.funil_coluna && activeChaves.has(p.funil_coluna)
        ? p.funil_coluna
        : colunas[0]?.chave ?? "",
    [activeChaves, colunas]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return processos.filter((p) => {
      const matchSearch =
        !q ||
        p.nome?.toLowerCase().includes(q) ||
        p.polo_ativo?.toLowerCase().includes(q) ||
        p.polo_passivo?.toLowerCase().includes(q) ||
        p.numero_processo?.toLowerCase().includes(q) ||
        (qDigits.length >= 3 &&
          (p.cpf?.replace(/\D/g, "").includes(qDigits) ||
            p.numero_processo?.replace(/\D/g, "").includes(qDigits)));
      const matchSituacao =
        situacaoFilter === FILTER_ALL ||
        (situacaoFilter === FILTER_NONE ? !p.situacao : p.situacao === situacaoFilter);
      const matchParceiro =
        parceiroFilter === FILTER_ALL ||
        (parceiroFilter === FILTER_NONE
          ? !p.parceiro_id
          : p.parceiro_id === parceiroFilter);
      return matchSearch && matchSituacao && matchParceiro;
    });
  }, [processos, search, situacaoFilter, parceiroFilter]);

  const porColuna = useMemo(() => {
    const map: Record<string, Processo[]> = {};
    for (const c of colunas) map[c.chave] = [];
    for (const p of filtered) {
      const key = colunaDe(p);
      if (map[key]) map[key].push(p);
    }
    return map;
  }, [filtered, colunas, colunaDe]);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    let query = supabase
      .from("processos_clientes")
      .select("*")
      .order("ultimo_andamento_data", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
    query =
      funil === FUNIL_PROCESSO_PADRAO
        ? query.or(`area.eq.${funil},area.is.null`)
        : query.eq("area", funil);
    const [{ data: procData }, { data: colData }] = await Promise.all([
      query,
      supabase
        .from("app_processo_colunas")
        .select("*")
        .eq("funil", funil)
        .eq("ativo", true)
        .order("ordem", { ascending: true }),
    ]);
    if (procData) {
      setProcessos(procData);
      const ids = new Set(procData.map((p) => p.id));
      setSelected((prev) => {
        const next = new Set([...prev].filter((id) => ids.has(id)));
        return next.size === prev.size ? prev : next;
      });
    }
    if (colData?.length) {
      setColunas(
        colData.map((c) => ({
          id: c.id,
          funil,
          chave: c.chave,
          label: c.label,
          ordem: c.ordem,
          ativo: c.ativo,
          cor: c.cor,
        }))
      );
    }
  }, [funil]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`processos-board-${funil}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "processos_clientes" },
        () => refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_processo_colunas" },
        () => refresh()
      )
      .subscribe();
    const interval = setInterval(refresh, 60000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [funil, refresh]);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleColumn(ids: number[], select: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function removerProcesso(id: number) {
    setProcessos((list) => list.filter((p) => p.id !== id));
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function moveProcessos(ids: number[], chave: string) {
    if (!ids.length) return;
    const prev = processos;
    setProcessos((list) =>
      list.map((p) => (ids.includes(p.id) ? { ...p, funil_coluna: chave } : p))
    );
    const label = colunas.find((c) => c.chave === chave)?.label ?? chave;
    try {
      const res = await moverProcessoColuna(ids, chave);
      toast.success(
        res.count > 1
          ? `${res.count} processos movidos para "${label}"`
          : `Processo movido para "${label}"`
      );
    } catch (err) {
      setProcessos(prev);
      toast.error("Erro ao mover processo", {
        description: err instanceof Error ? err.message : "Tente novamente",
        action: { label: "Tentar de novo", onClick: () => moveProcessos(ids, chave) },
      });
    }
  }

  function bulkMover(chave: string) {
    const ids = [...selected];
    startBulkTransition(async () => {
      await moveProcessos(ids, chave);
      setSelected(new Set());
    });
  }

  function bulkSituacao(value: string) {
    const ids = [...selected];
    const situacao = value === SITUACAO_LIMPAR ? null : value;
    const prev = processos;
    setProcessos((list) =>
      list.map((p) => (ids.includes(p.id) ? { ...p, situacao } : p))
    );
    startBulkTransition(async () => {
      try {
        const res = await atualizarSituacaoProcesso(ids, situacao);
        const label = situacaoProcessoInfo(situacao)?.label;
        toast.success(
          label
            ? `Situação "${label}" aplicada a ${res.count} processo(s)`
            : `Situação removida de ${res.count} processo(s)`
        );
        setSelected(new Set());
      } catch (err) {
        setProcessos(prev);
        toast.error(err instanceof Error ? err.message : "Erro ao definir situação");
      }
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const p = event.active.data.current?.processo as Processo | undefined;
    if (p) setActiveProcesso(p);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveProcesso(null);
    const p = event.active.data.current?.processo as Processo | undefined;
    const chave = event.over?.id as string | undefined;
    if (!p || !chave) return;
    const ids =
      selected.has(p.id) && selected.size > 1
        ? processos
            .filter((x) => selected.has(x.id) && colunaDe(x) !== chave)
            .map((x) => x.id)
        : colunaDe(p) !== chave
          ? [p.id]
          : [];
    if (ids.length) {
      void moveProcessos(ids, chave);
      if (selected.has(p.id)) setSelected(new Set());
    }
  }

  function handleCriarColuna() {
    const label = novaColunaLabel.trim();
    if (!label) {
      toast.error("Informe o nome da coluna");
      return;
    }
    startColunaTransition(async () => {
      try {
        const created = await criarProcessoColuna({ funil, label });
        setColunas((list) =>
          [...list, created].sort(
            (a, b) => a.ordem - b.ordem || a.label.localeCompare(b.label)
          )
        );
        setNovaColunaLabel("");
        setNovaColunaOpen(false);
        toast.success(`Coluna "${created.label}" criada`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao criar coluna");
      }
    });
  }

  const totalPorColuna = useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const p of processos) {
      const key = colunaDe(p);
      (map[key] ??= []).push(p.id);
    }
    return map;
  }, [processos, colunaDe]);

  async function salvarColuna(
    col: ProcessoColunaMatch,
    patch: { label?: string; cor?: string | null },
    sucesso: string
  ) {
    if (!col.id) return;
    const prev = colunas;
    setColunas((list) =>
      list.map((c) => (c.chave === col.chave ? { ...c, ...patch } : c))
    );
    try {
      const updated = await atualizarProcessoColuna({ id: col.id, ...patch });
      setColunas((list) =>
        list.map((c) => (c.chave === updated.chave ? updated : c))
      );
      toast.success(sucesso);
      router.refresh();
    } catch (err) {
      setColunas(prev);
      toast.error(err instanceof Error ? err.message : "Erro ao salvar coluna");
    }
  }

  async function moverColuna(col: ProcessoColunaMatch, dir: -1 | 1) {
    const idx = colunas.findIndex((c) => c.chave === col.chave);
    const alvo = idx + dir;
    if (idx < 0 || alvo < 0 || alvo >= colunas.length) return;
    if (colunas.some((c) => !c.id)) {
      toast.error("Colunas padrão ainda não salvas — ajuste em Configurações");
      return;
    }
    const prev = colunas;
    const next = [...colunas];
    [next[idx], next[alvo]] = [next[alvo], next[idx]];
    const reordered = next.map((c, i) => ({ ...c, ordem: (i + 1) * 10 }));
    setColunas(reordered);
    try {
      await reordenarProcessoColunas(
        funil,
        reordered.map((c) => c.id!)
      );
      toast.success(`Coluna "${col.label}" movida`);
      router.refresh();
    } catch (err) {
      setColunas(prev);
      toast.error(err instanceof Error ? err.message : "Erro ao reordenar colunas");
    }
  }

  async function arquivarColuna(
    col: ProcessoColunaMatch,
    destino: string | null
  ): Promise<boolean> {
    if (!col.id) return false;
    const ids = totalPorColuna[col.chave] ?? [];
    try {
      if (destino && ids.length) {
        await moverProcessoColuna(ids, destino);
        setProcessos((list) =>
          list.map((p) => (ids.includes(p.id) ? { ...p, funil_coluna: destino } : p))
        );
      }
      await arquivarProcessoColuna(col.id);
      setColunas((list) => list.filter((c) => c.chave !== col.chave));
      const destinoLabel = destino
        ? colunas.find((c) => c.chave === destino)?.label
        : null;
      toast.success(`Coluna "${col.label}" arquivada`, {
        description:
          destinoLabel && ids.length
            ? `${ids.length} processo(s) movido(s) para "${destinoLabel}"`
            : "Reative em Configurações → Funis de processos",
      });
      router.refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao arquivar coluna");
      void refresh();
      return false;
    }
  }

  function editHandlers(
    col: ProcessoColunaMatch,
    index: number
  ): ColunaEditHandlers | undefined {
    if (!canManageColunas || !col.id) return undefined;
    return {
      index,
      total: colunas.length,
      processosCount: totalPorColuna[col.chave]?.length ?? 0,
      onRename: (label) =>
        void salvarColuna(col, { label }, `Coluna renomeada para "${label}"`),
      onCor: (cor) => void salvarColuna(col, { cor }, "Cor da coluna atualizada"),
      onMoveColuna: (dir) => void moverColuna(col, dir),
      onArchive: (destino) => arquivarColuna(col, destino),
    };
  }

  const colunaActions = canManageColunas ? (
    <div className="flex gap-2 sm:ml-auto">
      <Button variant="outline" size="sm" onClick={() => setNovaColunaOpen(true)}>
        <Plus className="mr-1 h-4 w-4" />
        Nova coluna
      </Button>
      <LinkButton href="/configuracoes?tab=funis-processos" size="sm" variant="outline">
        Colunas
      </LinkButton>
    </div>
  ) : null;

  const novaColunaDialog = (
    <Dialog open={novaColunaOpen} onOpenChange={setNovaColunaOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova coluna — funil {labelFunilProcesso(funil)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="nova-coluna-processo">Nome</Label>
          <Input
            id="nova-coluna-processo"
            placeholder="Ex.: Aguardando perícia"
            value={novaColunaLabel}
            onChange={(e) => setNovaColunaLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCriarColuna();
            }}
          />
          <p className="text-xs text-muted-foreground">
            A coluna é adicionada ao final. Depois use o menu ⋮ no topo da
            coluna para renomear, mudar a cor, reordenar ou arquivar.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setNovaColunaOpen(false)}
            disabled={pendingColuna}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleCriarColuna}
            disabled={pendingColuna || !novaColunaLabel.trim()}
          >
            {pendingColuna ? "Criando…" : "Criar coluna"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (processos.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={Scale}
          title={`Nenhum processo no funil ${labelFunilProcesso(funil)}`}
          description={`Use o botão "Novo processo" acima (ou a ficha do cliente), ou transfira processos de outro funil. Eles aparecem aqui na primeira coluna do funil ${labelFunilProcesso(funil)}.`}
        />
        <div className="flex justify-center gap-2">
          <LinkButton href="/clientes" size="sm" variant="default">
            Ir para Clientes
          </LinkButton>
          {colunaActions}
        </div>
        {canManageColunas && colunas.length ? (
          <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:snap-none sm:px-0">
            {colunas.map((col, index) => (
              <div
                key={col.chave}
                className={cn(
                  "flex w-[85vw] max-w-72 shrink-0 snap-start items-center gap-2 rounded-xl border border-t-4 bg-muted/30 p-3 sm:w-72",
                  corBorder(col.cor)
                )}
              >
                <span className={cn("size-2 shrink-0 rounded-full", corDot(col.cor))} aria-hidden />
                <ColunaTitulo coluna={col} colunas={colunas} edit={editHandlers(col, index)} />
              </div>
            ))}
          </div>
        ) : null}
        {novaColunaDialog}
      </div>
    );
  }

  const activeIds =
    activeProcesso && selected.has(activeProcesso.id) ? selected.size : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          placeholder="Buscar por nome, CPF ou nº do processo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <Select
          value={situacaoFilter}
          onValueChange={(v) => setSituacaoFilter(v ?? FILTER_ALL)}
        >
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder="Situação">
              {(v: string | null) => {
                if (!v || v === FILTER_ALL) return "Todas as situações";
                if (v === FILTER_NONE) return "Sem situação";
                return situacaoProcessoInfo(v)?.label ?? v;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FILTER_ALL}>Todas as situações</SelectItem>
            <SelectItem value={FILTER_NONE}>Sem situação</SelectItem>
            {SITUACOES_PROCESSO.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                <span className={cn("size-2 rounded-full", s.dotClassName)} aria-hidden />
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={parceiroFilter}
          onValueChange={(v) => setParceiroFilter(v ?? FILTER_ALL)}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Parceiro">
              {(v: string | null) => {
                if (!v || v === FILTER_ALL) return "Todos os parceiros";
                if (v === FILTER_NONE) return "Sem parceiro";
                return parceiroNomes[v] ?? "Parceiro";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FILTER_ALL}>Todos os parceiros</SelectItem>
            <SelectItem value={FILTER_NONE}>Sem parceiro</SelectItem>
            {parceiros.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.cidade ? `${p.nome} · ${p.cidade}` : p.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {colunaActions}
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-2 z-20 flex flex-col gap-2 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur sm:flex-row sm:flex-wrap sm:items-center">
          <span className="text-sm font-medium">
            {selected.size} selecionado(s)
          </span>
          <Select
            value={null}
            onValueChange={(v) => {
              if (v) bulkMover(v);
            }}
            disabled={pendingBulk}
          >
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="Mover para coluna…" />
            </SelectTrigger>
            <SelectContent>
              {colunas.map((c) => (
                <SelectItem key={c.chave} value={c.chave}>
                  <span className={cn("size-2 rounded-full", corDot(c.cor))} aria-hidden />
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={null}
            onValueChange={(v) => {
              if (v) bulkSituacao(v);
            }}
            disabled={pendingBulk}
          >
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="Definir situação…" />
            </SelectTrigger>
            <SelectContent>
              {SITUACOES_PROCESSO.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  <span className={cn("size-2 rounded-full", s.dotClassName)} aria-hidden />
                  {s.label}
                </SelectItem>
              ))}
              <SelectItem value={SITUACAO_LIMPAR}>Remover situação</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTransferIds([...selected])}
            disabled={pendingBulk}
          >
            <ArrowRightLeft className="mr-1 h-4 w-4" />
            Transferir para outro funil…
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="sm:ml-auto"
            onClick={() => setSelected(new Set())}
            disabled={pendingBulk}
          >
            <X className="mr-1 h-4 w-4" />
            Limpar seleção
          </Button>
        </div>
      ) : null}

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveProcesso(null)}
      >
        <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:snap-none sm:px-0">
          {colunas.map((col, index) => (
            <ProcessoColumn
              edit={editHandlers(col, index)}
              key={col.chave}
              coluna={col}
              colunas={colunas}
              processos={porColuna[col.chave] ?? []}
              parceiroNomes={parceiroNomes}
              activeChaves={activeChaves}
              selected={selected}
              onToggleSelect={toggleSelect}
              onToggleColumn={toggleColumn}
              onMove={(ids, chave) => void moveProcessos(ids, chave)}
              onTransferir={setTransferIds}
              onDeleted={canExcluir ? removerProcesso : undefined}
            />
          ))}
        </div>
        <DragOverlay>
          {activeProcesso ? (
            <ProcessoCard
              processo={activeProcesso}
              parceiroNome={
                activeProcesso.parceiro_id
                  ? parceiroNomes[activeProcesso.parceiro_id]
                  : null
              }
              selected={selected.has(activeProcesso.id)}
              overlayCount={activeIds}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {novaColunaDialog}
      <TransferirProcessoDialog
        ids={transferIds ?? []}
        funilAtual={funil}
        open={transferIds !== null}
        onOpenChange={(open) => {
          if (!open) setTransferIds(null);
        }}
        onTransferred={({ ids }) => {
          setProcessos((list) => list.filter((p) => !ids.includes(p.id)));
          setSelected((prev) => {
            const next = new Set([...prev].filter((id) => !ids.includes(id)));
            return next.size === prev.size ? prev : next;
          });
        }}
      />
    </div>
  );
}
