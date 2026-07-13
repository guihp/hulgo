import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AppToaster } from "@/components/providers/app-toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Boueres e Fonteles — Painel",
  description: "Sistema de gestão para escritório de advocacia previdenciária",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body
        className={`${plusJakarta.variable} ${jetbrainsMono.variable} min-h-screen font-sans antialiased`}
      >
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <AppToaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
