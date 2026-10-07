/**
 * Reduz fotos grandes no navegador antes do upload (base64 em Server Action).
 * Fotos de celular (4–12 MB) viram JPEG ~0,5–1,5 MB sem perda perceptível de leitura.
 * Retorna o arquivo original se não for imagem rasterizável, se já for pequeno,
 * ou se o navegador não conseguir decodificar (ex.: HEIC fora do Safari).
 */

const MAX_LADO = 2560;
const QUALIDADE = 0.85;
const LIMIAR_BYTES = 1.5 * 1024 * 1024;

export async function compressImageFile(file: File): Promise<File> {
  const mime = (file.type || "").toLowerCase();
  if (!mime.startsWith("image/") || mime === "image/gif" || mime === "image/svg+xml") {
    return file;
  }
  const precisaConverter = mime === "image/heic" || mime === "image/heif";
  if (file.size <= LIMIAR_BYTES && !precisaConverter) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * escala));
    const h = Math.max(1, Math.round(bitmap.height * escala));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff"; // PNG com transparência → fundo branco no JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALIDADE)
    );
    if (!blob || (blob.size >= file.size && !precisaConverter)) return file;

    const base = (file.name || "imagem").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
