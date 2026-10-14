// Browser-side fetch helpers. Errors carry the server's user-facing message.

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Could not reach the server.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && typeof data.error === "string" && data.error) || `Request failed (${res.status}).`);
  return data as T;
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export async function pollJob<T extends { status: string }>(id: string, onUpdate: (j: T) => void, intervalMs = 700): Promise<T> {
  for (;;) {
    const j = await api<T>(`/api/jobs/${id}`);
    onUpdate(j);
    if (j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
