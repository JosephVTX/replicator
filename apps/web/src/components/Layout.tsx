import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Boxes, LayoutDashboard, LogOut, Settings, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "./ui";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Replicas", icon: LayoutDashboard, end: true },
  { to: "/users", label: "Users", icon: Users, admin: true },
  { to: "/settings", label: "Settings", icon: Settings, admin: true },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface/60 p-4">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="grid size-8 place-items-center rounded-lg bg-accent/15 text-accent-soft">
            <Boxes className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold leading-none">Replicator</p>
            <p className="mt-1 text-[11px] text-muted">pixel-perfect pipeline</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.filter((item) => !item.admin || user?.role === "admin").map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text",
                  isActive && "bg-surface-2 text-text",
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 border-t border-border pt-4">
          <NavLink to="/account" className="block px-2">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-[11px] text-muted">{user?.email}</p>
          </NavLink>
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={handleLogout}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-6xl px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
