import { cn } from "@/lib/utils";

export function AppLogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/FB.png"
      alt="Logo Advocacia Previdenciário"
      className={cn("shrink-0 rounded-md object-contain", className)}
    />
  );
}

export function AppLogo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <AppLogoMark className={compact ? "size-12" : "size-14"} />
      <div className="min-w-0 leading-tight">
        <p className="truncate font-semibold tracking-tight text-[#0F172A]">Advocacia</p>
        <p className="truncate text-[10px] font-semibold tracking-[0.22em] text-[#163a7a]">
          PREVIDENCIÁRIO
        </p>
      </div>
    </div>
  );
}
