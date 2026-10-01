import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/Badge";
import { Table, type TableColumn } from "../../components/Table";
import { useUserMutations, useUsers } from "../../hooks/useUsers";
import type { User } from "../../schemas/user.schema";

const ROLE_LABELS: Record<User["role"], string> = {
  admin: "Administrador",
  operator: "Operador",
  viewer: "Consulta",
};

export function UsersPage() {
  const [search, setSearch] = useState("");
  const { data: users, isLoading, isError } = useUsers(search || undefined);
  const { updateStatus } = useUserMutations();

  function toggleActive(user: User) {
    const nextStatus = user.status === "active" ? "inactive" : "active";
    void updateStatus.mutateAsync({ id: user.id, status: nextStatus });
  }

  const columns: TableColumn<User>[] = [
    { key: "name", header: "Nome", render: (u) => u.name },
    { key: "email", header: "E-mail", render: (u) => u.email },
    { key: "role", header: "Perfil", render: (u) => ROLE_LABELS[u.role] },
    { key: "status", header: "Status", render: (u) => <Badge status={u.status} /> },
    {
      key: "actions",
      header: "Ações",
      render: (u) => (
        <div className="flex gap-3">
          <Link className="text-sm text-wine-700 hover:underline" to={`/admin/users/${u.id}`}>
            Editar
          </Link>
          <button
            type="button"
            className="text-sm text-gray-600 hover:underline disabled:opacity-50"
            disabled={updateStatus.isPending}
            onClick={() => toggleActive(u)}
          >
            {u.status === "active" ? "Desativar" : "Ativar"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-wine-900">Usuários</h1>
        <Link
          className="rounded-md bg-wine-800 px-4 py-2 text-sm font-medium text-gold-100 hover:bg-wine-900"
          to="/admin/users/new"
        >
          + Novo usuário
        </Link>
      </div>

      <input
        type="search"
        placeholder="Buscar por nome ou e-mail..."
        className="block w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-wine-600 focus:outline-none focus:ring-1 focus:ring-wine-600"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {isLoading && <p className="text-sm text-gray-500">Carregando...</p>}
      {isError && <p className="text-sm text-red-600">Não foi possível carregar os usuários.</p>}
      {users && (
        <Table
          columns={columns}
          rows={users}
          rowKey={(u) => u.id}
          emptyMessage="Nenhum usuário encontrado."
        />
      )}
    </div>
  );
}
