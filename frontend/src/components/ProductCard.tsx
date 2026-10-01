import { useState } from "react";
import { MOEDA_LOCALES, PRODUCT_STATUS_LABELS, type Moeda, type Product } from "../schemas/product.schema";
import { Card } from "./Card";
import { ImageLightbox } from "./ImageLightbox";

const PRODUCT_STATUS_STYLES: Record<Product["status"], string> = {
  rascunho: "bg-gray-100 text-gray-600",
  em_revisao: "bg-amber-100 text-amber-800",
  disponivel: "bg-green-100 text-green-800",
  reservado: "bg-blue-100 text-blue-800",
  vendido: "bg-wine-100 text-wine-800",
  inativo: "bg-red-100 text-red-800",
};

export function ProductStatusBadge({ status }: { status: Product["status"] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${PRODUCT_STATUS_STYLES[status]}`}
    >
      {PRODUCT_STATUS_LABELS[status]}
    </span>
  );
}

function formatPrice(value: number | null, moeda: Moeda): string {
  if (value === null) return "—";
  return value.toLocaleString(MOEDA_LOCALES[moeda], { style: "currency", currency: moeda });
}

/** Resumo visual de um produto — usado dentro da listagem (005) e reutilizável no futuro e-commerce. */
export function ProductCard({ product }: { product: Product }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const capaUrl = product.imagens.principal?.url;

  return (
    <Card className="flex gap-3">
      {capaUrl ? (
        <img
          src={capaUrl}
          alt={product.identificacao.nome}
          className="h-16 w-16 shrink-0 cursor-pointer rounded-md object-cover"
          onClick={() => setPreviewUrl(capaUrl)}
        />
      ) : (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-gold-100 text-xs text-wine-700">
          Sem foto
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-medium text-wine-900">{product.identificacao.nome}</p>
          <ProductStatusBadge status={product.status} />
        </div>
        <p className="text-xs text-gray-500">
          {product.sku} · {product.classificacao.categoria}
          {product.caracteristicas.tamanho_etiqueta ? ` · Tam. ${product.caracteristicas.tamanho_etiqueta}` : ""}
        </p>
        <p className="text-sm font-semibold text-wine-800">
          {formatPrice(product.preco.preco_venda, product.preco.moeda)}
        </p>
      </div>
      {previewUrl && <ImageLightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />}
    </Card>
  );
}
