"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Users } from "lucide-react";
import { deleteProcesso, upsertProcesso } from "@/lib/actions/casos";
import type { AppUser } from "@/lib/actions/auth";
import type { Tables } from "@/types/database";
import { CpfDisplay } from "@/components/shared/cpf-display";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  cpfCnpjDocumentLabel,
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

type Processo = Tables<"processos_clientes">;

type ProcessoFormState = {
  nome: string;
  cpf: string;
  numero_processo: string;
  telefone: string;
  tribunal: string;
  area: string;
  data_nascimento: string;
  descricao_caso: string;
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
    ativo: processo.ativo ?? true,
  };
}

function ProcessoFormFields({
  form,
  setForm,
  idPrefix = "",
}: {
  form: ProcessoFormState;
  setForm: React.Dispatch<React.SetStateAction<ProcessoFormState>>;
  idPrefix?: string;
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
  const cpfLabel = cpfCnpjDocumentLabel(form.cpf);

  useEffect(() => {
    if (open) {
      setForm(
        processo ? processoToForm(processo) : { ...EMPTY_FORM, ...prefill }
      );
    }
  }, [open, processo, prefill]);

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
        <ProcessoFormFields form={form} setForm={setForm} idPrefix={form.id ? `edit-${form.id}` : "new"} />
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
  abrirCaso = null,
  user,
}: {
  processos: Processo[];
  casosAbertura?: Tables<"casos_novos">[];
  abrirCaso?: Tables<"casos_novos"> | null;
  user: AppUser;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingProcesso, setEditingProcesso] = useState<Processo | null>(null);
  // Chegando de /clientes?caso=ID, o diálogo já abre preenchido
  const [abrindoCaso, setAbrindoCaso] = useState<Tables<"casos_novos"> | null>(
    abrirCaso
  );

  // Clientes do Kanban em "Abertura de processo" que ainda não têm processo
  // cadastrado — dedupe por telefone/CPF e exclui quem já está na tabela
  const emAbertura = (() => {
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
  })();

  const filtered = processos.filter((p) => {
    const q = search.toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return (
      !q ||
      p.nome.toLowerCase().includes(q) ||
      p.cpf.includes(qDigits) ||
      p.numero_processo.includes(qDigits) ||
      formatNumeroProcesso(p.numero_processo).toLowerCase().includes(q)
    );
  });

  async function handleDelete(id: number) {
    if (user.papel !== "advogado") {
      toast.error("Apenas advogados podem excluir processos");
      return;
    }
    try {
      await deleteProcesso(id);
      toast.success("Processo removido");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Buscar por nome, CPF ou processo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
        <ProcessoDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          title="Cadastrar processo"
          trigger={
            <DialogTrigger className={buttonVariants()}>
              <Plus className="mr-2 h-4 w-4" />
              Novo processo
            </DialogTrigger>
          }
        />
        <ProcessoDialog
          processo={editingProcesso}
          open={editingProcesso !== null}
          onOpenChange={(next) => {
            if (!next) setEditingProcesso(null);
          }}
          title="Editar processo"
        />
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
      </div>

      {emAbertura.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-1 text-base font-semibold">
              Aguardando abertura de processo ({emAbertura.length})
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Clientes na coluna &quot;Abertura de processo&quot; do funil que
              ainda não têm processo cadastrado
            </p>
            <div className="space-y-2">
              {emAbertura.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{c.nome ?? "Sem nome"}</p>
                    <p className="text-muted-foreground">
                      <CpfDisplay value={c.cpf} />
                      {c.telefone ? ` · ${maskPhoneBrInput(c.telefone)}` : ""}
                      {c.beneficio_identificado
                        ? ` · ${c.beneficio_identificado}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <LinkButton
                      href={`/kanban/${c.id}`}
                      size="sm"
                      variant="outline"
                    >
                      Ver caso
                    </LinkButton>
                    <Button size="sm" onClick={() => setAbrindoCaso(c)}>
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Criar processo
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum processo cadastrado"
          description="Cadastre clientes com processo para alimentar a consulta por CPF da IA."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>CPF</TableHead>
                  <TableHead className="hidden md:table-cell">Processo</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell>
                      <CpfDisplay value={p.cpf} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell font-mono text-xs">
                      {formatNumeroProcesso(p.numero_processo)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={p.ativo ? "default" : "secondary"}>
                        {p.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <LinkButton href={`/clientes/${normalizeCpf(p.cpf)}`} size="sm" variant="outline">
                        Ver 360°
                      </LinkButton>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingProcesso(p)}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        Editar
                      </Button>
                      {user.papel === "advogado" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => handleDelete(p.id)}
                        >
                          Excluir
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function Cliente360({
  cpf,
  processos,
  casos,
  mensagens,
}: {
  cpf: string;
  processos: Processo[];
  casos: Tables<"casos_novos">[];
  mensagens: Tables<"mensagens">[];
}) {
  const [editingProcesso, setEditingProcesso] = useState<Processo | null>(null);
  const nome = processos[0]?.nome ?? casos[0]?.nome ?? "Cliente";
  const contactNorm = phoneToContactNorm(
    processos[0]?.telefone ?? casos[0]?.telefone
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{nome}</h1>
          <p className="text-muted-foreground">
            CPF: <CpfDisplay value={cpf} />
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

      <section>
        <h2 className="mb-3 text-lg font-semibold">Processos ({processos.length})</h2>
        {processos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum processo</p>
        ) : (
          <div className="space-y-2">
            {processos.map((p) => (
              <Card key={p.id}>
                <CardContent className="flex items-start justify-between gap-3 p-4 text-sm">
                  <div className="min-w-0">
                    <p className="font-mono">{formatNumeroProcesso(p.numero_processo)}</p>
                    <p className="text-muted-foreground">
                      {p.tribunal} · {p.area} · {formatDate(p.created_at)}
                    </p>
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
            ))}
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
                  <LinkButton href={`/kanban/${c.id}`} size="sm" variant="outline">
                    Abrir
                  </LinkButton>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Conversas WhatsApp ({mensagens.length})
        </h2>
        {mensagens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma mensagem</p>
        ) : (
          <LinkButton
            href={`/atendimentos?contact=${encodeURIComponent(contactNorm || cpf)}`}
            variant="outline"
          >
            Ver conversa
          </LinkButton>
        )}
      </section>
    </div>
  );
}
