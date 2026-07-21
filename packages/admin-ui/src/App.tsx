import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/repositories" replace />} />
        <Route
          path="/repositories"
          element={
            <PlaceholderPage
              title="Repositories"
              description="Repository management screens will appear here."
            />
          }
        />
        <Route
          path="/tokens"
          element={<PlaceholderPage title="Tokens" description="Publish token management screens will appear here." />}
        />
        <Route
          path="/signing-keys"
          element={
            <PlaceholderPage
              title="Signing Keys"
              description="Signing key management screens will appear here."
            />
          }
        />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
