import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { DashboardPage } from "../pages/DashboardPage";
import { LoginPage } from "../pages/LoginPage";
import { AiSettingsPage } from "../pages/admin/AiSettingsPage";
import { AuditLogsPage } from "../pages/admin/AuditLogsPage";
import { CategoriesPage } from "../pages/admin/CategoriesPage";
import { MarketplaceAccountsPage } from "../pages/admin/MarketplaceAccountsPage";
import { OAuthCallbackPage } from "../pages/admin/OAuthCallbackPage";
import { UserFormPage } from "../pages/admin/UserFormPage";
import { UsersPage } from "../pages/admin/UsersPage";
import { ProductAiIntakePage } from "../pages/products/ProductAiIntakePage";
import { ProductFormPage } from "../pages/products/ProductFormPage";
import { ProductViewPage } from "../pages/products/ProductViewPage";
import { ProductsPage } from "../pages/products/ProductsPage";
import { ProtectedRoute } from "./routes/ProtectedRoute";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout>
                <DashboardPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/products"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ProductsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/products/new"
          element={
            <ProtectedRoute roles={["admin", "operator"]}>
              <AppLayout>
                <ProductFormPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/products/:id"
          element={
            <ProtectedRoute roles={["admin", "operator"]}>
              <AppLayout>
                <ProductFormPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/products/:id/view"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ProductViewPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/products/ai-new"
          element={
            <ProtectedRoute roles={["admin", "operator"]}>
              <AppLayout>
                <ProductAiIntakePage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute roles={["admin"]}>
              <AppLayout>
                <UsersPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users/new"
          element={
            <ProtectedRoute roles={["admin"]}>
              <AppLayout>
                <UserFormPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users/:id"
          element={
            <ProtectedRoute roles={["admin"]}>
              <AppLayout>
                <UserFormPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/categories"
          element={
            <ProtectedRoute roles={["admin"]}>
              <AppLayout>
                <CategoriesPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/marketplace-accounts"
          element={
            <ProtectedRoute roles={["admin"]}>
              <AppLayout>
                <MarketplaceAccountsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/marketplace-accounts/oauth/callback"
          element={
            <ProtectedRoute roles={["admin"]}>
              <AppLayout>
                <OAuthCallbackPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/ai-settings"
          element={
            <ProtectedRoute roles={["admin"]}>
              <AppLayout>
                <AiSettingsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/audit-logs"
          element={
            <ProtectedRoute roles={["admin"]}>
              <AppLayout>
                <AuditLogsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
