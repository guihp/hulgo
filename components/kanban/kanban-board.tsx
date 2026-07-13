"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle, Kanban, MessageSquare, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { updateCasoStatusCliente } from "@/lib/actions/casos";
import { CASO_STATUS } from "@/lib/constants";
import type { CasoStatus, Tables } from "@/types/database";
import { CpfDisplay } from "@/components/shared/cpf-display";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { caseAgeLabel } from "@/lib/utils/dates";
import { normalizeCpf } from "@/lib/utils/cpf";
import {
  findAprovacaoIdForCaso,
  buildAprovacaoPorContato,
  buildClientePorTelefone,
  casoClientKey,
  dedupeCasosPorCliente,
  normalizeCasoStatus,
} from "@/lib/data/kanban-lookups";
import { cn } from "@/lib/utils";

type Caso = Tables<"casos_novos">;

function statusLabel(status: string | null | undefined) {
  const normalized = normalizeCasoStatus(status);
  return CASO_STATUS.find((s) => s.value === normalized)?.label ?? status ?? "—";
}

function displayName(caso: Caso, displayNames: Record<string, string>) {
  if (caso.nome?.trim()) return caso.nome;
  const digits = caso.telefone?.replace(/\D/g, "") ?? "";
  if (digits && displayNames[digits]) return displayNames[digits];
  return "Sem nome";
}

function CasoCard({
  caso,
  displayNames,
  aprovacaoPorContato,
  clientePorTelefone,
  isDragging,
}: {
  caso: Caso;
  displayNames: Record<string, string>;
  aprovacaoPorContato: Record<string, number>;
  clientePorTelefone: Record<string, string>;
  isDragging?: boolean;
}) {
  const hasDocsFaltantes = Boolean(caso.documentos_faltantes?.trim());
  const contactDigits = caso.telefone?.replace(/\D/g, "") ?? "";
  const cpfCaso = caso.cpf ? normalizeCpf(caso.cpf) : "";
  const temProcesso = Boolean(
    contactDigits && clientePorTelefone[contactDigits]
  );
  const cpfCliente =
    cpfCaso || (contactDigits ? clientePorTelefone[contactDigits] : "") || "";
  const aprovacaoId = findAprovacaoIdForCaso(
    caso.telefone,
    caso.cpf,
    aprovacaoPorContato
  );
  const statusNormalizado = normalizeCasoStatus(caso.status);
  const mostrarCliente = statusNormalizado === "abertura_processo";
  const mostrarAprovacao = statusNormalizado === "aguardando_aprovacao";

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 shadow-sm transition-shadow",
        isDragging && "opacity-50 shadow-lg",
        hasDocsFaltantes && "border-amber-500/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-tight">{displayName(caso, displayNames)}</p>
        {hasDocsFaltantes && (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-label="Documentos faltantes" />
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
        {caso.beneficio_identificado ?? "Benefício não identificado"}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary">{statusLabel(caso.status)}</Badge>
        <CpfDisplay value={caso.cpf} />
        <Badge variant="outline">{caseAgeLabel(caso.created_at)}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        <LinkButton href={`/kanban/${caso.id}`} size="sm" variant="outline" className="h-7 text-xs">
          Detalhes
        </LinkButton>
        {contactDigits ? (
          <LinkButton
            href={`/atendimentos?contact=${encodeURIComponent(contactDigits)}`}
            size="sm"
            variant="outline"
            className="h-7 text-xs"
          >
            <MessageSquare className="mr-1 h-3 w-3" />
            Chat
          </LinkButton>
        ) : null}
        {mostrarCliente ? (
          temProcesso ? (
            <LinkButton
              href={`/clientes/${cpfCliente}`}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
            >
              <User className="mr-1 h-3 w-3" />
              Cliente
            </LinkButton>
          ) : (
            <LinkButton
              href={`/clientes?caso=${caso.id}`}
              size="sm"
              variant="default"
              className="h-7 text-xs"
            >
              <User className="mr-1 h-3 w-3" />
              Criar processo
            </LinkButton>
          )
        ) : null}
        {mostrarAprovacao ? (
          <LinkButton
            href={aprovacaoId ? `/aprovacoes/${aprovacaoId}` : "/aprovacoes"}
            size="sm"
            variant={aprovacaoId ? "default" : "outline"}
            className="h-7 text-xs"
          >
            <CheckCircle className="mr-1 h-3 w-3" />
            {aprovacaoId ? "Aprovar" : "Aprovações"}
          </LinkButton>
        ) : null}
      </div>
    </div>
  );
}

function DraggableCasoCard({
  caso,
  displayNames,
  aprovacaoPorContato,
  clientePorTelefone,
}: {
  caso: Caso;
  displayNames: Record<string, string>;
  aprovacaoPorContato: Record<string, number>;
  clientePorTelefone: Record<string, string>;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `caso-${caso.id}`,
    data: { caso },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="touch-none">
      <CasoCard
        caso={caso}
        displayNames={displayNames}
        aprovacaoPorContato={aprovacaoPorContato}
        clientePorTelefone={clientePorTelefone}
        isDragging={isDragging}
      />
    </div>
  );
}

function KanbanColumn({
  status,
  label,
  casos,
  onMove,
  displayNames,
  aprovacaoPorContato,
  clientePorTelefone,
}: {
  status: CasoStatus;
  label: string;
  casos: Caso[];
  onMove: (casoId: number, newStatus: CasoStatus) => void;
  displayNames: Record<string, string>;
  aprovacaoPorContato: Record<string, number>;
  clientePorTelefone: Record<string, string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[320px] w-72 shrink-0 flex-col rounded-xl border bg-muted/30",
        isOver && "ring-2 ring-primary"
      )}
    >
      <div className="flex items-center justify-between border-b p-3">
        <h3 className="text-sm font-semibold">{label}</h3>
        <Badge variant="secondary">{casos.length}</Badge>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {casos.map((caso) => (
          <div key={caso.id} className="space-y-1">
            <DraggableCasoCard
              caso={caso}
              displayNames={displayNames}
              aprovacaoPorContato={aprovacaoPorContato}
              clientePorTelefone={clientePorTelefone}
            />
            <Select
              value={normalizeCasoStatus(caso.status)}
              onValueChange={(v) => onMove(caso.id, v as CasoStatus)}
            >
              <SelectTrigger className="h-7 text-xs lg:hidden">
                <SelectValue placeholder="Mover para..." />
              </SelectTrigger>
              <SelectContent>
                {CASO_STATUS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
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

export function KanbanBoard({
  initialCasos,
  displayNames = {},
  initialAprovacaoPorContato = {},
  initialClientePorTelefone = {},
}: {
  initialCasos: Caso[];
  displayNames?: Record<string, string>;
  initialAprovacaoPorContato?: Record<string, number>;
  initialClientePorTelefone?: Record<string, string>;
}) {
  const [casos, setCasos] = useState(initialCasos);
  const [aprovacaoPorContato, setAprovacaoPorContato] = useState(
    initialAprovacaoPorContato
  );
  const [clientePorTelefone, setClientePorTelefone] = useState(
    initialClientePorTelefone
  );
  const [activeCaso, setActiveCaso] = useState<Caso | null>(null);
  const [search, setSearch] = useState("");
  const [beneficioFilter, setBeneficioFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const beneficios = useMemo(
    () => [...new Set(casos.map((c) => c.beneficio_identificado).filter(Boolean))] as string[],
    [casos]
  );
  const areas = useMemo(
    () => [...new Set(casos.map((c) => c.area).filter(Boolean))] as string[],
    [casos]
  );

  // 1 cliente = 1 card (n8n pode ter mais de uma linha por telefone)
  const { casos: casosUnicos, idsPorCliente } = useMemo(
    () => dedupeCasosPorCliente(casos),
    [casos]
  );

  const filtered = useMemo(() => {
    return casosUnicos.filter((c) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        c.nome?.toLowerCase().includes(q) ||
        c.cpf?.includes(q.replace(/\D/g, ""));
      const matchBeneficio =
        beneficioFilter === "all" || c.beneficio_identificado === beneficioFilter;
      const matchArea = areaFilter === "all" || c.area === areaFilter;
      return matchSearch && matchBeneficio && matchArea;
    });
  }, [casosUnicos, search, beneficioFilter, areaFilter]);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data: casosData }, { data: aprovData }, { data: processosData }] =
      await Promise.all([
        supabase
          .from("casos_novos")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("aprovacoes_pendentes")
          .select("id, telefone_cliente, cpf, status")
          .order("created_at", { ascending: false }),
        supabase.from("processos_clientes").select("telefone, cpf"),
      ]);
    if (casosData) setCasos(casosData);
    if (aprovData) setAprovacaoPorContato(buildAprovacaoPorContato(aprovData));
    if (processosData) setClientePorTelefone(buildClientePorTelefone(processosData));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("kanban-casos")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "casos_novos" },
        () => refresh()
      )
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

  async function moveCaso(casoId: number, newStatus: CasoStatus) {
    const caso = casos.find((c) => c.id === casoId);
    // Move todas as linhas do mesmo cliente, senão outra linha "puxa" o card
    // de volta para a coluna antiga no próximo refresh
    const ids = caso ? idsPorCliente[casoClientKey(caso)] ?? [casoId] : [casoId];
    const prev = casos;
    setCasos((list) =>
      list.map((c) => (ids.includes(c.id) ? { ...c, status: newStatus } : c))
    );
    try {
      const result = await updateCasoStatusCliente(ids, newStatus);
      if (result.aprovacaoCriada) {
        toast.success("Pendência criada em Aprovações");
      } else {
        toast.success("Status atualizado");
      }
    } catch (err) {
      setCasos(prev);
      toast.error("Erro ao mover caso", {
        description: err instanceof Error ? err.message : "Tente novamente",
        action: { label: "Retry", onClick: () => moveCaso(casoId, newStatus) },
      });
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const caso = event.active.data.current?.caso as Caso | undefined;
    if (caso) setActiveCaso(caso);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCaso(null);
    const caso = event.active.data.current?.caso as Caso | undefined;
    const newStatus = event.over?.id as CasoStatus | undefined;
    if (caso && newStatus && normalizeCasoStatus(caso.status) !== newStatus) {
      moveCaso(caso.id, newStatus);
    }
  }

  if (casos.length === 0) {
    return (
      <EmptyState
        icon={Kanban}
        title="Nenhum caso na fila"
        description="Quando a IA triar um novo caso pelo WhatsApp, ele aparecerá aqui automaticamente."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Buscar por nome ou CPF..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <Select value={beneficioFilter} onValueChange={(v) => setBeneficioFilter(v ?? "all")}>
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder="Benefício" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os benefícios</SelectItem>
            {beneficios.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={areaFilter} onValueChange={(v) => setAreaFilter(v ?? "all")}>
          <SelectTrigger className="sm:w-40">
            <SelectValue placeholder="Área" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as áreas</SelectItem>
            {areas.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {CASO_STATUS.map((col) => (
            <KanbanColumn
              key={col.value}
              status={col.value}
              label={col.label}
              casos={filtered.filter(
                (c) => normalizeCasoStatus(c.status) === col.value
              )}
              onMove={moveCaso}
              displayNames={displayNames}
              aprovacaoPorContato={aprovacaoPorContato}
              clientePorTelefone={clientePorTelefone}
            />
          ))}
        </div>
        <DragOverlay>
          {activeCaso ? (
            <CasoCard
              caso={activeCaso}
              displayNames={displayNames}
              aprovacaoPorContato={aprovacaoPorContato}
              clientePorTelefone={clientePorTelefone}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
