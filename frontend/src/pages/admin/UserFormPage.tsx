import { useNavigate, useParams } from "react-router-dom";
import { UserForm } from "../../components/UserForm";
import { useUser, useUserMutations } from "../../hooks/useUsers";
import type { CreateUserFormValues, EditUserFormValues } from "../../schemas/user.schema";

export function UserFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { create, update } = useUserMutations();

  if (id) {
    return <EditUserFormSection id={id} onDone={() => navigate("/admin/users")} update={update} />;
  }

  async function handleCreate(values: CreateUserFormValues) {
    const { confirmPassword: _confirmPassword, ...payload } = values;
    await create.mutateAsync(payload);
    navigate("/admin/users");
  }

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="font-display text-2xl font-bold text-wine-900">Novo usuário</h1>
      <UserForm mode="create" onSubmit={handleCreate} isSubmitting={create.isPending} />
    </div>
  );
}

function EditUserFormSection({
  id,
  onDone,
  update,
}: {
  id: string;
  onDone: () => void;
  update: ReturnType<typeof useUserMutations>["update"];
}) {
  const { data: user, isLoading, isError } = useUser(id);

  async function handleUpdate(values: EditUserFormValues) {
    await update.mutateAsync({ id, values });
    onDone();
  }

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="font-display text-2xl font-bold text-wine-900">Editar usuário</h1>
      {isLoading && <p className="text-sm text-gray-500">Carregando...</p>}
      {isError && <p className="text-sm text-red-600">Usuário não encontrado.</p>}
      {user && <UserForm mode="edit" user={user} onSubmit={handleUpdate} isSubmitting={update.isPending} />}
    </div>
  );
}
