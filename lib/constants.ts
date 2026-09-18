import type { AprovacaoStatus, CasoStatus } from "@/types/database";

export const APP_NAME = "Advocacia";

export const CASO_STATUS: { value: CasoStatus; label: string }[] = [
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "consultar_processo", label: "Consultar processo" },
  { value: "abertura_processo", label: "Abertura de processo" },
  { value: "aguardando_analise", label: "Aguardando análise" },
  { value: "aguardando_aprovacao", label: "Aguardando aprovação" },
  { value: "atendimento_humano", label: "Solicitou atendimento humano" },
  { value: "processo_finalizado", label: "Processo finalizado" },
];

export const APROVACAO_STATUS: { value: AprovacaoStatus; label: string }[] = [
  { value: "pendente", label: "Pendente" },
  { value: "aprovado", label: "Aprovado" },
  { value: "respondido_manual", label: "Respondido manualmente" },
  { value: "recusado", label: "Recusado" },
];

export const NAV_ICON_NAMES = [
  "LayoutDashboard",
  "Kanban",
  "CheckCircle",
  "CalendarClock",
  "Users",
  "MessageSquare",
  "FileBarChart",
  "Settings",
] as const;

export type NavIconName = (typeof NAV_ICON_NAMES)[number];

export type NavItemDef = {
  href: string;
  label: string;
  icon: NavIconName;
  badge?: "aprovacoes" | "prazos";
  advogadoOnly?: boolean;
};

export const NAV_GROUPS: { title: string; items: NavItemDef[] }[] = [
  {
    title: "OPERAÇÃO",
    items: [
      { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
      { href: "/kanban", label: "Funil", icon: "Kanban" },
      { href: "/aprovacoes", label: "Aprovações", icon: "CheckCircle", badge: "aprovacoes" },
      { href: "/prazos", label: "Prazos", icon: "CalendarClock", badge: "prazos" },
      { href: "/clientes", label: "Clientes", icon: "Users" },
      { href: "/atendimentos", label: "Atendimentos", icon: "MessageSquare" },
    ],
  },
  {
    title: "ESCRITÓRIO",
    items: [
      { href: "/relatorios", label: "Relatórios", icon: "FileBarChart" },
      { href: "/configuracoes", label: "Configurações", icon: "Settings", advogadoOnly: true },
    ],
  },
];

/** @deprecated Use NAV_GROUPS */
export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
