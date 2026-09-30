"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  ProcessoDialog,
  type ProcessoFormPrefill,
} from "@/components/clientes/clientes-ui";
import { Button } from "@/components/ui/button";
import { labelFunilProcesso, type FunilProcesso } from "@/lib/utils/processos";

export function NovoProcessoButton({ funil }: { funil: FunilProcesso }) {
  const [open, setOpen] = useState(false);
  const prefill = useMemo<ProcessoFormPrefill>(() => ({ area: funil }), [funil]);

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1">
        <Plus className="size-4" />
        Novo processo
      </Button>
      <ProcessoDialog
        open={open}
        onOpenChange={setOpen}
        title={`Novo processo — ${labelFunilProcesso(funil)}`}
        prefill={prefill}
        clientePicker
      />
    </>
  );
}
