import type { CompareCandidate, ComparePageSession, CompareSessionSummary, CreateCompareSession } from '../../../../domain/mapping/compare/comparePageSession';

const base = `${import.meta.env.BASE_URL}api/mapping/compare-sessions`;
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options), value = await response.json();
  if (!response.ok) throw Error(value.error ?? 'Comparison request failed');
  return value;
}
export const listCompareSessions = () => request<CompareSessionSummary[]>(base);
export const listCompareCandidates = () => request<CompareCandidate[]>(`${base}/candidates`);
export const readCompareSession = (id: string) => request<ComparePageSession>(`${base}/${encodeURIComponent(id)}`);
export const createCompareSession = (input: CreateCompareSession) => request<ComparePageSession>(base, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input)
});
