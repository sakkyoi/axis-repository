import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { RepositoriesPage } from "./pages/RepositoriesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SigningKeysPage } from "./pages/SigningKeysPage";
import { TokensPage } from "./pages/TokensPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/repositories" replace />} />
        <Route path="/repositories" element={<RepositoriesPage />} />
        <Route path="/tokens" element={<TokensPage />} />
        <Route path="/signing-keys" element={<SigningKeysPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
