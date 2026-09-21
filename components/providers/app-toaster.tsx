"use client";

import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      offset={16}
      closeButton
      toastOptions={{
        duration: 5000,
        classNames: {
          toast:
            "!bg-white/92 !text-[#0b2148] !border-[#0b2148]/12 !backdrop-blur-md !shadow-[0_16px_40px_rgba(11,33,72,0.12)]",
          title: "!text-sm !font-medium !text-[#0b2148]",
          description: "!text-xs !text-[#64748B]",
          actionButton:
            "!bg-[#0b2148] !text-white !text-xs !h-7 !px-2.5",
          cancelButton:
            "!bg-[#f5f7fa] !text-[#0b2148] !text-xs !h-7 !px-2.5",
          closeButton:
            "!bg-[#f5f7fa] !border-[#0b2148]/12 !text-[#0b2148]",
          icon: "!text-[#163a7a]",
          error: "!border-[#0b2148]/16",
          success: "!border-[#0b2148]/16",
        },
      }}
    />
  );
}
