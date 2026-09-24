import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, UserCog } from "lucide-react";
import type { Role, User } from "@replicator/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { Badge, Button, Card, ErrorText, Field, Input, Select, Spinner } from "@/components/ui";

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "user" as Role });

  const load = useCallback(async () => {
    try {
      const data = await api<{ items: User[] }>("/api/users");
      setUsers(data.items);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await act("create", async () => {
      await api("/api/users", { method: "POST", body: form });
      setForm({ name: "", email: "", password: "", role: "user" });
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="text-xs text-muted">Add accounts so others can submit URLs to replicate.</p>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}

      <Card>
        <form onSubmit={create} className="grid gap-4 md:grid-cols-4">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <Field label="Password">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          <div className="md:col-span-4 flex justify-end">
            <Button type="submit" disabled={busy !== null}>
              {busy === "create" ? <Spinner /> : <Plus className="size-4" />} Add user
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr className="border-b border-border">
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Created</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border/60 last:border-0">
                <td className="px-5 py-3">
                  {u.name} {u.id === me?.id ? <Badge>you</Badge> : null}
                </td>
                <td className="px-5 py-3 text-muted">{u.email}</td>
                <td className="px-5 py-3">
                  <Select
                    className="h-8 w-28 text-xs"
                    value={u.role}
                    onChange={(e) => void act(`role-${u.id}`, () => api(`/api/users/${u.id}`, { method: "PATCH", body: { role: e.target.value } }))}
                    disabled={u.id === me?.id}
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </Select>
                </td>
                <td className="px-5 py-3">
                  <Badge className={u.disabled ? "text-err" : "text-ok"}>{u.disabled ? "disabled" : "active"}</Badge>
                </td>
                <td className="px-5 py-3 text-muted">{formatDate(u.createdAt)}</td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Toggle disabled"
                      onClick={() => void act(`dis-${u.id}`, () => api(`/api/users/${u.id}`, { method: "PATCH", body: { disabled: !u.disabled } }))}
                      disabled={u.id === me?.id}
                    >
                      <UserCog className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-err hover:text-err"
                      title="Delete"
                      onClick={() => {
                        if (confirm(`Delete ${u.email}?`)) void act(`del-${u.id}`, () => api(`/api/users/${u.id}`, { method: "DELETE" }));
                      }}
                      disabled={u.id === me?.id}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
