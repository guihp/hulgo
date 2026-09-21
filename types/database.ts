export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      app_log_eventos: {
        Row: {
          acao: string;
          created_at: string;
          entidade: string;
          entidade_id: number | null;
          id: number;
          payload: Json | null;
          usuario_id: string | null;
        };
        Insert: {
          acao: string;
          created_at?: string;
          entidade: string;
          entidade_id?: number | null;
          id?: never;
          payload?: Json | null;
          usuario_id?: string | null;
        };
        Update: {
          acao?: string;
          created_at?: string;
          entidade?: string;
          entidade_id?: number | null;
          id?: never;
          payload?: Json | null;
          usuario_id?: string | null;
        };
        Relationships: [];
      };
      app_notas_caso: {
        Row: {
          autor_id: string;
          caso_id: number;
          conteudo: string;
          created_at: string;
          id: number;
        };
        Insert: {
          autor_id: string;
          caso_id: number;
          conteudo: string;
          created_at?: string;
          id?: never;
        };
        Update: {
          autor_id?: string;
          caso_id?: number;
          conteudo?: string;
          created_at?: string;
          id?: never;
        };
        Relationships: [];
      };
      app_usuarios: {
        Row: {
          ativo: boolean;
          created_at: string;
          id: string;
          nome: string;
          papel: string;
        };
        Insert: {
          ativo?: boolean;
          created_at?: string;
          id: string;
          nome: string;
          papel: string;
        };
        Update: {
          ativo?: boolean;
          created_at?: string;
          id?: string;
          nome?: string;
          papel?: string;
        };
        Relationships: [];
      };
      app_push_subscriptions: {
        Row: {
          id: number;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: never;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: never;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          user_agent?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      app_prazos_alertas: {
        Row: {
          prazo_id: number;
          alerta_dia: string;
          tipo: string;
          enviado_em: string;
        };
        Insert: {
          prazo_id: number;
          alerta_dia: string;
          tipo: string;
          enviado_em?: string;
        };
        Update: {
          prazo_id?: number;
          alerta_dia?: string;
          tipo?: string;
          enviado_em?: string;
        };
        Relationships: [];
      };
      app_config: {
        Row: {
          chave: string;
          valor: string;
          descricao: string | null;
          updated_at: string;
        };
        Insert: {
          chave: string;
          valor?: string;
          descricao?: string | null;
          updated_at?: string;
        };
        Update: {
          chave?: string;
          valor?: string;
          descricao?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      app_agente_config: {
        Row: {
          id: number;
          persona_rascunho: string;
          mensagem_abertura_rascunho: string;
          persona: string;
          mensagem_abertura: string;
          versao: number;
          published_at: string | null;
          updated_at: string;
          updated_by: string | null;
          published_by: string | null;
        };
        Insert: {
          id?: number;
          persona_rascunho?: string;
          mensagem_abertura_rascunho?: string;
          persona?: string;
          mensagem_abertura?: string;
          versao?: number;
          published_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          published_by?: string | null;
        };
        Update: {
          id?: number;
          persona_rascunho?: string;
          mensagem_abertura_rascunho?: string;
          persona?: string;
          mensagem_abertura?: string;
          versao?: number;
          published_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          published_by?: string | null;
        };
        Relationships: [];
      };
      app_agente_config_versoes: {
        Row: {
          id: string;
          persona: string;
          mensagem_abertura: string;
          publicado: boolean;
          fonte: string;
          motivo: string | null;
          config_versao: number | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          persona: string;
          mensagem_abertura: string;
          publicado?: boolean;
          fonte?: string;
          motivo?: string | null;
          config_versao?: number | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          persona?: string;
          mensagem_abertura?: string;
          publicado?: boolean;
          fonte?: string;
          motivo?: string | null;
          config_versao?: number | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      app_agente_sandbox_sessoes: {
        Row: {
          id: string;
          user_id: string;
          versao: string;
          tipo_caso_id: string | null;
          tipo_caso_label: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          versao: string;
          tipo_caso_id?: string | null;
          tipo_caso_label?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          versao?: string;
          tipo_caso_id?: string | null;
          tipo_caso_label?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      app_agente_sandbox_mensagens: {
        Row: {
          id: string;
          sessao_id: string;
          role: string;
          content: string;
          media_kind: string | null;
          media_path: string | null;
          media_url: string | null;
          media_mime: string | null;
          transcript: string | null;
          meta: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          sessao_id: string;
          role: string;
          content?: string;
          media_kind?: string | null;
          media_path?: string | null;
          media_url?: string | null;
          media_mime?: string | null;
          transcript?: string | null;
          meta?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          sessao_id?: string;
          role?: string;
          content?: string;
          media_kind?: string | null;
          media_path?: string | null;
          media_url?: string | null;
          media_mime?: string | null;
          transcript?: string | null;
          meta?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      app_assistente_sessoes: {
        Row: {
          id: string;
          user_id: string;
          created_at: string;
          updated_at: string;
          pending_anexo: Json | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          created_at?: string;
          updated_at?: string;
          pending_anexo?: Json | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          created_at?: string;
          updated_at?: string;
          pending_anexo?: Json | null;
        };
        Relationships: [];
      };
      app_assistente_mensagens: {
        Row: {
          id: string;
          sessao_id: string;
          role: string;
          content: string;
          tool_trace: Json;
          anexos: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          sessao_id: string;
          role: string;
          content?: string;
          tool_trace?: Json;
          anexos?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          sessao_id?: string;
          role?: string;
          content?: string;
          tool_trace?: Json;
          anexos?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      app_assistente_auditoria: {
        Row: {
          id: string;
          sessao_id: string | null;
          user_id: string;
          tool: string;
          args: Json;
          result: Json;
          confirmed_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          sessao_id?: string | null;
          user_id: string;
          tool: string;
          args?: Json;
          result?: Json;
          confirmed_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          sessao_id?: string | null;
          user_id?: string;
          tool?: string;
          args?: Json;
          result?: Json;
          confirmed_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      aprovacoes_pendentes: {
        Row: {
          cpf: string | null;
          created_at: string | null;
          decidido_em: string | null;
          decidido_por: string | null;
          enviado_whatsapp: boolean;
          id: number;
          instancia: string | null;
          mensagem_id: string | null;
          motivo_recusa: string | null;
          nome_cliente: string | null;
          numero_processo: string | null;
          resposta_manual: string | null;
          resumo: string;
          resumo_final: string | null;
          status: string | null;
          telefone_cliente: string;
        };
        Insert: {
          cpf?: string | null;
          created_at?: string | null;
          decidido_em?: string | null;
          decidido_por?: string | null;
          enviado_whatsapp?: boolean;
          id?: number;
          instancia?: string | null;
          mensagem_id?: string | null;
          motivo_recusa?: string | null;
          nome_cliente?: string | null;
          numero_processo?: string | null;
          resposta_manual?: string | null;
          resumo: string;
          resumo_final?: string | null;
          status?: string | null;
          telefone_cliente: string;
        };
        Update: {
          cpf?: string | null;
          created_at?: string | null;
          decidido_em?: string | null;
          decidido_por?: string | null;
          enviado_whatsapp?: boolean;
          id?: number;
          instancia?: string | null;
          mensagem_id?: string | null;
          motivo_recusa?: string | null;
          nome_cliente?: string | null;
          numero_processo?: string | null;
          resposta_manual?: string | null;
          resumo?: string;
          resumo_final?: string | null;
          status?: string | null;
          telefone_cliente?: string;
        };
        Relationships: [];
      };
      app_conversas_lidas: {
        Row: {
          contact_norm: string;
          lida_em: string;
          user_id: string;
        };
        Insert: {
          contact_norm: string;
          lida_em?: string;
          user_id: string;
        };
        Update: {
          contact_norm?: string;
          lida_em?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      app_parceiros: {
        Row: {
          id: string;
          nome: string;
          cidade: string;
          telefone: string;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          nome: string;
          cidade?: string;
          telefone: string;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          nome?: string;
          cidade?: string;
          telefone?: string;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      app_prazos: {
        Row: {
          caso_id: number | null;
          concluido: boolean;
          concluido_em: string | null;
          cpf: string | null;
          created_at: string;
          criado_por: string | null;
          data_prazo: string;
          descricao: string | null;
          id: number;
          processo_id: number | null;
          tipo: string;
          titulo: string;
        };
        Insert: {
          caso_id?: number | null;
          concluido?: boolean;
          concluido_em?: string | null;
          cpf?: string | null;
          created_at?: string;
          criado_por?: string | null;
          data_prazo: string;
          descricao?: string | null;
          id?: never;
          processo_id?: number | null;
          tipo?: string;
          titulo: string;
        };
        Update: {
          caso_id?: number | null;
          concluido?: boolean;
          concluido_em?: string | null;
          cpf?: string | null;
          created_at?: string;
          criado_por?: string | null;
          data_prazo?: string;
          descricao?: string | null;
          id?: never;
          processo_id?: number | null;
          tipo?: string;
          titulo?: string;
        };
        Relationships: [];
      };
      app_tipos_caso: {
        Row: {
          id: string;
          chave: string;
          label: string;
          aliases: string[];
          documentos: string[];
          ativo: boolean;
          ordem: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          chave: string;
          label: string;
          aliases?: string[];
          documentos?: string[];
          ativo?: boolean;
          ordem?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          chave?: string;
          label?: string;
          aliases?: string[];
          documentos?: string[];
          ativo?: boolean;
          ordem?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      casos_novos: {
        Row: {
          area: string | null;
          beneficio_identificado: string | null;
          beneficios_alternativos: string | null;
          consulta_dap_caf: string | null;
          consulta_jf: string | null;
          consulta_tse: string | null;
          cpf: string | null;
          created_at: string | null;
          data_nascimento: string | null;
          documentos_faltantes: string | null;
          documentos_recebidos: string | null;
          id: number;
          ja_negou_inss: boolean | null;
          ja_recebe_beneficio: string | null;
          ja_tem_processo: boolean | null;
          mensagem_encaminhamento_enviada_em: string | null;
          motivo_negativa: string | null;
          nome: string | null;
          pontos_analise_juridica: string | null;
          relatorio: string | null;
          requisitos_pendentes: string | null;
          requisitos_preenchidos: string | null;
          status: string | null;
          telefone: string | null;
          tipo_segurado: string | null;
          updated_at: string | null;
        };
        Insert: {
          area?: string | null;
          beneficio_identificado?: string | null;
          beneficios_alternativos?: string | null;
          consulta_dap_caf?: string | null;
          consulta_jf?: string | null;
          consulta_tse?: string | null;
          cpf?: string | null;
          created_at?: string | null;
          data_nascimento?: string | null;
          documentos_faltantes?: string | null;
          documentos_recebidos?: string | null;
          id?: number;
          ja_negou_inss?: boolean | null;
          ja_recebe_beneficio?: string | null;
          ja_tem_processo?: boolean | null;
          mensagem_encaminhamento_enviada_em?: string | null;
          motivo_negativa?: string | null;
          nome?: string | null;
          pontos_analise_juridica?: string | null;
          relatorio?: string | null;
          requisitos_pendentes?: string | null;
          requisitos_preenchidos?: string | null;
          status?: string | null;
          telefone?: string | null;
          tipo_segurado?: string | null;
          updated_at?: string | null;
        };
        Update: {
          area?: string | null;
          beneficio_identificado?: string | null;
          beneficios_alternativos?: string | null;
          consulta_dap_caf?: string | null;
          consulta_jf?: string | null;
          consulta_tse?: string | null;
          cpf?: string | null;
          created_at?: string | null;
          data_nascimento?: string | null;
          documentos_faltantes?: string | null;
          documentos_recebidos?: string | null;
          id?: number;
          ja_negou_inss?: boolean | null;
          ja_recebe_beneficio?: string | null;
          ja_tem_processo?: boolean | null;
          mensagem_encaminhamento_enviada_em?: string | null;
          motivo_negativa?: string | null;
          nome?: string | null;
          pontos_analise_juridica?: string | null;
          relatorio?: string | null;
          requisitos_pendentes?: string | null;
          requisitos_preenchidos?: string | null;
          status?: string | null;
          telefone?: string | null;
          tipo_segurado?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      documentos_cliente: {
        Row: {
          assinado_em: string | null;
          caso_id: number | null;
          contact_norm: string | null;
          cpf: string | null;
          created_at: string;
          descricao: string | null;
          enviado_cliente_em: string | null;
          id: number;
          mensagem_id: string | null;
          mensagem_row_id: number | null;
          nome_documento: string;
          origem: string;
          pasta: string;
          processo_id: number | null;
          requer_assinatura: boolean;
          url_media: string;
        };
        Insert: {
          assinado_em?: string | null;
          caso_id?: number | null;
          contact_norm?: string | null;
          cpf?: string | null;
          created_at?: string;
          descricao?: string | null;
          enviado_cliente_em?: string | null;
          id?: never;
          mensagem_id?: string | null;
          mensagem_row_id?: number | null;
          nome_documento: string;
          origem?: string;
          pasta?: string;
          processo_id?: number | null;
          requer_assinatura?: boolean;
          url_media: string;
        };
        Update: {
          assinado_em?: string | null;
          caso_id?: number | null;
          contact_norm?: string | null;
          cpf?: string | null;
          created_at?: string;
          descricao?: string | null;
          enviado_cliente_em?: string | null;
          id?: never;
          mensagem_id?: string | null;
          mensagem_row_id?: number | null;
          nome_documento?: string;
          origem?: string;
          pasta?: string;
          processo_id?: number | null;
          requer_assinatura?: boolean;
          url_media?: string;
        };
        Relationships: [];
      };
      documentos_pastas: {
        Row: {
          contact_norm: string | null;
          cpf: string | null;
          created_at: string;
          id: number;
          nome: string;
        };
        Insert: {
          contact_norm?: string | null;
          cpf?: string | null;
          created_at?: string;
          id?: never;
          nome: string;
        };
        Update: {
          contact_norm?: string | null;
          cpf?: string | null;
          created_at?: string;
          id?: never;
          nome?: string;
        };
        Relationships: [];
      };
      mensagens: {
        Row: {
          contact_norm: string | null;
          conteudo_media: string | null;
          created_at: string;
          id: number;
          instancia: string | null;
          mensage_type: string | null;
          mensagem_id: string | null;
          phone: string | null;
          plataforma: string;
          session_id: string | null;
          text: string | null;
          type: string | null;
        };
        Insert: {
          contact_norm?: string | null;
          conteudo_media?: string | null;
          created_at?: string;
          id?: number;
          instancia?: string | null;
          mensage_type?: string | null;
          mensagem_id?: string | null;
          phone?: string | null;
          plataforma?: string;
          session_id?: string | null;
          text?: string | null;
          type?: string | null;
        };
        Update: {
          contact_norm?: string | null;
          conteudo_media?: string | null;
          created_at?: string;
          id?: number;
          instancia?: string | null;
          mensage_type?: string | null;
          mensagem_id?: string | null;
          phone?: string | null;
          plataforma?: string;
          session_id?: string | null;
          text?: string | null;
          type?: string | null;
        };
        Relationships: [];
      };
      processos_clientes: {
        Row: {
          area: string | null;
          ativo: boolean | null;
          cpf: string;
          created_at: string | null;
          data_nascimento: string | null;
          descricao_caso: string | null;
          id: number;
          monitorar_dias: number | null;
          nome: string;
          numero_processo: string;
          telefone: string | null;
          tribunal: string | null;
          ultima_consulta_datajud: string | null;
          ultimo_movimento: string | null;
        };
        Insert: {
          area?: string | null;
          ativo?: boolean | null;
          cpf: string;
          created_at?: string | null;
          data_nascimento?: string | null;
          descricao_caso?: string | null;
          id?: number;
          monitorar_dias?: number | null;
          nome: string;
          numero_processo: string;
          telefone?: string | null;
          tribunal?: string | null;
          ultima_consulta_datajud?: string | null;
          ultimo_movimento?: string | null;
        };
        Update: {
          area?: string | null;
          ativo?: boolean | null;
          cpf?: string;
          created_at?: string | null;
          data_nascimento?: string | null;
          descricao_caso?: string | null;
          id?: number;
          monitorar_dias?: number | null;
          nome?: string;
          numero_processo?: string;
          telefone?: string | null;
          tribunal?: string | null;
          ultima_consulta_datajud?: string | null;
          ultimo_movimento?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      app_get_papel: { Args: Record<string, never>; Returns: string };
      upsert_mensagem: {
        Args: {
          p_phone: string;
          p_type: string;
          p_text?: string | null;
          p_mensagem_id?: string | null;
          p_mensage_type?: string | null;
          p_plataforma?: string | null;
          p_instancia?: string | null;
          p_session_id?: string | null;
          p_conteudo_media?: string | null;
        };
        Returns: { result_id: number; result_contact_norm: string }[];
      };
      registrar_documento_cliente: {
        Args: {
          p_nome_documento: string;
          p_url_media: string;
          p_descricao?: string | null;
          p_telefone?: string | null;
          p_cpf?: string | null;
          p_caso_id?: number | null;
          p_mensagem_id?: string | null;
          p_mensagem_row_id?: number | null;
          p_origem?: string | null;
          p_nome_cliente?: string | null;
        };
        Returns: {
          documento_id: number;
          caso_id: number;
          documentos_recebidos: string | null;
          documentos_faltantes: string | null;
        }[];
      };
      mover_cliente_kanban: {
        Args: {
          p_telefone: string;
          p_status: string;
          p_motivo?: string | null;
          p_nome_cliente?: string | null;
        };
        Returns: {
          caso_id: number;
          status: string;
          telefone: string;
        }[];
      };
      consultar_cliente_kanban: {
        Args: {
          p_telefone: string;
        };
        Returns: {
          encontrado: boolean;
          caso_id: number | null;
          status: string | null;
          coluna: string | null;
          nome: string | null;
          cpf: string | null;
          beneficio_identificado: string | null;
          documentos_recebidos: string | null;
          documentos_faltantes: string | null;
          telefone: string | null;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type CasoStatus =
  | "em_atendimento"
  | "consultar_processo"
  | "abertura_processo"
  | "aguardando_analise"
  | "aguardando_aprovacao"
  | "atendimento_humano"
  | "processo_finalizado";

export type AprovacaoStatus =
  | "pendente"
  | "aprovado"
  | "respondido_manual"
  | "recusado";

export type UserRole = "advogado" | "secretaria";

export type PrazoTipo =
  | "exigencia_inss"
  | "recurso"
  | "pericia"
  | "audiencia"
  | "outro";

export type AprovacaoAcao = "aprovar" | "recusar" | "responder";
