"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TipoDocumento } from "@/lib/utils/documentos";
import { TIPOS_DOCUMENTO } from "@/lib/utils/documentos";
import { formatCpf } from "@/lib/utils/cpf";

export type DadosDocumento = {
  clienteNome: string;
  clienteCpf: string;
  clienteNascimento: string | null;
  clienteTelefone: string;
  beneficio: string;
  escritorioNome: string;
  voltarHref: string;
};

type Campos = {
  rg: string;
  estadoCivil: string;
  profissao: string;
  endereco: string;
  advogadoNome: string;
  advogadoOab: string;
  enderecoEscritorio: string;
  cidadeUf: string;
  percentual: string;
};

export function DocumentoEditor({
  tipo,
  dados,
}: {
  tipo: TipoDocumento;
  dados: DadosDocumento;
}) {
  const [campos, setCampos] = useState<Campos>({
    rg: "",
    estadoCivil: "",
    profissao: "",
    endereco: "",
    advogadoNome: "Hulgo Fernando Sousa Boueres",
    advogadoOab: "OAB/MA nº ______",
    enderecoEscritorio: "",
    cidadeUf: "",
    percentual: "30%",
  });

  const set = (k: keyof Campos) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCampos((c) => ({ ...c, [k]: e.target.value }));

  const hoje = new Date().toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const v = (valor: string, placeholder: string) =>
    valor.trim() || `________ (${placeholder})`;

  const qualificacaoCliente = `${dados.clienteNome}, brasileiro(a), ${v(
    campos.estadoCivil,
    "estado civil"
  )}, ${v(campos.profissao, "profissão")}, portador(a) do RG nº ${v(
    campos.rg,
    "RG"
  )} e do CPF nº ${formatCpf(dados.clienteCpf)}, residente e domiciliado(a) em ${v(
    campos.endereco,
    "endereço completo"
  )}`;

  const qualificacaoAdvogado = `${campos.advogadoNome}, advogado inscrito na ${campos.advogadoOab}, integrante do escritório ${dados.escritorioNome}, com endereço profissional em ${v(
    campos.enderecoEscritorio,
    "endereço do escritório"
  )}`;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 lg:p-8">
      {/* Barra de controle — some na impressão */}
      <div className="space-y-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link
              href={dados.voltarHref}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-xl font-bold">{TIPOS_DOCUMENTO[tipo]}</h1>
          </div>
          <Button onClick={() => window.print()} className="gap-2">
            <Printer className="h-4 w-4" /> Imprimir / salvar PDF
          </Button>
        </div>

        <div className="grid gap-3 rounded-lg border bg-background p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <Label>RG do cliente</Label>
            <Input value={campos.rg} onChange={set("rg")} />
          </div>
          <div className="space-y-1">
            <Label>Estado civil</Label>
            <Input value={campos.estadoCivil} onChange={set("estadoCivil")} placeholder="casado(a)" />
          </div>
          <div className="space-y-1">
            <Label>Profissão</Label>
            <Input value={campos.profissao} onChange={set("profissao")} placeholder="lavrador(a)" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Endereço do cliente</Label>
            <Input value={campos.endereco} onChange={set("endereco")} />
          </div>
          <div className="space-y-1">
            <Label>Cidade/UF (assinatura)</Label>
            <Input value={campos.cidadeUf} onChange={set("cidadeUf")} placeholder="São Luís/MA" />
          </div>
          <div className="space-y-1">
            <Label>Advogado</Label>
            <Input value={campos.advogadoNome} onChange={set("advogadoNome")} />
          </div>
          <div className="space-y-1">
            <Label>OAB</Label>
            <Input value={campos.advogadoOab} onChange={set("advogadoOab")} />
          </div>
          <div className="space-y-1">
            <Label>Endereço do escritório</Label>
            <Input
              value={campos.enderecoEscritorio}
              onChange={set("enderecoEscritorio")}
            />
          </div>
          {tipo === "honorarios" && (
            <div className="space-y-1">
              <Label>Percentual de honorários</Label>
              <Input value={campos.percentual} onChange={set("percentual")} />
            </div>
          )}
        </div>
      </div>

      {/* Documento (A4) */}
      <div className="mx-auto rounded-lg border bg-white p-10 text-black shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <div className="space-y-6 font-serif text-[15px] leading-7">
          <p className="text-center text-lg font-bold uppercase">
            {TIPOS_DOCUMENTO[tipo]}
          </p>

          {tipo === "procuracao" && (
            <>
              <p>
                <strong>OUTORGANTE:</strong> {qualificacaoCliente}.
              </p>
              <p>
                <strong>OUTORGADO:</strong> {qualificacaoAdvogado}.
              </p>
              <p>
                <strong>PODERES:</strong> Pelo presente instrumento particular de
                procuração, o(a) outorgante nomeia e constitui o outorgado seu
                procurador, conferindo-lhe os poderes da cláusula{" "}
                <em>ad judicia et extra</em> (art. 105 do CPC), para o foro em
                geral, podendo promover quaisquer medidas judiciais ou
                administrativas, em especial perante o Instituto Nacional do
                Seguro Social — INSS e a Justiça Federal, relativas ao
                requerimento, concessão, revisão ou restabelecimento do benefício
                previdenciário de <strong>{dados.beneficio}</strong>, com poderes
                para requerer, alegar, defender, transigir, desistir, firmar
                compromissos, receber e dar quitação, substabelecer com ou sem
                reserva de poderes, e praticar todos os demais atos necessários ao
                fiel cumprimento deste mandato.
              </p>
            </>
          )}

          {tipo === "honorarios" && (
            <>
              <p>
                <strong>CONTRATANTE:</strong> {qualificacaoCliente}.
              </p>
              <p>
                <strong>CONTRATADO:</strong> {qualificacaoAdvogado}.
              </p>
              <p>
                <strong>CLÁUSULA 1ª — DO OBJETO.</strong> O contratado prestará
                serviços advocatícios ao contratante no requerimento
                administrativo e/ou ação judicial relativos ao benefício
                previdenciário de <strong>{dados.beneficio}</strong>, perante o
                INSS e/ou a Justiça Federal.
              </p>
              <p>
                <strong>CLÁUSULA 2ª — DOS HONORÁRIOS.</strong> Pelos serviços
                prestados, o contratante pagará ao contratado honorários
                advocatícios correspondentes a{" "}
                <strong>{campos.percentual || "____"}</strong> do proveito
                econômico obtido (parcelas vencidas/atrasados), devidos somente em
                caso de êxito, além dos honorários de sucumbência fixados
                judicialmente, que pertencem exclusivamente ao contratado.
              </p>
              <p>
                <strong>CLÁUSULA 3ª — DAS OBRIGAÇÕES.</strong> O contratado
                empregará a diligência necessária na condução do caso, mantendo o
                contratante informado. O contratante fornecerá documentos e
                informações verdadeiras, comprometendo-se a comunicar mudança de
                endereço ou telefone.
              </p>
              <p>
                <strong>CLÁUSULA 4ª — DO FORO.</strong> Fica eleito o foro da
                comarca de {v(campos.cidadeUf, "cidade/UF")} para dirimir
                quaisquer controvérsias oriundas deste contrato.
              </p>
              <p>
                E por estarem justos e contratados, firmam o presente em duas vias
                de igual teor.
              </p>
            </>
          )}

          {tipo === "hipossuficiencia" && (
            <>
              <p>{qualificacaoCliente}, DECLARA, sob as penas da lei e nos termos
              do art. 99, § 3º, do Código de Processo Civil e da Lei nº
              1.060/50, que não possui condições financeiras de arcar com as
              custas, despesas processuais e honorários advocatícios sem
              prejuízo do sustento próprio e de sua família, razão pela qual
              requer os benefícios da <strong>justiça gratuita</strong>.</p>
              <p>
                Declara, ainda, estar ciente de que a falsidade desta declaração
                pode acarretar as sanções civis e penais cabíveis.
              </p>
            </>
          )}

          <p className="pt-6 text-center">
            {v(campos.cidadeUf, "cidade/UF")}, {hoje}.
          </p>

          <div className="space-y-10 pt-10">
            <div className="mx-auto w-80 border-t border-black pt-1 text-center text-sm">
              {dados.clienteNome}
              <br />
              CPF {formatCpf(dados.clienteCpf)}
            </div>
            {tipo !== "hipossuficiencia" && (
              <div className="mx-auto w-80 border-t border-black pt-1 text-center text-sm">
                {campos.advogadoNome}
                <br />
                {campos.advogadoOab}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
