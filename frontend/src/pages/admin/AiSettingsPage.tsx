import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useAiSettings, useUpdateAiSettings } from "../../hooks/useAiSettings";
import { AiSettingsFormSchema, type AiSettingsFormValues } from "../../schemas/ai-settings.schema";

const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-wine-600 focus:outline-none focus:ring-1 focus:ring-wine-600";
const labelClass = "block text-sm font-medium text-gray-700";
const errorClass = "mt-1 text-sm text-red-600";

/**
 * Configuração do provedor de IA (spec 013) — substitui `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL`
 * do `.env` (spec 006, seção 5). `apiKey` **nunca** vem pré-preenchida (nem com o valor real,
 * nem com o preview mascarado) — o campo começa sempre em branco; deixar em branco no submit
 * preserva a chave já salva.
 */
export function AiSettingsPage() {
  const { data: settings, isLoading, isError } = useAiSettings();
  const update = useUpdateAiSettings();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<AiSettingsFormValues>({
    resolver: zodResolver(AiSettingsFormSchema),
    values: settings ? { baseUrl: settings.baseUrl, model: settings.model, apiKey: "" } : undefined,
  });

  async function onSubmit(values: AiSettingsFormValues) {
    const updated = await update.mutateAsync(values);
    reset({ baseUrl: updated.baseUrl, model: updated.model, apiKey: "" });
  }

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="font-display text-2xl font-bold text-wine-900">Configuração de IA</h1>
      <p className="text-sm text-gray-600">
        Provedor de IA usado no cadastro e na reavaliação de peças (specs 006/013) — qualquer
        endpoint compatível com a API de Chat Completions da OpenAI (OpenAI, OpenRouter, Groq,
        um servidor self-hosted etc.).
      </p>

      {isLoading && <p className="text-sm text-gray-500">Carregando...</p>}
      {isError && <p className={errorClass}>Não foi possível carregar a configuração.</p>}
      {!isLoading && !isError && !settings && (
        <p className="text-sm text-amber-700">
          Ainda não configurado — cadastro e reavaliação por IA vão falhar até preencher e salvar.
        </p>
      )}

      <form className="space-y-4 rounded-lg border border-gray-200 bg-white p-4" onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
        <div>
          <label className={labelClass}>
            URL base
            <input className={inputClass} type="text" placeholder="https://openrouter.ai/api/v1" {...register("baseUrl")} />
          </label>
          <p className="mt-1 text-xs text-gray-500">Em branco = API oficial da OpenAI.</p>
        </div>

        <div>
          <label className={labelClass}>
            Modelo
            <input className={inputClass} type="text" placeholder="gpt-4o-mini" {...register("model")} />
          </label>
        </div>

        <div>
          <label className={labelClass}>
            API key
            <input
              className={inputClass}
              type="password"
              placeholder={settings ? `${settings.apiKeyPreview} — informe um novo valor pra trocar` : "sk-..."}
              autoComplete="off"
              {...register("apiKey")}
            />
          </label>
          {errors.apiKey && <p className={errorClass}>{errors.apiKey.message}</p>}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-wine-800 px-4 py-2 text-sm font-medium text-gold-100 hover:bg-wine-900 disabled:opacity-50"
            disabled={update.isPending || !isDirty}
          >
            {update.isPending ? "Salvando..." : "Salvar configuração"}
          </button>
          {update.isSuccess && !isDirty && (
            <p className="text-sm text-green-700" role="status">
              Configuração salva.
            </p>
          )}
        </div>

        {settings && <p className="text-xs text-gray-500">Última atualização: {settings.updatedAt.toLocaleString("pt-BR")}.</p>}

        {update.isError && (
          <p className={errorClass} role="alert">
            {update.error instanceof Error ? update.error.message : "Não foi possível salvar a configuração."}
          </p>
        )}
      </form>
    </div>
  );
}
