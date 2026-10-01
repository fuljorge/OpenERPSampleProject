import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/**
 * Casca visual comum a toda tela autenticada — cabeçalho com marca, navegação e logout.
 * Abaixo de `md` (telas de celular), a navegação colapsa num menu hambúrguer — sem isso, os
 * ~6 itens (Dashboard/Produtos/Categorias/Usuários/Auditoria/nome/Sair) numa única linha
 * ultrapassam a largura da tela, empurrando até o botão "Sair" pra fora da área visível.
 */
export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = (
    <>
      <Link
        to="/"
        className="font-medium text-wine-700 hover:text-wine-900"
        onClick={() => setMenuOpen(false)}
      >
        Dashboard
      </Link>
      <Link
        to="/products"
        className="font-medium text-wine-700 hover:text-wine-900"
        onClick={() => setMenuOpen(false)}
      >
        Produtos
      </Link>
      {user?.role === "admin" && (
        <>
          <Link
            to="/admin/categories"
            className="font-medium text-wine-700 hover:text-wine-900"
            onClick={() => setMenuOpen(false)}
          >
            Categorias
          </Link>
          <Link
            to="/admin/marketplace-accounts"
            className="font-medium text-wine-700 hover:text-wine-900"
            onClick={() => setMenuOpen(false)}
          >
            Marketplaces
          </Link>
          <Link
            to="/admin/ai-settings"
            className="font-medium text-wine-700 hover:text-wine-900"
            onClick={() => setMenuOpen(false)}
          >
            Configuração de IA
          </Link>
          <Link
            to="/admin/users"
            className="font-medium text-wine-700 hover:text-wine-900"
            onClick={() => setMenuOpen(false)}
          >
            Usuários
          </Link>
          <Link
            to="/admin/audit-logs"
            className="font-medium text-wine-700 hover:text-wine-900"
            onClick={() => setMenuOpen(false)}
          >
            Auditoria
          </Link>
        </>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-cream-50">
      <header className="border-b border-wine-900/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
          <Link to="/" className="font-display text-lg font-bold text-wine-900" onClick={() => setMenuOpen(false)}>
            OpenERP Sample
          </Link>

          <nav className="hidden items-center gap-5 text-sm md:flex">
            {navLinks}
            <span className="text-gray-500">{user?.name}</span>
            <button
              type="button"
              className="rounded-md border border-wine-900/15 px-3 py-1.5 font-medium text-wine-900 hover:bg-wine-50"
              onClick={() => void logout()}
            >
              Sair
            </button>
          </nav>

          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-wine-900/15 text-lg text-wine-900 md:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>

        {menuOpen && (
          <nav className="flex flex-col items-start gap-3 border-t border-wine-900/10 px-4 py-3 text-sm md:hidden">
            {navLinks}
            <span className="text-gray-500">{user?.name}</span>
            <button
              type="button"
              className="rounded-md border border-wine-900/15 px-3 py-1.5 font-medium text-wine-900 hover:bg-wine-50"
              onClick={() => void logout()}
            >
              Sair
            </button>
          </nav>
        )}
      </header>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
    </div>
  );
}
