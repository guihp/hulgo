"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  FolderOpen,
  ImageIcon,
  Search,
  User,
} from "lucide-react";
import type {
  ClienteArquivosGrupo,
  DocumentoComCaso,
  MidiaChat,
} from "@/lib/data/arquivos";
import { EmptyState } from "@/components/shared/empty-state";
import { CpfDisplay } from "@/components/shared/cpf-display";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LinkButton } from "@/components/ui/link-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { contactInitials } from "@/lib/utils/messages";
import { formatDateTime } from "@/lib/utils/dates";
import { formatPhone } from "@/lib/utils/phone";
import { resolveMediaDisplayKind } from "@/lib/utils/messages";

function mediaIcon(url: string, type: string | null) {
  const kind = resolveMediaDisplayKind(url, type);
  if (kind === "image") return ImageIcon;
  return FileText;
}

function DocumentoCard({ doc }: { doc: DocumentoComCaso }) {
  const Icon = mediaIcon(doc.url_media, null);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-medium">{doc.nome_documento}</p>
              {doc.descricao ? (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                  {doc.descricao}
                </p>
              ) : null}
              <p className="mt-1 text-[10px] text-muted-foreground">
                {formatDateTime(doc.created_at)}
              </p>
              {doc.caso?.beneficio_identificado ? (
                <Badge variant="outline" className="mt-2 text-[10px]">
                  {doc.caso.beneficio_identificado}
                </Badge>
              ) : null}
            </div>
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
      </CardContent>
    </Card>
  );
}

function MidiaChatCard({ midia }: { midia: MidiaChat }) {
  const Icon = mediaIcon(midia.url, midia.mensage_type);
  const kind = resolveMediaDisplayKind(midia.url, midia.mensage_type);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            {kind === "image" ? (
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={midia.url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-medium">Mídia do chat</p>
              <p className="mt-0.5 text-xs text-muted-foreground capitalize">
                {midia.mensage_type ?? "arquivo"}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {formatDateTime(midia.created_at)}
              </p>
            </div>
          </div>
          <a
            href={midia.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-primary underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

export function ArquivosGeralPanel({
  grupos,
}: {
  grupos: ClienteArquivosGrupo[];
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grupos;
    return grupos.filter((g) => {
      const phoneDigits = g.phone.replace(/\D/g, "");
      return (
        (g.displayName?.toLowerCase().includes(q) ?? false) ||
        phoneDigits.includes(q.replace(/\D/g, "")) ||
        g.documentos.some(
          (d) =>
            d.nome_documento.toLowerCase().includes(q) ||
            (d.descricao?.toLowerCase().includes(q) ?? false)
        )
      );
    });
  }, [grupos, search]);

  const totalDocs = grupos.reduce((acc, g) => acc + g.documentos.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou documento..."
            className="pl-9"
          />
        </div>
        <Badge variant="secondary">
          {totalDocs} arquivo{totalDocs === 1 ? "" : "s"} · {grupos.length} cliente
          {grupos.length === 1 ? "" : "s"}
        </Badge>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Nenhum arquivo encontrado"
          description={
            search
              ? "Tente outro termo de busca."
              : "Os documentos enviados pelos clientes no WhatsApp aparecerão aqui quando a IA registrá-los."
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden md:table-cell">Telefone</TableHead>
                  <TableHead>Arquivos</TableHead>
                  <TableHead className="hidden sm:table-cell">Último envio</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((grupo) => (
                  <TableRow key={grupo.contactNorm}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {contactInitials(grupo.phone, grupo.displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {grupo.displayName ?? formatPhone(grupo.phone)}
                          </p>
                          {grupo.documentos[0]?.caso?.cpf ? (
                            <span className="text-xs text-muted-foreground">
                              <CpfDisplay value={grupo.documentos[0].caso.cpf} />
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {formatPhone(grupo.phone)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{grupo.documentos.length}</Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                      {grupo.lastAt ? formatDateTime(grupo.lastAt) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <LinkButton
                        href={`/arquivos/${grupo.contactNorm}`}
                        size="sm"
                        variant="outline"
                      >
                        Ver arquivos
                      </LinkButton>
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

export function ArquivosContatoPanel({
  contactNorm,
  phone,
  displayName,
  documentos,
  midiasChat,
  cpf,
}: {
  contactNorm: string;
  phone: string;
  displayName: string | null;
  documentos: DocumentoComCaso[];
  midiasChat: MidiaChat[];
  cpf: string | null;
}) {
  const [search, setSearch] = useState("");

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return documentos;
    return documentos.filter(
      (d) =>
        d.nome_documento.toLowerCase().includes(q) ||
        (d.descricao?.toLowerCase().includes(q) ?? false)
    );
  }, [documentos, search]);

  const total = documentos.length + midiasChat.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <LinkButton href="/arquivos" variant="ghost" size="icon" aria-label="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </LinkButton>
        <Avatar className="h-11 w-11">
          <AvatarFallback className="bg-primary/10 text-primary">
            {contactInitials(phone, displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold">
            {displayName ?? formatPhone(phone)}
          </h2>
          <p className="text-sm text-muted-foreground">{formatPhone(phone)}</p>
          {cpf ? (
            <span className="text-xs text-muted-foreground">
              <CpfDisplay value={cpf} />
            </span>
          ) : null}
        </div>
        <LinkButton href={`/atendimentos?contact=${encodeURIComponent(contactNorm)}`} variant="outline">
          <User className="mr-2 h-4 w-4" />
          Abrir chat
        </LinkButton>
      </div>

      {total > 0 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar documentos..."
            className="pl-9"
          />
        </div>
      )}

      {total === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Nenhum arquivo deste cliente"
          description="Quando o cliente enviar documentos pelo WhatsApp e a IA registrá-los, eles aparecerão aqui."
        />
      ) : (
        <>
          {filteredDocs.length > 0 && (
            <section className="space-y-3">
              <CardHeader className="px-0 pb-0 pt-0">
                <CardTitle className="text-base">
                  Documentos registrados ({filteredDocs.length})
                </CardTitle>
              </CardHeader>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredDocs.map((doc) => (
                  <DocumentoCard key={doc.id} doc={doc} />
                ))}
              </div>
            </section>
          )}

          {midiasChat.length > 0 && (
            <section className="space-y-3">
              <CardHeader className="px-0 pb-0 pt-0">
                <CardTitle className="text-base">
                  Mídias do chat ({midiasChat.length})
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Arquivos enviados no WhatsApp ainda não classificados pela IA.
                </p>
              </CardHeader>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {midiasChat.map((midia) => (
                  <MidiaChatCard key={midia.id} midia={midia} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
