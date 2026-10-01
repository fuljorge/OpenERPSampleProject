import { z } from "zod";
import { MarketplaceEnum } from "../../../shared/dist/schemas/marketplace.schema.js";
import { MercadoLivrePackageSettingsRecordSchema } from "../../../shared/dist/schemas/mercado-livre-package-settings.schema.js";

export { MarketplaceEnum };
export type Marketplace = z.infer<typeof MarketplaceEnum>;

/** Pacote padrão do Mercado Livre (spec 012, seção 3.4; ADR-027) — devolvido pela API, já gravado. */
export { MercadoLivrePackageSettingsRecordSchema };
export type MercadoLivrePackageSettingsRecord = z.infer<typeof MercadoLivrePackageSettingsRecordSchema>;

/**
 * Formulário de edição — campos de texto (padrão do projeto, ver `product.schema.ts`), coeridos
 * para número inteiro positivo na validação; o `zodResolver` já devolve o valor numérico ao
 * `onSubmit`, sem parse manual.
 */
export const MercadoLivrePackageSettingsFormSchema = z.object({
  altura_cm: z.coerce
    .number({ invalid_type_error: "Informe um número." })
    .int("Use um número inteiro, em centímetros.")
    .positive("Deve ser maior que zero."),
  largura_cm: z.coerce
    .number({ invalid_type_error: "Informe um número." })
    .int("Use um número inteiro, em centímetros.")
    .positive("Deve ser maior que zero."),
  comprimento_cm: z.coerce
    .number({ invalid_type_error: "Informe um número." })
    .int("Use um número inteiro, em centímetros.")
    .positive("Deve ser maior que zero."),
  peso_g: z.coerce
    .number({ invalid_type_error: "Informe um número." })
    .int("Use um número inteiro, em gramas.")
    .positive("Deve ser maior que zero."),
});
export type MercadoLivrePackageSettingsFormValues = z.infer<typeof MercadoLivrePackageSettingsFormSchema>;

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  mercado_livre: "Mercado Livre",
  shopee: "Shopee",
  ebay: "eBay",
};

/**
 * Tipos de anúncio do Mercado Livre (spec 012, seção 3.2; ADR-026) — lista estática, ordenada do
 * mais barato para o mais caro, `free` como padrão. Escolhida pelo operador na tela de revisão
 * (junto da categoria, T059) — nunca uma variável de ambiente fixa. ⚠ Ordem não confirmada por
 * preço real (ADR-026) — a confirmar na Fase 8 (T043/T044) com a conta real.
 */
export const MERCADO_LIVRE_LISTING_TYPES: { id: string; label: string }[] = [
  { id: "free", label: "Grátis" },
  { id: "bronze", label: "Bronze" },
  { id: "silver", label: "Prata" },
  { id: "gold", label: "Ouro" },
  { id: "gold_special", label: "Clássico" },
  { id: "gold_premium", label: "Diamante" },
  { id: "gold_pro", label: "Premium" },
];

export const ConnectionStatusEnum = z.enum(["connected", "disconnected", "error", "expired"]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusEnum>;

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: "Conectada",
  disconnected: "Desconectada",
  error: "Erro",
  expired: "Expirada",
};

export const MarketplaceAccountSchema = z.object({
  id: z.string(),
  marketplace: MarketplaceEnum,
  label: z.string(),
  credentialPreview: z.string(),
  connectionStatus: ConnectionStatusEnum,
  active: z.boolean(),
  publishedListingsCount: z.number().int().nonnegative(),
  expectedUser: z.string().nullable(),
  connectedNickname: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type MarketplaceAccount = z.infer<typeof MarketplaceAccountSchema>;

export interface CredentialFieldConfig {
  /** Chave usada tanto no objeto montado (mercado_livre) quanto no nome do campo do form. */
  key:
    | "credential"
    | "credential_client_id"
    | "credential_client_secret";
  label: string;
  placeholder?: string;
}

/**
 * Campos que compõem a credencial de cada marketplace — o conteúdo varia por conector, nunca
 * é uma única string opaca genérica quando o conector já tem spec própria. Mercado Livre usa
 * OAuth 2.0 (spec 012, seção 2): o admin informa só o aplicativo (Client ID + Client Secret);
 * access/refresh token **nunca são digitados** — vêm do Mercado Livre ao conectar a conta
 * (redirecionamento OAuth), e o ERP os renova com o Client ID/Secret. Shopee/eBay ainda não têm spec própria (011, seção 5,
 * roadmap) — continuam com o campo genérico único até que tenham.
 */
export const MARKETPLACE_CREDENTIAL_FIELDS: Record<Marketplace, CredentialFieldConfig[]> = {
  mercado_livre: [
    { key: "credential_client_id", label: "Client ID", placeholder: "ID do aplicativo (App ID)" },
    { key: "credential_client_secret", label: "Client Secret", placeholder: "Secret Key do aplicativo" },
  ],
  shopee: [{ key: "credential", label: "Credencial", placeholder: "API key, token..." }],
  ebay: [{ key: "credential", label: "Credencial", placeholder: "API key, token..." }],
};

/**
 * Monta o valor único enviado como `credential` à API (backend continua tratando-o como uma
 * string opaca — spec 011, seção 2.1/2.2 — nenhuma mudança de schema no backend). Para
 * marketplaces com um único campo genérico, é o valor literal digitado; para Mercado Livre, é
 * um JSON com o Client ID/Secret — os tokens são acrescentados pelo backend no fluxo OAuth
 * (spec 012, seção 2.1/2.2).
 */
export function buildCredentialPayload(
  marketplace: Marketplace,
  values: Partial<Record<CredentialFieldConfig["key"], string>>,
): string {
  const fields = MARKETPLACE_CREDENTIAL_FIELDS[marketplace];
  if (fields.length === 1 && fields[0]?.key === "credential") {
    return values.credential?.trim() ?? "";
  }

  if (marketplace === "mercado_livre") {
    return JSON.stringify({
      client_id: values.credential_client_id?.trim() ?? "",
      client_secret: values.credential_client_secret?.trim() ?? "",
    });
  }

  return "";
}

const CredentialFieldsShape = {
  credential: z.string().optional(),
  credential_client_id: z.string().optional(),
  credential_client_secret: z.string().optional(),
};

/** Todo campo de credencial da combinação de `marketplace` está preenchido (criação — todos
 * obrigatórios) ou, na edição, ou todos vazios ("não trocar") ou todos preenchidos. */
export function credentialFieldsFilled(
  marketplace: Marketplace,
  values: Partial<Record<CredentialFieldConfig["key"], string>>,
): { filledCount: number; totalCount: number; firstEmptyKey: CredentialFieldConfig["key"] | null } {
  const fields = MARKETPLACE_CREDENTIAL_FIELDS[marketplace];
  let filledCount = 0;
  let firstEmptyKey: CredentialFieldConfig["key"] | null = null;
  for (const field of fields) {
    if (values[field.key]?.trim()) {
      filledCount += 1;
    } else if (firstEmptyKey === null) {
      firstEmptyKey = field.key;
    }
  }
  return { filledCount, totalCount: fields.length, firstEmptyKey };
}

/** Chave de criptografia das credenciais (spec 011, seção 3.1) — só metadados, nunca material de chave. */
export const EncryptionKeyStatusSchema = z.object({
  activeKey: z.object({ id: z.string(), version: z.number(), createdAt: z.coerce.date() }),
  accountsByKeyId: z.record(z.number()),
});
export type EncryptionKeyStatus = z.infer<typeof EncryptionKeyStatusSchema>;

export const KeyRotationReportSchema = z.object({
  previousKeyId: z.string(),
  newKeyId: z.string(),
  total: z.number(),
  rotated: z.number(),
  alreadyCurrent: z.number(),
  skippedConcurrent: z.number(),
  failed: z.array(z.object({ accountId: z.string(), reason: z.string() })),
});
export type KeyRotationReport = z.infer<typeof KeyRotationReportSchema>;

/** Resposta do teste de integração do Mercado Livre (`GET /users/me`) — spec 012, seção 2.4. */
export const IntegrationTestResultSchema = z.object({
  userId: z.union([z.number(), z.string()]),
  nickname: z.string().optional(),
});
export type IntegrationTestResult = z.infer<typeof IntegrationTestResultSchema>;

export const OAuthAuthorizationSchema =z.object({ authorizationUrl: z.string().url(), redirectUri: z.string() });
export type OAuthAuthorization = z.infer<typeof OAuthAuthorizationSchema>;

export const CreateMarketplaceAccountFormSchema = z
  .object({
    marketplace: MarketplaceEnum,
    label: z.string().min(1, "Apelido é obrigatório."),
    // Mercado Livre: usuário que a conta vai usar (spec 012, seção 2.5) — conferido depois do OAuth.
    expectedUser: z.string().optional(),
    ...CredentialFieldsShape,
  })
  .superRefine((data, ctx) => {
    if (data.marketplace === "mercado_livre" && !data.expectedUser?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedUser"],
        message: "Informe o usuário do Mercado Livre (apelido ou ID).",
      });
    }
    const { filledCount, totalCount, firstEmptyKey } = credentialFieldsFilled(data.marketplace, data);
    if (filledCount < totalCount && firstEmptyKey) {
      const field = MARKETPLACE_CREDENTIAL_FIELDS[data.marketplace].find((f) => f.key === firstEmptyKey)!;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [firstEmptyKey],
        message: `${field.label} é obrigatório.`,
      });
    }
  });
export type CreateMarketplaceAccountFormValues = z.infer<typeof CreateMarketplaceAccountFormSchema>;

/**
 * Todos os campos de credencial em branco significa "não trocar" (spec 011, seção 2.2: trocar
 * sempre substitui o valor inteiro — não existe edição parcial). Como a credencial de Mercado
 * Livre é um par (Client ID + Client Secret), só faz sentido "tudo ou nada": preencher um sem o
 * outro deixaria o par inconsistente.
 */
export const EditMarketplaceAccountFormSchema = z
  .object({
    marketplace: MarketplaceEnum,
    label: z.string().min(1, "Apelido é obrigatório."),
    expectedUser: z.string().optional(),
    ...CredentialFieldsShape,
  })
  .superRefine((data, ctx) => {
    const { filledCount, totalCount } = credentialFieldsFilled(data.marketplace, data);
    if (filledCount > 0 && filledCount < totalCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["credential_client_secret"],
        message: "Preencha todos os campos de credencial juntos, ou deixe todos em branco para manter a atual.",
      });
    }
  });
export type EditMarketplaceAccountFormValues = z.infer<typeof EditMarketplaceAccountFormSchema>;
