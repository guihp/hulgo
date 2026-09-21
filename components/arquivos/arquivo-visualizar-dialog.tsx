"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  FileText,
  ImageIcon,
  Mic,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  resolveMediaDisplayKind,
  type MediaDisplayKind,
} from "@/lib/utils/messages";

export type ArquivoVisualizarItem = {
  url: string;
  label?: string;
  mensageType?: string | null;
};

type PreviewMode = "image" | "pdf" | "video" | "audio" | null;

function filenameFromUrl(url: string, fallback: string): string {
  try {
    const base = new URL(url).pathname.split("/").pop();
    if (base) return decodeURIComponent(base);
  } catch {
    /* ignore */
  }
  return fallback;
}

function previewMode(kind: MediaDisplayKind, url: string): PreviewMode {
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  if (kind === "audio") return "audio";
  if (/\.pdf(\?|$)/i.test(url)) return "pdf";
  return null;
}

function kindIcon(kind: MediaDisplayKind) {
  if (kind === "image") return ImageIcon;
  if (kind === "audio") return Mic;
  if (kind === "video") return Video;
  return FileText;
}

function triggerDownload(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

async function downloadAll(arquivos: ArquivoVisualizarItem[]) {
  for (let i = 0; i < arquivos.length; i++) {
    const item = arquivos[i];
    const label = item.label ?? `arquivo-${i + 1}`;
    triggerDownload(item.url, filenameFromUrl(item.url, label));
    if (i < arquivos.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
}

function ArquivoPreview({
  url,
  mensageType,
}: {
  url: string;
  mensageType?: string | null;
}) {
  const kind = resolveMediaDisplayKind(mensageType, url);
  const mode = previewMode(kind, url);

  if (mode === "image") {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-lg border bg-muted/30 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Visualização do documento"
          className="max-h-[min(60vh,520px)] max-w-full rounded-md object-contain"
        />
      </div>
    );
  }

  if (mode === "pdf") {
    return (
      <iframe
        src={url}
        title="Visualização PDF"
        className="h-[min(60vh,520px)] w-full rounded-lg border bg-muted/20"
      />
    );
  }

  if (mode === "video") {
    return (
      <div className="rounded-lg border bg-muted/30 p-2">
        <video
          controls
          src={url}
          className="max-h-[min(60vh,520px)] w-full rounded-md"
          preload="metadata"
        />
      </div>
    );
  }

  if (mode === "audio") {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-3 rounded-lg border bg-muted/30 p-6">
        <Mic className="h-8 w-8 text-muted-foreground" />
        <audio controls src={url} className="w-full max-w-md" preload="metadata" />
      </div>
    );
  }

  const Icon = kindIcon(kind);
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/20 p-8 text-center">
      <Icon className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Visualização não disponível para este tipo de arquivo.
      </p>
      <p className="text-xs text-muted-foreground">Use o botão Baixar abaixo.</p>
    </div>
  );
}

export function ArquivoVisualizarDialog({
  open,
  onOpenChange,
  title,
  description,
  arquivos,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | null;
  arquivos: ArquivoVisualizarItem[];
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items = useMemo(
    () => arquivos.filter((a) => a.url?.trim()),
    [arquivos]
  );

  useEffect(() => {
    if (!open) {
      setSelectedIndex(0);
      return;
    }
    if (selectedIndex >= items.length) {
      setSelectedIndex(0);
    }
  }, [open, items.length, selectedIndex]);

  const selected = items[selectedIndex] ?? items[0];
  const isBundle = items.length > 1;

  if (!items.length) return null;

  const selectedLabel =
    selected.label ?? filenameFromUrl(selected.url, `arquivo-${selectedIndex + 1}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,820px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-4 py-4 pr-12">
          <DialogTitle className="truncate">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="line-clamp-2">{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <div
          className={cn(
            "grid min-h-0 flex-1",
            isBundle ? "md:grid-cols-[220px_minmax(0,1fr)]" : "grid-cols-1"
          )}
        >
          {isBundle ? (
            <ScrollArea className="border-b md:border-b-0 md:border-r">
              <ul className="p-2">
                {items.map((item, index) => {
                  const kind = resolveMediaDisplayKind(item.mensageType, item.url);
                  const Icon = kindIcon(kind);
                  const label =
                    item.label ?? filenameFromUrl(item.url, `Arquivo ${index + 1}`);
                  return (
                    <li key={`${item.url}-${index}`}>
                      <button
                        type="button"
                        onClick={() => setSelectedIndex(index)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                          index === selectedIndex
                            ? "bg-primary/10 text-foreground"
                            : "text-muted-foreground hover:bg-muted"
                        )}
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="line-clamp-3 min-w-0">{label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          ) : null}

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 p-4">
              {isBundle ? (
                <p className="text-xs font-medium text-muted-foreground">{selectedLabel}</p>
              ) : null}
              {selected ? (
                <ArquivoPreview
                  url={selected.url}
                  mensageType={selected.mensageType}
                />
              ) : null}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                triggerDownload(
                  selected.url,
                  filenameFromUrl(selected.url, selectedLabel)
                )
              }
            >
              <Download className="mr-1.5 h-4 w-4" />
              Baixar{isBundle ? " selecionado" : ""}
            </Button>
            {isBundle ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => downloadAll(items)}
              >
                <Download className="mr-1.5 h-4 w-4" />
                Baixar todos ({items.length})
              </Button>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
