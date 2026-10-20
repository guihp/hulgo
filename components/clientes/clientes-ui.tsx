"use client";

import { toastProcessoDoCaso } from "@/components/processos/vincular-processo";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { differenceInDays } from "date-fns";
import { ArrowRightLeft, Eye, EyeOff, Pencil, Plus, Search, Users } from "lucide-react";
import { upsertProcesso, criarCasoNaFicha, updateCasoFields, updateCasoStatus } from "@/lib/actions/casos";
import type { AppUser } from "@/lib/actions/auth";
import {
  buscarClientesParaProcesso,
  type ClienteBusca,
} from "@/lib/actions/busca";
import {
  listParceiros,
  type Parceiro,
} from "@/lib/actions/parceiros";
import type { Tables } from "@/types/database";
import { BeneficioTipoSelect } from "@/components/casos/beneficio-tipo-select";
import { ColunaKanbanSelect } from "@/components/casos/coluna-kanban-select";
import { EditarCasoDialog } from "@/components/kanban/editar-caso";
import {
  listarKanbanColunasAction,
  type KanbanColunaMatch,
} from "@/lib/actions/kanban-colunas";
import { CpfDisplay } from "@/components/shared/cpf-display";
import { EmptyState } from "@/components/shared/empty-state";
import { LinkButton } from "@/components/ui/link-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FichaArquivos } from "@/components/clientes/ficha-arquivos";
import { GerarDocumentoMenu } from "@/components/documentos/gerar-documento-menu";
import { ExcluirProcessoDialog } from "@/components/processos/excluir-processo-dialog";
import { TransferirProcessoDialog } from "@/components/processos/transferir-processo-dialog";
import { fichaPessoaHref } from "@/lib/utils/ficha";
import type { MidiaChat } from "@/lib/data/arquivos";
import type { PessoaListaItem } from "@/lib/data/pessoas";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CASO_STATUS } from "@/lib/constants";
import {
  cpfCnpjDocumentLabel,
  formatCpfCnpj,
  maskCpf,
  maskCpfCnpjInput,
  normalizeCpf,
} from "@/lib/utils/cpf";
import {
  brazilianDateToIso,
  formatDate,
  isoToBrazilianDate,
  maskBrazilianDateInput,
  maskNomeInput,
} from "@/lib/utils/dates";
import {
  maskPhoneBrInput,
  normalizePhoneBrStorage,
  phoneToContactNorm,
} from "@/lib/utils/phone";
import {
  formatNumeroProcesso,
  isValidNumeroProcesso,
  maskNumeroProcessoInput,
  normalizeNumeroProcesso,
} from "@/lib/utils/processo";
import {
  FUNIL_BADGE_CLASS,
  FUNIS_PROCESSO,
  formatValorCentavos,
  funilExigeCnj,
  funilTemBeneficio,
  isFunilProcesso,
  isSituacaoProcesso,
  labelFunilProcesso,
  labelNumeroProcesso,
  normalizeAreaProcesso,
  parseValorReais,
  SITUACOES_PROCESSO,
  situacaoProcessoInfo,
  type FunilProcesso,
} from "@/lib/utils/processos";
import {
  listarProcessoColunasAction,
  type ProcessoColunaMatch,
} from "@/lib/actions/processo-colunas";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toastErroAcao } from "@/lib/client/erros";

const inputShell =
  "border-[#e2e8f0] bg-white text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12";

/** Shared list grid: fixed contato/vínculos/ação tracks so header and rows align. */
const clientesListGrid =
  "grid grid-cols-1 gap-3 px-4 sm:grid-cols-[minmax(0,1fr)_14rem_10rem_7.5rem] sm:items-center sm:gap-4 sm:px-5";

type ClienteFiltro = "todos" | "com_processo" | "so_atendimento" | "sem_cpf";

const FILTER_ALL = "__all__";

const filterSelectTriggerClass =
  "h-9 min-w-[9.5rem] rounded-full border-[#e2e8f0] bg-white px-3 text-sm font-medium text-[#64748B] shadow-none hover:border-[#0b2148]/30 hover:text-[#0b2148] data-placeholder:text-[#64748B]";

function initialsFromName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function diasNaEtapa(createdAt: string | null | undefined): number {
  if (!createdAt) return 0;
  return Math.max(0, differenceInDays(new Date(), new Date(createdAt)));
}

function ClienteKpiCard({
  label,
  value,
  sub,
  dotClass,
}: {
  label: string;
  value: number;
  sub: string;
  dotClass: string;
}) {
  return (
    <Card className="rounded-2xl border-[#e2e8f0] bg-white shadow-none">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-[#64748B]">{label}</p>
          <span className={cn("mt-1 size-2 shrink-0 rounded-full", dotClass)} />
        </div>
        <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-[#0b2148]">
          {value}
        </p>
        <p className="mt-1 text-xs text-[#94a3b8]">{sub}</p>
      </CardContent>
    </Card>
  );
}

type Processo = Tables<"processos_clientes">;

const PARCEIRO_NENHUM = "__none__";

const SITUACAO_NENHUMA = "__none__";

type ProcessoFormState = {
  nome: string;
  cpf: string;
  numero_processo: string;
  /** Cadastro antecipado: número ainda não existe (preenchido depois). */
  sem_numero: boolean;
  telefone: string;
  tribunal: string;
  area: FunilProcesso;
  data_nascimento: string;
  beneficio_identificado: string;
  descricao_caso: string;
  parceiro_id: string;
  funil_coluna: string;
  polo_ativo: string;
  polo_passivo: string;
  tipo_acao: string;
  vara_comarca: string;
  /** Texto em reais (ex.: "1.234,56") */
  valor: string;
  processo_origem: string;
  situacao: string;
  /** dd/mm/aaaa */
  ultimo_andamento_data: string;
  ultimo_movimento: string;
  observacao: string;
  id?: number;
  ativo?: boolean;
};

const EMPTY_FORM: ProcessoFormState = {
  nome: "",
  cpf: "",
  numero_processo: "",
  sem_numero: false,
  telefone: "",
  tribunal: "",
  area: "previdenciario",
  data_nascimento: "",
  beneficio_identificado: "",
  descricao_caso: "",
  parceiro_id: "",
  funil_coluna: "",
  polo_ativo: "",
  polo_passivo: "",
  tipo_acao: "",
  vara_comarca: "",
  valor: "",
  processo_origem: "",
  situacao: "",
  ultimo_andamento_data: "",
  ultimo_movimento: "",
  observacao: "",
};

function valorCentavosToInput(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined) return "";
  return (centavos / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** "NOME (CPF 000.000.000-00)" — texto padrão do polo ativo. */
function poloAtivoPadrao(nome: string, cpf: string): string {
  const n = maskNomeInput(nome).trim();
  if (!n) return "";
  const digits = normalizeCpf(cpf);
  if (digits.length !== 11 && digits.length !== 14) return n.toUpperCase();
  return `${n.toUpperCase()} (${cpfCnpjDocumentLabel(digits)} ${formatCpfCnpj(digits)})`;
}

/** CNJ nos funis judiciais; nº do requerimento/NB livre (só dígitos e . - /). */
function maskNumeroForFunil(value: string, funil: FunilProcesso): string {
  if (funilExigeCnj(funil)) return maskNumeroProcessoInput(value);
  return value.replace(/[^\d.\-/]/g, "").slice(0, 30);
}

function processoToForm(processo: Processo): ProcessoFormState {
  const origem = processo.processo_origem ?? "";
  const area = normalizeAreaProcesso(processo.area);
  return {
    id: processo.id,
    nome: processo.nome ?? "",
    cpf: maskCpfCnpjInput(processo.cpf),
    numero_processo: maskNumeroForFunil(processo.numero_processo ?? "", area),
    sem_numero: !processo.numero_processo && funilExigeCnj(area),
    telefone: maskPhoneBrInput(processo.telefone ?? ""),
    tribunal: processo.tribunal ?? "",
    area,
    data_nascimento: isoToBrazilianDate(processo.data_nascimento),
    beneficio_identificado: processo.beneficio_identificado ?? "",
    descricao_caso: processo.descricao_caso ?? "",
    parceiro_id: processo.parceiro_id ?? "",
    funil_coluna: processo.funil_coluna ?? "",
    polo_ativo:
      processo.polo_ativo ?? poloAtivoPadrao(processo.nome ?? "", processo.cpf),
    polo_passivo: processo.polo_passivo ?? "",
    tipo_acao: processo.tipo_acao ?? "",
    vara_comarca: processo.vara_comarca ?? "",
    valor: valorCentavosToInput(processo.valor_centavos),
    processo_origem: isValidNumeroProcesso(normalizeNumeroProcesso(origem))
      ? formatNumeroProcesso(origem)
      : origem,
    situacao: processo.situacao ?? "",
    ultimo_andamento_data: isoToBrazilianDate(processo.ultimo_andamento_data),
    ultimo_movimento: processo.ultimo_movimento ?? "",
    observacao: processo.observacao ?? "",
    ativo: processo.ativo ?? true,
  };
}

function FormSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748B] sm:col-span-2">
      {children}
    </p>
  );
}

function ProcessoFormFields({
  form,
  setForm,
  idPrefix = "",
  parceiros,
  parceirosLoading,
  colunas,
  colunasLoading,
}: {
  form: ProcessoFormState;
  setForm: React.Dispatch<React.SetStateAction<ProcessoFormState>>;
  idPrefix?: string;
  parceiros: Parceiro[];
  parceirosLoading: boolean;
  colunas: ProcessoColunaMatch[];
  colunasLoading: boolean;
}) {
  const cpfLabel = cpfCnpjDocumentLabel(form.cpf);
  const fieldId = (name: string) => (idPrefix ? `${idPrefix}-${name}` : name);
  const poloPadrao = poloAtivoPadrao(form.nome, form.cpf);
  const exigeCnj = funilExigeCnj(form.area);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormSectionTitle>Cliente</FormSectionTitle>
      <div className="space-y-1">
        <Label htmlFor={fieldId("nome")}>Nome</Label>
        <Input
          id={fieldId("nome")}
          value={form.nome}
          onChange={(e) =>
            setForm((f) => ({ ...f, nome: maskNomeInput(e.target.value) }))
          }
          autoComplete="name"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("cpf")}>{cpfLabel}</Label>
        <Input
          id={fieldId("cpf")}
          value={form.cpf}
          onChange={(e) =>
            setForm((f) => ({ ...f, cpf: maskCpfCnpjInput(e.target.value) }))
          }
          inputMode="numeric"
          autoComplete="off"
          placeholder={cpfLabel === "CNPJ" ? "00.000.000/0000-00" : "000.000.000-00"}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("telefone")}>Telefone</Label>
        <Input
          id={fieldId("telefone")}
          value={form.telefone}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              telefone: maskPhoneBrInput(e.target.value),
            }))
          }
          inputMode="tel"
          autoComplete="tel"
          placeholder="(00) 9 0000-0000"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("data_nascimento")}>Data nascimento</Label>
        <Input
          id={fieldId("data_nascimento")}
          value={form.data_nascimento}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              data_nascimento: maskBrazilianDateInput(e.target.value),
            }))
          }
          inputMode="numeric"
          placeholder="DD/MM/AAAA"
        />
      </div>

      <FormSectionTitle>Processo</FormSectionTitle>
      <div className="space-y-1">
        <Label htmlFor={fieldId("numero_processo")}>
          {labelNumeroProcesso(form.area)}
        </Label>
        <Input
          id={fieldId("numero_processo")}
          value={form.numero_processo}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              numero_processo: maskNumeroForFunil(e.target.value, f.area),
            }))
          }
          inputMode="numeric"
          placeholder={
            form.sem_numero
              ? "Sem número por enquanto"
              : exigeCnj
                ? "0000000-00.0000.0.00.0000"
                : "Protocolo INSS ou NB (opcional)"
          }
          disabled={form.sem_numero}
          className="font-mono"
        />
        {exigeCnj ? (
          <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
            <Checkbox
              checked={form.sem_numero}
              onCheckedChange={(v) =>
                setForm((f) => ({
                  ...f,
                  sem_numero: v === true,
                  numero_processo: v === true ? "" : f.numero_processo,
                }))
              }
            />
            Ainda sem número (adicionar depois)
          </label>
        ) : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("tribunal")}>Tribunal</Label>
        <Input
          id={fieldId("tribunal")}
          value={form.tribunal}
          onChange={(e) => setForm((f) => ({ ...f, tribunal: e.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("area")}>Área</Label>
        <Select
          value={form.area}
          onValueChange={(v) => {
            if (!isFunilProcesso(v)) return;
            setForm((f) =>
              f.area === v
                ? f
                : {
                    ...f,
                    area: v,
                    funil_coluna: "",
                    numero_processo: maskNumeroForFunil(f.numero_processo, v),
                  }
            );
          }}
        >
          <SelectTrigger id={fieldId("area")} className="w-full">
            <SelectValue>{(v) => labelFunilProcesso(v as string)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FUNIS_PROCESSO.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("funil_coluna")}>Coluna do funil</Label>
        <Select
          value={form.funil_coluna || null}
          onValueChange={(v) =>
            setForm((f) => ({ ...f, funil_coluna: (v as string | null) ?? "" }))
          }
          disabled={colunasLoading || colunas.length === 0}
        >
          <SelectTrigger id={fieldId("funil_coluna")} className="w-full">
            <SelectValue placeholder={colunasLoading ? "Carregando…" : "Primeira coluna"}>
              {(v) => {
                if (!v) return colunasLoading ? "Carregando…" : "Primeira coluna";
                return colunas.find((c) => c.chave === v)?.label ?? String(v);
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {colunas.map((c) => (
              <SelectItem key={c.id} value={c.chave}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("tipo_acao")}>Tipo de ação</Label>
        <Input
          id={fieldId("tipo_acao")}
          value={form.tipo_acao}
          onChange={(e) => setForm((f) => ({ ...f, tipo_acao: e.target.value }))}
          placeholder="Ex.: Cumprimento de sentença (FGTS)"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("vara_comarca")}>Vara / Comarca</Label>
        <Input
          id={fieldId("vara_comarca")}
          value={form.vara_comarca}
          onChange={(e) =>
            setForm((f) => ({ ...f, vara_comarca: e.target.value }))
          }
          placeholder="Ex.: Vara Única de Mirinzal"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("polo_ativo")}>Polo ativo</Label>
        <Input
          id={fieldId("polo_ativo")}
          value={form.polo_ativo}
          onChange={(e) => setForm((f) => ({ ...f, polo_ativo: e.target.value }))}
          placeholder={poloPadrao || "Autor"}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("polo_passivo")}>Polo passivo</Label>
        <Input
          id={fieldId("polo_passivo")}
          value={form.polo_passivo}
          onChange={(e) =>
            setForm((f) => ({ ...f, polo_passivo: e.target.value }))
          }
          placeholder={form.area === "civel" ? "Ex.: Estado do Maranhão" : "Ex.: INSS"}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("valor")}>Valor</Label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
            R$
          </span>
          <Input
            id={fieldId("valor")}
            value={form.valor}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                valor: e.target.value.replace(/[^\d.,]/g, ""),
              }))
            }
            onBlur={() =>
              setForm((f) => {
                const c = parseValorReais(f.valor);
                return { ...f, valor: c === null ? "" : valorCentavosToInput(c) };
              })
            }
            inputMode="decimal"
            placeholder="0,00"
            className="pl-9 tabular-nums"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("processo_origem")}>Processo de origem</Label>
        <Input
          id={fieldId("processo_origem")}
          value={form.processo_origem}
          onChange={(e) =>
            setForm((f) => ({ ...f, processo_origem: e.target.value }))
          }
          placeholder="Nº CNJ de origem"
          className="font-mono"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("situacao")}>Situação</Label>
        <Select
          value={form.situacao || SITUACAO_NENHUMA}
          onValueChange={(v) =>
            setForm((f) => ({
              ...f,
              situacao: !v || v === SITUACAO_NENHUMA ? "" : String(v),
            }))
          }
        >
          <SelectTrigger id={fieldId("situacao")} className="w-full">
            <SelectValue>
              {(v) => situacaoProcessoInfo(v as string)?.label ?? "Nenhuma"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SITUACAO_NENHUMA}>Nenhuma</SelectItem>
            {SITUACOES_PROCESSO.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                <span
                  className={cn(
                    "inline-block size-2 shrink-0 self-center rounded-full",
                    s.dotClassName
                  )}
                />
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {funilTemBeneficio(form.area) ? (
        <div className="space-y-1">
          <Label htmlFor={fieldId("beneficio")}>Benefício</Label>
          <BeneficioTipoSelect
            id={fieldId("beneficio")}
            value={form.beneficio_identificado || null}
            onChange={(label) =>
              setForm((f) => ({ ...f, beneficio_identificado: label ?? "" }))
            }
          />
        </div>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor={fieldId("parceiro")}>Parceiro</Label>
        {parceirosLoading ? (
          <p className="text-sm text-muted-foreground">Carregando parceiros…</p>
        ) : parceiros.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Nenhum parceiro cadastrado. Cadastre em{" "}
            <Link
              href="/configuracoes?tab=parceiros"
              className="font-medium text-foreground underline underline-offset-2"
            >
              Configurações → Parceiros
            </Link>
            .
          </p>
        ) : (
          <Select
            value={form.parceiro_id || PARCEIRO_NENHUM}
            onValueChange={(v) =>
              setForm((f) => ({
                ...f,
                parceiro_id: !v || v === PARCEIRO_NENHUM ? "" : v,
              }))
            }
          >
            <SelectTrigger id={fieldId("parceiro")} className="w-full">
              <SelectValue placeholder="Sem parceiro">
                {(v) => {
                  if (!v || v === PARCEIRO_NENHUM) return "Sem parceiro";
                  const p = parceiros.find((x) => x.id === v);
                  if (!p) return "Parceiro";
                  return p.cidade ? `${p.nome} · ${p.cidade}` : p.nome;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PARCEIRO_NENHUM}>Sem parceiro</SelectItem>
              {parceiros.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nome}
                  {p.cidade ? ` · ${p.cidade}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <FormSectionTitle>Andamento</FormSectionTitle>
      <div className="space-y-1">
        <Label htmlFor={fieldId("ultimo_andamento_data")}>
          Data do último andamento
        </Label>
        <Input
          id={fieldId("ultimo_andamento_data")}
          value={form.ultimo_andamento_data}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              ultimo_andamento_data: maskBrazilianDateInput(e.target.value),
            }))
          }
          inputMode="numeric"
          placeholder="DD/MM/AAAA"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("ultimo_movimento")}>Último andamento</Label>
        <Input
          id={fieldId("ultimo_movimento")}
          value={form.ultimo_movimento}
          onChange={(e) =>
            setForm((f) => ({ ...f, ultimo_movimento: e.target.value }))
          }
          placeholder="Ex.: Expedido precatório"
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={fieldId("observacao")}>Observação</Label>
        <Textarea
          id={fieldId("observacao")}
          value={form.observacao}
          onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))}
          rows={2}
          className="min-h-[60px] resize-y"
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={fieldId("descricao_caso")}>Descrição</Label>
        <Input
          id={fieldId("descricao_caso")}
          value={form.descricao_caso}
          onChange={(e) =>
            setForm((f) => ({ ...f, descricao_caso: e.target.value }))
          }
        />
      </div>
    </div>
  );
}

export type ProcessoFormPrefill = Partial<ProcessoFormState>;

export function ProcessoDialog({
  processo,
  prefill,
  open,
  onOpenChange,
  title,
  trigger,
  clientePicker = false,
  onSaved,
}: {
  processo?: Processo | null;
  prefill?: ProcessoFormPrefill;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  trigger?: React.ReactNode;
  /** Busca de cliente existente acima do formulário (página /processos). */
  clientePicker?: boolean;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ProcessoFormState>(EMPTY_FORM);
  const [parceiros, setParceiros] = useState<Parceiro[]>([]);
  const [parceirosLoading, setParceirosLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [colunasState, setColunasState] = useState<{
    area: FunilProcesso | null;
    list: ProcessoColunaMatch[];
  }>({ area: null, list: [] });
  const cpfLabel = cpfCnpjDocumentLabel(form.cpf);

  useEffect(() => {
    if (open) {
      if (processo) {
        setForm(processoToForm(processo));
      } else {
        const base = { ...EMPTY_FORM, ...prefill };
        setForm({
          ...base,
          polo_ativo: base.polo_ativo || poloAtivoPadrao(base.nome, base.cpf),
        });
      }
    }
  }, [open, processo, prefill]);

  const area = form.area;
  const colunas = colunasState.area === area ? colunasState.list : [];
  const colunasLoading = open && colunasState.area !== area;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listarProcessoColunasAction(area)
      .then((list) => {
        if (cancelled) return;
        const doFunil = list.filter((c) => c.funil === area && c.ativo);
        setColunasState({ area, list: doFunil });
        setForm((f) =>
          f.area !== area || doFunil.some((c) => c.chave === f.funil_coluna)
            ? f
            : { ...f, funil_coluna: doFunil[0]?.chave ?? "" }
        );
      })
      .catch(() => {
        if (!cancelled) setColunasState({ area, list: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [open, area]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setParceirosLoading(true);
    listParceiros()
      .then((list) => {
        if (!cancelled) setParceiros(list);
      })
      .catch(() => {
        if (!cancelled) setParceiros([]);
      })
      .finally(() => {
        if (!cancelled) setParceirosLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleSave() {
    const nome = maskNomeInput(form.nome).trim();
    const cpf = normalizeCpf(form.cpf);
    const numero = normalizeNumeroProcesso(form.numero_processo);
    const telefone = form.telefone ? normalizePhoneBrStorage(form.telefone) : "";
    const dataIso = form.data_nascimento
      ? brazilianDateToIso(form.data_nascimento)
      : null;

    if (!nome) {
      toast.error("Informe o nome");
      return;
    }
    if (cpf.length !== 11 && cpf.length !== 14) {
      toast.error(`${cpfLabel} inválido`);
      return;
    }
    const semNumero = form.sem_numero || (!funilExigeCnj(form.area) && !numero);
    if (funilExigeCnj(form.area) && !semNumero && !isValidNumeroProcesso(numero)) {
      toast.error(
        numero
          ? "Número de processo CNJ inválido (20 dígitos)"
          : "Informe o número do processo ou marque “Ainda sem número”"
      );
      return;
    }
    if (form.data_nascimento && !dataIso) {
      toast.error("Data de nascimento inválida");
      return;
    }
    const andamentoIso = form.ultimo_andamento_data
      ? brazilianDateToIso(form.ultimo_andamento_data)
      : null;
    if (form.ultimo_andamento_data && !andamentoIso) {
      toast.error("Data do último andamento inválida");
      return;
    }
    const valorCentavos = form.valor.trim() ? parseValorReais(form.valor) : null;
    if (form.valor.trim() && valorCentavos === null) {
      toast.error("Valor inválido");
      return;
    }
    const situacao = isSituacaoProcesso(form.situacao) ? form.situacao : null;

    setSaving(true);
    try {
      await upsertProcesso({
        id: form.id,
        nome,
        cpf,
        numero_processo: semNumero ? null : numero,
        telefone: telefone || null,
        tribunal: form.tribunal || null,
        area: form.area,
        data_nascimento: dataIso,
        beneficio_identificado: funilTemBeneficio(form.area)
          ? form.beneficio_identificado.trim() || null
          : null,
        descricao_caso: form.descricao_caso || null,
        parceiro_id: form.parceiro_id || null,
        ativo: form.ativo ?? true,
        funil_coluna: form.funil_coluna || null,
        polo_ativo: form.polo_ativo.trim() || poloAtivoPadrao(nome, cpf) || null,
        polo_passivo: form.polo_passivo.trim() || null,
        tipo_acao: form.tipo_acao.trim() || null,
        vara_comarca: form.vara_comarca.trim() || null,
        valor_centavos: valorCentavos,
        processo_origem: form.processo_origem.trim() || null,
        situacao,
        ultimo_andamento_data: andamentoIso,
        ultimo_movimento: form.ultimo_movimento.trim() || null,
        observacao: form.observacao.trim() || null,
      });
      toast.success(form.id ? "Processo atualizado" : "Processo salvo");
      onOpenChange(false);
      onSaved?.();
      router.refresh();
    } catch (err) {
      toastErroAcao(err, "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {clientePicker && !form.id ? (
          <ClientePicker
            onPick={(c) =>
              setForm((f) => ({
                ...f,
                nome: maskNomeInput(c.nome),
                cpf: maskCpfCnpjInput(c.cpf ?? ""),
                telefone: maskPhoneBrInput(c.telefone ?? ""),
                data_nascimento: isoToBrazilianDate(c.data_nascimento),
                polo_ativo: poloAtivoPadrao(c.nome, c.cpf ?? ""),
              }))
            }
          />
        ) : null}
        <ProcessoFormFields
          form={form}
          setForm={setForm}
          idPrefix={form.id ? `edit-${form.id}` : "new"}
          parceiros={parceiros}
          parceirosLoading={parceirosLoading}
          colunas={colunas}
          colunasLoading={colunasLoading}
        />
        <DialogFooter>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientePicker({ onPick }: { onPick: (c: ClienteBusca) => void }) {
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ClienteBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [escolhido, setEscolhido] = useState<string | null>(null);

  useEffect(() => {
    const q = termo.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setBuscando(true);
      buscarClientesParaProcesso(q)
        .then((list) => {
          if (!cancelled) setResultados(list);
        })
        .catch(() => {
          if (!cancelled) setResultados([]);
        })
        .finally(() => {
          if (!cancelled) setBuscando(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [termo]);

  const lista = termo.trim().length >= 2 ? resultados : [];

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <Label htmlFor="novo-processo-busca-cliente">Cliente existente</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="novo-processo-busca-cliente"
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setEscolhido(null);
          }}
          placeholder="Buscar por nome, CPF ou telefone…"
          className="pl-9"
          autoComplete="off"
        />
      </div>
      {escolhido ? (
        <p className="text-xs text-muted-foreground">
          Dados de <span className="font-medium text-foreground">{escolhido}</span>{" "}
          preenchidos abaixo.
        </p>
      ) : lista.length ? (
        <ul className="max-h-48 divide-y overflow-y-auto rounded-md border bg-background">
          {lista.map((c) => (
            <li key={`${c.cpf ?? ""}-${c.telefone ?? ""}-${c.nome}`}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onPick(c);
                  setEscolhido(c.nome);
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.nome}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[
                      c.cpf ? formatCpfCnpj(c.cpf) : "Sem CPF",
                      c.telefone ? maskPhoneBrInput(c.telefone) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <Badge variant="outline" className="shrink-0 text-[11px]">
                  {c.origem === "processo" ? "Tem processo" : "Atendimento"}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {buscando
            ? "Buscando…"
            : termo.trim().length >= 2
              ? "Nenhum cliente encontrado — preencha os dados do novo cliente abaixo."
              : "Busque um cliente cadastrado ou preencha os dados de um novo cliente abaixo."}
        </p>
      )}
    </div>
  );
}

export function ClientesList({
  processos,
  casosAbertura = [],
  pessoas,
  parceiros = [],
  abrirCaso = null,
}: {
  processos: Processo[];
  casosAbertura?: Tables<"casos_novos">[];
  pessoas: PessoaListaItem[];
  parceiros?: Parceiro[];
  abrirCaso?: Tables<"casos_novos"> | null;
  user?: AppUser;
}) {
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<ClienteFiltro>("todos");
  const [filtroCidade, setFiltroCidade] = useState(FILTER_ALL);
  const [filtroBeneficio, setFiltroBeneficio] = useState(FILTER_ALL);
  const [filtroParceiro, setFiltroParceiro] = useState(FILTER_ALL);
  const [revealCpfs, setRevealCpfs] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [abrindoCaso, setAbrindoCaso] = useState<Tables<"casos_novos"> | null>(
    abrirCaso
  );

  const parceirosById = useMemo(
    () => new Map(parceiros.map((p) => [p.id, p])),
    [parceiros]
  );

  // Clientes do Kanban em etapas de abertura que ainda não têm processo
  // cadastrado — dedupe por telefone/CPF e exclui quem já está na tabela
  const emAbertura = useMemo(() => {
    const cpfsComProcesso = new Set(processos.map((p) => normalizeCpf(p.cpf)));
    const telefonesComProcesso = new Set(
      processos.map((p) => p.telefone?.replace(/\D/g, "") ?? "").filter(Boolean)
    );
    const vistos = new Set<string>();
    return casosAbertura.filter((c) => {
      const cpf = c.cpf ? normalizeCpf(c.cpf) : "";
      const tel = c.telefone?.replace(/\D/g, "") ?? "";
      if (cpf && cpfsComProcesso.has(cpf)) return false;
      if (tel && telefonesComProcesso.has(tel)) return false;
      const key = tel || cpf || `caso:${c.id}`;
      if (vistos.has(key)) return false;
      vistos.add(key);
      return true;
    });
  }, [casosAbertura, processos]);

  const kpis = useMemo(() => {
    const total = pessoas.length;
    const comProcesso = pessoas.filter((p) => p.nProcessos > 0).length;
    const soAtendimento = pessoas.filter(
      (p) => p.nProcessos === 0 && p.nCasos > 0
    ).length;
    const semCpf = pessoas.filter((p) => !p.cpf).length;
    return { total, comProcesso, soAtendimento, semCpf };
  }, [pessoas]);

  const cidadeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of pessoas) {
      for (const c of p.cidades) {
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
      .map(([value, count]) => ({ value, count }));
  }, [pessoas]);

  const beneficioOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of pessoas) {
      for (const b of p.beneficios) {
        counts.set(b, (counts.get(b) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
      .map(([value, count]) => ({ value, count }));
  }, [pessoas]);

  const parceiroOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of pessoas) {
      for (const id of p.parceiroIds) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([id, count]) => {
        const ref = parceirosById.get(id);
        const label = ref
          ? ref.cidade
            ? `${ref.nome} · ${ref.cidade}`
            : ref.nome
          : "Parceiro removido";
        return { value: id, label, count };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [pessoas, parceirosById]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const qDigits = q.replace(/\D/g, "");
    return pessoas.filter((p) => {
      if (filtro === "com_processo" && p.nProcessos === 0) return false;
      if (filtro === "so_atendimento" && !(p.nProcessos === 0 && p.nCasos > 0))
        return false;
      if (filtro === "sem_cpf" && p.cpf) return false;
      if (filtroCidade !== FILTER_ALL && !p.cidades.includes(filtroCidade)) {
        return false;
      }
      if (
        filtroBeneficio !== FILTER_ALL &&
        !p.beneficios.includes(filtroBeneficio)
      ) {
        return false;
      }
      if (
        filtroParceiro !== FILTER_ALL &&
        !p.parceiroIds.includes(filtroParceiro)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        p.nome.toLowerCase().includes(q) ||
        (p.cpf != null && qDigits.length > 0 && p.cpf.includes(qDigits)) ||
        (p.telefone != null &&
          qDigits.length > 0 &&
          p.telefone.replace(/\D/g, "").includes(qDigits)) ||
        (p.beneficio?.toLowerCase().includes(q) ?? false) ||
        p.beneficios.some((b) => b.toLowerCase().includes(q))
      );
    });
  }, [
    pessoas,
    search,
    filtro,
    filtroCidade,
    filtroBeneficio,
    filtroParceiro,
  ]);

  const pills: { key: ClienteFiltro; label: string; count: number }[] = [
    { key: "todos", label: "Todos", count: kpis.total },
    { key: "com_processo", label: "Com processo", count: kpis.comProcesso },
    { key: "so_atendimento", label: "Só atendimento", count: kpis.soAtendimento },
    { key: "sem_cpf", label: "Sem CPF", count: kpis.semCpf },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0b2148]">
            Clientes
          </h1>
          <p className="mt-1 text-sm text-[#64748B]">
            Pessoas com processo judicial ou atendimento no WhatsApp
          </p>
        </div>
        <ProcessoDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          title="Cadastrar processo"
          trigger={
            <DialogTrigger
              className={cn(
                buttonVariants(),
                "rounded-full bg-[#0b2148] text-white shadow-[0_8px_24px_rgba(11,33,72,0.22)] hover:bg-[#163a7a]"
              )}
            >
              <Plus className="size-4" />
              Novo processo
            </DialogTrigger>
          }
        />
      </div>

      <ProcessoDialog
        open={abrindoCaso !== null}
        onOpenChange={(next) => {
          if (!next) setAbrindoCaso(null);
        }}
        title="Criar processo para o cliente"
        prefill={
          abrindoCaso
            ? {
                nome: abrindoCaso.nome ?? "",
                cpf: maskCpfCnpjInput(abrindoCaso.cpf ?? ""),
                telefone: maskPhoneBrInput(abrindoCaso.telefone ?? ""),
                area: normalizeAreaProcesso(abrindoCaso.area),
                data_nascimento: isoToBrazilianDate(
                  abrindoCaso.data_nascimento
                ),
                beneficio_identificado:
                  abrindoCaso.beneficio_identificado ?? "",
              }
            : undefined
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ClienteKpiCard
          label="Clientes na base"
          value={kpis.total}
          sub="cadastrados no escritório"
          dotClass="bg-[#0b2148]"
        />
        <ClienteKpiCard
          label="Com processo"
          value={kpis.comProcesso}
          sub="ficha judicial ativa"
          dotClass="bg-[#163a7a]"
        />
        <ClienteKpiCard
          label="Só atendimento"
          value={kpis.soAtendimento}
          sub="WhatsApp sem processo"
          dotClass="bg-amber-500"
        />
        <ClienteKpiCard
          label="Sem CPF"
          value={kpis.semCpf}
          sub="cadastro incompleto"
          dotClass="bg-rose-500"
        />
      </div>

      {emAbertura.length > 0 && (
        <section className="rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-none sm:p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="size-2 shrink-0 rounded-full bg-amber-500" />
              <h2 className="text-sm font-semibold text-[#0b2148]">
                Aguardando abertura de processo
              </h2>
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-[#F1F5F9] text-xs font-semibold text-[#64748B]">
                {emAbertura.length}
              </span>
            </div>
            <p className="text-xs text-[#94a3b8] sm:text-right">
              Na etapa &quot;Abertura de processo&quot; do funil, ainda sem
              processo cadastrado
            </p>
          </div>
          <div className="space-y-2">
            {emAbertura.map((c) => {
              const dias = diasNaEtapa(c.updated_at ?? c.created_at);
              const meta = [
                c.beneficio_identificado || "Benefício não identificado",
                c.telefone ? maskPhoneBrInput(c.telefone) : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div
                  key={c.id}
                  className="flex flex-col gap-3 rounded-xl border border-[#e2e8f0] bg-[#F8FAFC] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-sm font-semibold text-amber-900">
                      {initialsFromName(c.nome)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[#0b2148]">
                        {c.nome ?? "Sem nome"}
                      </p>
                      <p className="truncate text-sm text-[#64748B]">{meta}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                      há {dias} dia{dias === 1 ? "" : "s"} na etapa
                    </span>
                    <LinkButton
                      href={fichaPessoaHref({
                        cpf: c.cpf,
                        contactNorm: c.telefone,
                        aba: "caso",
                        casoId: c.id,
                      })}
                      size="sm"
                      variant="outline"
                      className="border-[#e2e8f0] text-[#0b2148] hover:bg-white"
                    >
                      Ver caso
                    </LinkButton>
                    <Button
                      size="sm"
                      className="bg-[#0b2148] text-white hover:bg-[#163a7a]"
                      onClick={() => setAbrindoCaso(c)}
                    >
                      Criar processo
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-[#c5d4e8]/80 bg-white p-3 sm:p-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#94a3b8]" />
            <Input
              placeholder="Buscar por nome, CPF ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(inputShell, "h-11 rounded-full pl-9")}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {pills.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setFiltro(p.key)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                  filtro === p.key
                    ? "border-[#0b2148] bg-[#0b2148] text-white shadow-sm"
                    : "border-[#e2e8f0] bg-[#F8FAFC] text-[#64748B] hover:border-[#0b2148]/30 hover:text-[#0b2148]"
                )}
              >
                {p.label} ({p.count})
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 lg:ml-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full border-[#e2e8f0] bg-[#F8FAFC] text-[#0b2148] hover:bg-[#0b2148]/5"
              onClick={() => setRevealCpfs((v) => !v)}
            >
              {revealCpfs ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
              {revealCpfs ? "Ocultar CPFs" : "Revelar CPFs"}
            </Button>
            <span className="text-sm tabular-nums text-[#64748B]">
              <span className="font-semibold text-[#0b2148]">
                {filtered.length}
              </span>
              /{kpis.total}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[#e2e8f0] pt-3">
          <Select
            value={filtroCidade}
            onValueChange={(v) => setFiltroCidade(v ?? FILTER_ALL)}
          >
            <SelectTrigger
              className={cn(
                filterSelectTriggerClass,
                filtroCidade !== FILTER_ALL &&
                  "border-[#0b2148] bg-[#0b2148] text-white hover:border-[#0b2148] hover:text-white"
              )}
            >
              <SelectValue placeholder="Cidade">
                {(v) => {
                  if (!v || v === FILTER_ALL) return "Cidade";
                  const opt = cidadeOptions.find((o) => o.value === v);
                  return opt ? `${opt.value} (${opt.count})` : v;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FILTER_ALL}>Todas as cidades</SelectItem>
              {cidadeOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.value} ({o.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filtroBeneficio}
            onValueChange={(v) => setFiltroBeneficio(v ?? FILTER_ALL)}
          >
            <SelectTrigger
              className={cn(
                filterSelectTriggerClass,
                filtroBeneficio !== FILTER_ALL &&
                  "border-[#0b2148] bg-[#0b2148] text-white hover:border-[#0b2148] hover:text-white"
              )}
            >
              <SelectValue placeholder="Benefício">
                {(v) => {
                  if (!v || v === FILTER_ALL) return "Benefício";
                  const opt = beneficioOptions.find((o) => o.value === v);
                  return opt ? `${opt.value} (${opt.count})` : v;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FILTER_ALL}>Todos os benefícios</SelectItem>
              {beneficioOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.value} ({o.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filtroParceiro}
            onValueChange={(v) => setFiltroParceiro(v ?? FILTER_ALL)}
          >
            <SelectTrigger
              className={cn(
                filterSelectTriggerClass,
                "min-w-[11rem]",
                filtroParceiro !== FILTER_ALL &&
                  "border-[#0b2148] bg-[#0b2148] text-white hover:border-[#0b2148] hover:text-white"
              )}
            >
              <SelectValue placeholder="Parceiros">
                {(v) => {
                  if (!v || v === FILTER_ALL) return "Parceiros";
                  const opt = parceiroOptions.find((o) => o.value === v);
                  return opt ? `${opt.label} (${opt.count})` : "Parceiro";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FILTER_ALL}>Todos os parceiros</SelectItem>
              {parceiroOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label} ({o.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(filtroCidade !== FILTER_ALL ||
            filtroBeneficio !== FILTER_ALL ||
            filtroParceiro !== FILTER_ALL) && (
            <button
              type="button"
              onClick={() => {
                setFiltroCidade(FILTER_ALL);
                setFiltroBeneficio(FILTER_ALL);
                setFiltroParceiro(FILTER_ALL);
              }}
              className="rounded-full border border-transparent px-3 py-1.5 text-sm font-medium text-[#64748B] hover:text-[#0b2148]"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {pessoas.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhuma pessoa encontrada"
          description="Pessoas com processo judicial ou atendimento no WhatsApp aparecem aqui."
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#e2e8f0] bg-white p-8 text-center text-sm text-[#64748B]">
          Nenhum cliente corresponde aos filtros atuais.
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white">
          <div className={cn(clientesListGrid, "border-b border-[#e2e8f0] py-3")}>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-[#94a3b8] uppercase">
                Cliente
              </p>
            </div>
            <div className="min-w-0 text-left">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-[#94a3b8] uppercase">
                Contato
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-[#94a3b8] uppercase">
                Vínculos
              </p>
            </div>
            <div className="min-w-0 text-right sm:justify-self-end">
              <p className="text-[10px] leading-tight text-[#94a3b8]">
                ordem alfabética
              </p>
            </div>
          </div>
          <ul className="divide-y divide-[#e2e8f0]">
            {filtered.map((p) => (
              <li key={p.key} className={cn(clientesListGrid, "py-4")}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#0b2148]/10 text-sm font-semibold text-[#0b2148]">
                    {initialsFromName(p.nome)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#0b2148]">
                      {p.nome}
                    </p>
                    <p className="truncate text-sm text-[#64748B]">
                      {p.beneficio || "Benefício não identificado"}
                    </p>
                  </div>
                </div>

                <div className="min-w-0 text-left">
                  {p.cpf ? (
                    <p className="font-mono text-sm text-[#0F172A]">
                      {revealCpfs ? formatCpfCnpj(p.cpf) : maskCpf(p.cpf)}
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-amber-700/80">
                      Sem CPF cadastrado
                    </p>
                  )}
                  <p className="text-sm text-[#64748B]">
                    {p.telefone
                      ? maskPhoneBrInput(p.telefone)
                      : "sem WhatsApp"}
                  </p>
                </div>

                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {p.nProcessos > 0 ? (
                    <span className="rounded-full border border-[#0b2148]/20 bg-[#0b2148]/8 px-2.5 py-0.5 text-xs font-medium text-[#0b2148]">
                      {p.nProcessos} processo{p.nProcessos === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {p.nCasos > 0 ? (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                      {p.nCasos} caso{p.nCasos === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>

                <div className="sm:justify-self-end">
                  <LinkButton
                    href={p.href}
                    size="sm"
                    variant="outline"
                    className="border-[#e2e8f0] text-[#0b2148] hover:bg-[#F8FAFC]"
                  >
                    Ver ficha
                  </LinkButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function FichaHeader({
  cpf,
  contactNorm: contactNormProp,
  processos,
  casos,
}: {
  cpf: string | null;
  contactNorm?: string;
  processos: Processo[];
  casos: Tables<"casos_novos">[];
}) {
  const [editingProcesso, setEditingProcesso] = useState<Processo | null>(null);
  const nome = processos[0]?.nome ?? casos[0]?.nome ?? "Cliente";
  const contactNorm =
    contactNormProp ||
    phoneToContactNorm(processos[0]?.telefone ?? casos[0]?.telefone);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{nome}</h1>
          <p className="text-muted-foreground">
            {cpf ? (
              <>
                CPF: <CpfDisplay value={cpf} />
              </>
            ) : (
              "Sem CPF cadastrado"
            )}
            {contactNorm ? (
              <>
                {" · "}
                {maskPhoneBrInput(contactNorm)}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {cpf || casos[0] ? (
            <GerarDocumentoMenu
              query={cpf ? `cpf=${normalizeCpf(cpf)}` : `caso=${casos[0]!.id}`}
            />
          ) : null}
          {processos[0] ? (
            <Button variant="outline" size="sm" onClick={() => setEditingProcesso(processos[0])}>
              <Pencil className="mr-2 h-4 w-4" />
              Editar cadastro
            </Button>
          ) : null}
        </div>
      </div>

      <ProcessoDialog
        processo={editingProcesso}
        open={editingProcesso !== null}
        onOpenChange={(next) => {
          if (!next) setEditingProcesso(null);
        }}
        title="Editar processo"
      />
    </>
  );
}

function statusCasoLabel(
  status: string | null | undefined,
  colunas?: KanbanColunaMatch[]
) {
  if (!status) return "—";
  if (colunas?.length) {
    return colunas.find((c) => c.chave === status)?.label ?? status;
  }
  return CASO_STATUS.find((s) => s.value === status)?.label ?? status;
}

function NovoCasoFichaDialog({
  cpf,
  telefone,
  nome,
}: {
  cpf: string | null;
  telefone: string | null;
  nome: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [beneficio, setBeneficio] = useState<string | null>(null);
  const [coluna, setColuna] = useState<string>("em_atendimento");
  const [loading, setLoading] = useState(false);

  async function criar() {
    if (!coluna.trim()) {
      toast.error("Escolha a coluna do funil");
      return;
    }
    setLoading(true);
    try {
      await criarCasoNaFicha({
        nome: nome.trim() || "Cliente",
        cpf,
        telefone,
        beneficio_identificado: beneficio,
        status: coluna,
      });
      toast.success("Caso criado e colocado no funil");
      setOpen(false);
      setBeneficio(null);
      setColuna("em_atendimento");
      router.refresh();
    } catch (err) {
      toastErroAcao(err, "Erro ao criar caso");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setBeneficio(null);
          setColuna("em_atendimento");
        }
      }}
    >
      <DialogTrigger
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1")}
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar ao funil
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cadastrar no funil</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Cria um caso de triagem neste cliente e coloca na coluna escolhida.
          </p>
          <div className="space-y-1">
            <Label>Coluna do funil</Label>
            <ColunaKanbanSelect value={coluna} onChange={setColuna} />
          </div>
          <div className="space-y-1">
            <Label>Benefício / tipo de caso</Label>
            <BeneficioTipoSelect value={beneficio} onChange={setBeneficio} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={loading || !coluna} onClick={criar}>
            {loading ? "Cadastrando…" : "Cadastrar na coluna"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CasoResumoCard({
  caso,
  cpf,
  contactNorm,
  onAbrirCaso,
  colunas,
}: {
  caso: Tables<"casos_novos">;
  cpf: string | null;
  contactNorm: string;
  onAbrirCaso?: (casoId: number) => void;
  colunas?: KanbanColunaMatch[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);

  async function salvarBeneficio(label: string | null) {
    if ((caso.beneficio_identificado ?? null) === label) return;
    setSaving(true);
    try {
      await updateCasoFields(caso.id, { beneficio_identificado: label });
      toast.success("Benefício do caso atualizado");
      router.refresh();
    } catch (err) {
      toastErroAcao(err, "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function moverColuna(chave: string) {
    if ((caso.status ?? "") === chave) return;
    setMoving(true);
    try {
      const result = await updateCasoStatus(caso.id, chave);
      toast.success("Caso movido no funil");
      toastProcessoDoCaso(result.processo);
      router.refresh();
    } catch (err) {
      toastErroAcao(err, "Erro ao mover");
    } finally {
      setMoving(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Caso #{caso.id}</p>
            <p className="text-sm text-muted-foreground">
              {statusCasoLabel(caso.status, colunas)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <EditarCasoDialog
              caso={caso}
              triggerSize="sm"
              triggerLabel="Editar"
            />
            {onAbrirCaso ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAbrirCaso(caso.id)}
              >
                Abrir
              </Button>
            ) : (
              <LinkButton
                href={fichaPessoaHref({
                  cpf,
                  contactNorm,
                  aba: "caso",
                  casoId: caso.id,
                })}
                size="sm"
                variant="outline"
              >
                Abrir
              </LinkButton>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Coluna do funil
          </Label>
          <ColunaKanbanSelect
            value={caso.status}
            onChange={moverColuna}
            colunas={colunas}
            disabled={moving}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Benefício deste caso
          </Label>
          <BeneficioTipoSelect
            value={caso.beneficio_identificado}
            onChange={salvarBeneficio}
            disabled={saving}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ProcessoCampo({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#94a3b8]">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-[#0b2148]">{children}</dd>
    </div>
  );
}

function ProcessoFichaCard({
  processo: p,
  parceiroNome,
  colunaLabel,
  onEdit,
  podeExcluir = false,
}: {
  processo: Processo;
  parceiroNome?: string;
  colunaLabel: string | null;
  onEdit: () => void;
  podeExcluir?: boolean;
}) {
  const [transferirOpen, setTransferirOpen] = useState(false);
  const funil = normalizeAreaProcesso(p.area);
  const situacao = situacaoProcessoInfo(p.situacao);
  const partes = [p.polo_ativo?.trim(), p.polo_passivo?.trim()].filter(Boolean);
  const andamentoData = p.ultimo_andamento_data
    ? formatDate(p.ultimo_andamento_data)
    : null;
  const andamento = [andamentoData, p.ultimo_movimento?.trim()]
    .filter(Boolean)
    .join(" — ");
  const origem = p.processo_origem?.trim();

  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn("text-[11px]", FUNIL_BADGE_CLASS[funil])}
              >
                {labelFunilProcesso(funil)}
              </Badge>
              {situacao ? (
                <Badge
                  variant="outline"
                  className={cn("text-[11px]", situacao.className)}
                >
                  {situacao.label}
                </Badge>
              ) : null}
              {colunaLabel ? (
                <span className="text-xs text-muted-foreground">
                  Coluna: {colunaLabel}
                </span>
              ) : null}
            </div>
            <p className="font-mono">
              {p.numero_processo ? (
                <>
                  {funilExigeCnj(funil) ? null : (
                    <span className="font-sans text-xs text-muted-foreground">
                      Requerimento/NB:{" "}
                    </span>
                  )}
                  {formatNumeroProcesso(p.numero_processo)}
                </>
              ) : (
                <span className="font-sans text-amber-700 dark:text-amber-400">
                  Sem número ainda — use Editar para adicionar
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {[p.tribunal, `cadastrado em ${formatDate(p.created_at)}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton
              href={`/processos?funil=${funil}`}
              size="sm"
              variant="outline"
            >
              Ver no funil
            </LinkButton>
            <Button size="sm" variant="outline" onClick={() => setTransferirOpen(true)}>
              <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />
              Transferir para…
            </Button>
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Editar
            </Button>
            {podeExcluir ? <ExcluirProcessoDialog processo={p} /> : null}
            <TransferirProcessoDialog
              ids={[p.id]}
              funilAtual={funil}
              open={transferirOpen}
              onOpenChange={setTransferirOpen}
            />
          </div>
        </div>

        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {partes.length ? (
            <ProcessoCampo label="Partes" className="sm:col-span-2">
              {partes.join(" × ")}
            </ProcessoCampo>
          ) : null}
          {p.tipo_acao?.trim() ? (
            <ProcessoCampo label="Tipo">{p.tipo_acao}</ProcessoCampo>
          ) : null}
          {p.vara_comarca?.trim() ? (
            <ProcessoCampo label="Vara / Comarca">{p.vara_comarca}</ProcessoCampo>
          ) : null}
          {andamento ? (
            <ProcessoCampo label="Último andamento" className="sm:col-span-2">
              {andamento}
            </ProcessoCampo>
          ) : null}
          {p.valor_centavos !== null && p.valor_centavos !== undefined ? (
            <ProcessoCampo label="Valor">
              <span className="tabular-nums">
                {formatValorCentavos(p.valor_centavos)}
              </span>
            </ProcessoCampo>
          ) : null}
          {origem ? (
            <ProcessoCampo label="Origem">
              <span className="font-mono">
                {isValidNumeroProcesso(normalizeNumeroProcesso(origem))
                  ? formatNumeroProcesso(origem)
                  : origem}
              </span>
            </ProcessoCampo>
          ) : null}
          {funilTemBeneficio(funil) && p.beneficio_identificado ? (
            <ProcessoCampo label="Benefício">{p.beneficio_identificado}</ProcessoCampo>
          ) : null}
          {parceiroNome ? (
            <ProcessoCampo label="Parceiro">{parceiroNome}</ProcessoCampo>
          ) : null}
          {p.telefone ? (
            <ProcessoCampo label="Telefone">
              {maskPhoneBrInput(p.telefone)}
            </ProcessoCampo>
          ) : null}
          {p.observacao?.trim() ? (
            <ProcessoCampo label="Observação" className="sm:col-span-2">
              <span className="whitespace-pre-line">{p.observacao}</span>
            </ProcessoCampo>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

export function Cliente360({
  cpf,
  contactNorm: contactNormProp,
  processos,
  casos,
  mensagens,
  documentos = [],
  pastas = [],
  midiasChat = [],
  showHeader = true,
  showArquivos = true,
  onAbrirCaso,
  podeExcluirProcesso = false,
}: {
  cpf: string | null;
  contactNorm?: string;
  processos: Processo[];
  casos: Tables<"casos_novos">[];
  mensagens: Tables<"mensagens">[];
  documentos?: Tables<"documentos_cliente">[];
  pastas?: Tables<"documentos_pastas">[];
  midiasChat?: MidiaChat[];
  /** Cabeçalho vive fora do componente quando a ficha usa abas. */
  showHeader?: boolean;
  /** Arquivos viram aba própria na ficha unificada. */
  showArquivos?: boolean;
  /** Na ficha com abas, "Abrir" troca de aba em vez de navegar para outra URL. */
  onAbrirCaso?: (casoId: number) => void;
  /** RLS só permite DELETE em processos_clientes para advogado. */
  podeExcluirProcesso?: boolean;
}) {
  const [editingProcesso, setEditingProcesso] = useState<Processo | null>(null);
  const [parceiros, setParceiros] = useState<Parceiro[]>([]);
  const [colunas, setColunas] = useState<KanbanColunaMatch[]>([]);
  const [processoColunas, setProcessoColunas] = useState<ProcessoColunaMatch[]>(
    []
  );
  const [novoProcessoOpen, setNovoProcessoOpen] = useState(false);
  const contactNorm =
    contactNormProp ||
    phoneToContactNorm(processos[0]?.telefone ?? casos[0]?.telefone);
  const nomeHint = processos[0]?.nome ?? casos[0]?.nome ?? "Cliente";
  const telefoneHint =
    processos[0]?.telefone ?? casos[0]?.telefone ?? (contactNorm || null);

  useEffect(() => {
    let cancelled = false;
    listParceiros()
      .then((list) => {
        if (!cancelled) setParceiros(list);
      })
      .catch(() => {
        if (!cancelled) setParceiros([]);
      });
    listarKanbanColunasAction(false)
      .then((list) => {
        if (!cancelled) setColunas(list);
      })
      .catch(() => {
        if (!cancelled) setColunas([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const parceiroNomeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of parceiros) map.set(p.id, p.nome);
    return map;
  }, [parceiros]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      FUNIS_PROCESSO.map((f) =>
        listarProcessoColunasAction(f.value, true).catch(
          () => [] as ProcessoColunaMatch[]
        )
      )
    ).then((lists) => {
      if (!cancelled) setProcessoColunas(lists.flat());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function colunaLabelFor(p: Processo): string | null {
    if (!p.funil_coluna) return null;
    const funil = normalizeAreaProcesso(p.area);
    return (
      processoColunas.find((c) => c.funil === funil && c.chave === p.funil_coluna)
        ?.label ?? p.funil_coluna
    );
  }

  const novoProcessoPrefill = useMemo<Partial<ProcessoFormState>>(() => {
    const base = processos[0] ?? casos[0];
    return {
      nome: base?.nome ?? "",
      cpf: maskCpfCnpjInput(cpf ?? base?.cpf ?? ""),
      telefone: maskPhoneBrInput(base?.telefone ?? contactNorm ?? ""),
      data_nascimento: isoToBrazilianDate(base?.data_nascimento),
    };
  }, [processos, casos, cpf, contactNorm]);

  return (
    <div className="space-y-6">
      {showHeader ? (
        <FichaHeader
          cpf={cpf}
          contactNorm={contactNorm}
          processos={processos}
          casos={casos}
        />
      ) : null}

      <ProcessoDialog
        processo={editingProcesso}
        open={editingProcesso !== null}
        onOpenChange={(next) => {
          if (!next) setEditingProcesso(null);
        }}
        title="Editar processo"
      />

      <ProcessoDialog
        open={novoProcessoOpen}
        onOpenChange={setNovoProcessoOpen}
        title="Cadastrar processo"
        prefill={novoProcessoPrefill}
      />

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Processos ({processos.length})</h2>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => setNovoProcessoOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Novo processo
          </Button>
        </div>
        {processos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum processo</p>
        ) : (
          <div className="space-y-2">
            {processos.map((p) => (
              <ProcessoFichaCard
                key={p.id}
                processo={p}
                parceiroNome={
                  p.parceiro_id ? parceiroNomeById.get(p.parceiro_id) : undefined
                }
                colunaLabel={colunaLabelFor(p)}
                onEdit={() => setEditingProcesso(p)}
                podeExcluir={podeExcluirProcesso}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            Funil / casos ({casos.length})
          </h2>
          <NovoCasoFichaDialog
            cpf={cpf}
            telefone={telefoneHint}
            nome={nomeHint}
          />
        </div>
        {casos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum caso no funil. Use{" "}
            <span className="font-medium text-[#0b2148]">Adicionar ao funil</span>{" "}
            para criar um caso e escolher a coluna.
          </p>
        ) : (
          <div className="space-y-2">
            {casos.map((c) => (
              <CasoResumoCard
                key={c.id}
                caso={c}
                cpf={cpf}
                contactNorm={contactNorm}
                onAbrirCaso={onAbrirCaso}
                colunas={colunas}
              />
            ))}
          </div>
        )}
      </section>

      {showArquivos ? (
        <FichaArquivos
          cpf={cpf}
          contactNorm={contactNorm}
          casos={casos}
          processos={processos}
          documentos={documentos}
          pastas={pastas}
          midiasChat={midiasChat}
        />
      ) : null}

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Conversas WhatsApp ({mensagens.length})
        </h2>
        {mensagens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma mensagem</p>
        ) : (
          <LinkButton
            href={`/atendimentos?contact=${encodeURIComponent(contactNorm || cpf || "")}`}
            variant="outline"
          >
            Ver conversa
          </LinkButton>
        )}
      </section>
    </div>
  );
}
