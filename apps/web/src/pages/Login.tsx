import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Boxes } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button, ErrorText, Field, Input, Spinner } from "@/components/ui";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-surface p-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-accent/15 text-accent-soft">
            <Boxes className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-none">Replicator</h1>
            <p className="mt-1 text-xs text-muted">Sign in to the control panel</p>
          </div>
        </div>
        <ErrorText>{error}</ErrorText>
        <Field label="Email">
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : null} Sign in
        </Button>
      </form>
    </div>
  );
}
