import type { ReactNode } from "react";

/** Contêiner visual genérico (borda + fundo branco + sombra leve) — base do ProductCard. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>
  );
}
