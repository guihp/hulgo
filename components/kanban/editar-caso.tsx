"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { updateCasoFields } from "@/lib/actions/casos";
import type { Tables } from "@/types/database";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { normalizeCpf } from "@/lib/utils/cpf";
import { cn } from "@/lib/utils";

type Caso = Tables<"casos_novos">;

const SIM_NAO = [
  { value: "nd", label: "Não informado" },
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
];

function boolToStr(v: boolean | null): string {
  if (v === true) return "sim";
  if (v === false) return "nao";
  return "nd";
}
function strToBool(v: string): boolean | null {
  if (v === "sim") return true;
  if (v === "nao") return false;
  return null;
}

export function EditarCasoDialog({ caso }: { caso: Caso }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({
    nome: caso.nome ?? "",
    cpf: caso.cpf ?? "",
    data_nascimento: caso.data_nascimento ?? "",
    beneficio_identificado: caso.beneficio_identificado ?? "",
    area: caso.area ?? "",
    tipo_segurado: caso.tipo_segurado ?? "",
    ja_negou_inss: boolToStr(caso.ja_negou_inss),
    motivo_negativa: caso.motivo_negativa ?? "",
    ja_tem_processo: boolToStr(caso.ja_tem_processo),
    ja_recebe_beneficio: caso.ja_recebe_beneficio ?? "",
    requisitos_preenchidos: caso.requisitos_preenchidos ?? "",
    requisitos_pendentes: caso.requisitos_pendentes ?? "",
    pontos_analise_juridica: caso.pontos_analise_juridica ?? "",
    beneficios_alternativos: caso.beneficios_alternativos ?? "",
  });

  const set =
    (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setF((s) => ({ ...s, [k]: e.target.value }));

  async function salvar() {
    setLoading(true);
    try {
      await updateCasoFields(caso.id, {
        nome: f.nome.trim() || null,
        cpf: f.cpf.trim() ? normalizeCpf(f.cpf) : null,
        data_nascimento: f.data_nascimento || null,
        beneficio_identificado: f.beneficio_identificado.trim() || null,
        area: f.area.trim() || null,
        tipo_segurado: f.tipo_segurado.trim() || null,
        ja_negou_inss: strToBool(f.ja_negou_inss),
        motivo_negativa: f.motivo_negativa.trim() || null,
        ja_tem_processo: strToBool(f.ja_tem_processo),
        ja_recebe_beneficio: f.ja_recebe_beneficio.trim() || null,
        requisitos_preenchidos: f.requisitos_preenchidos.trim() || null,
        requisitos_pendentes: f.requisitos_pendentes.trim() || null,
        pontos_analise_juridica: f.pontos_analise_juridica.trim() || null,
        beneficios_alternativos: f.beneficios_alternativos.trim() || null,
      });
      toast.success("Ficha do caso atualizada");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
      >
        <Pencil className="h-4 w-4" /> Editar dados
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar dados do caso</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input value={f.nome} onChange={set("nome")} />
          </div>
          <div className="space-y-1">
            <Label>CPF</Label>
            <Input value={f.cpf} onChange={set("cpf")} />
          </div>
          <div className="space-y-1">
            <Label>Data de nascimento</Label>
            <Input
              type="date"
              value={f.data_nascimento}
              onChange={set("data_nascimento")}
            />
          </div>
          <div className="space-y-1">
            <Label>Benefício</Label>
            <Input
              value={f.beneficio_identificado}
              onChange={set("beneficio_identificado")}
              placeholder="Ex.: Aposentadoria por Idade Rural"
            />
          </div>
          <div className="space-y-1">
            <Label>Área</Label>
            <Input value={f.area} onChange={set("area")} placeholder="rural | urbano | assistencial" />
          </div>
          <div className="space-y-1">
            <Label>Tipo de segurado</Label>
            <Input value={f.tipo_segurado} onChange={set("tipo_segurado")} />
          </div>
          <div className="space-y-1">
            <Label>Já negou INSS</Label>
            <Select
              value={f.ja_negou_inss}
              onValueChange={(v) => setF((s) => ({ ...s, ja_negou_inss: v ?? "nd" }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SIM_NAO.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Já tem processo</Label>
            <Select
              value={f.ja_tem_processo}
              onValueChange={(v) => setF((s) => ({ ...s, ja_tem_processo: v ?? "nd" }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SIM_NAO.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Motivo da negativa</Label>
            <Input value={f.motivo_negativa} onChange={set("motivo_negativa")} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Já recebe benefício</Label>
            <Input value={f.ja_recebe_beneficio} onChange={set("ja_recebe_beneficio")} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Requisitos preenchidos</Label>
            <Textarea rows={2} value={f.requisitos_preenchidos} onChange={set("requisitos_preenchidos")} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Requisitos pendentes</Label>
            <Textarea rows={2} value={f.requisitos_pendentes} onChange={set("requisitos_pendentes")} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Pontos de análise jurídica</Label>
            <Textarea rows={2} value={f.pontos_analise_juridica} onChange={set("pontos_analise_juridica")} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Benefícios alternativos</Label>
            <Textarea rows={2} value={f.beneficios_alternativos} onChange={set("beneficios_alternativos")} />
          </div>
        </div>
        <Button className="mt-2 w-full" disabled={loading} onClick={salvar}>
          Salvar ficha
        </Button>
      </DialogContent>
    </Dialog>
  );
}
