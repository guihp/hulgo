"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Contact,
  FileText,
  ImageIcon,
  Loader2,
  MapPin,
  Mic,
  Navigation,
  Plus,
  Search,
  Send,
  Smile,
  Square,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  enviarMensagem,
  prepararUploadMidia,
  type EnviarMensagemResult,
  type EvoGoMediaType,
} from "@/lib/actions/mensagens";
import {
  buscarContatosPlataforma,
  buscarEndereco,
  enderecoDaPosicao,
  type ContatoPlataforma,
  type EnderecoEncontrado,
} from "@/lib/actions/envio-extras";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toastErroAcao } from "@/lib/client/erros";
import { formatPhone } from "@/lib/utils/phone";
import { cn } from "@/lib/utils";

type ChatComposerProps = {
  phone: string;
  contactNorm: string;
  instancia?: string;
  onSent?: (mensagem: Tables<"mensagens">, iaPausada?: boolean) => void;
  /** Mensagem provisória (id negativo) mostrada enquanto o envio não termina. */
  onPending?: (mensagem: Tables<"mensagens">) => void;
  /** Tira a provisória (enviou ou falhou). */
  onSettled?: (pendingId: number) => void;
};

const QUICK_ACTIONS = [
  {
    label: "Pedir documentos",
    text: "Olá! Poderia me enviar os documentos pendentes, por favor?",
  },
  {
    label: "Confirmar dados",
    text: "Poderia confirmar se seus dados cadastrais estão corretos?",
  },
  {
    label: "Explicar próximo passo",
    text: "Vou te explicar o próximo passo do seu atendimento.",
  },
] as const;

const EMOJIS = [
  "😀", "😊", "🙂", "😉", "😅", "😂", "🥰", "😍",
  "🤗", "🤔", "😐", "😕", "😢", "😮", "🙏", "👏",
  "👍", "👎", "👌", "✌️", "🤝", "💪", "👋", "🙌",
  "✅", "❌", "⚠️", "❗", "❓", "📌", "📎", "📄",
  "📝", "📅", "⏰", "📞", "📍", "🏠", "⚖️", "💼",
  "💰", "🎉", "❤️", "💙", "⭐", "🔔", "➡️", "⬇️",
];

/** Limite do armazenamento de mídias (o WhatsApp também recusa arquivos muito grandes). */
const MAX_ARQUIVO_BYTES = 50 * 1024 * 1024;

const ACCEPT_ARQUIVOS =
  "image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.odt,.ods";

let proximoPendente = -1;
let proximoArquivo = 1;

/** Formatos que o navegador grava, do preferido ao último recurso (o WhatsApp recebe como áudio de voz). */
const AUDIO_MIMES = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function extensaoAudio(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  return "webm";
}

function formatarDuracao(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Print colado vem como "image.png": dá um nome que diga o que é. */
function nomearColado(file: File, indice: number): File {
  const generico = !file.name || /^image\.\w+$/i.test(file.name);
  if (!generico) return file;
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const d = new Date();
  const dois = (n: number) => String(n).padStart(2, "0");
  const carimbo = `${d.getFullYear()}${dois(d.getMonth() + 1)}${dois(d.getDate())}-${dois(d.getHours())}${dois(d.getMinutes())}${dois(d.getSeconds())}`;
  const sufixo = indice ? `-${indice + 1}` : "";
  return new File([file], `print-${carimbo}${sufixo}.${ext}`, { type: file.type || "image/png" });
}

function inferMediaType(mimeType: string, fileName: string): EvoGoMediaType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext && ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  if (ext && ["mp3", "ogg", "wav", "m4a", "opus"].includes(ext)) return "audio";
  if (ext && ["mp4", "mov", "webm"].includes(ext)) return "video";
  return "document";
}

/** Sobe o arquivo direto do navegador para o storage (não passa pelo servidor). */
async function subirArquivo(contactNorm: string, file: File): Promise<string> {
  const { path, token } = await prepararUploadMidia({
    contactNorm,
    fileName: file.name,
    tamanho: file.size,
  });
  const bucket = createClient().storage.from("mensagens-media");
  let { error } = await bucket.uploadToSignedUrl(path, token, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (error && /mime/i.test(error.message)) {
    // Tipo fora da lista do storage (ex.: video/3gpp): sobe como binário.
    ({ error } = await bucket.uploadToSignedUrl(path, token, file, {
      contentType: "application/octet-stream",
    }));
  }
  if (error) throw new Error(`Falha ao subir o arquivo: ${error.message}`);
  return path;
}

type ArquivoSelecionado = { id: number; file: File; preview: string | null };

export function ChatComposer({
  phone,
  contactNorm,
  instancia,
  onSent,
  onPending,
  onSettled,
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  const [arquivos, setArquivos] = useState<ArquivoSelecionado[]>([]);
  const [mediaCaption, setMediaCaption] = useState("");
  const [mediaDialogOpen, setMediaDialogOpen] = useState(false);

  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [buscaEndereco, setBuscaEndereco] = useState("");
  const [enderecos, setEnderecos] = useState<EnderecoEncontrado[]>([]);
  const [buscandoEndereco, setBuscandoEndereco] = useState(false);
  const [localEscolhido, setLocalEscolhido] = useState<EnderecoEncontrado | null>(null);

  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [buscaContato, setBuscaContato] = useState("");
  const [contatos, setContatos] = useState<ContatoPlataforma[]>([]);
  const [buscandoContatos, setBuscandoContatos] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const [gravando, setGravando] = useState(false);
  const [segundosGravados, setSegundosGravados] = useState(0);

  const mediaInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const descartarGravacao = useRef(false);

  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => setSegundosGravados((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [gravando]);

  // Trocar de conversa ou sair da página com gravação aberta: descarta.
  useEffect(
    () => () => {
      descartarGravacao.current = true;
      recorderRef.current?.stop();
    },
    []
  );

  const handleResult = useCallback(
    (result: EnviarMensagemResult, successLabel: string) => {
      if (result.warning) toast.warning(result.warning);
      else toast.success(successLabel);
      if (result.mensagem) onSent?.(result.mensagem, result.iaPausada);
    },
    [onSent]
  );

  const runSend = useCallback(
    async (fn: () => Promise<void>) => {
      if (sending) return;
      setSending(true);
      try {
        await fn();
      } catch (err) {
        toastErroAcao(err, "Falha ao enviar mensagem");
      } finally {
        setSending(false);
      }
    },
    [sending]
  );

  /** Mostra a mensagem na conversa na hora; o envio de verdade segue por trás. */
  const criarPendente = useCallback(
    (parcial: Pick<Tables<"mensagens">, "mensage_type" | "text" | "conteudo_media">) => {
      const id = proximoPendente--;
      onPending?.({
        id,
        contact_norm: contactNorm,
        phone,
        instancia: instancia ?? null,
        created_at: new Date().toISOString(),
        type: "bot",
        plataforma: "whatsapp",
        session_id: null,
        mensagem_id: null,
        ia_conteudo: null,
        ...parcial,
      });
      return id;
    },
    [contactNorm, instancia, onPending, phone]
  );

  const handleSendText = useCallback(async () => {
    const body = text.trim();
    if (!body) return;

    setText("");
    const pendingId = criarPendente({ mensage_type: "text", text: body, conteudo_media: null });
    try {
      const result = await enviarMensagem({
        phone,
        contactNorm,
        instancia,
        kind: "text",
        text: body,
      });
      if (result.warning) toast.warning(result.warning);
      if (result.mensagem) onSent?.(result.mensagem, result.iaPausada);
    } catch (err) {
      // Devolve o texto para não perder o que foi escrito.
      setText((atual) => (atual.trim() ? atual : body));
      toastErroAcao(err, "Falha ao enviar mensagem");
    } finally {
      onSettled?.(pendingId);
    }
  }, [contactNorm, criarPendente, instancia, onSent, onSettled, phone, text]);

  /**
   * Fotos, vídeos, documentos e áudios: todos aparecem na conversa na hora e
   * saem um de cada vez, na ordem escolhida. A legenda vai com o primeiro.
   */
  const enviarArquivos = useCallback(
    async (files: File[], caption?: string) => {
      const fila = files.map((file, i) => {
        const mediaType = inferMediaType(file.type, file.name);
        const localUrl = mediaType === "document" ? null : URL.createObjectURL(file);
        const legenda = i === 0 ? caption : undefined;
        const pendingId = criarPendente({
          mensage_type: mediaType,
          text: legenda || null,
          conteudo_media: localUrl,
        });
        return { file, mediaType, localUrl, legenda, pendingId };
      });
      for (const item of fila) {
        try {
          const storagePath = await subirArquivo(contactNorm, item.file);
          const result = await enviarMensagem({
            phone,
            contactNorm,
            instancia,
            kind: "media",
            storagePath,
            fileName: item.file.name,
            mimeType: item.file.type || "application/octet-stream",
            mediaType: item.mediaType,
            caption: item.legenda,
          });
          if (result.warning) toast.warning(result.warning);
          if (result.mensagem) onSent?.(result.mensagem, result.iaPausada);
        } catch (err) {
          toastErroAcao(
            err,
            item.mediaType === "audio"
              ? "Falha ao enviar o áudio"
              : `Falha ao enviar ${item.file.name}`
          );
        } finally {
          onSettled?.(item.pendingId);
          if (item.localUrl) URL.revokeObjectURL(item.localUrl);
        }
      }
    },
    [contactNorm, criarPendente, instancia, onSent, onSettled, phone]
  );

  const adicionarArquivos = useCallback((files: File[], legendaInicial?: string) => {
    const grandes = files.filter((f) => f.size > MAX_ARQUIVO_BYTES);
    if (grandes.length) {
      toast.error(
        `${grandes.map((f) => f.name).join(", ")}: maior que 50 MB. Mande um arquivo menor.`
      );
    }
    const novos = files
      .filter((f) => f.size <= MAX_ARQUIVO_BYTES)
      .map((file) => ({
        id: proximoArquivo++,
        file,
        preview:
          file.type.startsWith("image/") || file.type.startsWith("video/")
            ? URL.createObjectURL(file)
            : null,
      }));
    if (!novos.length) return;
    setArquivos((atuais) => [...atuais, ...novos]);
    if (legendaInicial) setMediaCaption((c) => c || legendaInicial);
    setMediaDialogOpen(true);
  }, []);

  const removerArquivo = (id: number) => {
    setArquivos((atuais) => {
      const alvo = atuais.find((a) => a.id === id);
      if (alvo?.preview) URL.revokeObjectURL(alvo.preview);
      return atuais.filter((a) => a.id !== id);
    });
  };

  const limparArquivos = () => {
    arquivos.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
    setArquivos([]);
    setMediaCaption("");
  };

  const handleSendMedia = () => {
    if (!arquivos.length) return;
    const caption = mediaCaption.trim() || undefined;
    // Legenda veio do texto que estava digitado: não fica repetido no campo.
    if (caption && caption === text.trim()) setText("");
    void enviarArquivos(
      arquivos.map((a) => a.file),
      caption
    );
    limparArquivos();
    setMediaDialogOpen(false);
    textareaRef.current?.focus();
  };

  const iniciarGravacao = async () => {
    if (gravando) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Este navegador não grava áudio. Envie um arquivo de áudio pelo +.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Sem acesso ao microfone. Libere o microfone para este site no navegador.");
      return;
    }
    const mimeType = AUDIO_MIMES.find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const partes: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) partes.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      setGravando(false);
      if (descartarGravacao.current || partes.length === 0) return;
      const tipo = recorder.mimeType || mimeType || "audio/webm";
      const file = new File(partes, `audio-${Date.now()}.${extensaoAudio(tipo)}`, {
        type: tipo.split(";")[0],
      });
      void enviarArquivos([file]);
    };
    descartarGravacao.current = false;
    recorderRef.current = recorder;
    setSegundosGravados(0);
    setGravando(true);
    recorder.start(250);
  };

  const pararGravacao = (descartar: boolean) => {
    descartarGravacao.current = descartar;
    recorderRef.current?.stop();
  };

  /** Ctrl+V de prints (ou arquivos copiados) abre a tela de envio com a prévia. */
  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (!files.length) return;
    e.preventDefault();
    adicionarArquivos(
      files.map((f, i) => nomearColado(f, i)),
      text.trim() || undefined
    );
  };

  const handleDrop = (e: React.DragEvent) => {
    setArrastando(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    e.preventDefault();
    adicionarArquivos(files);
  };

  const handleTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendText();
    }
  };

  const handleMediaFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) adicionarArquivos(files);
  };

  const inserirEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const inicio = el?.selectionStart ?? text.length;
    const fim = el?.selectionEnd ?? text.length;
    setText((t) => t.slice(0, inicio) + emoji + t.slice(fim));
    requestAnimationFrame(() => {
      el?.focus();
      const pos = inicio + emoji.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  // ---- Localização ----
  const abrirLocalizacao = () => {
    setBuscaEndereco("");
    setEnderecos([]);
    setLocalEscolhido(null);
    setLocationDialogOpen(true);
  };

  const handleBuscarEndereco = async () => {
    const q = buscaEndereco.trim();
    if (q.length < 3) {
      toast.error("Digite o endereço, o nome do lugar ou o CEP");
      return;
    }
    setBuscandoEndereco(true);
    try {
      const lista = await buscarEndereco(q);
      setEnderecos(lista);
      if (!lista.length) toast.info("Nada encontrado. Tente com rua, número e cidade.");
    } catch (err) {
      toastErroAcao(err, "Falha ao buscar o endereço");
    } finally {
      setBuscandoEndereco(false);
    }
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Localização não disponível neste navegador");
      return;
    }
    setBuscandoEndereco(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const achado = await enderecoDaPosicao(latitude, longitude).catch(() => null);
        setLocalEscolhido(
          achado ?? { nome: "Minha localização", endereco: "", latitude, longitude }
        );
        setEnderecos([]);
        setBuscandoEndereco(false);
      },
      () => {
        setBuscandoEndereco(false);
        toast.error("Não foi possível obter a localização. Libere a localização no navegador.");
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleSendLocation = async () => {
    if (!localEscolhido) {
      toast.error("Escolha um endereço da lista ou use sua localização atual");
      return;
    }
    await runSend(async () => {
      const result = await enviarMensagem({
        phone,
        contactNorm,
        instancia,
        kind: "location",
        latitude: localEscolhido.latitude,
        longitude: localEscolhido.longitude,
        name: localEscolhido.nome.trim() || undefined,
        address: localEscolhido.endereco.trim() || undefined,
      });
      handleResult(result, "Localização enviada");
      setLocationDialogOpen(false);
    });
  };

  // ---- Contato ----
  useEffect(() => {
    if (!contactDialogOpen) return;
    let cancelado = false;
    const t = setTimeout(() => {
      setBuscandoContatos(true);
      buscarContatosPlataforma(buscaContato)
        .then((lista) => {
          if (!cancelado) setContatos(lista);
        })
        .catch(() => {
          if (!cancelado) setContatos([]);
        })
        .finally(() => {
          if (!cancelado) setBuscandoContatos(false);
        });
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [buscaContato, contactDialogOpen]);

  const abrirContato = () => {
    setBuscaContato("");
    setContactName("");
    setContactPhone("");
    setContactDialogOpen(true);
  };

  const handleSendContact = async () => {
    if (!contactName.trim() || !contactPhone.trim()) {
      toast.error("Escolha um contato da lista ou preencha nome e telefone");
      return;
    }

    await runSend(async () => {
      const result = await enviarMensagem({
        phone,
        contactNorm,
        instancia,
        kind: "contact",
        fullName: contactName.trim(),
        contactPhone: contactPhone.trim(),
      });
      handleResult(result, "Contato enviado");
      setContactDialogOpen(false);
    });
  };

  const telefoneEscolhido = contactPhone.replace(/\D/g, "");

  const resumoArquivos = useMemo(() => {
    const total = arquivos.reduce((s, a) => s + a.file.size, 0);
    return `${arquivos.length} ${arquivos.length === 1 ? "arquivo" : "arquivos"} · ${formatarTamanho(total)}`;
  }, [arquivos]);

  return (
    <>
      <div
        className={cn(
          "relative border-t border-[#e2e8f0] bg-white px-3 py-3",
          arrastando && "ring-2 ring-inset ring-[#0b2148]/30"
        )}
        onPaste={handlePaste}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={handleDrop}
      >
        {arrastando ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/85 text-sm font-medium text-[#0b2148]">
            Solte aqui para enviar
          </div>
        ) : null}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={gravando}
              onClick={() => setText(action.text)}
              className="rounded-full border border-[#e2e8f0] bg-[#F8FAFC] px-3 py-1 text-xs font-medium text-[#0b2148] transition hover:border-[#0b2148]/30 hover:bg-[#0b2148]/5 disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={gravando}
                  aria-label="Anexar"
                  className="size-10 shrink-0 border-[#e2e8f0] text-[#0b2148] hover:bg-[#F1F5F9]"
                />
              }
            >
              <span className="text-lg font-medium leading-none">+</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onClick={() => mediaInputRef.current?.click()}>
                <ImageIcon className="h-4 w-4" />
                Fotos e vídeos
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => mediaInputRef.current?.click()}>
                <FileText className="h-4 w-4" />
                Documentos ou áudios
              </DropdownMenuItem>
              <DropdownMenuItem onClick={abrirLocalizacao}>
                <MapPin className="h-4 w-4" />
                Localização
              </DropdownMenuItem>
              <DropdownMenuItem onClick={abrirContato}>
                <Contact className="h-4 w-4" />
                Contato
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <input
            ref={mediaInputRef}
            type="file"
            multiple
            className="hidden"
            accept={ACCEPT_ARQUIVOS}
            onChange={handleMediaFileChange}
          />

          {gravando ? (
            <>
              <div className="flex h-10 flex-1 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm text-red-700">
                <span className="size-2.5 animate-pulse rounded-full bg-red-600" />
                Gravando {formatarDuracao(segundosGravados)}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => pararGravacao(true)}
                aria-label="Descartar áudio"
                className="size-10 shrink-0 border-[#e2e8f0] text-[#64748B] hover:bg-[#F1F5F9]"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                onClick={() => pararGravacao(false)}
                className="h-10 shrink-0 gap-1.5 bg-[#0b2148] px-4 text-white hover:bg-[#163a7a]"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                Enviar áudio
              </Button>
            </>
          ) : (
            <>
              <div className="relative flex-1">
                <Textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleTextKeyDown}
                  placeholder="Escreva uma mensagem ou cole um print..."
                  rows={1}
                  className="max-h-32 min-h-10 resize-none border-[#e2e8f0] bg-white py-2.5 pr-10 text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12"
                />
                <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                  <PopoverTrigger
                    aria-label="Emojis"
                    title="Emojis"
                    className="absolute bottom-1.5 right-1.5 flex size-7 items-center justify-center rounded-md text-[#64748B] transition hover:bg-[#F1F5F9] hover:text-[#0b2148]"
                  >
                    <Smile className="h-4 w-4" />
                  </PopoverTrigger>
                  <PopoverContent align="end" side="top" className="w-72 p-2">
                    <div className="grid grid-cols-8 gap-0.5">
                      {EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => inserirEmoji(emoji)}
                          className="flex size-8 items-center justify-center rounded-md text-lg transition hover:bg-[#F1F5F9]"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {text.trim() ? (
                <Button
                  type="button"
                  onClick={() => void handleSendText()}
                  className="h-10 shrink-0 gap-1.5 bg-[#0b2148] px-4 text-white hover:bg-[#163a7a]"
                >
                  <Send className="h-4 w-4" />
                  Enviar
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => void iniciarGravacao()}
                  aria-label="Gravar áudio"
                  title="Gravar áudio"
                  className="size-10 shrink-0 bg-[#0b2148] p-0 text-white hover:bg-[#163a7a]"
                >
                  <Mic className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
        </div>
        <p className="mt-2 text-[11px] text-[#94a3b8]">
          Ao enviar, o agente pausa nesta conversa e você assume o atendimento.
        </p>
      </div>

      <Dialog
        open={mediaDialogOpen}
        onOpenChange={(open) => {
          setMediaDialogOpen(open);
          if (!open) limparArquivos();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar arquivos</DialogTitle>
            <DialogDescription>{resumoArquivos}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {arquivos.map((a) => (
                <div
                  key={a.id}
                  className="relative aspect-square overflow-hidden rounded-lg border border-[#e2e8f0] bg-[#F8FAFC]"
                >
                  {a.preview && a.file.type.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.preview} alt={a.file.name} className="size-full object-cover" />
                  ) : a.preview ? (
                    <div className="relative size-full">
                      <video src={a.preview} muted className="size-full object-cover" />
                      <Video className="absolute left-1.5 top-1.5 h-4 w-4 text-white drop-shadow" />
                    </div>
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center">
                      {a.file.type.startsWith("audio/") ? (
                        <Mic className="h-6 w-6 text-[#64748B]" />
                      ) : (
                        <FileText className="h-6 w-6 text-[#64748B]" />
                      )}
                      <span className="line-clamp-2 break-all text-[10px] text-[#64748B]">
                        {a.file.name}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removerArquivo(a.id)}
                    aria-label={`Tirar ${a.file.name}`}
                    className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/75"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => mediaInputRef.current?.click()}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#cbd5e1] text-xs text-[#64748B] transition hover:border-[#0b2148]/40 hover:text-[#0b2148]"
              >
                <Plus className="h-5 w-5" />
                Adicionar
              </button>
            </div>
            <div className="space-y-1">
              <Label htmlFor="media-caption">
                Legenda (opcional{arquivos.length > 1 ? ", vai junto com o primeiro" : ""})
              </Label>
              <Input
                id="media-caption"
                value={mediaCaption}
                onChange={(e) => setMediaCaption(e.target.value)}
                placeholder="Legenda"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSendMedia();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMediaDialogOpen(false);
                limparArquivos();
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleSendMedia} disabled={!arquivos.length}>
              <Send className="h-4 w-4" />
              {arquivos.length > 1 ? `Enviar ${arquivos.length} arquivos` : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar localização</DialogTitle>
            <DialogDescription>
              Busque pelo endereço, nome do lugar ou CEP, ou use a sua localização atual.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={buscaEndereco}
                onChange={(e) => setBuscaEndereco(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleBuscarEndereco();
                  }
                }}
                placeholder="Ex.: Rua Barão de Jaguara 1000, Campinas"
                disabled={sending}
                autoFocus
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleBuscarEndereco()}
                disabled={sending || buscandoEndereco}
                aria-label="Buscar endereço"
              >
                {buscandoEndereco ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleUseCurrentLocation}
              disabled={sending || buscandoEndereco}
            >
              <Navigation className="h-4 w-4" />
              Usar minha localização atual
            </Button>

            {enderecos.length > 0 && (
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {enderecos.map((e) => (
                  <li key={`${e.latitude},${e.longitude}`}>
                    <button
                      type="button"
                      onClick={() => setLocalEscolhido(e)}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-[#F8FAFC]",
                        localEscolhido?.latitude === e.latitude &&
                          localEscolhido?.longitude === e.longitude
                          ? "border-[#0b2148] bg-[#0b2148]/5"
                          : "border-[#e2e8f0]"
                      )}
                    >
                      <span className="block font-medium text-[#0b2148]">{e.nome}</span>
                      <span className="line-clamp-2 text-xs text-[#64748B]">{e.endereco}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {localEscolhido && (
              <div className="space-y-2 rounded-lg border border-[#0b2148]/20 bg-[#0b2148]/5 p-3">
                <div className="space-y-1">
                  <Label htmlFor="loc-name">Nome que vai aparecer</Label>
                  <Input
                    id="loc-name"
                    value={localEscolhido.nome}
                    onChange={(e) =>
                      setLocalEscolhido((l) => (l ? { ...l, nome: e.target.value } : l))
                    }
                    disabled={sending}
                  />
                </div>
                {localEscolhido.endereco ? (
                  <p className="flex gap-1.5 text-xs text-[#64748B]">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {localEscolhido.endereco}
                  </p>
                ) : null}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLocationDialogOpen(false)}
              disabled={sending}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void handleSendLocation()}
              disabled={sending || !localEscolhido}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar contato</DialogTitle>
            <DialogDescription>
              Escolha um cliente ou parceiro já cadastrado, ou digite outro contato.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
              <Input
                value={buscaContato}
                onChange={(e) => setBuscaContato(e.target.value)}
                placeholder="Buscar por nome ou telefone"
                className="pl-8"
                autoFocus
              />
            </div>
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {buscandoContatos && !contatos.length ? (
                <li className="flex items-center gap-2 px-1 py-2 text-sm text-[#64748B]">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
                </li>
              ) : null}
              {!buscandoContatos && !contatos.length ? (
                <li className="px-1 py-2 text-sm text-[#94a3b8]">Nenhum contato encontrado.</li>
              ) : null}
              {contatos.map((c) => (
                <li key={`${c.origem}-${c.telefone}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setContactName(c.nome);
                      setContactPhone(c.telefone);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-[#F8FAFC]",
                      telefoneEscolhido === c.telefone
                        ? "border-[#0b2148] bg-[#0b2148]/5"
                        : "border-[#e2e8f0]"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[#0b2148]">{c.nome}</span>
                      <span className="block truncate text-xs text-[#64748B]">
                        {formatPhone(c.telefone)}
                        {c.detalhe ? ` · ${c.detalhe}` : ""}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        c.origem === "parceiro"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-[#0b2148]/8 text-[#0b2148]"
                      )}
                    >
                      {c.origem === "parceiro" ? "Parceiro" : "Cliente"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-2 border-t border-[#e2e8f0] pt-3">
              <div className="space-y-1">
                <Label htmlFor="contact-name">Nome</Label>
                <Input
                  id="contact-name"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  disabled={sending}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="contact-phone">Telefone</Label>
                <Input
                  id="contact-phone"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="(19) 99999-9999"
                  disabled={sending}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setContactDialogOpen(false)}
              disabled={sending}
            >
              Cancelar
            </Button>
            <Button onClick={() => void handleSendContact()} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
