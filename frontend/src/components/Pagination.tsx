interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** Paginação simples anterior/próxima (002-usuários não paginava; reutilizável a partir de 005). */
export function Pagination({ page, limit, total, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between text-sm text-gray-600">
      <span>
        Página {page} de {totalPages} · {total} produto{total === 1 ? "" : "s"}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
