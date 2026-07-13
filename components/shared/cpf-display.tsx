"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCpfCnpj, maskCpf } from "@/lib/utils/cpf";

export function CpfDisplay({ value }: { value: string | null | undefined }) {
  const [revealed, setRevealed] = useState(false);
  if (!value) return <span className="text-muted-foreground">—</span>;

  return (
    <span className="inline-flex items-center gap-1 font-mono text-sm">
      {revealed ? formatCpfCnpj(value) : maskCpf(value)}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? "Ocultar CPF" : "Revelar CPF"}
      >
        {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </Button>
    </span>
  );
}
