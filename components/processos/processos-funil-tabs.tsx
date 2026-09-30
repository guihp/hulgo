import Link from "next/link";
import { FUNIS_PROCESSO, type FunilProcesso } from "@/lib/utils/processos";
import { cn } from "@/lib/utils";

export function ProcessosFunilTabs({ funil }: { funil: FunilProcesso }) {
  return (
    <div
      role="tablist"
      aria-label="Funil de processos"
      className="inline-flex w-fit max-w-full overflow-x-auto rounded-lg border bg-muted/40 p-1"
    >
      {FUNIS_PROCESSO.map((f) => {
        const selected = f.value === funil;
        return (
          <Link
            key={f.value}
            role="tab"
            aria-selected={selected}
            href={`/processos?funil=${f.value}`}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              selected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
            )}
          >
            {f.label}
          </Link>
        );
      })}
    </div>
  );
}
