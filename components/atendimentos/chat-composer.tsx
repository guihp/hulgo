"use client";

import { useCallback, useRef, useState } from "react";
import {
  Contact,
  FileText,
  ImageIcon,
  Loader2,
  MapPin,
  Send,
  Smile,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { enviarMensagem, type EnviarMensagemResult, type EvoGoMediaType } from "@/lib/actions/mensagens";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toastErroAcao } from "@/lib/client/erros";
type ChatComposerProps = {
  phone: string;
  contactNorm: string;
  instancia?: string;
  onSent?: (mensagem: Tables<"mensagens">, iaPausada?: boolean) => void;
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Falha ao ler arquivo"));
        return;
      }
      const base64 = result.includes(",") ? result.split(",")[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
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

export function ChatComposer({
  phone,
  contactNorm,
  instancia,
  onSent,
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [mediaCaption, setMediaCaption] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaDialogOpen, setMediaDialogOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [stickerDialogOpen, setStickerDialogOpen] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [stickerUrl, setStickerUrl] = useState("");
  const [stickerFile, setStickerFile] = useState<File | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactOrg, setContactOrg] = useState("");

  const mediaInputRef = useRef<HTMLInputElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);

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

  const handleSendText = useCallback(async () => {
    const body = text.trim();
    if (!body) return;

    await runSend(async () => {
      const result = await enviarMensagem({
        phone,
        contactNorm,
        instancia,
        kind: "text",
        text: body,
      });
      handleResult(result, "Mensagem enviada");
      setText("");
    });
  }, [contactNorm, handleResult, instancia, phone, runSend, text]);

  const handleTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendText();
    }
  };

  const handleMediaFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMediaFile(file);
    setMediaCaption("");
    setMediaDialogOpen(true);
    e.target.value = "";
  };

  const handleSendMedia = async () => {
    if (!mediaFile) return;

    await runSend(async () => {
      const fileBase64 = await fileToBase64(mediaFile);
      const result = await enviarMensagem({
        phone,
        contactNorm,
        instancia,
        kind: "media",
        fileBase64,
        fileName: mediaFile.name,
        mimeType: mediaFile.type || "application/octet-stream",
        mediaType: inferMediaType(mediaFile.type, mediaFile.name),
        caption: mediaCaption.trim() || undefined,
      });
      handleResult(result, "Mídia enviada");
      setMediaFile(null);
      setMediaCaption("");
      setMediaDialogOpen(false);
    });
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocalização não disponível neste navegador");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(String(pos.coords.latitude));
        setLongitude(String(pos.coords.longitude));
        toast.success("Localização atual preenchida");
      },
      () => toast.error("Não foi possível obter a localização")
    );
  };

  const handleSendLocation = async () => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast.error("Latitude e longitude inválidas");
      return;
    }

    await runSend(async () => {
      const result = await enviarMensagem({
        phone,
        contactNorm,
        instancia,
        kind: "location",
        latitude: lat,
        longitude: lng,
        name: locationName.trim() || undefined,
        address: locationAddress.trim() || undefined,
      });
      handleResult(result, "Localização enviada");
      setLatitude("");
      setLongitude("");
      setLocationName("");
      setLocationAddress("");
      setLocationDialogOpen(false);
    });
  };

  const handleStickerFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStickerFile(file);
    setStickerUrl("");
    e.target.value = "";
  };

  const handleSendSticker = async () => {
    if (!stickerFile && !stickerUrl.trim()) {
      toast.error("Selecione um arquivo .webp ou informe uma URL");
      return;
    }

    await runSend(async () => {
      const result = stickerFile
        ? await enviarMensagem({
            phone,
            contactNorm,
            instancia,
            kind: "sticker",
            fileBase64: await fileToBase64(stickerFile),
            fileName: stickerFile.name,
          })
        : await enviarMensagem({
            phone,
            contactNorm,
            instancia,
            kind: "sticker",
            stickerUrl: stickerUrl.trim(),
          });
      handleResult(result, "Sticker enviado");
      setStickerFile(null);
      setStickerUrl("");
      setStickerDialogOpen(false);
    });
  };

  const handleSendContact = async () => {
    if (!contactName.trim() || !contactPhone.trim()) {
      toast.error("Nome e telefone são obrigatórios");
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
        organization: contactOrg.trim() || undefined,
      });
      handleResult(result, "Contato enviado");
      setContactName("");
      setContactPhone("");
      setContactOrg("");
      setContactDialogOpen(false);
    });
  };

  return (
    <>
      <div className="border-t border-[#e2e8f0] bg-white px-3 py-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={sending}
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
                  disabled={sending}
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
                Foto ou vídeo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => mediaInputRef.current?.click()}>
                <FileText className="h-4 w-4" />
                Documento ou áudio
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocationDialogOpen(true)}>
                <MapPin className="h-4 w-4" />
                Localização
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStickerDialogOpen(true)}>
                <Smile className="h-4 w-4" />
                Sticker
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setContactDialogOpen(true)}>
                <Contact className="h-4 w-4" />
                Contato
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <input
            ref={mediaInputRef}
            type="file"
            className="hidden"
            accept="image/*,audio/*,video/*,.pdf,.doc,.docx"
            onChange={handleMediaFileChange}
          />
          <input
            ref={stickerInputRef}
            type="file"
            className="hidden"
            accept=".webp,image/webp"
            onChange={handleStickerFileChange}
          />

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleTextKeyDown}
            placeholder="Escreva uma mensagem..."
            disabled={sending}
            rows={1}
            className="max-h-32 min-h-10 flex-1 resize-none border-[#e2e8f0] bg-white py-2.5 text-[#0b2148] placeholder:text-[#94a3b8] focus-visible:border-[#0b2148] focus-visible:ring-[#0b2148]/12"
          />

          <Button
            type="button"
            disabled={sending || !text.trim()}
            onClick={() => void handleSendText()}
            className="h-10 shrink-0 gap-1.5 bg-[#0b2148] px-4 text-white hover:bg-[#163a7a]"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Enviar
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-[#94a3b8]">
          Ao enviar, o agente pausa nesta conversa e você assume o atendimento.
        </p>
      </div>

      <Dialog open={mediaDialogOpen} onOpenChange={setMediaDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar mídia</DialogTitle>
            <DialogDescription>
              {mediaFile?.name ?? "Selecione um arquivo"}
            </DialogDescription>
          </DialogHeader>
          {mediaFile && (
            <div className="space-y-3">
              {mediaFile.type.startsWith("image/") && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={URL.createObjectURL(mediaFile)}
                  alt="Preview"
                  className="max-h-40 rounded-lg object-cover"
                />
              )}
              {mediaFile.type.startsWith("video/") && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Video className="h-4 w-4" />
                  Vídeo selecionado
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="media-caption">Legenda (opcional)</Label>
                <Input
                  id="media-caption"
                  value={mediaCaption}
                  onChange={(e) => setMediaCaption(e.target.value)}
                  placeholder="Legenda"
                  disabled={sending}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMediaDialogOpen(false)}
              disabled={sending}
            >
              Cancelar
            </Button>
            <Button onClick={() => void handleSendMedia()} disabled={sending || !mediaFile}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar localização</DialogTitle>
            <DialogDescription>
              Informe as coordenadas ou use sua localização atual.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="lat">Latitude</Label>
                <Input
                  id="lat"
                  type="number"
                  step="any"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  disabled={sending}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lng">Longitude</Label>
                <Input
                  id="lng"
                  type="number"
                  step="any"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  disabled={sending}
                />
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleUseCurrentLocation}
              disabled={sending}
            >
              <MapPin className="h-4 w-4" />
              Usar localização atual
            </Button>
            <div className="space-y-1">
              <Label htmlFor="loc-name">Nome (opcional)</Label>
              <Input
                id="loc-name"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                disabled={sending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loc-address">Endereço (opcional)</Label>
              <Input
                id="loc-address"
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                disabled={sending}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLocationDialogOpen(false)}
              disabled={sending}
            >
              Cancelar
            </Button>
            <Button onClick={() => void handleSendLocation()} disabled={sending}>
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stickerDialogOpen} onOpenChange={setStickerDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar sticker</DialogTitle>
            <DialogDescription>
              Envie um arquivo .webp ou cole a URL de um sticker.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => stickerInputRef.current?.click()}
              disabled={sending}
            >
              Selecionar .webp
            </Button>
            {stickerFile && (
              <p className="text-sm text-muted-foreground">{stickerFile.name}</p>
            )}
            <div className="space-y-1">
              <Label htmlFor="sticker-url">Ou URL do sticker</Label>
              <Input
                id="sticker-url"
                value={stickerUrl}
                onChange={(e) => {
                  setStickerUrl(e.target.value);
                  if (e.target.value.trim()) setStickerFile(null);
                }}
                placeholder="https://..."
                disabled={sending}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setStickerDialogOpen(false)}
              disabled={sending}
            >
              Cancelar
            </Button>
            <Button onClick={() => void handleSendSticker()} disabled={sending}>
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar contato</DialogTitle>
            <DialogDescription>
              Compartilhe um cartão de contato no WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="contact-name">Nome completo</Label>
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
                placeholder="5511999999999"
                disabled={sending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="contact-org">Organização (opcional)</Label>
              <Input
                id="contact-org"
                value={contactOrg}
                onChange={(e) => setContactOrg(e.target.value)}
                disabled={sending}
              />
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
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
