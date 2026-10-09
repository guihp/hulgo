"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { definirNumeroProcesso } from "@/lib/actions/casos";
import {
  isValidNumeroProcesso,
  maskNumeroProcessoInput,
  normalizeNumeroProcesso,
} from "@/lib/utils/processo";
import { funilExigeCnj, normalizeAreaProcesso } from "@/lib/utils/processos";
import { toastErroAcao } from "@/lib/client/erros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Preenche o número de um processo cadastrado "sem número". */
export function AdicionarNumeroDialog({
  processo,
  onOpenChange,
  onSaved,
}: {
  processo: { id: number; nome: string | null; area: string | null } | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (id: number, numero: string) => void;
}) {
  const router = useRouter();
  const [numero, setNumero] = useState("");
  const [saving, setSaving] = useState(false);
  const exigeCnj = funilExigeCnj(normalizeAreaProcesso(processo?.area));

  async function salvar() {
    if (!processo) return;
    const digitos = normalizeNumeroProcesso(numero);
    if (!digitos) {
      toast.error("Informe o número do processo");
      return;
    }
    if (exigeCnj && !isValidNumeroProcesso(digitos)) {
      toast.error("Número CNJ inválido (precisa ter 20 dígitos)");
      return;
    }
    setSaving(true);
    try {
      const res = await definirNumeroProcesso(processo.id, digitos);
      toast.success("Número do processo adicionado");
      onSaved?.(processo.id, res.numero_processo);
      setNumero("");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toastErroAcao(err, "Não foi possível salvar o número");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={processo !== null}
      onOpenChange={(open) => {
        if (!open) setNumero("");
        onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar número do processo</DialogTitle>
          <DialogDescription>
            {processo?.nome ?? "Processo"} foi cadastrado sem número. Informe o
            número para liberar a consulta automática de andamentos.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="adicionar-numero-processo">
            {exigeCnj ? "Nº processo CNJ" : "Nº do requerimento / NB"}
          </Label>
          <Input
            id="adicionar-numero-processo"
            value={numero}
            onChange={(e) =>
              setNumero(
                exigeCnj
                  ? maskNumeroProcessoInput(e.target.value)
                  : e.target.value.replace(/[^\d.\-/]/g, "").slice(0, 30)
              )
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") void salvar();
            }}
            inputMode="numeric"
            placeholder={exigeCnj ? "0000000-00.0000.0.00.0000" : "Protocolo ou NB"}
            className="font-mono"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button onClick={() => void salvar()} disabled={saving}>
            {saving ? "Salvando…" : "Salvar número"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
