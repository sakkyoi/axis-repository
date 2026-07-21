import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { RepositoriesPage } from "./pages/RepositoriesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SigningKeysPage } from "./pages/SigningKeysPage";
import { TokensPage } from "./pages/TokensPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/repositories" replace />} />
          <Route path="/repositories" element={<RepositoriesPage />} />
          <Route path="/tokens" element={<TokensPage />} />
          <Route path="/signing-keys" element={<SigningKeysPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
