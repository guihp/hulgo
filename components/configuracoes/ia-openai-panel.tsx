"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck, ShieldAlert, Trash2 } from "lucide-react";
import {
  listarModelosOpenAI,
  obterConfigIA,
  removerChaveOpenAI,
  salvarChaveOpenAI,
  salvarModelosIA,
  type IaConfigResumo,
} from "@/lib/actions/ia-config";
import { toastErroAcao } from "@/lib/client/erros";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const cardShell = "rounded-2xl border border-[#e2e8f0] bg-white p-5";
const btnPrimary = "rounded-full bg-[#0b2148] text-white hover:bg-[#163a7a]";
const PADRAO = "__padrao__";

type Raciocinio = "low" | "medium" | "high";
const RACIOCINIO: { value: Raciocinio; label: string }[] = [
  { value: "low", label: "Baixo — mais rápido e barato" },
  { value: "medium", label: "Médio" },
  { value: "high", label: "Alto — mais cuidadoso (padrão)" },
];

function ModeloSelect(props: {
  id: string;
  valor: string | null;
  opcoes: string[];
  padraoLabel: string;
  disabled?: boolean;
  onChange: (v: string | null) => void;
}) {
  // Mantém o salvo visível mesmo se a lista ainda não carregou.
  const opcoes = props.valor && !props.opcoes.includes(props.valor) ? [props.valor, ...props.opcoes] : props.opcoes;
  return (
    <Select
      value={props.valor ?? PADRAO}
      disabled={props.disabled}
      onValueChange={(v) => props.onChange(v == null || v === PADRAO ? null : String(v))}
    >
      <SelectTrigger id={props.id} className="w-full">
        <SelectValue>{(v: string | null) => (!v || v === PADRAO ? props.padraoLabel : v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={PADRAO}>{props.padraoLabel}</SelectItem>
        {opcoes.map((m) => (
          <SelectItem key={m} value={m}>
            {m}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function IaOpenAIPanel() {
  const [resumo, setResumo] = useState<IaConfigResumo | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [novaChave, setNovaChave] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [modelos, setModelos] = useState<{ chat: string[]; transcricao: string[] } | null>(null);
  const [carregandoModelos, setCarregandoModelos] = useState(false);
  const [form, setForm] = useState<{
    modeloChat: string | null;
    modeloWhatsapp: string | null;
    modeloTranscricao: string | null;
    raciocinioWhatsapp: Raciocinio | null;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const carregarModelos = useCallback(async () => {
    setCarregandoModelos(true);
    try {
      setModelos(await listarModelosOpenAI());
    } catch (e) {
      toastErroAcao(e, "Não foi possível listar os modelos");
    } finally {
      setCarregandoModelos(false);
    }
  }, []);

  const carregar = useCallback(async () => {
    try {
      const r = await obterConfigIA();
      setResumo(r);
      setForm({ ...r.salvos });
      setErroCarga(null);
      if (r.chave.origem !== "nenhuma") void carregarModelos();
    } catch (e) {
      setErroCarga(e instanceof Error ? e.message : "Erro ao carregar");
    }
  }, [carregarModelos]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial via server action
    void carregar();
  }, [carregar]);

  function salvarChave() {
    startTransition(async () => {
      try {
        const { final } = await salvarChaveOpenAI(novaChave);
        setNovaChave("");
        setMostrar(false);
        toast.success(`Chave testada e salva (…${final})`);
        await carregar();
      } catch (e) {
        toastErroAcao(e, "Não foi possível salvar a chave");
      }
    });
  }

  function removerChave() {
    startTransition(async () => {
      try {
        await removerChaveOpenAI();
        toast.success("Chave do painel removida");
        await carregar();
      } catch (e) {
        toastErroAcao(e, "Não foi possível remover a chave");
      }
    });
  }

  function salvarModelos() {
    if (!form) return;
    startTransition(async () => {
      try {
        await salvarModelosIA(form);
        toast.success("Modelos salvos — valem a partir da próxima mensagem");
        await carregar();
      } catch (e) {
        toastErroAcao(e, "Não foi possível salvar os modelos");
      }
    });
  }

  if (erroCarga) {
    return <div className={cn(cardShell, "text-sm text-red-700")}>{erroCarga}</div>;
  }
  if (!resumo || !form) {
    return (
      <div className={cn(cardShell, "flex items-center gap-2 text-sm text-[#64748b]")}>
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  const origemTexto =
    resumo.chave.origem === "painel"
      ? `Cadastrada aqui no painel · termina em …${resumo.chave.final}`
      : resumo.chave.origem === "ambiente"
        ? `Vem do servidor (Coolify) · termina em …${resumo.chave.final}`
        : "Nenhuma chave configurada — a IA não funciona sem ela.";

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className={cn(cardShell, "flex flex-col gap-4")}>
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[#0b2148]" />
          <h2 className="font-semibold text-[#0b2148]">Chave da OpenAI</h2>
        </div>

        <div
          className={cn(
            "rounded-xl border p-3 text-sm",
            resumo.chave.origem === "nenhuma"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-[#e2e8f0] bg-[#f8fafc] text-[#0b2148]"
          )}
        >
          {origemTexto}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nova-chave">
            {resumo.chave.origem === "painel" ? "Trocar a chave" : "Cadastrar chave"}
          </Label>
          <div className="flex gap-2">
            <Input
              id="nova-chave"
              type={mostrar ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-…"
              value={novaChave}
              onChange={(e) => setNovaChave(e.target.value)}
              disabled={!resumo.criptografiaOk || pending}
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setMostrar((v) => !v)}
              aria-label={mostrar ? "Ocultar chave" : "Mostrar chave"}
            >
              {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <Button
            onClick={salvarChave}
            disabled={!novaChave.trim() || !resumo.criptografiaOk || pending}
            className={cn(btnPrimary, "self-start")}
          >
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Testar e salvar
          </Button>
        </div>

        {resumo.chave.origem === "painel" ? (
          <AlertDialog>
            <AlertDialogTrigger
              disabled={pending}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start text-red-700")}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Remover chave do painel
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover a chave cadastrada?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se o servidor tiver uma chave própria (Coolify), ela passa a valer. Se não tiver,
                  a IA do WhatsApp e o assistente param de funcionar até cadastrar outra.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={removerChave}>Remover</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}

        <div
          className={cn(
            "flex gap-2 rounded-xl border p-3 text-xs",
            resumo.criptografiaOk
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          )}
        >
          {resumo.criptografiaOk ? (
            <ShieldCheck className="h-4 w-4 shrink-0" />
          ) : (
            <ShieldAlert className="h-4 w-4 shrink-0" />
          )}
          <p>
            {resumo.criptografiaOk
              ? "A chave é testada na OpenAI, guardada criptografada e nunca é mostrada de novo — nem para quem está logado. Só aparecem os 4 últimos caracteres."
              : "Para cadastrar a chave pelo painel, o responsável técnico precisa configurar a APP_ENCRYPTION_KEY no servidor (Coolify). Até lá vale a chave do servidor."}
          </p>
        </div>
      </section>

      <section className={cn(cardShell, "flex flex-col gap-4")}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-[#0b2148]">Modelos</h2>
          <Button
            variant="outline"
            size="sm"
            disabled={carregandoModelos || resumo.chave.origem === "nenhuma"}
            onClick={() => void carregarModelos()}
          >
            {carregandoModelos ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Atualizar lista
          </Button>
        </div>
        <p className="text-xs text-[#64748b]">
          A lista vem da sua conta na OpenAI, então só aparecem modelos que a chave pode usar.
        </p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="modelo-whatsapp">IA do WhatsApp</Label>
          <ModeloSelect
            id="modelo-whatsapp"
            valor={form.modeloWhatsapp}
            opcoes={modelos?.chat ?? []}
            padraoLabel={`Mesmo do assistente (${resumo.efetivos.modeloChat})`}
            disabled={pending}
            onChange={(v) => setForm({ ...form, modeloWhatsapp: v })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="raciocinio">Raciocínio da IA do WhatsApp</Label>
          <Select
            value={form.raciocinioWhatsapp ?? PADRAO}
            disabled={pending}
            onValueChange={(v) =>
              setForm({ ...form, raciocinioWhatsapp: v == null || v === PADRAO ? null : (v as Raciocinio) })
            }
          >
            <SelectTrigger id="raciocinio" className="w-full">
              <SelectValue>
                {(v: string | null) =>
                  !v || v === PADRAO
                    ? "Padrão (alto)"
                    : RACIOCINIO.find((r) => r.value === v)?.label ?? v
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PADRAO}>Padrão (alto)</SelectItem>
              {RACIOCINIO.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-[#64748b]">Só vale para modelos com raciocínio (linha GPT-5).</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="modelo-chat">Assistente do painel e leitura de imagens/documentos</Label>
          <ModeloSelect
            id="modelo-chat"
            valor={form.modeloChat}
            opcoes={modelos?.chat ?? []}
            padraoLabel={`Padrão (${resumo.padroes.modeloChat})`}
            disabled={pending}
            onChange={(v) => setForm({ ...form, modeloChat: v })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="modelo-transcricao">Transcrição de áudio</Label>
          <ModeloSelect
            id="modelo-transcricao"
            valor={form.modeloTranscricao}
            opcoes={modelos?.transcricao ?? []}
            padraoLabel={`Padrão (${resumo.padroes.modeloTranscricao})`}
            disabled={pending}
            onChange={(v) => setForm({ ...form, modeloTranscricao: v })}
          />
        </div>

        <Button
          onClick={salvarModelos}
          disabled={pending || resumo.chave.origem === "nenhuma"}
          className={cn(btnPrimary, "self-start")}
        >
          Salvar modelos
        </Button>
        <p className="text-xs text-[#94a3b8]">
          Em uso agora: WhatsApp <strong>{resumo.efetivos.modeloWhatsapp}</strong> · assistente{" "}
          <strong>{resumo.efetivos.modeloChat}</strong> · áudio{" "}
          <strong>{resumo.efetivos.modeloTranscricao}</strong>
        </p>
      </section>
    </div>
  );
}
