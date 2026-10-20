export async function chatRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/mapping/agent-chat${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new ChatRequestError(data.error || 'Chat request failed.');
  return data as T;
}
export class ChatRequestError extends Error {}

