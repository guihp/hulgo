"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { excluirProcesso } from "@/lib/actions/casos";
import { formatNumeroProcesso } from "@/lib/utils/processo";
import { buttonVariants } from "@/components/ui/button";
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
import { toastErroAcao } from "@/lib/client/erros";

export function ExcluirProcessoDialog({
  processo,
  compact = false,
  className,
  onDeleted,
}: {
  processo: { id: number; numero_processo: string | null; nome: string | null };
  /** Só o ícone (cards do funil). */
  compact?: boolean;
  className?: string;
  onDeleted?: (id: number) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const numero = processo.numero_processo
    ? formatNumeroProcesso(processo.numero_processo)
    : "sem número";

  async function excluir() {
    setDeleting(true);
    try {
      await excluirProcesso(processo.id);
      toast.success("Processo excluído");
      setOpen(false);
      onDeleted?.(processo.id);
      router.refresh();
    } catch (err) {
      toastErroAcao(err, "Erro ao excluir processo");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        title="Excluir processo"
        aria-label="Excluir processo"
        className={cn(
          buttonVariants({ variant: "outline", size: compact ? "icon-sm" : "sm" }),
          "text-destructive hover:text-destructive",
          className
        )}
      >
        <Trash2 className={compact ? "h-3.5 w-3.5" : "mr-1 h-3.5 w-3.5"} />
        {compact ? null : "Excluir"}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir processo?</AlertDialogTitle>
          <AlertDialogDescription>
            Excluir o processo <strong className="font-mono">{numero}</strong>
            {processo.nome?.trim() ? (
              <>
                {" "}de <strong>{processo.nome.trim()}</strong>
              </>
            ) : null}
            . Esta ação não pode ser desfeita. Documentos e prazos/audiências
            vinculados continuam no cliente, sem vínculo com o processo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting}
            onClick={(e) => {
              e.preventDefault();
              void excluir();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Excluindo…" : "Excluir"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
