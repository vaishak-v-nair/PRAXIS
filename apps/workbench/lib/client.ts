/** Same-origin API access. Errors never masquerade as empty successful data. */
export async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(150000),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof value?.detail === "string" ? value.detail : `Request failed (${response.status}). Please check the local service and try again.`);
  if (value === null) throw new Error("The local service returned an unreadable response.");
  return value as T;
}
export function message(error: unknown) { return error instanceof Error ? error.message : "The request could not finish."; }
