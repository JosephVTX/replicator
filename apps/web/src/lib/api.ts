let csrfToken = "";

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  raw?: boolean;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (csrfToken && options.method && options.method !== "GET") headers["x-csrf-token"] = csrfToken;

  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    credentials: "same-origin",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    let code = "error";
    let message = res.statusText;
    if (contentType.includes("application/json")) {
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
      code = data?.error ?? code;
      message = data?.message ?? message;
    }
    throw new ApiError(res.status, code, message);
  }
  if (contentType.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export function download(path: string): void {
  const a = document.createElement("a");
  a.href = path;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
