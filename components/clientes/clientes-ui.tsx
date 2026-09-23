"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { differenceInDays } from "date-fns";
import { Eye, EyeOff, Pencil, Plus, Search, Users } from "lucide-react";
import { upsertProcesso } from "@/lib/actions/casos";
import type { AppUser } from "@/lib/actions/auth";
import {
  listParceiros,
  type Parceiro,
} from "@/lib/actions/parceiros";
import type { Tables } from "@/types/database";
import { CpfDisplay } from "@/components/shared/cpf-display";
import { EmptyState } from "@/components/shared/empty-state";
import { LinkButton } from "@/components/ui/link-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

const inputShell =
  "border-[#e2e8f0] bg-white text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12";

/** Shared list grid: fixed contato/vínculos/ação tracks so header and rows align. */
const clientesListGrid =
  "grid grid-cols-1 gap-3 px-4 sm:grid-cols-[minmax(0,1fr)_14rem_10rem_7.5rem] sm:items-center sm:gap-4 sm:px-5";

type ClienteFiltro = "todos" | "com_processo" | "so_atendimento" | "sem_cpf";

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

type ProcessoFormState = {
  nome: string;
  cpf: string;
  numero_processo: string;
  telefone: string;
  tribunal: string;
  area: string;
  data_nascimento: string;
  descricao_caso: string;
  parceiro_id: string;
  id?: number;
  ativo?: boolean;
};

const EMPTY_FORM: ProcessoFormState = {
  nome: "",
  cpf: "",
  numero_processo: "",
  telefone: "",
  tribunal: "",
  area: "",
  data_nascimento: "",
  descricao_caso: "",
  parceiro_id: "",
};

function processoToForm(processo: Processo): ProcessoFormState {
  return {
    id: processo.id,
    nome: processo.nome ?? "",
    cpf: maskCpfCnpjInput(processo.cpf),
    numero_processo: maskNumeroProcessoInput(processo.numero_processo),
    telefone: maskPhoneBrInput(processo.telefone ?? ""),
    tribunal: processo.tribunal ?? "",
    area: processo.area ?? "",
    data_nascimento: isoToBrazilianDate(processo.data_nascimento),
    descricao_caso: processo.descricao_caso ?? "",
    parceiro_id: processo.parceiro_id ?? "",
    ativo: processo.ativo ?? true,
  };
}

function ProcessoFormFields({
  form,
  setForm,
  idPrefix = "",
  parceiros,
  parceirosLoading,
}: {
  form: ProcessoFormState;
  setForm: React.Dispatch<React.SetStateAction<ProcessoFormState>>;
  idPrefix?: string;
  parceiros: Parceiro[];
  parceirosLoading: boolean;
}) {
  const cpfLabel = cpfCnpjDocumentLabel(form.cpf);
  const fieldId = (name: string) => (idPrefix ? `${idPrefix}-${name}` : name);

  return (
    <div className="grid gap-3">
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
        <Label htmlFor={fieldId("numero_processo")}>Nº processo CNJ</Label>
        <Input
          id={fieldId("numero_processo")}
          value={form.numero_processo}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              numero_processo: maskNumeroProcessoInput(e.target.value),
            }))
          }
          inputMode="numeric"
          placeholder="0000000-00.0000.0.00.0000"
          className="font-mono"
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
        <Label htmlFor={fieldId("tribunal")}>Tribunal</Label>
        <Input
          id={fieldId("tribunal")}
          value={form.tribunal}
          onChange={(e) => setForm((f) => ({ ...f, tribunal: e.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={fieldId("area")}>Área</Label>
        <Input
          id={fieldId("area")}
          value={form.area}
          onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
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
      <div className="space-y-1">
        <Label htmlFor={fieldId("descricao_caso")}>Descrição</Label>
        <Input
          id={fieldId("descricao_caso")}
          value={form.descricao_caso}
          onChange={(e) =>
            setForm((f) => ({ ...f, descricao_caso: e.target.value }))
          }
        />
      </div>
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
              <SelectValue placeholder="Sem parceiro" />
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
    </div>
  );
}

function ProcessoDialog({
  processo,
  prefill,
  open,
  onOpenChange,
  title,
  trigger,
}: {
  processo?: Processo | null;
  prefill?: Partial<ProcessoFormState>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ProcessoFormState>(EMPTY_FORM);
  const [parceiros, setParceiros] = useState<Parceiro[]>([]);
  const [parceirosLoading, setParceirosLoading] = useState(false);
  const cpfLabel = cpfCnpjDocumentLabel(form.cpf);

  useEffect(() => {
    if (open) {
      setForm(
        processo ? processoToForm(processo) : { ...EMPTY_FORM, ...prefill }
      );
    }
  }, [open, processo, prefill]);

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
    if (!isValidNumeroProcesso(numero)) {
      toast.error("Número de processo CNJ inválido (20 dígitos)");
      return;
    }
    if (form.data_nascimento && !dataIso) {
      toast.error("Data de nascimento inválida");
      return;
    }

    try {
      await upsertProcesso({
        id: form.id,
        nome,
        cpf,
        numero_processo: numero,
        telefone: telefone || null,
        tribunal: form.tribunal || null,
        area: form.area || null,
        data_nascimento: dataIso,
        descricao_caso: form.descricao_caso || null,
        parceiro_id: form.parceiro_id || null,
        ativo: form.ativo ?? true,
      });
      toast.success(form.id ? "Processo atualizado" : "Processo salvo");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <ProcessoFormFields
          form={form}
          setForm={setForm}
          idPrefix={form.id ? `edit-${form.id}` : "new"}
          parceiros={parceiros}
          parceirosLoading={parceirosLoading}
        />
        <DialogFooter>
          <Button onClick={handleSave}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClientesList({
  processos,
  casosAbertura = [],
  pessoas,
  abrirCaso = null,
}: {
  processos: Processo[];
  casosAbertura?: Tables<"casos_novos">[];
  pessoas: PessoaListaItem[];
  abrirCaso?: Tables<"casos_novos"> | null;
  user?: AppUser;
}) {
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<ClienteFiltro>("todos");
  const [revealCpfs, setRevealCpfs] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [abrindoCaso, setAbrindoCaso] = useState<Tables<"casos_novos"> | null>(
    abrirCaso
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

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const qDigits = q.replace(/\D/g, "");
    return pessoas.filter((p) => {
      if (filtro === "com_processo" && p.nProcessos === 0) return false;
      if (filtro === "so_atendimento" && !(p.nProcessos === 0 && p.nCasos > 0))
        return false;
      if (filtro === "sem_cpf" && p.cpf) return false;
      if (!q) return true;
      return (
        p.nome.toLowerCase().includes(q) ||
        (p.cpf != null && qDigits.length > 0 && p.cpf.includes(qDigits)) ||
        (p.telefone != null &&
          qDigits.length > 0 &&
          p.telefone.replace(/\D/g, "").includes(qDigits)) ||
        (p.beneficio?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [pessoas, search, filtro]);

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
                area: abrindoCaso.area ?? "",
                data_nascimento: isoToBrazilianDate(
                  abrindoCaso.data_nascimento
                ),
                descricao_caso: abrindoCaso.beneficio_identificado ?? "",
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

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#94a3b8]" />
          <Input
            placeholder="Buscar por nome, CPF ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(inputShell, "h-11 pl-9")}
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
                  : "border-[#e2e8f0] bg-white text-[#64748B] hover:border-[#0b2148]/30 hover:text-[#0b2148]"
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
            className="border-[#e2e8f0] text-[#0b2148] hover:bg-[#0b2148]/5"
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
            <span className="font-semibold text-[#0b2148]">{filtered.length}</span>
            /{kpis.total}
          </span>
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
        {processos[0] ? (
          <Button variant="outline" size="sm" onClick={() => setEditingProcesso(processos[0])}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar cadastro
          </Button>
        ) : null}
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
}) {
  const [editingProcesso, setEditingProcesso] = useState<Processo | null>(null);
  const [parceiros, setParceiros] = useState<Parceiro[]>([]);
  const contactNorm =
    contactNormProp ||
    phoneToContactNorm(processos[0]?.telefone ?? casos[0]?.telefone);

  useEffect(() => {
    let cancelled = false;
    listParceiros()
      .then((list) => {
        if (!cancelled) setParceiros(list);
      })
      .catch(() => {
        if (!cancelled) setParceiros([]);
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

      <section>
        <h2 className="mb-3 text-lg font-semibold">Processos ({processos.length})</h2>
        {processos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum processo</p>
        ) : (
          <div className="space-y-2">
            {processos.map((p) => {
              const parceiroNome = p.parceiro_id
                ? parceiroNomeById.get(p.parceiro_id)
                : undefined;
              return (
              <Card key={p.id}>
                <CardContent className="flex items-start justify-between gap-3 p-4 text-sm">
                  <div className="min-w-0">
                    <p className="font-mono">{formatNumeroProcesso(p.numero_processo)}</p>
                    <p className="text-muted-foreground">
                      {p.tribunal} · {p.area} · {formatDate(p.created_at)}
                    </p>
                    {parceiroNome ? (
                      <p className="mt-1 text-muted-foreground">
                        Parceiro: {parceiroNome}
                      </p>
                    ) : null}
                    {p.telefone ? (
                      <p className="mt-1 text-muted-foreground">
                        {maskPhoneBrInput(p.telefone)}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingProcesso(p)}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Editar
                  </Button>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Casos de triagem ({casos.length})</h2>
        {casos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum caso</p>
        ) : (
          <div className="space-y-2">
            {casos.map((c) => (
              <Card key={c.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">{c.beneficio_identificado}</p>
                    <p className="text-sm text-muted-foreground">{c.status}</p>
                  </div>
                  {onAbrirCaso ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAbrirCaso(c.id)}
                    >
                      Abrir
                    </Button>
                  ) : (
                    <LinkButton
                      href={fichaPessoaHref({
                        cpf,
                        contactNorm,
                        aba: "caso",
                        casoId: c.id,
                      })}
                      size="sm"
                      variant="outline"
                    >
                      Abrir
                    </LinkButton>
                  )}
                </CardContent>
              </Card>
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
