import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { LoginFormSchema, type LoginFormValues } from "../schemas/auth.schema";
import { ApiError } from "../services/auth.service";

interface LocationState {
  from?: string;
}

const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-wine-600 focus:outline-none focus:ring-1 focus:ring-wine-600";

export function LoginPage() {
  const { user, isLoading, login, isLoggingIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginFormValues>({ resolver: zodResolver(LoginFormSchema) });

  const redirectTo = (location.state as LocationState | null)?.from ?? "/";

  // Já autenticado (ex.: acessou /login diretamente com sessão ativa) — não mostra o form.
  if (!isLoading && user) {
    return <Navigate to={redirectTo} replace />;
  }

  async function onSubmit(values: LoginFormValues) {
    try {
      await login(values);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      // Mensagem sempre genérica — o backend já não revela se o e-mail existe (spec 001,
      // seção 6); aqui só repassamos o que veio da API ou um fallback igualmente genérico.
      const message =
        err instanceof ApiError ? err.message : "Não foi possível entrar. Tente novamente.";
      setError("root", { message });
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-wine-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-gold-400">ERP para Brechó</p>
          <h1 className="font-display text-4xl font-bold text-gold-300">OpenERP Sample</h1>
          <p className="mt-1 text-xs uppercase tracking-wide text-wine-200">ERP · Backoffice</p>
        </div>

        <div className="rounded-lg bg-cream-50 p-8 shadow-xl">
          <h2 className="mb-6 text-lg font-semibold text-wine-900">Entrar</h2>
          <form className="space-y-4" onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                E-mail
                <input
                  className={inputClass}
                  type="email"
                  autoComplete="username"
                  {...register("email")}
                />
              </label>
              {errors.email && <p className="mt-1 text-sm text-red-600" role="alert">{errors.email.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Senha
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="current-password"
                  {...register("password")}
                />
              </label>
              {errors.password && (
                <p className="mt-1 text-sm text-red-600" role="alert">
                  {errors.password.message}
                </p>
              )}
            </div>

            {errors.root?.message && (
              <p className="text-sm text-red-600" role="alert">
                {errors.root.message}
              </p>
            )}

            <button
              type="submit"
              className="w-full rounded-md bg-wine-800 px-4 py-2.5 text-sm font-semibold text-gold-100 transition hover:bg-wine-900 disabled:opacity-50"
              disabled={isLoggingIn}
            >
              {isLoggingIn ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
