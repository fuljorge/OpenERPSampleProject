import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Table, type TableColumn } from "../../components/Table";
import { useCategories, useCategoryMutations } from "../../hooks/useCategories";
import {
  CreateCategoryFormSchema,
  EditCategoryFormSchema,
  type Category,
  type CreateCategoryFormValues,
  type EditCategoryFormValues,
} from "../../schemas/category.schema";

const inputClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-wine-600 focus:outline-none focus:ring-1 focus:ring-wine-600";
const errorClass = "mt-1 text-xs text-red-600";

function CreateCategoryForm() {
  const { create } = useCategoryMutations();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateCategoryFormValues>({ resolver: zodResolver(CreateCategoryFormSchema) });

  async function onSubmit(values: CreateCategoryFormValues) {
    try {
      await create.mutateAsync(values);
      reset();
    } catch (err) {
      setError("root", { message: err instanceof Error ? err.message : "Não foi possível criar." });
    }
  }

  return (
    <form
      className="flex flex-wrap items-start gap-3 rounded-lg border border-gray-200 bg-white p-4"
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      noValidate
    >
      <div>
        <input className={`${inputClass} w-24`} placeholder="Código" {...register("code")} />
        {errors.code && <p className={errorClass}>{errors.code.message}</p>}
      </div>
      <div>
        <input className={`${inputClass} w-48`} placeholder="Nome" {...register("name")} />
        {errors.name && <p className={errorClass}>{errors.name.message}</p>}
      </div>
      <div>
        <input className={`${inputClass} w-40`} placeholder="Departamento" {...register("department")} />
        {errors.department && <p className={errorClass}>{errors.department.message}</p>}
      </div>
      <button
        type="submit"
        className="rounded-md bg-wine-800 px-4 py-2 text-sm font-medium text-gold-100 hover:bg-wine-900 disabled:opacity-50"
        disabled={create.isPending}
      >
        {create.isPending ? "Criando..." : "+ Nova categoria"}
      </button>
      {errors.root?.message && <p className={errorClass}>{errors.root.message}</p>}
    </form>
  );
}

function EditCategoryRow({ category, onDone }: { category: Category; onDone: () => void }) {
  const { update } = useCategoryMutations();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditCategoryFormValues>({
    resolver: zodResolver(EditCategoryFormSchema),
    defaultValues: { name: category.name, department: category.department },
  });

  async function onSubmit(values: EditCategoryFormValues) {
    await update.mutateAsync({ id: category.id, values });
    onDone();
  }

  return (
    <form className="flex items-center gap-2" onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
      <input className={`${inputClass} w-40`} {...register("name")} />
      <input className={`${inputClass} w-32`} {...register("department")} />
      <button type="submit" className="text-sm text-wine-700 hover:underline" disabled={update.isPending}>
        Salvar
      </button>
      <button type="button" className="text-sm text-gray-500 hover:underline" onClick={onDone}>
        Cancelar
      </button>
      {(errors.name ?? errors.department) && <p className={errorClass}>Preencha os campos.</p>}
    </form>
  );
}

export function CategoriesPage() {
  const { data: categories, isLoading, isError } = useCategories();
  const { updateStatus } = useCategoryMutations();
  const [editingId, setEditingId] = useState<string | null>(null);

  const columns: TableColumn<Category>[] = [
    { key: "code", header: "Código", render: (c) => <span className="font-mono">{c.code}</span> },
    {
      key: "name",
      header: "Nome / Departamento",
      render: (c) =>
        editingId === c.id ? (
          <EditCategoryRow category={c} onDone={() => setEditingId(null)} />
        ) : (
          `${c.name} · ${c.department}`
        ),
    },
    {
      key: "active",
      header: "Status",
      render: (c) => (
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            c.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
          }`}
        >
          {c.active ? "Ativa" : "Inativa"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Ações",
      render: (c) =>
        editingId === c.id ? null : (
          <div className="flex gap-3">
            <button type="button" className="text-sm text-wine-700 hover:underline" onClick={() => setEditingId(c.id)}>
              Editar
            </button>
            <button
              type="button"
              className="text-sm text-gray-600 hover:underline disabled:opacity-50"
              disabled={updateStatus.isPending}
              onClick={() => void updateStatus.mutateAsync({ id: c.id, active: !c.active })}
            >
              {c.active ? "Desativar" : "Ativar"}
            </button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-wine-900">Categorias</h1>

      <CreateCategoryForm />

      {isLoading && <p className="text-sm text-gray-500">Carregando...</p>}
      {isError && <p className="text-sm text-red-600">Não foi possível carregar as categorias.</p>}
      {categories && (
        <Table
          columns={columns}
          rows={categories}
          rowKey={(c) => c.id}
          emptyMessage="Nenhuma categoria cadastrada."
        />
      )}
    </div>
  );
}
