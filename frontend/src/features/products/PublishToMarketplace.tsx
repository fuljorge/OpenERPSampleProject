import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useMarketplaceAccounts } from "../../hooks/useMarketplaceAccounts";
import {
  useAttributeSuggestion,
  useCategorySuggestion,
  useCloseListing,
  usePublishListing,
  useShippingSuggestion,
  useSizeSuggestion,
} from "../../hooks/useMarketplaceListings";
import type { ExtraAttributeChoice, PendingAttribute, ShippingOption } from "../../services/marketplace-listing.service";
import {
  MARKETPLACE_LABELS,
  MarketplaceEnum,
  MERCADO_LIVRE_LISTING_TYPES,
  type Marketplace,
} from "../../schemas/marketplace-account.schema";
import type { Product } from "../../schemas/product.schema";

const sectionClass = "space-y-4 rounded-lg border border-gray-200 bg-white p-4";
const sectionTitleClass = "font-display text-base font-semibold text-wine-900";
const inputClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-wine-600 focus:outline-none focus:ring-1 focus:ring-wine-600";
const buttonClass =
  "rounded-md bg-wine-800 px-4 py-2 text-sm font-medium text-gold-100 hover:bg-wine-900 disabled:opacity-50";

/** Chave estável pra identificar uma opção no `<select>` (spec 012, achado real 24/09/2026). */
function shippingOptionKey(option: Pick<ShippingOption, "mode" | "logisticType">): string {
  return `${option.mode}|${option.logisticType}`;
}

/** Rótulo em português pras combinações mais comuns — sem tradução conhecida, mostra o modo cru
 * do Mercado Livre em vez de inventar um nome (constituição, princípio I). */
const SHIPPING_MODE_LABELS: Record<string, string> = {
  me2: "Mercado Envios 2",
  not_specified: "Sem especificar",
  custom: "Envio customizado",
  me1: "Mercado Envios 1",
};

function shippingOptionLabel(option: ShippingOption): string {
  const modeLabel = SHIPPING_MODE_LABELS[option.mode] ?? option.mode;
  if (option.freeShippingRequired) return `${modeLabel} — frete grátis (obrigatório)`;
  if (!option.freeShippingAllowed) return `${modeLabel} — frete por conta do comprador`;
  return `${modeLabel} — frete grátis opcional`;
}

/**
 * Botão/seletor de publicação de produto em marketplaces (spec 011, seção 4.3) — só faz
 * sentido num produto já salvo (`product.id` existe), nunca no cadastro de um produto novo.
 * Integrado à tela de edição (005/`ProductFormPage`), fora do `ProductForm` em si (publicar não
 * é um campo do formulário, é uma ação separada sobre o produto já persistido).
 */
export function PublishToMarketplace({ product }: { product: Product }) {
  const { user } = useAuth();
  const [marketplace, setMarketplace] = useState<Marketplace>(MarketplaceEnum.options[0]);
  // Escolha explícita do operador, só relevante quando há mais de uma conta ativa — reiniciada
  // ao trocar de marketplace (no próprio handler de troca, nunca via efeito).
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const { data: accounts, isLoading: isLoadingAccounts } = useMarketplaceAccounts({ marketplace, active: true });
  const publish = usePublishListing();
  const close = useCloseListing();
  const suggestion = useCategorySuggestion();
  // Categoria escolhida na tela de revisão (spec 012, seção 4; ADR-025) — pré-preenchida com a
  // sugestão do preditor quando ela existir; o operador confirma ou troca antes de publicar.
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  // Tipo de anúncio, mesma tela de revisão (spec 012, seção 3.2; ADR-026) — sempre pré-selecionado
  // no mais barato (`free`, primeiro da lista estática), o operador troca se quiser mais exposição.
  const [selectedListingTypeId, setSelectedListingTypeId] = useState(MERCADO_LIVRE_LISTING_TYPES[0]!.id);
  // Tamanho de calçado (spec 012, achado real 24/09/2026) — só relevante quando a categoria usa
  // tabela BRAND/STANDARD do Mercado Livre (`sizeSuggestion.data?.applicable`); consultado de
  // novo toda vez que a categoria muda, porque a tabela é por categoria.
  const sizeSuggestion = useSizeSuggestion();
  const [selectedSize, setSelectedSize] = useState("");
  // Frete (spec 012, achado real 24/09/2026) — nunca bloqueia a publicação: se a consulta falhar
  // ou não tiver opção nenhuma, publica sem declarar frete (mesmo comportamento de antes dessa
  // funcionalidade existir), o Mercado Livre aplica o próprio padrão.
  const shippingSuggestion = useShippingSuggestion();
  const [selectedShippingKey, setSelectedShippingKey] = useState("");
  const [freeShippingChoice, setFreeShippingChoice] = useState(true);
  // Obrigatórios da categoria que o cadastro não cobre — "tipo de roupa", "tipo de manga" etc.
  // (ADR-035). Consultados de novo a cada troca de categoria; pré-preenchidos com a sugestão do
  // backend quando a subcategoria do cadastro bate com uma opção.
  const attributeSuggestion = useAttributeSuggestion();
  const [attributeChoices, setAttributeChoices] = useState<Record<string, ExtraAttributeChoice>>({});

  async function refreshAttributes(categoryId: string) {
    if (marketplace !== "mercado_livre" || !accountId || !categoryId) {
      attributeSuggestion.reset();
      setAttributeChoices({});
      return;
    }
    try {
      const pending = await attributeSuggestion.mutateAsync({ productId: product.id, marketplace, accountId, categoryId });
      const prefilled: Record<string, ExtraAttributeChoice> = {};
      for (const attribute of pending) {
        if (attribute.suggested) {
          prefilled[attribute.id] = { id: attribute.id, valueId: attribute.suggested.id, valueName: attribute.suggested.name };
        }
      }
      setAttributeChoices(prefilled);
    } catch {
      setAttributeChoices({});
    }
  }

  function chooseAttributeOption(attribute: PendingAttribute, optionId: string) {
    const option = attribute.options.find((o) => o.id === optionId);
    setAttributeChoices((current) => {
      const next = { ...current };
      if (option) next[attribute.id] = { id: attribute.id, valueId: option.id, valueName: option.name };
      else delete next[attribute.id];
      return next;
    });
  }

  function typeAttributeValue(attribute: PendingAttribute, text: string) {
    setAttributeChoices((current) => {
      const next = { ...current };
      if (text.trim()) next[attribute.id] = { id: attribute.id, valueName: text };
      else delete next[attribute.id];
      return next;
    });
  }

  /** Busca a sugestão de tamanho pra uma categoria — chamado sempre que `selectedCategoryId`
   * muda (pré-seleção inicial e troca manual), nunca automaticamente por efeito. */
  async function refreshSizeSuggestion(categoryId: string) {
    if (marketplace !== "mercado_livre" || !accountId || !categoryId) {
      sizeSuggestion.reset();
      setSelectedSize("");
      return;
    }
    try {
      const result = await sizeSuggestion.mutateAsync({ productId: product.id, marketplace, accountId, categoryId });
      setSelectedSize(result.applicable && result.currentMatches ? (result.current ?? "") : "");
    } catch {
      setSelectedSize("");
    }
  }

  /** Busca as opções de frete válidas — chamado sempre que categoria ou tipo de anúncio mudam
   * (os dois afetam elegibilidade). Pré-seleciona a opção padrão do Mercado Livre, quando existe. */
  async function refreshShipping(categoryId: string, listingTypeId: string) {
    if (marketplace !== "mercado_livre" || !accountId || !categoryId || !listingTypeId) {
      shippingSuggestion.reset();
      setSelectedShippingKey("");
      return;
    }
    try {
      const options = await shippingSuggestion.mutateAsync({ productId: product.id, marketplace, accountId, categoryId, listingTypeId });
      const preferred = options.find((o) => o.isDefault) ?? options[0];
      if (!preferred) {
        setSelectedShippingKey("");
        return;
      }
      setSelectedShippingKey(shippingOptionKey(preferred));
      setFreeShippingChoice(preferred.freeShippingRequired ? true : preferred.freeShippingAllowed);
    } catch {
      setSelectedShippingKey("");
    }
  }

  // Pula a escolha de conta quando só há uma ativa para o marketplace selecionado (spec 011,
  // seção 4.3) — derivado durante a renderização, não via `useEffect` + `setState`.
  const accountId = accounts?.length === 1 ? (accounts[0]?.id ?? "") : selectedAccountId;

  // Conta escolhida já tem um anúncio no ar: o botão vira "Republicar" (spec 012, tarefa T034) —
  // a decisão de criar × atualizar é sempre do backend/conector (spec 012, seção 3.1), isto é só o rótulo.
  const hasPublishedListing = product.marketplaces.some(
    (listing) => listing.marketplace === marketplace && listing.conta_id === accountId && listing.status === "publicado",
  );

  function handleMarketplaceChange(value: Marketplace) {
    setMarketplace(value);
    setSelectedAccountId("");
  }

  /**
   * Mercado Livre exige revisão de categoria antes de publicar, sempre — criar, republicar ou
   * recriar (spec 012, seção 4; ADR-025). Outros marketplaces (sem esse passo ainda) publicam
   * direto, como antes.
   */
  async function handlePublishClick() {
    if (!accountId) return;
    if (marketplace !== "mercado_livre") {
      await publish.mutateAsync({ productId: product.id, marketplace, accountId });
      return;
    }
    const result = await suggestion.mutateAsync({ productId: product.id, marketplace, accountId });
    // A sugestão do preditor pode cair fora da lista curada (ex.: um título com "teste" no nome
    // confundiu o preditor com categorias de teste de piscina) — nesse caso não dá pra pré-selecionar
    // algo que não existe no <select>; melhor deixar em branco e avisar do que fingir uma escolha.
    const suggestionIsCurated = result.suggested && result.options.some((o) => o.categoryId === result.suggested!.categoryId);
    const categoryId = suggestionIsCurated ? result.suggested!.categoryId : "";
    const listingTypeId = MERCADO_LIVRE_LISTING_TYPES[0]!.id;
    setSelectedCategoryId(categoryId);
    setCategoryFilter("");
    setSelectedListingTypeId(listingTypeId);
    await refreshSizeSuggestion(categoryId);
    await refreshAttributes(categoryId);
    await refreshShipping(categoryId, listingTypeId);
  }

  async function handleCategoryChange(categoryId: string) {
    setSelectedCategoryId(categoryId);
    await refreshSizeSuggestion(categoryId);
    await refreshAttributes(categoryId);
    await refreshShipping(categoryId, selectedListingTypeId);
  }

  async function handleListingTypeChange(listingTypeId: string) {
    setSelectedListingTypeId(listingTypeId);
    await refreshShipping(selectedCategoryId, listingTypeId);
  }

  // Tamanho (spec 012, calçado; ADR-032, roupa): `applicable` só quando a categoria usa tabela de
  // medidas. Calçado sem tabela nenhuma não dá pra publicar (mesmo bloqueio que o Mercado Livre já
  // faria, só que antes de tentar) — roupa sempre pode criar/estender a própria tabela
  // (`allowCustomSize`), então tamanho vazio nunca bloqueia, só falta escolher/digitar um.
  const sizeIsApplicable = sizeSuggestion.data?.applicable === true;
  const sizeAllowsCustom = sizeSuggestion.data?.allowCustomSize === true;
  const sizeHasNoOptions = sizeIsApplicable && !sizeAllowsCustom && sizeSuggestion.data!.available.length === 0;
  const sizeNeedsChoice = sizeIsApplicable && !sizeHasNoOptions && !selectedSize;

  // Todo obrigatório pendente precisa de uma escolha — em lista fechada, só uma opção vale.
  const pendingAttributes = attributeSuggestion.data ?? [];
  const attributesNeedChoice = pendingAttributes.some((attribute) => {
    const choice = attributeChoices[attribute.id];
    if (!choice) return true;
    return attribute.valueType === "list" ? !choice.valueId : !choice.valueName.trim();
  });

  // Frete nunca bloqueia "Confirmar e publicar" — só complementa quando resolvido; se a consulta
  // falhou ou não achou opção, publica sem declarar `shipping` (comportamento de antes desta
  // funcionalidade existir).
  const selectedShippingOption = shippingSuggestion.data?.find((o) => shippingOptionKey(o) === selectedShippingKey);
  const shippingChoice = selectedShippingOption
    ? {
        mode: selectedShippingOption.mode,
        logisticType: selectedShippingOption.logisticType,
        freeShipping: selectedShippingOption.freeShippingRequired ? true : !selectedShippingOption.freeShippingAllowed ? false : freeShippingChoice,
      }
    : undefined;

  async function handleConfirmPublish() {
    if (!accountId || !selectedCategoryId || sizeHasNoOptions || sizeNeedsChoice || attributesNeedChoice) return;
    await publish.mutateAsync({
      productId: product.id,
      marketplace,
      accountId,
      categoryId: selectedCategoryId,
      listingTypeId: selectedListingTypeId,
      sizeOverride: selectedSize || undefined,
      shipping: shippingChoice,
      extraAttributes: pendingAttributes
        .map((attribute) => attributeChoices[attribute.id])
        .filter((choice): choice is ExtraAttributeChoice => choice !== undefined),
    });
    suggestion.reset();
    sizeSuggestion.reset();
    setSelectedSize("");
    attributeSuggestion.reset();
    setAttributeChoices({});
    shippingSuggestion.reset();
    setSelectedShippingKey("");
  }

  function handleCancelReview() {
    suggestion.reset();
    sizeSuggestion.reset();
    setSelectedSize("");
    attributeSuggestion.reset();
    setAttributeChoices({});
    shippingSuggestion.reset();
    setSelectedShippingKey("");
    setSelectedCategoryId("");
    setCategoryFilter("");
  }

  async function handleClose(listingMarketplace: Marketplace, listingAccountId: string) {
    // Texto de confirmação da spec 011, seção 4.7 — não parafrasear.
    const confirmed = window.confirm(
      `O anúncio deixará de estar à venda no ${MARKETPLACE_LABELS[listingMarketplace]}. Para vender de novo será preciso publicar outra vez.`,
    );
    if (!confirmed) return;
    await close.mutateAsync({ productId: product.id, marketplace: listingMarketplace, accountId: listingAccountId });
  }

  return (
    <section className={sectionClass}>
      <h2 className={sectionTitleClass}>Marketplaces</h2>

      {product.marketplaces.length > 0 && (
        <ul className="space-y-1 text-sm">
          {product.marketplaces.map((listing) => (
            <li key={`${listing.marketplace}-${listing.conta_id}`} className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  listing.status === "publicado"
                    ? "bg-green-100 text-green-800"
                    : listing.status === "erro"
                      ? "bg-red-100 text-red-800"
                      : listing.status === "encerrado"
                        ? "bg-gray-200 text-gray-700"
                        : "bg-gray-100 text-gray-600"
                }`}
              >
                {listing.status === "publicado"
                  ? "Publicado"
                  : listing.status === "erro"
                    ? "Erro"
                    : listing.status === "encerrado"
                      ? "Encerrado"
                      : "Não publicado"}
              </span>
              <span>
                {MARKETPLACE_LABELS[listing.marketplace]} ({listing.conta_apelido})
              </span>
              {listing.status === "publicado" && listing.url_anuncio && (
                <a
                  href={listing.url_anuncio}
                  target="_blank"
                  rel="noreferrer"
                  className="text-wine-700 hover:underline"
                >
                  Ver anúncio
                </a>
              )}
              {listing.status === "encerrado" && listing.encerrado_em && (
                <span className="text-gray-500">
                  Anúncio encerrado em {listing.encerrado_em.toLocaleDateString("pt-BR")}
                </span>
              )}
              {listing.status === "publicado" && (
                <button
                  type="button"
                  className="text-sm text-wine-700 underline hover:text-wine-900 disabled:opacity-50"
                  disabled={close.isPending}
                  onClick={() => void handleClose(listing.marketplace, listing.conta_id)}
                >
                  {close.isPending ? "Encerrando..." : "Encerrar anúncio"}
                </button>
              )}
              {(listing.status === "erro" || listing.status === "publicado") && listing.erro && (
                <span className="text-red-600">{listing.erro}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {suggestion.data ? (
        <div className="space-y-3 rounded-md border border-gold-400 bg-cream-50 p-3">
          <p className="text-sm font-medium text-wine-900">
            Revise a categoria no {MARKETPLACE_LABELS[marketplace]} antes de publicar
          </p>
          {suggestion.data.suggested && suggestion.data.options.some((o) => o.categoryId === suggestion.data!.suggested!.categoryId) && (
            <p className="text-sm text-gray-600">
              Sugestão do Mercado Livre: <strong>{suggestion.data.suggested.categoryName}</strong>
            </p>
          )}
          {suggestion.data.suggested && !suggestion.data.options.some((o) => o.categoryId === suggestion.data!.suggested!.categoryId) && (
            <p className="text-sm text-amber-700">
              O Mercado Livre sugeriu <strong>{suggestion.data.suggested.categoryName}</strong>, mas essa categoria não
              é de moda — escolha manualmente na lista abaixo.
            </p>
          )}
          {!suggestion.data.suggested && (
            <p className="text-sm text-gray-600">
              Não foi possível obter uma sugestão automática — escolha a categoria manualmente.
            </p>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500">Filtrar categorias</label>
            <input
              type="text"
              className={`${inputClass} w-full`}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              placeholder="Digite para filtrar..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500">Categoria</label>
            <select
              className={`${inputClass} w-full`}
              value={selectedCategoryId}
              onChange={(e) => void handleCategoryChange(e.target.value)}
            >
              <option value="">Selecione...</option>
              {suggestion.data.options
                .filter((option) => option.categoryName.toLowerCase().includes(categoryFilter.toLowerCase()))
                .map((option) => (
                  <option key={option.categoryId} value={option.categoryId}>
                    {option.categoryName}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500">
              Tipo de anúncio (do mais barato ao mais caro)
            </label>
            <select
              className={`${inputClass} w-full`}
              value={selectedListingTypeId}
              onChange={(e) => void handleListingTypeChange(e.target.value)}
            >
              {MERCADO_LIVRE_LISTING_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {sizeSuggestion.isPending && <p className="text-sm text-gray-600">Consultando tamanhos disponíveis no Mercado Livre...</p>}

          {sizeSuggestion.isError && (
            <p className="text-sm text-red-600">
              {sizeSuggestion.error instanceof Error ? sizeSuggestion.error.message : "Não foi possível checar os tamanhos disponíveis."}
            </p>
          )}

          {sizeIsApplicable && sizeHasNoOptions && (
            <p className="text-sm text-red-600">
              Não há tabela de medidas (da marca ou padrão) para esta categoria no Mercado Livre — não é possível
              publicar este calçado. Escolha outra categoria que tenha tabela, ou não publique esta peça por ora.
            </p>
          )}

          {sizeIsApplicable && !sizeHasNoOptions && (
            <div>
              <label className="block text-xs font-medium text-gray-500">Tamanho</label>
              {!sizeSuggestion.data!.currentMatches && (
                <p className="mb-1 text-sm text-amber-700">
                  {sizeSuggestion.data!.current
                    ? `O tamanho do cadastro ("${sizeSuggestion.data!.current}") não está entre os tamanhos já aceitos pelo Mercado Livre — ${sizeAllowsCustom ? "escolha um abaixo ou digite um tamanho válido." : "escolha um tamanho real abaixo."}`
                    : `A peça não tem tamanho cadastrado — ${sizeAllowsCustom ? "escolha ou digite um tamanho." : "escolha um tamanho real da tabela do Mercado Livre abaixo."}`}
                </p>
              )}
              {sizeSuggestion.data!.available.length > 0 && (
                <select className={`${inputClass} w-full`} value={selectedSize} onChange={(e) => setSelectedSize(e.target.value)}>
                  <option value="">Selecione...</option>
                  {sizeSuggestion.data!.available.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              )}
              {sizeAllowsCustom && (
                <input
                  type="text"
                  className={`${inputClass} mt-1 w-full`}
                  placeholder="Ou digite um tamanho (ex.: 48)"
                  value={selectedSize}
                  onChange={(e) => setSelectedSize(e.target.value)}
                />
              )}
            </div>
          )}

          {attributeSuggestion.isPending && (
            <p className="text-sm text-gray-600">Consultando o que o Mercado Livre exige para esta categoria...</p>
          )}

          {attributeSuggestion.isError && (
            <p className="text-sm text-red-600">
              {attributeSuggestion.error instanceof Error
                ? attributeSuggestion.error.message
                : "Não foi possível checar os atributos exigidos pela categoria."}
            </p>
          )}

          {pendingAttributes.length > 0 && (
            <div className="space-y-3 rounded-md border border-gray-200 bg-white p-3">
              <p className="text-sm text-gray-700">
                O Mercado Livre exige estas informações para esta categoria, e o cadastro da peça não as tem — escolha
                abaixo (vale só para esta publicação, não altera o cadastro).
              </p>
              {pendingAttributes.map((attribute) => {
                const choice = attributeChoices[attribute.id];
                const allowsText = attribute.valueType !== "list";
                return (
                  <div key={attribute.id}>
                    <label className="block text-xs font-medium text-gray-500">{attribute.name}</label>
                    {attribute.options.length > 0 && (
                      <select
                        className={`${inputClass} w-full`}
                        value={choice?.valueId ?? ""}
                        onChange={(e) => chooseAttributeOption(attribute, e.target.value)}
                      >
                        <option value="">Selecione...</option>
                        {attribute.options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {allowsText && (
                      <input
                        type="text"
                        className={`${inputClass} mt-1 w-full`}
                        placeholder={attribute.options.length > 0 ? "Ou digite" : "Digite"}
                        value={choice && !choice.valueId ? choice.valueName : ""}
                        onChange={(e) => typeAttributeValue(attribute, e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {shippingSuggestion.isPending && <p className="text-sm text-gray-600">Consultando opções de frete no Mercado Livre...</p>}

          {shippingSuggestion.isError && (
            <p className="text-sm text-amber-700">
              Não foi possível consultar as opções de frete — publica sem declarar frete (o Mercado Livre aplica um
              padrão próprio).
            </p>
          )}

          {!shippingSuggestion.isPending && shippingSuggestion.data && shippingSuggestion.data.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500">Frete</label>
              <select
                className={`${inputClass} w-full`}
                value={selectedShippingKey}
                onChange={(e) => setSelectedShippingKey(e.target.value)}
              >
                <option value="">Não declarar (o Mercado Livre aplica um padrão próprio)</option>
                {shippingSuggestion.data.map((option) => (
                  <option key={shippingOptionKey(option)} value={shippingOptionKey(option)}>
                    {shippingOptionLabel(option)}
                  </option>
                ))}
              </select>
              {selectedShippingOption && !selectedShippingOption.freeShippingRequired && selectedShippingOption.freeShippingAllowed && (
                <label className="mt-1 flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={freeShippingChoice}
                    onChange={(e) => setFreeShippingChoice(e.target.checked)}
                  />
                  Oferecer frete grátis (melhora a pontuação de qualidade do anúncio)
                </label>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              className={buttonClass}
              disabled={
                !selectedCategoryId ||
                publish.isPending ||
                sizeSuggestion.isPending ||
                attributeSuggestion.isPending ||
                sizeHasNoOptions ||
                sizeNeedsChoice ||
                attributesNeedChoice
              }
              onClick={() => void handleConfirmPublish()}
            >
              {publish.isPending ? "Publicando..." : "Confirmar e publicar"}
            </button>
            <button
              type="button"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              disabled={publish.isPending}
              onClick={handleCancelReview}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500">Marketplace</label>
            <select
              className={`${inputClass} w-40`}
              value={marketplace}
              onChange={(e) => handleMarketplaceChange(e.target.value as Marketplace)}
            >
              {MarketplaceEnum.options.map((option) => (
                <option key={option} value={option}>
                  {MARKETPLACE_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          {accounts && accounts.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-gray-500">Conta</label>
              <select
                className={`${inputClass} w-48`}
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
              >
                <option value="">Selecione...</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            className={buttonClass}
            disabled={!accountId || publish.isPending || suggestion.isPending || isLoadingAccounts}
            onClick={() => void handlePublishClick()}
          >
            {publish.isPending || suggestion.isPending
              ? "Carregando..."
              : hasPublishedListing
                ? `Republicar no ${MARKETPLACE_LABELS[marketplace]}`
                : `Publicar no ${MARKETPLACE_LABELS[marketplace]}`}
          </button>
        </div>
      )}

      {!isLoadingAccounts && accounts && accounts.length === 0 && (
        <p className="text-sm text-gray-500">
          Nenhuma conta ativa cadastrada para {MARKETPLACE_LABELS[marketplace]}.{" "}
          {user?.role === "admin" && (
            <Link to="/admin/marketplace-accounts" className="text-wine-700 hover:underline">
              Cadastrar conta
            </Link>
          )}
        </p>
      )}

      {suggestion.isError && (
        <p className="text-sm text-red-600">
          {suggestion.error instanceof Error ? suggestion.error.message : "Não foi possível revisar a categoria."}
        </p>
      )}

      {publish.isError && (
        <p className="text-sm text-red-600">
          {publish.error instanceof Error ? publish.error.message : "Não foi possível publicar."}
        </p>
      )}

      {close.isError && (
        <p className="text-sm text-red-600">
          {close.error instanceof Error ? close.error.message : "Não foi possível encerrar o anúncio."}
        </p>
      )}
    </section>
  );
}
