import { useState } from "react";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, ErrorText, Field, Input, Spinner } from "@/components/ui";

export default function AccountPage() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setDone(false);
    try {
      await api("/api/auth/password", { method: "POST", body: { currentPassword: current, newPassword: next } });
      setCurrent("");
      setNext("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Account</h1>
        <p className="text-xs text-muted">{user?.email}</p>
      </div>

      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Change password</h2>
          {user?.role === "admin" ? <Badge>admin</Badge> : null}
        </div>
        <form onSubmit={submit} className="space-y-4">
          {user?.role !== "admin" ? (
            <Field label="Current password">
              <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </Field>
          ) : null}
          <Field label="New password" hint="At least 8 characters.">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required />
          </Field>
          {error ? <ErrorText>{error}</ErrorText> : null}
          {done ? <p className="text-xs text-ok">Password updated.</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner /> : <KeyRound className="size-4" />} Update password
          </Button>
        </form>
      </Card>
    </div>
  );
}
