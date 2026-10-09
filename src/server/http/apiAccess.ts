/** POST is also used for these strictly read-only queries. Keep mixed exec gated. */
const readPostPaths = new Set([
  '/api/core/project/definitions',
  '/api/mapping/agent/tools/list_repositories',
  '/api/mapping/agent/tools/get_repository_diff_hunks',
  '/api/mapping/agent/tools/read_change_session_diff_tree',
  '/api/mapping/agent/tools/edit-diagram-status',
  '/api/mapping/agent/tools/diagram-search',
  '/api/mapping/agent/tools/canvas-api-search'
]);

export function isReadApiRequest(method: string | undefined, pathname: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
    || method === 'POST' && readPostPaths.has(pathname);
}
