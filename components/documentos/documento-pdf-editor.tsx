"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { nomeArquivo, preencherPdf } from "@/lib/documentos/preencher-pdf";
import type { CampoDocumento, DadosDocumento, DocumentoTemplate } from "@/lib/utils/documentos";
import {
  aplicarTemplate,
  entradaDoCampo,
  filtrarEntradaCampo,
  valoresIniciais,
} from "@/lib/utils/documentos";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/client/erros";

const COL_SPAN = {
  1: "sm:col-span-1",
  2: "sm:col-span-2",
  3: "sm:col-span-3",
} as const;

export function DocumentoPdfEditor({
  template,
  dados,
  valoresPreenchidos,
  avisoExpirado,
}: {
  template: DocumentoTemplate;
  dados: DadosDocumento;
  /** Valores já preenchidos (ex.: pelo assistente) — sobrepõem os iniciais. */
  valoresPreenchidos?: Record<string, string>;
  avisoExpirado?: boolean;
}) {
  const iniciais = useMemo(
    () => ({ ...valoresIniciais(template, dados), ...(valoresPreenchidos ?? {}) }),
    [template, dados, valoresPreenchidos]
  );
  const [valores, setValores] = useState<Record<string, string>>(iniciais);
  // Derivado que veio diferente do recalculado foi escrito à mão: não sobrescrever.
  const [editados, setEditados] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      template.campos
        .filter(
          (c) =>
            c.template &&
            valoresPreenchidos?.[c.key] &&
            valoresPreenchidos[c.key] !== aplicarTemplate(c.template, iniciais)
        )
        .map((c) => [c.key, true])
    )
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  const setCampo = (campo: CampoDocumento, valor: string) => {
    const filtrado = filtrarEntradaCampo(valor, entradaDoCampo(campo));
    setEditados((e) => ({ ...e, [campo.key]: true }));
    setValores((v) => ({ ...v, [campo.key]: filtrado }));
  };

  // Campos derivados acompanham os demais até o usuário editá-los à mão.
  useEffect(() => {
    setValores((atual) => {
      let mudou = false;
      const proximo = { ...atual };
      for (const campo of template.campos) {
        if (!campo.template || editados[campo.key]) continue;
        const derivado = aplicarTemplate(campo.template, atual);
        if (derivado !== atual[campo.key]) {
          proximo[campo.key] = derivado;
          mudou = true;
        }
      }
      return mudou ? proximo : atual;
    });
  }, [template.campos, valores, editados]);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const gerar = useCallback(async () => {
    setGerando(true);
    setErro(null);
    try {
      const bytes = await preencherPdf(template, valores);
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = url;
      setPreview(url);
      return url;
    } catch (e) {
      setErro(mensagemErro(e, "Falha ao gerar o PDF"));
      return null;
    } finally {
      setGerando(false);
    }
  }, [template, valores]);

  // Veio preenchido (assistente): mostra a prévia sem precisar clicar.
  const previaAutomatica = useRef(Boolean(valoresPreenchidos));
  useEffect(() => {
    if (!previaAutomatica.current) return;
    previaAutomatica.current = false;
    void gerar();
  }, [gerar]);

  const baixar = async () => {
    const url = (await gerar()) ?? preview;
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo(template, valores.nome ?? dados.clienteNome);
    a.click();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={dados.voltarHref}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">{template.label}</h1>
            <p className="text-sm text-muted-foreground">{template.descricao}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={gerar} disabled={gerando} className="gap-2">
            {gerando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Gerar / atualizar
          </Button>
          <Button onClick={baixar} disabled={gerando} className="gap-2">
            <Download className="h-4 w-4" /> Baixar PDF
          </Button>
        </div>
      </div>

      {avisoExpirado && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          O documento preenchido pelo assistente expirou (vale 1 dia). Os campos abaixo
          vieram da ficha do cliente.
        </p>
      )}
      {valoresPreenchidos && (
        <p className="rounded-md border border-[#0b2148]/15 bg-[#0b2148]/5 p-3 text-sm text-[#0b2148]">
          Campos preenchidos pelo assistente. Confira, ajuste se precisar e clique em
          <b className="mx-1">Baixar PDF</b>.
        </p>
      )}
      {erro && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {erro}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-3 self-start rounded-lg border bg-background p-4 sm:grid-cols-3">
          {template.campos.map((campo) => (
            <CampoInput
              key={campo.key}
              campo={campo}
              valor={valores[campo.key] ?? ""}
              onChange={(v) => setCampo(campo, v)}
            />
          ))}
        </div>

        <div className="min-h-[60vh] overflow-hidden rounded-lg border bg-muted/40">
          {preview ? (
            <iframe src={preview} title="Prévia do documento" className="h-[80vh] w-full" />
          ) : (
            <div className="flex h-full min-h-[60vh] items-center justify-center p-6 text-center text-sm text-muted-foreground">
              Preencha os campos e clique em <b className="mx-1">Gerar / atualizar</b> para
              ver a prévia.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CampoInput({
  campo,
  valor,
  onChange,
}: {
  campo: CampoDocumento;
  valor: string;
  onChange: (valor: string) => void;
}) {
  const span = COL_SPAN[campo.colSpan ?? 1];
  const entrada = entradaDoCampo(campo);
  const inputMode =
    entrada === "numero" ? "numeric" : entrada === "texto" ? "text" : undefined;

  return (
    <div className={cn("space-y-1", span)}>
      <Label className="text-xs">{campo.label}</Label>
      {campo.tipo === "opcao" ? (
        <Select value={valor} onValueChange={(v) => onChange(v ?? "")}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecionar" />
          </SelectTrigger>
          <SelectContent>
            {(campo.opcoes ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : campo.tipo === "textarea" ? (
        <Textarea
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={campo.placeholder}
          rows={3}
        />
      ) : (
        <Input
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={campo.placeholder}
          inputMode={inputMode}
          autoComplete="off"
        />
      )}
    </div>
  );
}
