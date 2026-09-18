"use client";

import { useId } from "react";
import { APP_NAME } from "@/lib/constants";

export function AuthShell({ children }: { children: React.ReactNode }) {
  const logoId = useId().replace(/:/g, "");

  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-white text-[#0b2148]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(11, 33, 72, 0.055) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(11, 33, 72, 0.055) 1px, transparent 1px)
          `,
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(ellipse 80% 70% at 28% 42%, black 20%, transparent 75%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-[-12%] h-[38rem] w-[38rem] rounded-full bg-[#0b2148]/8 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-8%] bottom-[-18%] h-[32rem] w-[32rem] rounded-full bg-[#0b2148]/6 blur-3xl"
      />

      <div className="relative mx-auto grid min-h-screen w-full max-w-6xl items-center gap-10 px-6 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:px-10">
        <section className="relative mx-auto w-full max-w-lg lg:mx-0">
          <div
            className="relative mb-10 hidden h-72 w-full items-center justify-center lg:flex"
            aria-hidden
          >
            <div className="login-halo absolute size-44 rounded-full bg-[#0b2148]/25 blur-3xl" />

            <div className="login-ring-outer absolute size-[20.5rem]">
              <div className="size-full rounded-full border border-[#0b2148]/22" />
              <span className="absolute top-0 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0b2148] shadow-[0_0_10px_rgba(11,33,72,0.85)]" />
              <span className="absolute top-[78%] left-[86%] size-1.5 rounded-full bg-[#163a7a] shadow-[0_0_8px_rgba(11,33,72,0.75)]" />
            </div>

            <div className="absolute size-[15.75rem] rounded-full border border-[#0b2148]/14" />

            <div className="login-ring-inner absolute size-[11.25rem]">
              <svg className="size-full" viewBox="0 0 180 180" fill="none">
                <circle
                  cx="90"
                  cy="90"
                  r="88"
                  stroke="#0b2148"
                  strokeOpacity="0.3"
                  strokeWidth="1.15"
                  strokeDasharray="3.2 6.8"
                />
              </svg>
              <span className="absolute top-0 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[#0b2148]/45 bg-white" />
            </div>

            <div className="login-mark relative z-10 size-24">
              <svg className="size-full" viewBox="0 0 64 64">
                <defs>
                  <linearGradient id={`${logoId}-fill`} x1="8" y1="2" x2="56" y2="62">
                    <stop offset="0%" stopColor="#2b62b8" />
                    <stop offset="55%" stopColor="#12305f" />
                    <stop offset="100%" stopColor="#07162f" />
                  </linearGradient>
                </defs>
                <g fill={`url(#${logoId}-fill)`}>
                  <circle cx="32" cy="6.4" r="2.9" />
                  <rect x="30.35" y="8.6" width="3.3" height="7.2" rx="0.7" />
                  <rect x="23.5" y="15.2" width="17" height="2.3" rx="1.15" />
                  <path d="M30.4 17.4h3.2v33.2l-1.6 5.2-1.6-5.2z" />
                  <rect x="5.5" y="20.6" width="53" height="2.9" rx="1.45" />
                  <rect x="11.05" y="23.5" width="1.4" height="14.2" rx="0.5" />
                  <rect x="16.55" y="23.5" width="1.4" height="14.2" rx="0.5" />
                  <rect x="8.4" y="36.4" width="12.2" height="1.7" rx="0.6" />
                  <path d="M8.4 38.1h12.2c.25 5.1-2.55 9-6.1 9s-6.35-3.9-6.1-9z" />
                  <rect x="46.05" y="23.5" width="1.4" height="14.2" rx="0.5" />
                  <rect x="51.55" y="23.5" width="1.4" height="14.2" rx="0.5" />
                  <rect x="43.4" y="36.4" width="12.2" height="1.7" rx="0.6" />
                  <path d="M43.4 38.1h12.2c.25 5.1-2.55 9-6.1 9s-6.35-3.9-6.1-9z" />
                  <rect x="24.5" y="55.2" width="15" height="2.3" rx="0.8" />
                  <rect x="19.5" y="57.8" width="25" height="3.2" rx="1.2" />
                </g>
              </svg>
            </div>

            <span className="login-float-7 absolute top-[12%] left-[16%] size-2.5 rounded-[3px] border border-[#0b2148]/35 bg-white" />
            <span className="login-float-9 absolute top-[22%] right-[18%] size-2 rounded-[2px] border border-[#0b2148]/40" />
            <span className="login-float-11 absolute right-[30%] bottom-[16%] size-1.5 rounded-full bg-[#0b2148]/70" />
            <span className="login-float-7 absolute bottom-[28%] left-[22%] size-1.5 rounded-full bg-[#0b2148]/80 [animation-delay:-2.4s]" />
          </div>

          <p className="mb-3 text-[11px] font-semibold tracking-[0.28em] text-[#163a7a]">
            PAINEL PREVIDENCIÁRIO
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-[#0b2148] sm:text-5xl">
            {APP_NAME}
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#4b5d78]">
            Processos, prazos e cálculos previdenciários reunidos em um só painel —
            com a segurança que o escritório precisa.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            {["Prazos automatizados", "Cálculos de benefício", "Dossiê do cliente"].map(
              (item) => (
                <span
                  key={item}
                  className="rounded-full border border-[#0b2148]/16 bg-white px-3.5 py-1.5 text-xs text-[#0b2148] shadow-[0_1px_0_rgba(11,33,72,0.04)]"
                >
                  {item}
                </span>
              )
            )}
          </div>
        </section>

        <section className="mx-auto w-full max-w-[420px] lg:mr-4 lg:ml-auto">
          {children}
        </section>
      </div>
    </div>
  );
}

export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-7 shadow-[0_8px_30px_rgba(15,23,42,0.06)] sm:p-8">
      {children}
    </div>
  );
}

export const authInputClassName =
  "h-11 w-full rounded-xl border border-[#d5dde8] bg-[#f5f7fa] px-3.5 text-sm text-[#0b2148] outline-none transition placeholder:text-[#93a1b5] focus:border-[#0b2148] focus:bg-white focus:ring-4 focus:ring-[#0b2148]/12";

export const authButtonClassName =
  "relative h-12 w-full overflow-hidden rounded-full bg-gradient-to-r from-[#07162f] to-[#163a7a] text-sm font-semibold text-white shadow-[0_10px_24px_rgba(11,33,72,0.28)] transition-[transform,box-shadow,filter] duration-200 hover:-translate-y-px hover:shadow-[0_16px_36px_rgba(11,33,72,0.42)] active:translate-y-px active:shadow-[0_6px_16px_rgba(11,33,72,0.28)] disabled:pointer-events-none";
