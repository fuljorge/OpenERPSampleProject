import { useState } from "react";
import { Table, type TableColumn } from "../../components/Table";
import { useAuditLogs } from "../../hooks/useAuditLogs";
import { AuditActionEnum, type AuditAction, type AuditLogEntry } from "../../schemas/audit-log.schema";

const ACTION_LABELS: Record<AuditAction, string> = {
  LOGIN_SUCCESS: "Login bem-sucedido",
  LOGIN_FAILED: "Login falho",
  USER_CREATE: "Usuário criado",
  USER_UPDATE: "Usuário atualizado",
  USER_DISABLE: "Usuário desativado",
  PRODUCT_CREATE: "Produto criado",
  PRODUCT_UPDATE: "Produto atualizado",
  PRODUCT_DISABLE: "Produto desativado",
  PRODUCT_PUBLISH: "Produto publicado",
  PRODUCT_UNPUBLISH: "Anúncio encerrado",
  PRODUCT_SOLD: "Produto vendido",
  PRICE_UPDATE: "Preço alterado",
  CATEGORY_CREATE: "Categoria criada",
  CATEGORY_UPDATE: "Categoria atualizada",
  CATEGORY_DISABLE: "Categoria desativada",
  MARKETPLACE_ACCOUNT_CREATE: "Conta de marketplace criada",
  MARKETPLACE_ACCOUNT_UPDATE: "Conta de marketplace atualizada",
  MARKETPLACE_ACCOUNT_DISABLE: "Conta de marketplace desativada",
  MARKETPLACE_ACCOUNT_DISCONNECT: "Conta de marketplace desconectada",
  MARKETPLACE_ACCOUNT_DELETE: "Conta de marketplace apagada",
  MARKETPLACE_ACCOUNT_VIEW: "Conta de marketplace consultada",
  MARKETPLACE_CREDENTIAL_KEY_ROTATE: "Chave de criptografia rotacionada",
  MERCADO_LIVRE_PACKAGE_SETTINGS_UPDATE: "Pacote padrão do Mercado Livre atualizado",
  AI_SETTINGS_UPDATE: "Configuração do provedor de IA atualizada",
};

const selectClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-wine-600 focus:outline-none focus:ring-1 focus:ring-wine-600";

export function AuditLogsPage() {
  const [action, setAction] = useState<AuditAction | "">("");
  const [entity, setEntity] = useState("");
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, isError } = useAuditLogs({
    action: action || undefined,
    entity: entity || undefined,
    page,
    limit,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const columns: TableColumn<AuditLogEntry>[] = [
    {
      key: "timestamp",
      header: "Quando",
      render: (log) => new Date(log.timestamp).toLocaleString("pt-BR"),
    },
    { key: "action", header: "Ação", render: (log) => ACTION_LABELS[log.action] },
    {
      key: "entity",
      header: "Entidade",
      render: (log) => `${log.entity}${log.entityId ? ` · ${log.entityId}` : ""}`,
    },
    { key: "userId", header: "Usuário", render: (log) => log.userId ?? "—" },
    {
      key: "metadata",
      header: "Detalhes",
      render: (log) =>
        log.metadata ? (
          <code className="text-xs text-gray-600">{JSON.stringify(log.metadata)}</code>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-wine-900">Auditoria</h1>

      <div className="flex flex-wrap gap-3">
        <select
          className={selectClass}
          value={action}
          onChange={(e) => {
            setAction(e.target.value as AuditAction | "");
            setPage(1);
          }}
        >
          <option value="">Todas as ações</option>
          {AuditActionEnum.options.map((option) => (
            <option key={option} value={option}>
              {ACTION_LABELS[option]}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Filtrar por entidade (ex.: user, product)..."
          className={`${selectClass} w-64`}
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {isLoading && <p className="text-sm text-gray-500">Carregando...</p>}
      {isError && <p className="text-sm text-red-600">Não foi possível carregar a auditoria.</p>}
      {data && (
        <>
          <Table
            columns={columns}
            rows={data.items}
            rowKey={(log) => log.id}
            emptyMessage="Nenhum registro de auditoria encontrado."
          />

          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>
              Página {data.page} de {totalPages} · {data.total} registro{data.total === 1 ? "" : "s"}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
