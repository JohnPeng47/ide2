/** Only the programmable agent tool API is gated; app persistence/sync stays available. */
const readTools = new Set([
  'list_repositories', 'get_repository_diff_hunks', 'read_change_session_diff_tree',
  'edit-diagram-status', 'diagram-search', 'canvas-api-search'
]);

export function isAgentMutationRequest(method: string | undefined, pathname: string): boolean {
  const prefix = '/api/mapping/agent/tools/';
  return pathname.startsWith(prefix) && !['GET', 'HEAD', 'OPTIONS'].includes(method ?? '')
    && !(method === 'POST' && readTools.has(pathname.slice(prefix.length)));
}
