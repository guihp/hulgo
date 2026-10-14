import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Cifra segredos guardados no banco (AES-256-GCM).
 * A senha mestra vem só da env APP_ENCRYPTION_KEY (Coolify) — nunca do banco.
 * Formato salvo: "v1:<iv b64>:<tag b64>:<dados b64>".
 */

function chaveMestra(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!raw || raw.length < 32) {
    throw new Error(
      "APP_ENCRYPTION_KEY não configurada no servidor (mín. 32 caracteres). Gere com: openssl rand -base64 32"
    );
  }
  // Deriva 32 bytes de qualquer string forte.
  return createHash("sha256").update(raw, "utf8").digest();
}

export function criptografiaConfigurada(): boolean {
  return (process.env.APP_ENCRYPTION_KEY?.trim().length ?? 0) >= 32;
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", chaveMestra(), iv);
  const dados = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), dados.toString("base64")].join(":");
}

export function decifrar(valor: string): string {
  const [versao, iv, tag, dados] = valor.split(":");
  if (versao !== "v1" || !iv || !tag || !dados) throw new Error("Segredo em formato inválido");
  const decipher = createDecipheriv("aes-256-gcm", chaveMestra(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dados, "base64")), decipher.final()]).toString("utf8");
}
