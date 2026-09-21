# Documentos PDF (overlay)

Os modelos em `public/documentos-templates/` são PDFs sem AcroForm. O preenchimento
desenha texto com `pdf-lib` nas coordenadas de `placements` em
[`lib/utils/documentos.ts`](../lib/utils/documentos.ts).

## Fluxo

1. Aba **Caso** → **Gerar documento** → escolhe o modelo.
2. Abre `/documentos/{slug}?caso={id}` com formulário pré-preenchido.
3. **Gerar PDF** / download via [`DocumentoPdfEditor`](../components/documentos/documento-pdf-editor.tsx)
   + [`preencherPdf`](../lib/documentos/preencher-pdf.ts).

## Calibração

Coordenadas usam origem no **canto inferior esquerdo** da página (pontos PDF).

Para recalibrar um campo:

1. Gere o PDF com valores de teste.
2. Ajuste `x` / `y` / `size` / `maxWidth` no `placements` do slug.
3. Recarregue a página do editor e gere de novo.

Campos condicionais (checkboxes) usam `when` + `text: "X"` — o valor do formulário
precisa bater com a opção (`estadoCivil=casado`, etc.).

## Modelos

| slug | Arquivo |
|------|---------|
| `procuracao-previdenciaria` | `procuracao-previdenciaria.pdf` |
| `termo-representacao` | `termo-representacao.pdf` |
| `termo-responsabilidade-in128` | `termo-responsabilidade-in128.pdf` |
| `autodeclaracao-rural` | `autodeclaracao-rural.pdf` |
| `autodeclaracao-pescador` | `autodeclaracao-pescador.pdf` |
| `requerimento-loas` | `requerimento-loas.pdf` |
