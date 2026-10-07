"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { DOCUMENTOS_TEMPLATES } from "@/lib/utils/documentos";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** `query`: "cpf=123..." ou "caso=10" — pré-preenche o modelo com os dados do cliente. */
export function GerarDocumentoMenu({ query }: { query: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2")}
      >
        <FileText className="h-4 w-4" />
        Gerar documento
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Modelos (já com os dados do cliente)</DropdownMenuLabel>
          {DOCUMENTOS_TEMPLATES.map((t) => (
            <DropdownMenuItem key={t.slug} render={<Link href={`/documentos/${t.slug}?${query}`} />}>
              {t.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
