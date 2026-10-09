import type { Instrumentation } from "next";

export function register() {}

/** Todo erro de servidor vai para app_erros_log (ver lib/erros-log.ts). */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registrarErroServidor } = await import("@/lib/erros-log");
  await registrarErroServidor(err, request, context);
};
