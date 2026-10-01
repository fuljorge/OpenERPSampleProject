import type { Db } from "mongodb";
import type { Product } from "../../schemas/product.schema.js";
import { mercadoLivrePackageSettingsRepository } from "../../repositories/mercado-livre-package-settings.repository.js";

/**
 * Pacote padrão do Mercado Livre (spec 012, seção 3.4; ADR-027) — o Mercado Envios 2 exige
 * dimensões de pacote em toda publicação, e o ERP não captura essas dimensões por produto nesta
 * versão. Um único pacote padrão para toda publicação, editado pela dona do brechó na tela de
 * admin (`mercadoLivrePackageSettingsRepository`) — não mais uma variável de ambiente nem
 * exceções por categoria/departamento (ADR-027 substitui a decisão "b" da ADR-023/T046: mais
 * simples, sem uma configuração que ninguém pediu ainda). O peso vem do produto quando existir;
 * o `peso_g` configurado é sempre a reserva.
 */

export class PackageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageConfigError";
  }
}

/** Resultado pronto para os atributos `SELLER_PACKAGE_*` (spec 012, seção 3.4): sempre inteiro. */
export interface ResolvedPackage {
  altura_cm: number;
  largura_cm: number;
  comprimento_cm: number;
  peso_g: number;
}

/** kg → g, arredondado para cima (nunca zero se o peso original for positivo). */
function kgToGrams(kg: number): number {
  return Math.ceil(kg * 1000);
}

/**
 * Resolve o pacote da peça: sempre o pacote padrão configurado (ADR-027). O peso vem do produto
 * quando preenchido; senão, do `peso_g` do pacote padrão (sempre presente — schema exige). Sem
 * pacote padrão configurado, falha com mensagem clara antes de qualquer chamada ao Mercado Livre.
 */
export async function resolvePackage(db: Db, product: Product): Promise<ResolvedPackage> {
  const settings = await mercadoLivrePackageSettingsRepository.find(db);
  if (!settings) {
    throw new PackageConfigError(
      'Pacote padrão do Mercado Livre não configurado — preencha em "Contas de marketplace → Pacote padrão do Mercado Livre" antes de publicar.',
    );
  }

  const pesoKg = product.peso.valor;
  const peso_g = pesoKg !== null ? kgToGrams(pesoKg) : settings.peso_g;

  return {
    altura_cm: settings.altura_cm,
    largura_cm: settings.largura_cm,
    comprimento_cm: settings.comprimento_cm,
    peso_g,
  };
}
