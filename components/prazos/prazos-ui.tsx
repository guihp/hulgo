"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { differenceInCalendarDays } from "date-fns";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { criarPrazo, concluirPrazo, excluirPrazo } from "@/lib/actions/prazos";
import type { PrazoTipo, Tables } from "@/types/database";
import { PRAZO_TIPOS } from "@/lib/utils/beneficios";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

type Prazo = Tables<"app_prazos">;

export function prazoUrgencia(dataPrazo: string, concluido: boolean) {
  if (concluido) return { label: "concluído", classes: "", badge: "secondary" as const };
  const dias = differenceInCalendarDays(new Date(dataPrazo + "T12:00:00"), new Date());
  if (dias < 0)
    return {
      label: `vencido há ${Math.abs(dias)}d`,
      classes: "border-destructive bg-destructive/5",
      badge: "destructive" as const,
    };
  if (dias === 0)
    return { label: "vence hoje", classes: "border-destructive bg-destructive/5", badge: "destructive" as const };
  if (dias <= 7)
    return {
      label: `em ${dias}d`,
      classes: "border-amber-500/60 bg-amber-500/5",
      badge: "outline" as const,
    };
  return { label: `em ${dias}d`, classes: "", badge: "secondary" as const };
}

export function tipoLabel(tipo: string) {
  return PRAZO_TIPOS.find((t) => t.value === tipo)?.label ?? tipo;
}

/* ---------- Dialog de novo prazo (reutilizado em caso/cliente) ---------- */

export function NovoPrazoDialog({
  cpf,
  casoId,
  processoId,
  triggerLabel = "Novo prazo",
  triggerVariant = "default",
}: {
  cpf?: string | null;
  casoId?: number;
  processoId?: number;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<PrazoTipo>("outro");
  const [data, setData] = useState("");
  const [descricao, setDescricao] = useState("");
  const [loading, setLoading] = useState(false);

  async function salvar() {
    setLoading(true);
    try {
      await criarPrazo({
        titulo,
        tipo,
        data_prazo: data,
        descricao,
        cpf: cpf ?? undefined,
        caso_id: casoId,
        processo_id: processoId,
      });
      toast.success("Prazo criado");
      setOpen(false);
      setTitulo("");
      setData("");
      setDescricao("");
      setTipo("outro");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar prazo");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn(buttonVariants({ variant: triggerVariant }), "gap-2")}
      >
        <Plus className="h-4 w-4" /> {triggerLabel}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo prazo</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Título</Label>
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Responder exigência do INSS — Maria Silva"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as PrazoTipo)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRAZO_TIPOS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Data limite</Label>
              <Input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Observações (opcional)</Label>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
            />
          </div>
          <Button
            className="w-full"
            disabled={loading || !titulo.trim() || !data}
            onClick={salvar}
          >
            Salvar prazo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Lista da página /prazos ---------- */

export function PrazosList({ prazos }: { prazos: Prazo[] }) {
  const router = useRouter();
  const [mostrarConcluidos, setMostrarConcluidos] = useState(false);

  const { abertos, concluidos } = useMemo(() => {
    const abertos = prazos
      .filter((p) => !p.concluido)
      .sort((a, b) => a.data_prazo.localeCompare(b.data_prazo));
    const concluidos = prazos
      .filter((p) => p.concluido)
      .sort((a, b) => b.data_prazo.localeCompare(a.data_prazo));
    return { abertos, concluidos };
  }, [prazos]);

  async function toggle(prazo: Prazo) {
    try {
      await concluirPrazo(prazo.id, !prazo.concluido);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  }

  async function remover(id: number) {
    try {
      await excluirPrazo(id);
      toast.success("Prazo excluído");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  }

  if (prazos.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Nenhum prazo cadastrado"
        description="Crie prazos de exigência do INSS, recurso, perícia ou audiência para não perder datas."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {abertos.map((p) => (
          <PrazoRow key={p.id} prazo={p} onToggle={toggle} onRemove={remover} />
        ))}
        {abertos.length === 0 && (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Nenhum prazo em aberto. 👌
          </div>
        )}
      </div>

      {concluidos.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMostrarConcluidos((v) => !v)}
          >
            {mostrarConcluidos ? "Ocultar" : "Mostrar"} concluídos (
            {concluidos.length})
          </Button>
          {mostrarConcluidos && (
            <div className="mt-2 space-y-2">
              {concluidos.map((p) => (
                <PrazoRow
                  key={p.id}
                  prazo={p}
                  onToggle={toggle}
                  onRemove={remover}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PrazoRow({
  prazo,
  onToggle,
  onRemove,
}: {
  prazo: Prazo;
  onToggle: (p: Prazo) => void;
  onRemove: (id: number) => void;
}) {
  const urg = prazoUrgencia(prazo.data_prazo, prazo.concluido);

  return (
    <Card className={cn(urg.classes)}>
      <CardContent className="flex items-center gap-3 p-3">
        <Checkbox
          checked={prazo.concluido}
          onCheckedChange={() => onToggle(prazo)}
          aria-label="Concluir prazo"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm font-medium",
              prazo.concluido && "text-muted-foreground line-through"
            )}
          >
            {prazo.titulo}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{formatDate(prazo.data_prazo)}</span>
            <Badge variant="outline">{tipoLabel(prazo.tipo)}</Badge>
            {prazo.caso_id && (
              <Link
                href={`/kanban/${prazo.caso_id}`}
                className="text-primary hover:underline"
              >
                ver caso
              </Link>
            )}
            {prazo.descricao && (
              <span className="truncate">{prazo.descricao}</span>
            )}
          </div>
        </div>
        <Badge variant={urg.badge} className="shrink-0">
          {urg.label}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          onClick={() => onRemove(prazo.id)}
          aria-label="Excluir prazo"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
