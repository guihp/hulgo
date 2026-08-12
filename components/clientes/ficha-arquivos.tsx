"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Briefcase,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Gavel,
  ImageIcon,
  MessageCircle,
  Upload,
} from "lucide-react";
import { ArquivoVisualizarDialog } from "@/components/arquivos/arquivo-visualizar-dialog";
import type { MidiaChat } from "@/lib/data/arquivos";
import {
  criarPastaCliente,
  registrarArquivosCliente,
} from "@/lib/actions/documentos";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  pastaCustomKey,
  pastaCustomNome,
  storagePastaSegment,
} from "@/lib/utils/ficha";
import { formatDateTime } from "@/lib/utils/dates";
import { formatNumeroProcesso } from "@/lib/utils/processo";
import { resolveMediaDisplayKind } from "@/lib/utils/messages";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/database";

type Documento = Tables<"documentos_cliente">;
type PastaCustom = Tables<"documentos_pastas">;
type Caso = Pick<
  Tables<"casos_novos">,
  "id" | "beneficio_identificado" | "status"
>;
type Processo = Pick<Tables<"processos_clientes">, "id" | "numero_processo">;

const WHATSAPP_KEY = "__whatsapp__";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 3;

type PastaKind = "geral" | "caso" | "processo" | "custom" | "whatsapp";

type PastaNode = {
  key: string;
  label: string;
  count: number;
  kind: PastaKind;
};

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function pastaIcon(kind: PastaKind, active: boolean) {
  const cls = cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground");
  if (kind === "caso") return <Briefcase className={cls} />;
  if (kind === "processo") return <Gavel className={cls} />;
  if (kind === "whatsapp") return <MessageCircle className={cls} />;
  if (kind === "custom") return active ? <FolderOpen className={cls} /> : <Folder className={cls} />;
  return active ? <FolderOpen className={cls} /> : <Folder className={cls} />;
}

function fileKindLabel(url: string, type?: string | null) {
  const kind = resolveMediaDisplayKind(type, url);
  if (kind === "image") return "Imagem";
  if (kind === "document") {
    if (/\.pdf(\?|$)/i.test(url)) return "PDF";
    return "Documento";
  }
  if (kind === "video") return "Vídeo";
  if (kind === "audio") return "Áudio";
  return "Arquivo";
}

function DocTile({ doc }: { doc: Documento }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const kind = resolveMediaDisplayKind(null, doc.url_media);
  const isImage = kind === "image";

  return (
    <>
      <button
        type="button"
        onClick={() => setPreviewOpen(true)}
        className={cn(
          "group flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card text-left transition-colors",
          "hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted/40">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={doc.url_media}
              alt=""
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-background/80 ring-1 ring-foreground/10">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {fileKindLabel(doc.url_media)}
              </span>
            </div>
          )}
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground opacity-0 shadow-sm ring-1 ring-foreground/10 transition-opacity group-hover:opacity-100">
            <Eye className="h-3 w-3" />
            Abrir
          </span>
        </div>
        <div className="space-y-0.5 p-3">
          <p className="truncate text-sm font-medium leading-snug">
            {doc.nome_documento}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {formatDateTime(doc.created_at)}
          </p>
        </div>
      </button>
      <ArquivoVisualizarDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={doc.nome_documento}
        description={doc.descricao}
        arquivos={[{ url: doc.url_media, label: doc.nome_documento }]}
      />
    </>
  );
}

function MidiaTile({ midia }: { midia: MidiaChat }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const kind = resolveMediaDisplayKind(midia.mensage_type, midia.url);
  const isImage = kind === "image";

  return (
    <>
      <button
        type="button"
        onClick={() => setPreviewOpen(true)}
        className={cn(
          "group flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card text-left transition-colors",
          "hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted/40">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={midia.url}
              alt=""
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-background/80 ring-1 ring-foreground/10">
                {kind === "image" ? (
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                ) : (
                  <FileText className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {fileKindLabel(midia.url, midia.mensage_type)}
              </span>
            </div>
          )}
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] font-medium opacity-0 shadow-sm ring-1 ring-foreground/10 transition-opacity group-hover:opacity-100">
            <Eye className="h-3 w-3" />
            Abrir
          </span>
        </div>
        <div className="space-y-0.5 p-3">
          <p className="truncate text-sm font-medium leading-snug">Mídia do chat</p>
          <p className="truncate text-[11px] capitalize text-muted-foreground">
            {midia.mensage_type ?? "arquivo"} · {formatDateTime(midia.created_at)}
          </p>
        </div>
      </button>
      <ArquivoVisualizarDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title="Mídia do chat"
        description={midia.text}
        arquivos={[
          {
            url: midia.url,
            label: midia.mensage_type ?? "Mídia do chat",
            mensageType: midia.mensage_type,
          },
        ]}
      />
    </>
  );
}

function EmptyPasta({
  onUpload,
}: {
  onUpload: () => void;
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 px-6 py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Upload className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">Pasta vazia</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
        Envie comprovantes, laudos ou contratos do computador.
      </p>
      <Button type="button" size="sm" className="mt-4" onClick={onUpload}>
        <Upload className="mr-1.5 h-4 w-4" />
        Enviar arquivos
      </Button>
    </div>
  );
}

export function FichaArquivos({
  cpf,
  contactNorm,
  casos,
  processos,
  documentos,
  pastas,
  midiasChat,
}: {
  cpf: string | null;
  contactNorm: string;
  casos: Caso[];
  processos: Processo[];
  documentos: Documento[];
  pastas: PastaCustom[];
  midiasChat: MidiaChat[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("geral");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pastaOpen, setPastaOpen] = useState(false);
  const [destino, setDestino] = useState("geral");
  const [novoNome, setNovoNome] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#arquivos") {
      document.getElementById("arquivos")?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  const nodes = useMemo<PastaNode[]>(() => {
    const countByPasta = new Map<string, number>();
    for (const doc of documentos) {
      const key = doc.pasta || "geral";
      countByPasta.set(key, (countByPasta.get(key) ?? 0) + 1);
    }

    const list: PastaNode[] = [
      {
        key: "geral",
        label: "Geral",
        count: countByPasta.get("geral") ?? 0,
        kind: "geral",
      },
    ];

    for (const c of casos) {
      const key = `caso:${c.id}`;
      list.push({
        key,
        label: c.beneficio_identificado?.trim() || `Caso #${c.id}`,
        count: countByPasta.get(key) ?? 0,
        kind: "caso",
      });
    }

    for (const p of processos) {
      const key = `processo:${p.id}`;
      list.push({
        key,
        label: formatNumeroProcesso(p.numero_processo),
        count: countByPasta.get(key) ?? 0,
        kind: "processo",
      });
    }

    const customKeys = new Set<string>();
    for (const pasta of pastas) {
      const key = pastaCustomKey(pasta.nome);
      customKeys.add(key);
      list.push({
        key,
        label: pasta.nome,
        count: countByPasta.get(key) ?? 0,
        kind: "custom",
      });
    }
    for (const [key, count] of countByPasta) {
      if (!key.startsWith("custom:") || customKeys.has(key)) continue;
      list.push({
        key,
        label: pastaCustomNome(key),
        count,
        kind: "custom",
      });
    }

    if (midiasChat.length) {
      list.push({
        key: WHATSAPP_KEY,
        label: "Do WhatsApp",
        count: midiasChat.length,
        kind: "whatsapp",
      });
    }

    return list;
  }, [casos, documentos, midiasChat.length, pastas, processos]);

  const destinosUpload = nodes.filter((n) => n.kind !== "whatsapp");
  const selectedNode = nodes.find((n) => n.key === selected) ?? nodes[0];

  const docsDaPasta = useMemo(
    () => documentos.filter((d) => (d.pasta || "geral") === selected),
    [documentos, selected]
  );

  const totalArquivos = documentos.length + midiasChat.length;

  function openUpload() {
    setDestino(selected === WHATSAPP_KEY ? "geral" : selected);
    setUploadOpen(true);
  }

  async function enviarArquivo() {
    if (arquivos.length === 0) {
      toast.error("Escolha ao menos um arquivo");
      return;
    }
    const oversized = arquivos.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (oversized.length) {
      toast.error(
        `Arquivo maior que 25 MB: ${oversized.map((f) => f.name).join(", ")}`
      );
      return;
    }

    setLoading(true);
    setProgresso(`0/${arquivos.length}`);

    const personKey = cpf || contactNorm;
    const supabase = createClient();
    let done = 0;
    const errors: string[] = [];
    const uploaded: Array<{
      urlMedia: string;
      nomeDocumento: string;
    }> = [];

    try {
      await mapPool(arquivos, UPLOAD_CONCURRENCY, async (file) => {
        try {
          const ext = file.name.includes(".")
            ? file.name.split(".").pop()!.toLowerCase()
            : "bin";
          const storagePath = `clientes/${personKey}/${storagePastaSegment(destino)}/${crypto.randomUUID()}.${ext}`;

          const { error: upErr } = await supabase.storage
            .from("mensagens-media")
            .upload(storagePath, file, {
              contentType: file.type || "application/octet-stream",
              upsert: false,
            });
          if (upErr) throw new Error(upErr.message);

          const { data: pub } = supabase.storage
            .from("mensagens-media")
            .getPublicUrl(storagePath);

          uploaded.push({
            urlMedia: pub.publicUrl,
            nomeDocumento: file.name.replace(/\.[^.]+$/, "") || "Arquivo",
          });
        } catch (err) {
          errors.push(
            `${file.name}: ${err instanceof Error ? err.message : "erro"}`
          );
        } finally {
          done += 1;
          setProgresso(`${done}/${arquivos.length}`);
        }
      });

      if (uploaded.length === 0) {
        toast.error(errors[0] || "Falha no upload");
        return;
      }

      setProgresso("salvando…");
      await registrarArquivosCliente({
        cpf,
        contactNorm,
        pasta: destino,
        arquivos: uploaded.map((u) => ({
          urlMedia: u.urlMedia,
          nomeDocumento: u.nomeDocumento,
        })),
      });

      if (errors.length) {
        toast.error(`${uploaded.length} enviados, ${errors.length} falharam`);
      } else {
        toast.success(
          uploaded.length === 1
            ? "Arquivo enviado"
            : `${uploaded.length} arquivos enviados`
        );
      }
      setUploadOpen(false);
      setArquivos([]);
      setSelected(destino);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setLoading(false);
      setProgresso(null);
    }
  }

  async function criarPasta() {
    setLoading(true);
    try {
      const result = await criarPastaCliente({
        cpf,
        contactNorm,
        nome: novoNome,
      });
      toast.success("Pasta criada");
      setPastaOpen(false);
      setNovoNome("");
      setDestino(result.pasta);
      setSelected(result.pasta);
      setUploadOpen(true);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar pasta");
    } finally {
      setLoading(false);
    }
  }

  const groups: { title: string; kinds: PastaKind[] }[] = [
    { title: "Pastas", kinds: ["geral", "custom"] },
    { title: "Casos", kinds: ["caso"] },
    { title: "Processos", kinds: ["processo"] },
    { title: "Outros", kinds: ["whatsapp"] },
  ];

  return (
    <section id="arquivos" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Arquivos</h2>
          <p className="text-sm text-muted-foreground">
            {totalArquivos} arquivo{totalArquivos === 1 ? "" : "s"} ·{" "}
            {nodes.filter((n) => n.kind !== "whatsapp").length} pasta
            {nodes.filter((n) => n.kind !== "whatsapp").length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={openUpload}>
            <Upload className="mr-1.5 h-4 w-4" />
            Enviar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPastaOpen(true)}
          >
            <FolderPlus className="mr-1.5 h-4 w-4" />
            Nova pasta
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/40 shadow-sm">
        <div className="grid md:grid-cols-[240px_minmax(0,1fr)]">
          {/* Pastas — mobile chips */}
          <div className="border-b border-border/70 p-3 md:hidden">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {nodes.map((node) => {
                const active = selected === node.key;
                return (
                  <button
                    key={node.key}
                    type="button"
                    onClick={() => setSelected(node.key)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {node.label}
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px text-[10px]",
                        active
                          ? "bg-primary-foreground/20"
                          : "bg-background/60"
                      )}
                    >
                      {node.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pastas — desktop sidebar */}
          <nav className="hidden border-r border-border/70 bg-muted/15 p-3 md:block">
            <div className="space-y-4">
              {groups.map((group) => {
                const items = nodes.filter((n) => group.kinds.includes(n.kind));
                if (!items.length) return null;
                return (
                  <div key={group.title} className="space-y-1">
                    <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                      {group.title}
                    </p>
                    {items.map((node) => {
                      const active = selected === node.key;
                      return (
                        <button
                          key={node.key}
                          type="button"
                          title={node.label}
                          onClick={() => setSelected(node.key)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                            active
                              ? "bg-primary/12 font-medium text-foreground ring-1 ring-primary/20"
                              : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                          )}
                        >
                          {pastaIcon(node.kind, active)}
                          <span className="min-w-0 flex-1 truncate">
                            {node.label}
                          </span>
                          <Badge
                            variant="secondary"
                            className="h-5 min-w-5 justify-center px-1.5 text-[10px] tabular-nums"
                          >
                            {node.count}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </nav>

          {/* Conteúdo */}
          <div className="min-w-0 p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {selectedNode
                    ? pastaIcon(selectedNode.kind, true)
                    : null}
                  <h3 className="truncate text-sm font-semibold">
                    {selectedNode?.label ?? "Pasta"}
                  </h3>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {selected === WHATSAPP_KEY
                    ? "Mídias do WhatsApp ainda sem pasta"
                    : `${docsDaPasta.length} item${docsDaPasta.length === 1 ? "" : "s"}`}
                </p>
              </div>
              {selected !== WHATSAPP_KEY ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={openUpload}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Nesta pasta
                </Button>
              ) : null}
            </div>

            {selected === WHATSAPP_KEY ? (
              midiasChat.length === 0 ? (
                <EmptyPasta onUpload={openUpload} />
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {midiasChat.map((midia) => (
                    <MidiaTile key={midia.id} midia={midia} />
                  ))}
                </div>
              )
            ) : docsDaPasta.length === 0 ? (
              <EmptyPasta onUpload={openUpload} />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {docsDaPasta.map((doc) => (
                  <DocTile key={doc.id} doc={doc} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open) {
            setArquivos([]);
            setProgresso(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar arquivos</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Destino</Label>
              <Select value={destino} onValueChange={(v) => v && setDestino(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {destinosUpload.map((n) => (
                    <SelectItem key={n.key} value={n.key}>
                      {n.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Arquivos</Label>
              <Input
                type="file"
                multiple
                onChange={(e) =>
                  setArquivos(Array.from(e.target.files ?? []))
                }
              />
              {arquivos.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {arquivos.length} arquivo{arquivos.length === 1 ? "" : "s"}{" "}
                  selecionado{arquivos.length === 1 ? "" : "s"}
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={enviarArquivo} disabled={loading}>
              {loading
                ? `Enviando${progresso ? ` ${progresso}` : "…"}`
                : arquivos.length > 1
                  ? `Enviar ${arquivos.length}`
                  : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pastaOpen} onOpenChange={setPastaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova pasta</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="nome-pasta">Nome</Label>
            <Input
              id="nome-pasta"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder="Ex.: RG, comprovantes, laudos"
            />
          </div>
          <DialogFooter>
            <Button type="button" onClick={criarPasta} disabled={loading}>
              {loading ? "Criando…" : "Criar e enviar arquivo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
