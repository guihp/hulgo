"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  FileUp,
  PenLine,
  Send,
  Trash2,
} from "lucide-react";
import {
  enviarDocumentoCliente,
  excluirDocumento,
  marcarDocumentoAssinado,
  uploadDocumentoAdvogado,
} from "@/lib/actions/documentos";
import type { AppUser } from "@/lib/actions/auth";
import type { Tables } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

type Documento = Tables<"documentos_cliente">;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function DocsAdvogado({
  casoId,
  documentos,
  user,
}: {
  casoId: number;
  documentos: Documento[];
  user: AppUser;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [requerAssinatura, setRequerAssinatura] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const [envioDoc, setEnvioDoc] = useState<Documento | null>(null);
  const [mensagemEnvio, setMensagemEnvio] = useState("");

  const docs = documentos.filter((d) => d.origem === "advogado");

  async function subir() {
    if (!arquivo) return;
    setLoading(true);
    try {
      const base64 = await fileToBase64(arquivo);
      await uploadDocumentoAdvogado({
        casoId,
        nomeDocumento: nome || arquivo.name.replace(/\.[^.]+$/, ""),
        descricao,
        fileBase64: base64,
        fileName: arquivo.name,
        mimeType: arquivo.type,
        requerAssinatura,
      });
      toast.success("Documento salvo");
      setOpen(false);
      setNome("");
      setDescricao("");
      setRequerAssinatura(false);
      setArquivo(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setLoading(false);
    }
  }

  function abrirEnvio(doc: Documento) {
    setEnvioDoc(doc);
    setMensagemEnvio(
      doc.requer_assinatura
        ? `Olá! Segue o documento "${doc.nome_documento}" do escritório. Por favor, assine, tire uma foto (ou escaneie) e envie de volta por aqui mesmo. 📄✍️`
        : `Olá! Segue o documento "${doc.nome_documento}" do escritório.`
    );
  }

  async function enviar() {
    if (!envioDoc) return;
    setLoading(true);
    try {
      await enviarDocumentoCliente({ docId: envioDoc.id, mensagem: mensagemEnvio });
      toast.success(
        envioDoc.requer_assinatura
          ? "Documento enviado — a IA vai cobrar a devolução assinada"
          : "Documento enviado ao cliente"
      );
      setEnvioDoc(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setLoading(false);
    }
  }

  async function assinar(doc: Documento) {
    try {
      await marcarDocumentoAssinado(doc.id);
      toast.success("Marcado como assinado/recebido");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  }

  async function excluir(doc: Documento) {
    try {
      await excluirDocumento(doc.id);
      toast.success("Documento excluído");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Documentos do escritório</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2")}
          >
            <FileUp className="h-4 w-4" /> Subir documento
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Subir documento do escritório</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Arquivo (PDF ou imagem)</Label>
                <Input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                  onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="space-y-1">
                <Label>Nome do documento</Label>
                <Input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex.: Contrato de honorários"
                />
              </div>
              <div className="space-y-1">
                <Label>Descrição (opcional)</Label>
                <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="requer-assinatura"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={requerAssinatura}
                  onChange={(e) => setRequerAssinatura(e.target.checked)}
                />
                <Label htmlFor="requer-assinatura">
                  Precisa da assinatura do cliente
                </Label>
              </div>
              <Button className="w-full" disabled={loading || !arquivo} onClick={subir}>
                Salvar documento
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum documento do escritório neste caso. Suba contrato, procuração ou
            petição e envie ao cliente pelo WhatsApp.
          </p>
        ) : (
          <ul className="space-y-2">
            {docs.map((doc) => (
              <li key={doc.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{doc.nome_documento}</p>
                  {doc.requer_assinatura &&
                    (doc.assinado_em ? (
                      <Badge className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> assinado
                      </Badge>
                    ) : doc.enviado_cliente_em ? (
                      <Badge variant="destructive" className="gap-1">
                        <PenLine className="h-3 w-3" /> aguardando assinatura
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <PenLine className="h-3 w-3" /> precisa assinar
                      </Badge>
                    ))}
                  {doc.enviado_cliente_em && (
                    <span className="text-xs text-muted-foreground">
                      enviado {formatDateTime(doc.enviado_cliente_em)}
                    </span>
                  )}
                </div>
                {doc.descricao && (
                  <p className="text-xs text-muted-foreground">{doc.descricao}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <a
                    href={doc.url_media}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1")}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Abrir
                  </a>
                  {user.papel === "advogado" && (
                    <>
                      <Button size="sm" className="gap-1" onClick={() => abrirEnvio(doc)}>
                        <Send className="h-3.5 w-3.5" />
                        {doc.enviado_cliente_em ? "Reenviar" : "Enviar ao cliente"}
                      </Button>
                      {doc.requer_assinatura && !doc.assinado_em && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => assinar(doc)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Marcar assinado
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-muted-foreground"
                        onClick={() => excluir(doc)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <Dialog open={envioDoc !== null} onOpenChange={(v) => !v && setEnvioDoc(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Enviar ao cliente pelo WhatsApp</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Documento: <strong>{envioDoc?.nome_documento}</strong>
                {envioDoc?.requer_assinatura &&
                  " — a devolução assinada entra nos documentos faltantes e a IA cobra o cliente."}
              </p>
              <div className="space-y-1">
                <Label>Mensagem que acompanha o documento</Label>
                <Textarea
                  rows={4}
                  value={mensagemEnvio}
                  onChange={(e) => setMensagemEnvio(e.target.value)}
                />
              </div>
              <Button className="w-full gap-2" disabled={loading} onClick={enviar}>
                <Send className="h-4 w-4" /> Enviar agora
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
