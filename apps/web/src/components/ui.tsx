import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "outline" | "danger";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const variants: Record<Variant, string> = {
    primary: "bg-accent text-white hover:bg-accent-soft",
    ghost: "text-muted hover:text-text hover:bg-surface-2",
    outline: "border border-border text-text hover:bg-surface-2",
    danger: "bg-err/90 text-white hover:bg-err",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none transition-colors placeholder:text-muted/70 focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-text outline-none focus:border-accent",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-xl border border-border bg-surface p-5", className)}>{children}</div>;
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted", className)}>
      {children}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "text-muted border-border",
  queued: "text-warn border-warn/40 bg-warn/10",
  running: "text-accent-soft border-accent/40 bg-accent/10",
  verifying: "text-accent-soft border-accent/40 bg-accent/10",
  ready: "text-ok border-ok/40 bg-ok/10",
  failed: "text-err border-err/40 bg-err/10",
  canceled: "text-muted border-border",
  succeeded: "text-ok border-ok/40 bg-ok/10",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLES[status] ?? "text-muted border-border",
      )}
    >
      <span className={cn("size-1.5 rounded-full bg-current", status === "running" && "animate-pulse")} />
      {status}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]",
        className,
      )}
    />
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs text-muted">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-lg border border-err/40 bg-err/10 px-3 py-2 text-xs text-err">{children}</p>;
}
