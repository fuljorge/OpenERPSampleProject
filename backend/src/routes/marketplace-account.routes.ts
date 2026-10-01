import type { FastifyInstance } from "fastify";
import { authorize } from "../middleware/authorize.middleware.js";
import {
  CreateMarketplaceAccountSchema,
  ListMarketplaceAccountsQuerySchema,
  MarketplaceAccountSchema,
  UpdateMarketplaceAccountSchema,
  UpdateMarketplaceAccountStatusSchema,
} from "../schemas/marketplace-account.schema.js";
import { z } from "zod";
import { MercadoLivreOAuthError } from "../plugins/marketplaces/mercado-livre-oauth.client.js";
import { CredentialKeyRotationConflictError } from "../services/credential-key.service.js";
import {
  InvalidOAuthStateError,
  OAuthNotSupportedError,
  UnexpectedMercadoLivreUserError,
  completeMercadoLivreAuthorization,
  getMercadoLivreRedirectUri,
  startMercadoLivreAuthorization,
  testMercadoLivreIntegration,
} from "../services/mercado-livre-oauth.service.js";
import { getEncryptionKeyStatus, rotateCredentialKey } from "../services/credential-key-rotation.service.js";
import {
  InvalidCredentialFormatError,
  MarketplaceAccountLifecycleError,
  MarketplaceAccountNotFoundError,
  createMarketplaceAccount,
  deleteMarketplaceAccount,
  disconnectMarketplaceAccount,
  getMarketplaceAccountById,
  listMarketplaceAccounts,
  updateMarketplaceAccountProfile,
  updateMarketplaceAccountStatus,
} from "../services/marketplace-account.service.js";
import {
  getMercadoLivrePackageSettings,
  updateMercadoLivrePackageSettings,
} from "../services/mercado-livre-package-settings.service.js";
import { MercadoLivrePackageSettingsSchema } from "../../../shared/dist/schemas/mercado-livre-package-settings.schema.js";

export default async function marketplaceAccountRoutes(fastify: FastifyInstance) {
  // Diferente do padrão geral de RBAC (categorias, por exemplo, liberam GET a qualquer
  // perfil autenticado): AQUI até a leitura é restrita a admin — credenciais de marketplace
  // são sensíveis mesmo mascaradas (spec 011, seção 2.2, exceção explícita à constituição,
  // seção 3).
  const adminGuard = {
    preHandler: [fastify.authenticate, authorize(["admin"])],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  };

  // Rotas fixas, declaradas antes de "/:id" (Fastify já prioriza rota estática, mas fica explícito).
  fastify.get("/encryption-key", adminGuard, async () => {
    const status = await getEncryptionKeyStatus();
    return { success: true, data: status };
  });

  // Rotação manual — só admin, rate limit mais duro (spec 011, seção 3.1; ADR-021). Re-cifra
  // todas as contas: operação pesada e sensível, nunca automática.
  fastify.post(
    "/rotate-key",
    {
      preHandler: [fastify.authenticate, authorize(["admin"])],
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      try {
        const report = await rotateCredentialKey(request.user!.id);
        return { success: true, data: report };
      } catch (err) {
        if (err instanceof CredentialKeyRotationConflictError) {
          return reply.code(409).send({ success: false, error: err.message });
        }
        throw err;
      }
    },
  );

  // Pacote padrão do Mercado Livre (spec 012, seção 3.4; ADR-027) — editado pelo admin, gravado no
  // banco (não mais variável de ambiente). `null` = ainda não configurado.
  fastify.get("/mercado-livre-package-settings", adminGuard, async () => {
    const settings = await getMercadoLivrePackageSettings();
    return { success: true, data: settings };
  });

  fastify.put("/mercado-livre-package-settings", adminGuard, async (request, reply) => {
    const parseResult = MercadoLivrePackageSettingsSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Dimensões e peso devem ser números inteiros positivos." });
    }

    const settings = await updateMercadoLivrePackageSettings(parseResult.data, request.user!.id);
    return { success: true, data: settings };
  });

  // OAuth 2.0 do Mercado Livre (spec 012, seção 2.2): o admin informa Client ID/Secret na conta e
  // conecta por redirecionamento — os tokens nunca são digitados.
  fastify.get("/oauth/redirect-uri", adminGuard, async () => ({
    success: true,
    data: { redirectUri: getMercadoLivreRedirectUri() },
  }));

  // Teste de integração antes de criar a conta (spec 012, seção 2.4). POST porque recebe o Client
  // Secret — que não pode ir em query string —; rate limit duro por chamar o Mercado Livre.
  fastify.post(
    "/mercado-livre/test-connection",
    {
      preHandler: [fastify.authenticate, authorize(["admin"])],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parseResult = z
        .object({ client_id: z.string().trim().min(1), client_secret: z.string().trim().min(1) })
        .strict()
        .safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ success: false, error: "Informe o Client ID e o Client Secret." });
      }

      try {
        const user = await testMercadoLivreIntegration({
          clientId: parseResult.data.client_id,
          clientSecret: parseResult.data.client_secret,
        });
        return { success: true, data: user };
      } catch (err) {
        if (err instanceof MercadoLivreOAuthError) {
          return reply.code(400).send({ success: false, error: err.message });
        }
        throw err;
      }
    },
  );

  fastify.post<{ Params: { id: string } }>("/:id/oauth/authorize", adminGuard, async (request, reply) => {
    try {
      const data = await startMercadoLivreAuthorization(request.params.id);
      return { success: true, data };
    } catch (err) {
      if (err instanceof MarketplaceAccountNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      if (err instanceof OAuthNotSupportedError || err instanceof InvalidCredentialFormatError) {
        return reply.code(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.post("/oauth/mercado-livre/complete", adminGuard, async (request, reply) => {
    const parseResult = z.object({ code: z.string().min(1), state: z.string().min(1) }).safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Dados de autorização inválidos." });
    }

    try {
      const account = await completeMercadoLivreAuthorization(parseResult.data, request.user!.id);
      return { success: true, data: MarketplaceAccountSchema.parse(account) };
    } catch (err) {
      if (
        err instanceof InvalidOAuthStateError ||
        err instanceof UnexpectedMercadoLivreUserError ||
        err instanceof InvalidCredentialFormatError ||
        err instanceof MercadoLivreOAuthError
      ) {
        return reply.code(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.get("/", adminGuard, async (request, reply) => {
    const parseResult = ListMarketplaceAccountsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Parâmetros de busca inválidos." });
    }

    const accounts = await listMarketplaceAccounts(parseResult.data, request.user!.id);
    return { success: true, data: accounts.map((account) => MarketplaceAccountSchema.parse(account)) };
  });

  fastify.get<{ Params: { id: string } }>("/:id", adminGuard, async (request, reply) => {
    try {
      const account = await getMarketplaceAccountById(request.params.id, request.user!.id);
      return { success: true, data: MarketplaceAccountSchema.parse(account) };
    } catch (err) {
      if (err instanceof MarketplaceAccountNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.post("/", adminGuard, async (request, reply) => {
    const parseResult = CreateMarketplaceAccountSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Dados de conta inválidos." });
    }

    try {
      const account = await createMarketplaceAccount({ ...parseResult.data, actingAdminId: request.user!.id });
      return reply.code(201).send({ success: true, data: MarketplaceAccountSchema.parse(account) });
    } catch (err) {
      if (err instanceof InvalidCredentialFormatError) {
        return reply.code(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.patch<{ Params: { id: string } }>("/:id", adminGuard, async (request, reply) => {
    const parseResult = UpdateMarketplaceAccountSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Dados de atualização inválidos." });
    }

    try {
      const account = await updateMarketplaceAccountProfile(
        request.params.id,
        parseResult.data,
        request.user!.id,
      );
      return { success: true, data: MarketplaceAccountSchema.parse(account) };
    } catch (err) {
      if (err instanceof MarketplaceAccountNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      if (err instanceof InvalidCredentialFormatError) {
        return reply.code(400).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.patch<{ Params: { id: string } }>("/:id/status", adminGuard, async (request, reply) => {
    const parseResult = UpdateMarketplaceAccountStatusSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ success: false, error: "Status inválido." });
    }

    try {
      const account = await updateMarketplaceAccountStatus(
        request.params.id,
        parseResult.data.active,
        request.user!.id,
      );
      return { success: true, data: MarketplaceAccountSchema.parse(account) };
    } catch (err) {
      if (err instanceof MarketplaceAccountNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      if (err instanceof MarketplaceAccountLifecycleError) {
        return reply.code(409).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  // Ciclo de remoção: Desconectar → Desativar → Apagar (spec 011, seção 2.2.2; ADR-022). A ordem é
  // imposta no serviço; aqui só se traduz o erro em 409.
  fastify.post<{ Params: { id: string } }>("/:id/disconnect", adminGuard, async (request, reply) => {
    try {
      const account = await disconnectMarketplaceAccount(request.params.id, request.user!.id);
      return { success: true, data: MarketplaceAccountSchema.parse(account) };
    } catch (err) {
      if (err instanceof MarketplaceAccountNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      throw err;
    }
  });

  fastify.delete<{ Params: { id: string } }>("/:id", adminGuard, async (request, reply) => {
    try {
      await deleteMarketplaceAccount(request.params.id, request.user!.id);
      return { success: true, data: { id: request.params.id } };
    } catch (err) {
      if (err instanceof MarketplaceAccountNotFoundError) {
        return reply.code(404).send({ success: false, error: err.message });
      }
      if (err instanceof MarketplaceAccountLifecycleError) {
        return reply.code(409).send({ success: false, error: err.message });
      }
      throw err;
    }
  });
}
