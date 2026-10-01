import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  CreateUserFormSchema,
  EditUserFormSchema,
  RoleEnum,
  StatusEnum,
  type CreateUserFormValues,
  type EditUserFormValues,
  type User,
} from "../schemas/user.schema";

const ROLE_LABELS: Record<(typeof RoleEnum.options)[number], string> = {
  admin: "Administrador",
  operator: "Operador",
  viewer: "Consulta",
};

const STATUS_LABELS: Record<(typeof StatusEnum.options)[number], string> = {
  active: "Ativo",
  inactive: "Inativo",
  blocked: "Bloqueado",
};

const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-wine-600 focus:outline-none focus:ring-1 focus:ring-wine-600";
const labelClass = "block text-sm font-medium text-gray-700";
const errorClass = "mt-1 text-sm text-red-600";
const buttonClass =
  "rounded-md bg-wine-800 px-4 py-2 text-sm font-medium text-gold-100 hover:bg-wine-900 disabled:opacity-50";

type UserFormProps =
  | {
      mode: "create";
      onSubmit: (values: CreateUserFormValues) => Promise<void>;
      isSubmitting: boolean;
    }
  | {
      mode: "edit";
      user: User;
      onSubmit: (values: EditUserFormValues) => Promise<void>;
      isSubmitting: boolean;
    };

export function UserForm(props: UserFormProps) {
  if (props.mode === "create") {
    return <CreateUserForm onSubmit={props.onSubmit} isSubmitting={props.isSubmitting} />;
  }
  return <EditUserForm user={props.user} onSubmit={props.onSubmit} isSubmitting={props.isSubmitting} />;
}

function CreateUserForm({
  onSubmit,
  isSubmitting,
}: {
  onSubmit: (values: CreateUserFormValues) => Promise<void>;
  isSubmitting: boolean;
}) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CreateUserFormValues>({
    resolver: zodResolver(CreateUserFormSchema),
    defaultValues: { role: "operator", status: "active" },
  });

  async function submit(values: CreateUserFormValues) {
    try {
      await onSubmit(values);
    } catch (err) {
      setError("root", { message: err instanceof Error ? err.message : "Não foi possível salvar." });
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void handleSubmit(submit)(e)} noValidate>
      <div>
        <label className={labelClass}>
          Nome
          <input className={inputClass} type="text" {...register("name")} />
        </label>
        {errors.name && <p className={errorClass}>{errors.name.message}</p>}
      </div>

      <div>
        <label className={labelClass}>
          E-mail
          <input className={inputClass} type="email" {...register("email")} />
        </label>
        {errors.email && <p className={errorClass}>{errors.email.message}</p>}
      </div>

      <div>
        <label className={labelClass}>
          Senha temporária
          <input className={inputClass} type="password" {...register("password")} />
        </label>
        {errors.password && <p className={errorClass}>{errors.password.message}</p>}
      </div>

      <div>
        <label className={labelClass}>
          Confirmar senha
          <input className={inputClass} type="password" {...register("confirmPassword")} />
        </label>
        {errors.confirmPassword && <p className={errorClass}>{errors.confirmPassword.message}</p>}
      </div>

      <div>
        <label className={labelClass}>
          Perfil
          <select className={inputClass} {...register("role")}>
            {RoleEnum.options.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <label className={labelClass}>
          Status
          <select className={inputClass} {...register("status")}>
            {StatusEnum.options.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {errors.root?.message && <p className={errorClass}>{errors.root.message}</p>}

      <button type="submit" className={buttonClass} disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : "Criar usuário"}
      </button>
    </form>
  );
}

function EditUserForm({
  user,
  onSubmit,
  isSubmitting,
}: {
  user: User;
  onSubmit: (values: EditUserFormValues) => Promise<void>;
  isSubmitting: boolean;
}) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<EditUserFormValues>({
    resolver: zodResolver(EditUserFormSchema),
    defaultValues: { name: user.name, role: user.role },
  });

  async function submit(values: EditUserFormValues) {
    try {
      await onSubmit(values);
    } catch (err) {
      setError("root", { message: err instanceof Error ? err.message : "Não foi possível salvar." });
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void handleSubmit(submit)(e)} noValidate>
      <div>
        <label className={labelClass}>
          Nome
          <input className={inputClass} type="text" {...register("name")} />
        </label>
        {errors.name && <p className={errorClass}>{errors.name.message}</p>}
      </div>

      <div>
        <label className={labelClass}>
          E-mail
          <input className={`${inputClass} bg-gray-100`} type="email" value={user.email} disabled readOnly />
        </label>
        <p className="mt-1 text-xs text-gray-500">O e-mail não pode ser alterado.</p>
      </div>

      <div>
        <label className={labelClass}>
          Perfil
          <select className={inputClass} {...register("role")}>
            {RoleEnum.options.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {errors.root?.message && <p className={errorClass}>{errors.root.message}</p>}

      <button type="submit" className={buttonClass} disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : "Salvar alterações"}
      </button>
    </form>
  );
}
