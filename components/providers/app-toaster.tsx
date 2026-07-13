"use client";

import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      offset={16}
      richColors
      closeButton
      toastOptions={{
        duration: 5000,
        classNames: {
          toast:
            "!bg-background/60 !text-foreground !border-border/35 !backdrop-blur-md !shadow-sm",
          title: "!text-sm !font-medium",
          description: "!text-xs !text-muted-foreground",
          actionButton:
            "!bg-primary/75 !text-primary-foreground !text-xs !h-7 !px-2.5",
          closeButton:
            "!bg-background/40 !border-border/35 !text-muted-foreground",
        },
      }}
    />
  );
}
