import { executeWorkspaceTask, type WorkspaceTask } from './workspaceTask';
onmessage = ({ data }: MessageEvent<WorkspaceTask>) => {
  try { postMessage({ result: executeWorkspaceTask(data) }); }
  catch (error) { postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
