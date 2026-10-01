import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import type { AuthUser } from "../../schemas/auth.schema";

interface ProtectedRouteProps {
  children: ReactNode;
  /** Quando informado, além de autenticado o usuário precisa ter um destes papéis — senão
   * é redirecionado (não só escondido via UI; spec 002, critério de aceite). */
  roles?: AuthUser["role"][];
}

export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <p>Carregando...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
