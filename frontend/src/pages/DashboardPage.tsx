import { Card } from "../components/Card";
import { useDashboardSummary } from "../hooks/useDashboardSummary";
import type { DashboardSummary } from "../schemas/dashboard.schema";

const INDICATORS: { key: keyof DashboardSummary; label: string }[] = [
  { key: "disponiveis", label: "Produtos disponíveis" },
  { key: "cadastradosHoje", label: "Produtos cadastrados hoje" },
  { key: "vendidos", label: "Produtos vendidos" },
  { key: "emRevisao", label: "Produtos em revisão" },
  { key: "semPreco", label: "Produtos sem preço" },
  { key: "semImagens", label: "Produtos sem imagens" },
];

/** Tela inicial pós-login (spec 009) — 6 indicadores agregados de `products`, sem cache
 * (constituição, princípio V). Evolução futura (faturamento, ticket médio etc.) fica de fora
 * do MVP — ver spec, seção 5. */
export function DashboardPage() {
  const { data, isLoading, isError } = useDashboardSummary();

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-wine-900">Dashboard</h1>

      {isLoading && <p className="text-sm text-gray-500">Carregando...</p>}
      {isError && <p className="text-sm text-red-600">Não foi possível carregar os indicadores.</p>}

      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INDICATORS.map((indicator) => (
            <Card key={indicator.key}>
              <p className="text-sm text-gray-500">{indicator.label}</p>
              <p className="mt-1 font-display text-3xl font-bold text-wine-900">{data[indicator.key]}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
