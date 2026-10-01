import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Table, type TableColumn } from "../../components/Table";
import {
  useEncryptionKeyStatus,
  useMarketplaceAccountMutations,
  useMarketplaceAccounts,
  useMercadoLivrePackageSettings,
  useOAuthRedirectUri,
  useRotateEncryptionKey,
  useUpdateMercadoLivrePackageSettings,
} from "../../hooks/useMarketplaceAccounts";
import {
  CONNECTION_STATUS_LABELS,
  CreateMarketplaceAccountFormSchema,
  EditMarketplaceAccountFormSchema,
  MARKETPLACE_CREDENTIAL_FIELDS,
  MARKETPLACE_LABELS,
  MarketplaceEnum,
  MercadoLivrePackageSettingsFormSchema,
  type ConnectionStatus,
  type CreateMarketplaceAccountFormValues,
  type EditMarketplaceAccountFormValues,
  type MarketplaceAccount,
  type MercadoLivrePackageSettingsFormValues,
} from "../../schemas/marketplace-account.schema";

const inputClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-wine-600 focus:outline-none focus:ring-1 focus:ring-wine-600";
const errorClass = "mt-1 text-xs text-red-600";
const labelClass = "block text-xs font-medium text-gray-500";

const CONNECTION_STATUS_BADGE: Record<ConnectionStatus, string> = {
  connected: "bg-green-100 text-green-800",
  disconnected: "bg-gray-100 text-gray-600",
  error: "bg-red-100 text-red-800",
  expired: "bg-amber-100 text-amber-800",
};

/**
 * Chave de criptografia das credenciais (spec 011, seção 3.1; ADR-021): o admin só vê o id/versão
 * da chave ativa e quantas contas estão em cada uma — nunca material de chave. A rotação é
 * sempre manual e pede confirmação (gera uma chave nova e re-cifra todas as contas).
 */
function EncryptionKeyCard() {
  const { data: status, isLoading, isError } = useEncryptionKeyStatus();
  const rotate = useRotateEncryptionKey();
  const [confirming, setConfirming] = useState(false);
  const totalAccounts = status ? Object.values(status.accountsByKeyId).reduce((sum, n) => sum + n, 0) : 0;

  async function handleRotate() {
    setConfirming(false);
    await rotate.mutateAsync().catch(() => undefined);
  }

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="font-display text-base font-semibold text-wine-900">Chave de criptografia</h2>

      {isLoading && <p className="text-sm text-gray-500">Carregando...</p>}
      {isError && <p className="text-sm text-red-600">Não foi possível carregar o estado da chave.</p>}
      {status && (
        <p className="text-sm text-gray-700">
          Chave ativa: <span className="font-mono">{status.activeKey.id}</span> (versão {status.activeKey.version}), criada em{" "}
          {status.activeKey.createdAt.toLocaleString("pt-BR")}.{" "}
          {totalAccounts === 0
            ? "Nenhuma conta cadastrada ainda."
            : `Contas por chave: ${Object.entries(status.accountsByKeyId)
                .map(([keyId, count]) => `${keyId}: ${count}`)
                .join(", ")}.`}
        </p>
      )}

      {!confirming && (
        <button
          type="button"
          className="rounded-md border border-wine-800 px-4 py-2 text-sm font-medium text-wine-800 hover:bg-wine-50 disabled:opacity-50"
          disabled={rotate.isPending || !status}
          onClick={() => setConfirming(true)}
        >
          {rotate.isPending ? "Rotacionando..." : "Rotacionar chave de criptografia"}
        </button>
      )}

      {confirming && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            Isso gera uma <strong>nova chave</strong> e re-cifra as credenciais das {totalAccounts} conta(s) cadastrada(s).
            Nenhuma credencial é perdida, mas a operação não pode ser desfeita. Use ao suspeitar de vazamento ou por política
            de segurança.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-md bg-wine-800 px-3 py-1.5 text-sm font-medium text-gold-100 hover:bg-wine-900"
              onClick={() => void handleRotate()}
            >
              Confirmar rotação
            </button>
            <button type="button" className="text-sm text-gray-600 hover:underline" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {rotate.isSuccess && (
        <div className="text-sm">
          <p className="text-green-700">
            Chave rotacionada: <span className="font-mono">{rotate.data.previousKeyId}</span> →{" "}
            <span className="font-mono">{rotate.data.newKeyId}</span>. {rotate.data.rotated} conta(s) re-cifrada(s).
          </p>
          {rotate.data.skippedConcurrent > 0 && (
            <p className="text-amber-700">
              {rotate.data.skippedConcurrent} conta(s) foram editadas durante a rotação e já estão na chave nova ou serão
              re-cifradas na próxima rotação.
            </p>
          )}
          {rotate.data.failed.length > 0 && (
            <div className="text-red-600">
              <p>{rotate.data.failed.length} conta(s) não puderam ser re-cifradas (continuam legíveis na chave anterior):</p>
              <ul className="list-disc pl-5">
                {rotate.data.failed.map((failure) => (
                  <li key={failure.accountId}>
                    <span className="font-mono">{failure.accountId}</span>: {failure.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {rotate.isError && (
        <p className="text-sm text-red-600">
          {rotate.error instanceof Error ? rotate.error.message : "Não foi possível rotacionar a chave."}
        </p>
      )}
    </section>
  );
}

/**
 * Pacote padrão do Mercado Livre (spec 012, seção 3.4; ADR-027) — um único conjunto de medidas
 * usado em toda publicação, editável aqui e gravado no banco (substitui a variável de ambiente
 * `MERCADO_LIVRE_PACKAGE_DEFAULTS` do desenho anterior, T046). Sem isso configurado, a primeira
 * publicação no Mercado Livre falha com mensagem clara pedindo para preencher esta tela.
 */
function PackageSettingsCard() {
  const { data: settings, isLoading, isError } = useMercadoLivrePackageSettings();
  const update = useUpdateMercadoLivrePackageSettings();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<MercadoLivrePackageSettingsFormValues>({
    resolver: zodResolver(MercadoLivrePackageSettingsFormSchema),
    values: settings
      ? {
          altura_cm: settings.altura_cm,
          largura_cm: settings.largura_cm,
          comprimento_cm: settings.comprimento_cm,
          peso_g: settings.peso_g,
        }
      : undefined,
  });

  async function onSubmit(values: MercadoLivrePackageSettingsFormValues) {
    const updated = await update.mutateAsync(values);
    reset({ altura_cm: updated.altura_cm, largura_cm: updated.largura_cm, comprimento_cm: updated.comprimento_cm, peso_g: updated.peso_g });
  }

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="font-display text-base font-semibold text-wine-900">Pacote padrão do Mercado Livre</h2>
      <p className="text-sm text-gray-600">
        Dimensões e peso da embalagem usados em toda publicação no Mercado Livre (Mercado Envios 2 exige isso em
        todo anúncio). O peso da peça, quando informado no cadastro, tem prioridade sobre o peso aqui — este é só a
        reserva.
      </p>

      {isLoading && <p className="text-sm text-gray-500">Carregando...</p>}
      {isError && <p className="text-sm text-red-600">Não foi possível carregar o pacote padrão.</p>}
      {!isLoading && !isError && !settings && (
        <p className="text-sm text-amber-700">
          Ainda não configurado — publicações no Mercado Livre vão falhar até preencher e salvar.
        </p>
      )}

      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
        <div>
          <label className={labelClass}>
            Altura (cm)
            <input type="text" inputMode="numeric" className={`${inputClass} mt-1 block w-24`} {...register("altura_cm")} />
          </label>
          {errors.altura_cm && <p className={errorClass}>{errors.altura_cm.message}</p>}
        </div>
        <div>
          <label className={labelClass}>
            Largura (cm)
            <input type="text" inputMode="numeric" className={`${inputClass} mt-1 block w-24`} {...register("largura_cm")} />
          </label>
          {errors.largura_cm && <p className={errorClass}>{errors.largura_cm.message}</p>}
        </div>
        <div>
          <label className={labelClass}>
            Comprimento (cm)
            <input type="text" inputMode="numeric" className={`${inputClass} mt-1 block w-28`} {...register("comprimento_cm")} />
          </label>
          {errors.comprimento_cm && <p className={errorClass}>{errors.comprimento_cm.message}</p>}
        </div>
        <div>
          <label className={labelClass}>
            Peso (g)
            <input type="text" inputMode="numeric" className={`${inputClass} mt-1 block w-24`} {...register("peso_g")} />
          </label>
          {errors.peso_g && <p className={errorClass}>{errors.peso_g.message}</p>}
        </div>
        <button
          type="submit"
          className="rounded-md bg-wine-800 px-4 py-2 text-sm font-medium text-gold-100 hover:bg-wine-900 disabled:opacity-50"
          disabled={update.isPending || !isDirty}
        >
          {update.isPending ? "Salvando..." : "Salvar"}
        </button>
        {settings && (
          <p className="w-full text-xs text-gray-500">
            Última atualização: {settings.updatedAt.toLocaleString("pt-BR")}.
          </p>
        )}
      </form>

      {update.isSuccess && !isDirty && <p className="text-sm text-green-700">Pacote padrão salvo.</p>}
      {update.isError && (
        <p className="text-sm text-red-600">
          {update.error instanceof Error ? update.error.message : "Não foi possível salvar o pacote padrão."}
        </p>
      )}
    </section>
  );
}

function CreateMarketplaceAccountForm() {
  const { create, startOAuth, testIntegration } = useMarketplaceAccountMutations();
  const { data: redirectUri } = useOAuthRedirectUri();
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateMarketplaceAccountFormValues>({
    resolver: zodResolver(CreateMarketplaceAccountFormSchema),
    defaultValues: { marketplace: MarketplaceEnum.options[0] },
  });
  const marketplace = watch("marketplace");
  const clientId = (watch("credential_client_id") ?? "").trim();
  const clientSecret = (watch("credential_client_secret") ?? "").trim();

  // O teste vale só para o par Client ID/Secret com que foi feito: editar qualquer um dos campos
  // invalida o resultado e o botão de criar volta a ficar bloqueado (spec 012, seção 2.4).
  const isMercadoLivre = marketplace === "mercado_livre";
  const testedPair = testIntegration.variables;
  const testMatchesFields = testedPair?.clientId === clientId && testedPair?.clientSecret === clientSecret;
  const integrationOk = testIntegration.isSuccess && testMatchesFields;
  const integrationFailed = testIntegration.isError && testMatchesFields;

  async function onSubmit(values: CreateMarketplaceAccountFormValues) {
    if (values.marketplace === "mercado_livre" && !integrationOk) {
      setError("root", { message: "Teste a integração com o Mercado Livre antes de criar a conta." });
      return;
    }
    try {
      const account = await create.mutateAsync(values);
      if (values.marketplace === "mercado_livre") {
        // Os tokens não são digitados: leva o admin ao Mercado Livre para autorizar o aplicativo
        // (spec 012, seção 2.2). A conta já existe e, se ele desistir, fica "Desconectada" na
        // lista, com o botão Conectar.
        const { authorizationUrl } = await startOAuth.mutateAsync(account.id);
        window.location.assign(authorizationUrl);
        return;
      }
      reset({ marketplace: values.marketplace });
    } catch (err) {
      setError("root", { message: err instanceof Error ? err.message : "Não foi possível criar." });
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      noValidate
    >
      <div>
        <select className={`${inputClass} w-40`} {...register("marketplace")}>
          {MarketplaceEnum.options.map((option) => (
            <option key={option} value={option}>
              {MARKETPLACE_LABELS[option]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <input className={`${inputClass} w-48`} placeholder="Apelido da loja" {...register("label")} />
        {errors.label && <p className={errorClass}>{errors.label.message}</p>}
      </div>
      {isMercadoLivre && (
        <div>
          <label className={labelClass}>
            Usuário do Mercado Livre
            <input
              autoComplete="off"
              className={`${inputClass} mt-1 block w-72`}
              placeholder="apelido ou ID (ex.: OpenErpSampleSalesML)"
              {...register("expectedUser")}
            />
          </label>
          {errors.expectedUser && <p className={errorClass}>{errors.expectedUser.message}</p>}
        </div>
      )}
      {/* Um campo por informação da credencial, com legenda indicando o que vai em cada um
          (spec 011, seção 2.2.1) — Mercado Livre usa OAuth (spec 012): só Client ID e Client
          Secret; os tokens são obtidos ao conectar. */}
      {MARKETPLACE_CREDENTIAL_FIELDS[marketplace].map((field) => (
        <div key={field.key}>
          <label className={labelClass}>
            {field.label}
            <input
              type="password"
              autoComplete="off"
              className={`${inputClass} mt-1 block w-56`}
              placeholder={field.placeholder}
              {...register(field.key)}
            />
          </label>
          {errors[field.key] && <p className={errorClass}>{errors[field.key]?.message}</p>}
        </div>
      ))}
      {isMercadoLivre && (
        <button
          type="button"
          className="rounded-md border border-wine-800 px-4 py-2 text-sm font-medium text-wine-800 hover:bg-wine-50 disabled:opacity-50"
          disabled={!clientId || !clientSecret || testIntegration.isPending}
          onClick={() => testIntegration.mutate({ clientId, clientSecret })}
        >
          {testIntegration.isPending ? "Testando..." : "Testar integração"}
        </button>
      )}
      <button
        type="submit"
        className="rounded-md bg-wine-800 px-4 py-2 text-sm font-medium text-gold-100 hover:bg-wine-900 disabled:opacity-50"
        disabled={create.isPending || startOAuth.isPending || (isMercadoLivre && !integrationOk)}
        title={isMercadoLivre && !integrationOk ? "Teste a integração com sucesso para liberar" : undefined}
      >
        {create.isPending || startOAuth.isPending
          ? "Criando..."
          : isMercadoLivre
            ? "Criar e conectar ao Mercado Livre"
            : "+ Nova conta"}
      </button>
      {isMercadoLivre && integrationOk && (
        <p className="w-full text-sm text-green-700" role="status">
          Integração OK — Mercado Livre respondeu em GET /users/me
          {testIntegration.data.nickname ? ` (${testIntegration.data.nickname})` : ""}.
        </p>
      )}
      {isMercadoLivre && integrationFailed && (
        <p className={`${errorClass} w-full`} role="alert">
          Teste de integração falhou:{" "}
          {testIntegration.error instanceof Error ? testIntegration.error.message : "erro desconhecido."}
        </p>
      )}
      {errors.root?.message && <p className={errorClass}>{errors.root.message}</p>}
      {isMercadoLivre && (
        <p className="w-full text-xs text-gray-500">
          Informe o usuário do Mercado Livre que esta conta vai usar (o ERP confere, depois da autorização, se foi
          ele mesmo que autorizou), o Client ID e o Client Secret do seu aplicativo no Mercado Livre e clique em{" "}
          <strong>Testar integração</strong> — o botão de criar só é liberado depois que o teste passar. Ao criar, você
          será levado ao Mercado Livre para autorizar a conta — os tokens de acesso são obtidos e renovados
          automaticamente. No aplicativo, cadastre esta URL como <strong>URL de redirecionamento</strong>:{" "}
          <span className="select-all break-all font-mono">{redirectUri ?? "..."}</span>
        </p>
      )}
    </form>
  );
}

function EditMarketplaceAccountRow({ account, onDone }: { account: MarketplaceAccount; onDone: () => void }) {
  const { update } = useMarketplaceAccountMutations();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditMarketplaceAccountFormValues>({
    resolver: zodResolver(EditMarketplaceAccountFormSchema),
    defaultValues: {
      marketplace: account.marketplace,
      label: account.label,
      credential: "",
      credential_client_id: "",
      credential_client_secret: "",
      expectedUser: "",
    },
  });

  const credentialError = MARKETPLACE_CREDENTIAL_FIELDS[account.marketplace]
    .map((field) => errors[field.key]?.message)
    .find(Boolean);

  async function onSubmit(values: EditMarketplaceAccountFormValues) {
    await update.mutateAsync({ id: account.id, values });
    onDone();
  }

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
      <input className={`${inputClass} w-40`} {...register("label")} />
      {account.marketplace === "mercado_livre" && (
        <label className={labelClass}>
          Usuário do Mercado Livre
          <input
            autoComplete="off"
            className={`${inputClass} mt-1 block w-56`}
            placeholder={account.expectedUser ?? "apelido ou ID"}
            {...register("expectedUser")}
          />
        </label>
      )}
      {MARKETPLACE_CREDENTIAL_FIELDS[account.marketplace].map((field) => (
        <label key={field.key} className={labelClass}>
          {field.label}
          <input
            type="password"
            autoComplete="off"
            className={`${inputClass} mt-1 block w-48`}
            placeholder="Deixe em branco pra manter"
            {...register(field.key)}
          />
        </label>
      ))}
      <button type="submit" className="text-sm text-wine-700 hover:underline" disabled={update.isPending}>
        Salvar
      </button>
      <button type="button" className="text-sm text-gray-500 hover:underline" onClick={onDone}>
        Cancelar
      </button>
      {errors.label && <p className={errorClass}>Preencha o apelido.</p>}
      {credentialError && <p className={`${errorClass} w-full`}>{credentialError}</p>}
      {account.marketplace === "mercado_livre" && (
        <p className="w-full text-xs text-gray-500">
          Trocar o Client ID/Secret ou o usuário do Mercado Livre desconecta a conta — conecte de novo depois para
          obter os tokens.
        </p>
      )}
    </form>
  );
}

export function MarketplaceAccountsPage() {
  const { data: accounts, isLoading, isError } = useMarketplaceAccounts();
  const { updateStatus, startOAuth, disconnect, remove } = useMarketplaceAccountMutations();
  const [editingId, setEditingId] = useState<string | null>(null);
  // Desconectar e Apagar pedem confirmação inline, na própria linha (mesmo padrão do botão de
  // rotacionar a chave): descartam tokens / removem o registro, e o segundo é irreversível.
  const [pending, setPending] = useState<{ id: string; action: "disconnect" | "delete" } | null>(null);

  async function connect(account: MarketplaceAccount) {
    const { authorizationUrl } = await startOAuth.mutateAsync(account.id).catch(() => ({ authorizationUrl: "" }));
    if (authorizationUrl) window.location.assign(authorizationUrl);
  }

  function askConfirmation(id: string, action: "disconnect" | "delete") {
    disconnect.reset();
    remove.reset();
    updateStatus.reset();
    setPending({ id, action });
  }

  async function confirmPending() {
    if (!pending) return;
    const { id, action } = pending;
    try {
      await (action === "disconnect" ? disconnect.mutateAsync(id) : remove.mutateAsync(id));
    } catch {
      // A mensagem do backend (ex.: passo fora de ordem) aparece abaixo da tabela.
    }
    setPending(null);
  }

  const columns: TableColumn<MarketplaceAccount>[] = [
    {
      key: "marketplace",
      header: "Marketplace",
      render: (a) => MARKETPLACE_LABELS[a.marketplace],
    },
    {
      key: "label",
      header: "Conta",
      render: (a) =>
        editingId === a.id ? (
          <EditMarketplaceAccountRow account={a} onDone={() => setEditingId(null)} />
        ) : (
          a.label
        ),
    },
    {
      key: "mlUser",
      header: "Usuário ML",
      render: (a) =>
        a.marketplace !== "mercado_livre" ? (
          "—"
        ) : (
          (a.connectedNickname ?? a.expectedUser ?? <span className="text-gray-400">não informado</span>)
        ),
    },
    {
      key: "credentialPreview",
      header: "Credencial",
      render: (a) => <span className="font-mono">{a.credentialPreview}</span>,
    },
    {
      key: "connectionStatus",
      header: "Conexão",
      render: (a) => (
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CONNECTION_STATUS_BADGE[a.connectionStatus]}`}
        >
          {CONNECTION_STATUS_LABELS[a.connectionStatus]}
        </span>
      ),
    },
    {
      key: "active",
      header: "Status",
      render: (a) => (
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            a.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
          }`}
        >
          {a.active ? "Ativa" : "Inativa"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Ações",
      render: (a) => {
        if (editingId === a.id) return null;

        if (pending?.id === a.id) {
          const isDelete = pending.action === "delete";
          return (
            <div className="space-y-2">
              <p className="max-w-xs text-xs text-gray-600">
                {isDelete
                  ? "Apagar definitivamente esta conta? Não dá para desfazer. Anúncios já publicados continuam no marketplace, mas não será mais possível republicar por ela."
                  : "Desconectar descarta os tokens de acesso desta conta. Para usá-la de novo será preciso reconectar."}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="text-sm font-medium text-red-700 hover:underline disabled:opacity-50"
                  disabled={disconnect.isPending || remove.isPending}
                  onClick={() => void confirmPending()}
                >
                  {isDelete ? "Confirmar e apagar" : "Confirmar e desconectar"}
                </button>
                <button type="button" className="text-sm text-gray-500 hover:underline" onClick={() => setPending(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          );
        }

        // Desconectar → Desativar → Apagar (spec 011, seção 2.2.2): cada linha mostra só o próximo
        // passo válido; o backend também impõe a ordem.
        const disconnected = a.connectionStatus === "disconnected";
        return (
          <div className="flex flex-wrap gap-3">
            <button type="button" className="text-sm text-wine-700 hover:underline" onClick={() => setEditingId(a.id)}>
              Editar
            </button>
            {a.marketplace === "mercado_livre" && a.active && a.connectionStatus !== "connected" && (
              <button
                type="button"
                className="text-sm font-medium text-wine-800 hover:underline disabled:opacity-50"
                disabled={startOAuth.isPending}
                onClick={() => void connect(a)}
              >
                {a.connectionStatus === "disconnected" ? "Conectar" : "Reconectar"}
              </button>
            )}
            {!disconnected && (
              <button
                type="button"
                className="text-sm text-gray-600 hover:underline"
                onClick={() => askConfirmation(a.id, "disconnect")}
              >
                Desconectar
              </button>
            )}
            {(!a.active || disconnected) && (
              <button
                type="button"
                className="text-sm text-gray-600 hover:underline disabled:opacity-50"
                disabled={updateStatus.isPending}
                onClick={() => void updateStatus.mutateAsync({ id: a.id, active: !a.active }).catch(() => undefined)}
              >
                {a.active ? "Desativar" : "Ativar"}
              </button>
            )}
            {!a.active && (
              <button
                type="button"
                className="text-sm text-red-700 hover:underline disabled:opacity-50"
                disabled={!disconnected}
                title={disconnected ? undefined : "Desconecte a conta antes de apagá-la"}
                onClick={() => askConfirmation(a.id, "delete")}
              >
                Apagar
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const lifecycleError = [disconnect, remove, updateStatus].find((mutation) => mutation.isError)?.error;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-wine-900">Contas de marketplace</h1>
      <p className="text-sm text-gray-600">
        Restrito a administradores (spec 011) — a credencial completa nunca é exibida aqui, só um
        trecho mascarado.
      </p>

      <EncryptionKeyCard />

      <PackageSettingsCard />

      <CreateMarketplaceAccountForm />

      {startOAuth.isError && (
        <p className="text-sm text-red-600">
          {startOAuth.error instanceof Error ? startOAuth.error.message : "Não foi possível iniciar a conexão."}
        </p>
      )}
      {lifecycleError && (
        <p className="text-sm text-red-600" role="alert">
          {lifecycleError instanceof Error ? lifecycleError.message : "Não foi possível concluir a operação."}
        </p>
      )}
      {isLoading && <p className="text-sm text-gray-500">Carregando...</p>}
      {isError && <p className="text-sm text-red-600">Não foi possível carregar as contas de marketplace.</p>}
      {accounts && (
        <Table
          columns={columns}
          rows={accounts}
          rowKey={(a) => a.id}
          emptyMessage="Nenhuma conta de marketplace cadastrada."
        />
      )}
    </div>
  );
}
