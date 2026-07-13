import type { AprovacaoStatus, CasoStatus } from "@/types/database";

export const APP_NAME = "Advocacia";

export const CASO_STATUS: { value: CasoStatus; label: string }[] = [
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "consultar_processo", label: "Consultar processo" },
  { value: "abertura_processo", label: "Abertura de processo" },
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

export const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/kanban", label: "Funil de atendimento", icon: "Kanban" },
  { href: "/aprovacoes", label: "Aprovações", icon: "CheckCircle" },
  { href: "/clientes", label: "Clientes", icon: "Users" },
  { href: "/atendimentos", label: "Atendimentos", icon: "MessageSquare" },
  { href: "/arquivos", label: "Arquivos", icon: "FolderOpen" },
  { href: "/relatorios", label: "Relatórios", icon: "FileBarChart" },
] as const;
