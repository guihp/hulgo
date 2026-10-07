import Link from "next/link";
import { FileText, Sparkles, UserRound } from "lucide-react";
import { DOCUMENTOS_TEMPLATES } from "@/lib/utils/documentos";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function DocumentosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Modelos de documentos</h1>
        <p className="text-muted-foreground">
          Procuração, termos e autodeclarações do INSS prontos para preencher e baixar em PDF
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex gap-3 rounded-xl border bg-card p-4 text-sm">
          <UserRound className="mt-0.5 size-5 shrink-0 text-[#163a7a]" />
          <p className="text-muted-foreground">
            <b className="text-foreground">Já com os dados do cliente:</b> abra a ficha
            do cliente e use <b className="text-foreground">Gerar documento</b>.
          </p>
        </div>
        <div className="flex gap-3 rounded-xl border bg-card p-4 text-sm">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-[#163a7a]" />
          <p className="text-muted-foreground">
            <b className="text-foreground">Pelo assistente:</b> envie a foto do RG e do
            comprovante de residência e peça, por exemplo, “preenche a procuração”.
            O link do PDF vale por 1 dia.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {DOCUMENTOS_TEMPLATES.map((t) => (
          <Card key={t.slug} className="flex flex-col">
            <CardContent className="flex flex-1 flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-[#0b2148]/8 p-2 text-[#0b2148]">
                  <FileText className="size-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold leading-tight">{t.label}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t.descricao}</p>
                </div>
              </div>
              <Link
                href={`/documentos/${t.slug}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-auto self-start")}
              >
                Preencher em branco
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
