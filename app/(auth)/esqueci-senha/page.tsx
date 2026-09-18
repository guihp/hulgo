"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  AuthCard,
  AuthShell,
  authButtonClassName,
  authInputClassName,
} from "@/components/auth/auth-shell";

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setLoading(false);

    if (error) {
      toast.error("Erro ao enviar e-mail", { description: error.message });
      return;
    }

    setSent(true);
    toast.success("E-mail de recuperação enviado");
  }

  return (
    <AuthShell>
      <AuthCard>
        <h2 className="text-[1.65rem] font-semibold tracking-tight text-[#0b2148]">
          Recuperar senha
        </h2>
        <p className="mt-1 text-sm text-[#64748B]">
          Enviaremos um link para redefinir sua senha.
        </p>

        {sent ? (
          <p className="mt-7 text-sm leading-relaxed text-[#4b5d78]">
            Verifique sua caixa de entrada e siga as instruções do e-mail.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-[11px] font-semibold tracking-[0.14em] text-[#64748B]"
              >
                E-MAIL
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                placeholder="nome@escritorio.adv.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={authInputClassName}
              />
            </div>

            <button type="submit" disabled={loading} className={authButtonClassName}>
              <span
                aria-hidden
                className="login-btn-shine pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent"
              />
              <span className="relative z-10">
                {loading ? "Enviando…" : "Enviar link"}
              </span>
            </button>
          </form>
        )}

        <p className="mt-6 text-center">
          <Link
            href="/login"
            className="text-sm font-medium text-[#163a7a] hover:underline"
          >
            Voltar ao login
          </Link>
        </p>

        <p className="mt-6 flex items-center justify-center gap-2 text-[12px] text-[#6b7c94]">
          <span className="size-1.5 rounded-full bg-[#0b2148]" />
          Conexão criptografada · Acesso restrito à equipe
        </p>
      </AuthCard>
    </AuthShell>
  );
}
