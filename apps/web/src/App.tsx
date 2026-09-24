import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import LoginPage from "./pages/Login";
import ReplicasPage from "./pages/Replicas";
import ReplicaDetailPage from "./pages/ReplicaDetail";
import UsersPage from "./pages/Users";
import SettingsPage from "./pages/Settings";
import AccountPage from "./pages/Account";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-muted">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route index element={<ReplicasPage />} />
        <Route path="/replicas/:id" element={<ReplicaDetailPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/users" element={user.role === "admin" ? <UsersPage /> : <Navigate to="/" replace />} />
        <Route path="/settings" element={user.role === "admin" ? <SettingsPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
