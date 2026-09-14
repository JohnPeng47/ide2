const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${basePath}${path}`, init);
}
export async function errorFrom(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  return new Error(payload.error || `request failed with ${response.status}`);
}
