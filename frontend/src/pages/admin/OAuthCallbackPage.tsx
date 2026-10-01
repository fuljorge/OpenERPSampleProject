import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMarketplaceAccountMutations } from "../../hooks/useMarketplaceAccounts";

/**
 * Para onde o Mercado Livre devolve o admin depois da autorização (spec 012, seção 2.2):
 * `?code=...&state=...` (ou `?error=...` se ele recusou). A troca do code por tokens acontece no
 * backend — o navegador nunca vê `client_secret` nem tokens. O `state` é de uso único, então a
 * chamada é feita uma vez só (o StrictMode do React roda o efeito duas vezes em desenvolvimento).
 */
export function OAuthCallbackPage() {
  const [params] = useSearchParams();
  const { completeOAuth } = useMarketplaceAccountMutations();
  const started = useRef(false);

  const code = params.get("code");
  const state = params.get("state");
  const refusal = params.get("error_description") ?? params.get("error");

  useEffect(() => {
    if (started.current || !code || !state) return;
    started.current = true;
    completeOAuth.mutate({ code, state });
  }, [code, state, completeOAuth]);

  let content: React.ReactNode;
  if (refusal) {
    content = <p className="text-sm text-red-600">O Mercado Livre não autorizou a conexão: {refusal}</p>;
  } else if (!code || !state) {
    content = <p className="text-sm text-red-600">Retorno do Mercado Livre sem código de autorização.</p>;
  } else if (completeOAuth.isError) {
    content = (
      <p className="text-sm text-red-600">
        {completeOAuth.error instanceof Error ? completeOAuth.error.message : "Não foi possível conectar a conta."}
      </p>
    );
  } else if (completeOAuth.isSuccess) {
    content = (
      <p className="text-sm text-green-700">
        Conta <strong>{completeOAuth.data.label}</strong> conectada ao Mercado Livre
        {completeOAuth.data.connectedNickname ? (
          <>
            {" "}
            como <strong>{completeOAuth.data.connectedNickname}</strong>
          </>
        ) : null}
        .
      </p>
    );
  } else {
    content = <p className="text-sm text-gray-500">Conectando a conta ao Mercado Livre...</p>;
  }

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="font-display text-2xl font-bold text-wine-900">Conectar conta do Mercado Livre</h1>
      {content}
      <Link to="/admin/marketplace-accounts" className="text-sm text-wine-700 hover:underline">
        Voltar para as contas de marketplace
      </Link>
    </div>
  );
}
