import {
  EncryptionKeyStatusSchema,
  IntegrationTestResultSchema,
  type IntegrationTestResult,
  OAuthAuthorizationSchema,
  type OAuthAuthorization,
  KeyRotationReportSchema,
  MarketplaceAccountSchema,
  type EncryptionKeyStatus,
  type KeyRotationReport,
  buildCredentialPayload,
  credentialFieldsFilled,
  type CreateMarketplaceAccountFormValues,
  type EditMarketplaceAccountFormValues,
  type Marketplace,
  type MarketplaceAccount,
  MercadoLivrePackageSettingsRecordSchema,
  type MercadoLivrePackageSettingsFormValues,
  type MercadoLivrePackageSettingsRecord,
} from "../schemas/marketplace-account.schema";

export class ApiError extends Error {}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.success) {
    throw new ApiError(body.error ?? "Erro inesperado. Tente novamente.");
  }
  return body.data as T;
}

export const marketplaceAccountService = {
  async list(filter: { marketplace?: Marketplace; active?: boolean } = {}): Promise<MarketplaceAccount[]> {
    const params = new URLSearchParams();
    if (filter.marketplace) params.set("marketplace", filter.marketplace);
    if (filter.active !== undefined) params.set("active", String(filter.active));
    const query = params.toString() ? `?${params.toString()}` : "";

    const response = await fetch(`/api/marketplace-accounts${query}`, { credentials: "include" });
    const data = await parseEnvelope<unknown[]>(response);
    return data.map((item) => MarketplaceAccountSchema.parse(item));
  },

  async create(values: CreateMarketplaceAccountFormValues): Promise<MarketplaceAccount> {
    // Monta o valor único de `credential` a partir dos campos específicos do marketplace
    // escolhido (spec 011, seção 2.2 — o backend continua vendo uma string opaca só).
    const payload: Record<string, string> = {
      marketplace: values.marketplace,
      label: values.label,
      credential: buildCredentialPayload(values.marketplace, values),
    };
    if (values.marketplace === "mercado_livre" && values.expectedUser?.trim()) {
      payload.expectedUser = values.expectedUser.trim();
    }

    const response = await fetch("/api/marketplace-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    return MarketplaceAccountSchema.parse(await parseEnvelope<unknown>(response));
  },

  async update(id: string, values: EditMarketplaceAccountFormValues): Promise<MarketplaceAccount> {
    // Campos de credencial todos em branco significa "não trocar" — nunca envia string vazia
    // (spec 011, seção 2.2). `credentialFieldsFilled` já garante (via Zod) que ou todos estão
    // preenchidos, ou nenhum está.
    const payload: Record<string, string> = { label: values.label };
    // Em branco = manter o usuário esperado atual (trocar desconecta a conta — spec 012, seção 2.5).
    if (values.expectedUser?.trim()) payload.expectedUser = values.expectedUser.trim();
    if (credentialFieldsFilled(values.marketplace, values).filledCount > 0) {
      payload.credential = buildCredentialPayload(values.marketplace, values);
    }

    const response = await fetch(`/api/marketplace-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    return MarketplaceAccountSchema.parse(await parseEnvelope<unknown>(response));
  },

  /** Testa Client ID/Secret no Mercado Livre (`GET /users/me`) antes de criar a conta — não grava nada. */
  async testMercadoLivreIntegration(input: { clientId: string; clientSecret: string }): Promise<IntegrationTestResult> {
    const response = await fetch("/api/marketplace-accounts/mercado-livre/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ client_id: input.clientId.trim(), client_secret: input.clientSecret.trim() }),
    });
    return IntegrationTestResultSchema.parse(await parseEnvelope<unknown>(response));
  },

  /** URL de retorno a cadastrar no aplicativo do Mercado Livre (spec 012, seção 2.2). */
  async getOAuthRedirectUri(): Promise<string> {
    const response = await fetch("/api/marketplace-accounts/oauth/redirect-uri", { credentials: "include" });
    return (await parseEnvelope<{ redirectUri: string }>(response)).redirectUri;
  },

  /** Inicia o OAuth do Mercado Livre: devolve a URL para onde redirecionar o admin. */
  async startOAuthAuthorization(id: string): Promise<OAuthAuthorization> {
    const response = await fetch(`/api/marketplace-accounts/${id}/oauth/authorize`, {
      method: "POST",
      credentials: "include",
    });
    return OAuthAuthorizationSchema.parse(await parseEnvelope<unknown>(response));
  },

  /** Volta do Mercado Livre: troca o code (via backend) por tokens e conecta a conta. */
  async completeOAuthAuthorization(input: { code: string; state: string }): Promise<MarketplaceAccount> {
    const response = await fetch("/api/marketplace-accounts/oauth/mercado-livre/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    return MarketplaceAccountSchema.parse(await parseEnvelope<unknown>(response));
  },

  async getEncryptionKeyStatus(): Promise<EncryptionKeyStatus> {
    const response = await fetch("/api/marketplace-accounts/encryption-key", { credentials: "include" });
    return EncryptionKeyStatusSchema.parse(await parseEnvelope<unknown>(response));
  },

  async rotateEncryptionKey(): Promise<KeyRotationReport> {
    const response = await fetch("/api/marketplace-accounts/rotate-key", {
      method: "POST",
      credentials: "include",
    });
    return KeyRotationReportSchema.parse(await parseEnvelope<unknown>(response));
  },

  /** Pacote padrão do Mercado Livre (spec 012, seção 3.4; ADR-027) — `null` se ainda não configurado. */
  async getMercadoLivrePackageSettings(): Promise<MercadoLivrePackageSettingsRecord | null> {
    const response = await fetch("/api/marketplace-accounts/mercado-livre-package-settings", { credentials: "include" });
    const data = await parseEnvelope<unknown>(response);
    return data === null ? null : MercadoLivrePackageSettingsRecordSchema.parse(data);
  },

  async updateMercadoLivrePackageSettings(values: MercadoLivrePackageSettingsFormValues): Promise<MercadoLivrePackageSettingsRecord> {
    const response = await fetch("/api/marketplace-accounts/mercado-livre-package-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(values),
    });
    return MercadoLivrePackageSettingsRecordSchema.parse(await parseEnvelope<unknown>(response));
  },

  async updateStatus(id: string, active: boolean): Promise<MarketplaceAccount> {
    const response = await fetch(`/api/marketplace-accounts/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ active }),
    });
    return MarketplaceAccountSchema.parse(await parseEnvelope<unknown>(response));
  },

  /** 1º passo de Desconectar → Desativar → Apagar (spec 011, seção 2.2.2): descarta os tokens. */
  async disconnect(id: string): Promise<MarketplaceAccount> {
    const response = await fetch(`/api/marketplace-accounts/${id}/disconnect`, {
      method: "POST",
      credentials: "include",
    });
    return MarketplaceAccountSchema.parse(await parseEnvelope<unknown>(response));
  },

  /** Último passo: remoção física, só de conta desconectada e desativada (ADR-022). */
  async remove(id: string): Promise<void> {
    const response = await fetch(`/api/marketplace-accounts/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    await parseEnvelope<unknown>(response);
  },
};
