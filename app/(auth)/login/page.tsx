"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { writeRememberPreference } from "@/lib/supabase/remember";
import { cn } from "@/lib/utils";
import {
  AuthCard,
  AuthShell,
  authButtonClassName,
  authInputClassName,
} from "@/components/auth/auth-shell";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const started = Date.now();
    writeRememberPreference(remember);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    const remaining = 1800 - (Date.now() - started);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    setLoading(false);

    if (error) {
      toast.error("Não foi possível entrar", { description: error.message });
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <AuthShell>
      <AuthCard>
        <h2 className="text-[1.65rem] font-semibold tracking-tight text-[#0b2148]">
          Entrar
        </h2>
        <p className="mt-1 text-sm text-[#64748B]">
          Use suas credenciais do escritório.
        </p>

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

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="text-[11px] font-semibold tracking-[0.14em] text-[#64748B]"
            >
              SENHA
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={cn(authInputClassName, "pr-16")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-[11px] font-semibold tracking-[0.12em] text-[#0b2148] hover:text-[#163a7a]"
              >
                {showPassword ? "OCULTAR" : "VER"}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <button
              type="button"
              role="switch"
              aria-checked={remember}
              onClick={() => setRemember((v) => !v)}
              className="flex cursor-pointer items-center gap-2 text-[13px] whitespace-nowrap text-[#0b2148] sm:gap-2.5 sm:text-sm"
            >
              <span
                className={cn(
                  "relative h-[22px] w-[40px] shrink-0 rounded-full transition-colors",
                  remember ? "bg-[#0b2148]" : "bg-[#c9d4e4]"
                )}
              >
                <span
                  className={cn(
                    "absolute top-[2px] size-[18px] rounded-full bg-white shadow-sm transition-all",
                    remember ? "left-[20px]" : "left-[2px]"
                  )}
                />
              </span>
              Manter conectado
            </button>
            <Link
              href="/esqueci-senha"
              className="shrink-0 text-[13px] font-medium whitespace-nowrap text-[#163a7a] hover:underline sm:text-sm"
            >
              Esqueci minha senha
            </Link>
          </div>

          <div className="space-y-2">
            <button type="submit" disabled={loading} className={authButtonClassName}>
              <span
                aria-hidden
                className="login-btn-shine pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent"
              />
              <span className="relative z-10">
                {loading ? "Entrando…" : "Entrar no painel"}
              </span>
            </button>
            {loading ? (
              <p className="flex items-center justify-center gap-2 text-[12px] text-[#64748B]">
                <span className="login-dot-pulse size-1.5 rounded-full bg-[#0b2148]" />
                Verificando credenciais
              </p>
            ) : null}
          </div>
        </form>

        <p className="mt-6 flex items-center justify-center gap-2 text-[12px] text-[#6b7c94]">
          <span className="size-1.5 rounded-full bg-[#0b2148]" />
          Conexão criptografada · Acesso restrito à equipe
        </p>
      </AuthCard>
    </AuthShell>
  );
}
