/**
 * Ajusta a imagem para os formatos que o modelo de visão aceita
 * (JPEG, PNG, WebP, GIF). Fotos de iPhone (HEIC/HEIF) viram JPEG.
 */

const HEIC_BRANDS = new Set([
  "heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1",
]);

export function isHeic(bytes: Uint8Array, mimeType: string, fileName: string): boolean {
  if (/image\/hei[cf]/i.test(mimeType) || /\.hei[cf]$/i.test(fileName)) return true;
  // Caixa "ftyp" do container ISO-BMFF: bytes 4..8 = "ftyp", 8..12 = marca.
  if (bytes.length < 12) return false;
  const ascii = (a: number, b: number) =>
    String.fromCharCode(...bytes.subarray(a, b));
  return ascii(4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(8, 12));
}

function mimePorNome(fileName: string): string | null {
  const ext = fileName.toLowerCase().split(".").pop();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return null;
  }
}

/** Data URL pronta para openaiDescribeImage (converte HEIC → JPEG). */
export async function imagemParaVisao(input: {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  let { bytes } = input;
  let mime = (input.mimeType || "").toLowerCase();

  if (isHeic(bytes, mime, input.fileName)) {
    const { default: heicConvert } = await import("heic-convert");
    const jpeg = await heicConvert({ buffer: bytes, format: "JPEG", quality: 0.85 });
    bytes = Buffer.from(jpeg);
    mime = "image/jpeg";
  } else if (!mime.startsWith("image/")) {
    mime = mimePorNome(input.fileName) ?? "image/jpeg";
  }

  return `data:${mime};base64,${bytes.toString("base64")}`;
}
