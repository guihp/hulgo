"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarClock,
  ExternalLink,
  FileText,
  ListChecks,
} from "lucide-react";
import {
  addNotaCaso,
  marcarProcessoCriado,
  updateCasoFields,
  updateCasoStatus,
} from "@/lib/actions/casos";
import type { AppUser } from "@/lib/actions/auth";
import type { CasoStatus, Tables } from "@/types/database";
import { CpfDisplay } from "@/components/shared/cpf-display";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CASO_STATUS } from "@/lib/constants";
import { parseDocumentList } from "@/lib/utils/messages";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { formatNumeroProcesso } from "@/lib/utils/processo";
import {
  avaliarRequisitoEtario,
  chaveDoBeneficio,
  CHECKLIST_POR_BENEFICIO,
} from "@/lib/utils/beneficios";
import { NovoPrazoDialog } from "@/components/prazos/prazos-ui";
import { EditarCasoDialog } from "@/components/kanban/editar-caso";
import { DocsAdvogado } from "@/components/kanban/docs-advogado";
import Link from "next/link";

function statusLabel(status: string | null | undefined) {
  return CASO_STATUS.find((s) => s.value === status)?.label ?? status ?? "—";
}

type Caso = Tables<"casos_novos">;
type Nota = Tables<"app_notas_caso"> & { autor?: { nome: string } | null };
type DocumentoCliente = Tables<"documentos_cliente">;

export function CasoDetail({
  caso,
  notas,
  documentos,
  user,
}: {
  caso: Caso;
  notas: Nota[];
  documentos: DocumentoCliente[];
  user: AppUser;
}) {
  const router = useRouter();
  const [nota, setNota] = useState("");
  const [numeroProcesso, setNumeroProcesso] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [consultas, setConsultas] = useState({
    consulta_tse: caso.consulta_tse ?? "",
    consulta_dap_caf: caso.consulta_dap_caf ?? "",
    consulta_jf: caso.consulta_jf ?? "",
  });

  const recebidos = parseDocumentList(caso.documentos_recebidos);
  const faltantes = parseDocumentList(caso.documentos_faltantes);
  const requisito = avaliarRequisitoEtario(
    caso.data_nascimento,
    caso.beneficio_identificado
  );
  const checklistTemplate =
    CHECKLIST_POR_BENEFICIO[chaveDoBeneficio(caso.beneficio_identificado)];

  async function aplicarChecklist() {
    const jaListados = new Set(
      [...recebidos, ...faltantes, ...documentos.map((d) => d.nome_documento)].map(
        (d) => d.toLowerCase()
      )
    );
    const novos = checklistTemplate.docs.filter(
      (d) => !jaListados.has(d.toLowerCase())
    );
    if (novos.length === 0) {
      toast.info("Checklist já aplicado — nenhum documento novo");
      return;
    }
    try {
      await updateCasoFields(caso.id, {
        documentos_faltantes: [...faltantes, ...novos].join(", "),
      });
      toast.success(`${novos.length} documento(s) adicionados aos faltantes`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao aplicar checklist");
    }
  }

  async function marcarDocumentoRecebido(doc: string) {
    try {
      await updateCasoFields(caso.id, {
        documentos_recebidos: [...recebidos, doc].join(", "),
        documentos_faltantes: faltantes.filter((f) => f !== doc).join(", "),
      });
      toast.success(`"${doc}" marcado como recebido`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
    }
  }

  async function handleAddNota() {
    if (!nota.trim()) return;
    try {
      await addNotaCaso(caso.id, nota.trim());
      setNota("");
      toast.success("Nota adicionada");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar nota");
    }
  }

  async function handleSaveConsultas() {
    try {
      await updateCasoFields(caso.id, consultas);
      toast.success("Consultas salvas");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  }

  async function handleMarcarProcesso() {
    try {
      const formatted = formatNumeroProcesso(numeroProcesso);
      await marcarProcessoCriado(caso.id, formatted);
      toast.success("Processo criado com sucesso");
      setDialogOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar processo");
    }
  }

  async function handleStatusChange(status: CasoStatus) {
    try {
      await updateCasoStatus(caso.id, status);
      toast.success("Status atualizado");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar");
    }
  }

  const fields: { label: string; value: string | null | undefined }[] = [
    { label: "Nome", value: caso.nome },
    { label: "CPF", value: caso.cpf },
    { label: "Data de nascimento", value: formatDate(caso.data_nascimento) },
    { label: "Telefone", value: caso.telefone },
    { label: "Benefício", value: caso.beneficio_identificado },
    { label: "Área", value: caso.area },
    { label: "Tipo de segurado", value: caso.tipo_segurado },
    { label: "Já negou INSS", value: caso.ja_negou_inss ? "Sim" : "Não" },
    { label: "Motivo negativa", value: caso.motivo_negativa },
    { label: "Já tem processo", value: caso.ja_tem_processo ? "Sim" : "Não" },
    { label: "Já recebe benefício", value: caso.ja_recebe_beneficio },
    { label: "Requisitos preenchidos", value: caso.requisitos_preenchidos },
    { label: "Requisitos pendentes", value: caso.requisitos_pendentes },
    { label: "Pontos de análise", value: caso.pontos_analise_juridica },
    { label: "Benefícios alternativos", value: caso.beneficios_alternativos },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <LinkButton href="/kanban" variant="ghost" size="icon">
          <ArrowLeft className="h-4 w-4" />
        </LinkButton>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{caso.nome ?? "Caso sem nome"}</h1>
          <p className="text-sm text-muted-foreground">
            Criado em {formatDateTime(caso.created_at)}
          </p>
        </div>
        <Badge>{statusLabel(caso.status)}</Badge>
      </div>

      {requisito && (
        <div
          className={
            "flex items-center gap-2 rounded-lg border p-3 text-sm " +
            (requisito.atingido === true
              ? "border-emerald-500/50 bg-emerald-500/5"
              : requisito.atingido === false
                ? "border-destructive/50 bg-destructive/5"
                : "border-amber-500/50 bg-amber-500/5")
          }
        >
          <span className="font-medium">
            {requisito.atingido === true
              ? "✓ Requisito etário atingido"
              : requisito.atingido === false
                ? "✗ Requisito etário NÃO atingido"
                : "△ Requisito etário depende do sexo/análise"}
          </span>
          <span className="text-muted-foreground">
            — cliente com {requisito.idade} anos · {requisito.requisito}
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Select value={caso.status ?? "em_atendimento"} onValueChange={(v) => handleStatusChange(v as CasoStatus)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CASO_STATUS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {user.papel === "advogado" && caso.status !== "processo_finalizado" && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger className={buttonVariants()}>
              Marcar processo finalizado
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Número do processo CNJ</DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="numero">Número CNJ</Label>
                <Input
                  id="numero"
                  placeholder="0000000-00.0000.0.00.0000"
                  value={numeroProcesso}
                  onChange={(e) => setNumeroProcesso(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button onClick={handleMarcarProcesso}>Confirmar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        <EditarCasoDialog caso={caso} />

        <NovoPrazoDialog
          cpf={caso.cpf}
          casoId={caso.id}
          triggerLabel="Novo prazo"
          triggerVariant="outline"
        />

        <DropdownMenu>
          <DropdownMenuTrigger className={buttonVariants({ variant: "outline" })}>
            <FileText className="mr-2 h-4 w-4" /> Gerar documento
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              render={<Link href={`/documentos/procuracao?caso=${caso.id}`} />}
            >
              Procuração
            </DropdownMenuItem>
            <DropdownMenuItem
              render={<Link href={`/documentos/honorarios?caso=${caso.id}`} />}
            >
              Contrato de honorários
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <Link href={`/documentos/hipossuficiencia?caso=${caso.id}`} />
              }
            >
              Declaração de hipossuficiência
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dados do caso</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {fields.map((f) => (
              <div key={f.label} className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">{f.label}</span>
                <span>
                  {f.label === "CPF" ? <CpfDisplay value={f.value} /> : f.value || "—"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Documentos</CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={aplicarChecklist}
            >
              <ListChecks className="h-4 w-4" />
              Aplicar checklist ({checklistTemplate.label})
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">Recebidos</p>
              {recebidos.length === 0 && documentos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum</p>
              ) : (
                <ul className="space-y-2">
                  {documentos.filter((d) => d.origem !== "advogado").map((doc) => (
                    <li key={doc.id} className="rounded-lg border p-2 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">{doc.nome_documento}</p>
                          {doc.descricao ? (
                            <p className="text-xs text-muted-foreground">{doc.descricao}</p>
                          ) : null}
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {formatDateTime(doc.created_at)}
                          </p>
                        </div>
                        <a
                          href={doc.url_media}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex shrink-0 items-center gap-1 text-xs text-primary underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Abrir
                        </a>
                      </div>
                    </li>
                  ))}
                  {recebidos
                    .filter(
                      (label) =>
                        !documentos.some(
                          (d) => d.nome_documento.toLowerCase() === label.toLowerCase()
                        )
                    )
                    .map((doc) => (
                      <li key={doc} className="flex items-center gap-2 text-sm">
                        <Checkbox checked disabled />
                        {doc}
                      </li>
                    ))}
                </ul>
              )}
            </div>
            <Separator />
            <div>
              <p className="mb-2 text-sm font-medium text-amber-600">Faltantes</p>
              {faltantes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum</p>
              ) : (
                <ul className="space-y-1">
                  {faltantes.map((doc) => (
                    <li key={doc} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        onCheckedChange={(checked) => {
                          if (checked) marcarDocumentoRecebido(doc);
                        }}
                        aria-label={`Marcar ${doc} como recebido`}
                      />
                      {doc}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Marcar a caixa move o documento para “Recebidos”.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <DocsAdvogado casoId={caso.id} documentos={documentos} user={user} />

      <Card>
        <CardHeader>
          <CardTitle>Relatório da triagem (IA)</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap text-sm">{caso.relatorio ?? "Sem relatório"}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Consultas manuais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(["consulta_tse", "consulta_dap_caf", "consulta_jf"] as const).map((key) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={key}>
                {key === "consulta_tse"
                  ? "TSE"
                  : key === "consulta_dap_caf"
                    ? "DAP/CAF"
                    : "Justiça Federal"}
              </Label>
              <Textarea
                id={key}
                value={consultas[key]}
                onChange={(e) =>
                  setConsultas((c) => ({ ...c, [key]: e.target.value }))
                }
                rows={3}
              />
            </div>
          ))}
          <Button onClick={handleSaveConsultas}>Salvar consultas</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notas internas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Textarea
              placeholder="Adicionar anotação..."
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={3}
            />
            <Button onClick={handleAddNota}>Adicionar nota</Button>
          </div>
          {notas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma nota ainda</p>
          ) : (
            <ul className="space-y-3">
              {notas.map((n) => (
                <li key={n.id} className="rounded-lg border p-3 text-sm">
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(n.created_at)}
                  </p>
                  <p className="mt-1">{n.conteudo}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
