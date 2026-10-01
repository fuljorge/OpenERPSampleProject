import type { ReactNode } from "react";

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}

/** Sombra sutil à esquerda da última coluna — sinaliza que ela continua fixa enquanto o resto
 * da tabela rola por baixo (relevante em telas estreitas, onde a tabela costuma ser mais larga
 * que a viewport). */
const stickyLastColumnShadow = "shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.08)]";

/**
 * Tabela genérica reutilizável (002-usuários, também usada em 005-produtos). Em telas estreitas
 * a tabela rola horizontalmente (`overflow-x-auto`) — a **última coluna fica fixa à direita**
 * (`position: sticky`), então a coluna de ações (convenção: sempre a última) continua acessível
 * sem o usuário precisar descobrir que dá pra arrastar a tabela pra ver mais.
 */
export function Table<T>({ columns, rows, rowKey, emptyMessage = "Nenhum registro encontrado." }: TableProps<T>) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((column, index) => (
              <th
                key={column.key}
                scope="col"
                className={`px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 ${
                  index === columns.length - 1 ? `sticky right-0 bg-gray-50 ${stickyLastColumnShadow}` : ""
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="group hover:bg-gray-50">
              {columns.map((column, index) => (
                <td
                  key={column.key}
                  className={`px-4 py-2 text-sm text-gray-700 ${
                    index === columns.length - 1
                      ? `sticky right-0 bg-white group-hover:bg-gray-50 ${stickyLastColumnShadow}`
                      : ""
                  }`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
