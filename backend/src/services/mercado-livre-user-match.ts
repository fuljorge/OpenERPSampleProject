/**
 * Confere se o usuário do Mercado Livre que autorizou o aplicativo é o que a conta deveria usar
 * (spec 012, seção 2.5). Só dígitos → compara com o ID; senão, com o apelido, sem diferenciar
 * maiúsculas de minúsculas e ignorando um `@` inicial.
 */
export interface MercadoLivreUserIdentity {
  id: number | string;
  nickname?: string | undefined;
}

export function matchesExpectedUser(expected: string, user: MercadoLivreUserIdentity): boolean {
  const wanted = expected.trim().replace(/^@/, "").trim();
  if (!wanted) return true;
  if (/^\d+$/.test(wanted)) return String(user.id) === wanted;
  return user.nickname !== undefined && user.nickname.trim().toLowerCase() === wanted.toLowerCase();
}
