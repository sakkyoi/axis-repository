import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { RepositoriesPage } from "./pages/RepositoriesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TokensPage } from "./pages/TokensPage";
import { ADMIN_UI_PATHS } from "./navigation";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={ADMIN_UI_PATHS.root} replace />} />
      <Route path={ADMIN_UI_PATHS.root} element={<Navigate to={ADMIN_UI_PATHS.repositories} replace />} />
      <Route path={ADMIN_UI_PATHS.login} element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path={ADMIN_UI_PATHS.repositories} element={<RepositoriesPage />} />
          <Route path={ADMIN_UI_PATHS.tokens} element={<TokensPage />} />
          <Route path={ADMIN_UI_PATHS.settings} element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
