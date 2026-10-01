import { expect, it } from 'vitest';
import { CanvasSessionBridge } from '../canvasSessionBridge';
it('refreshes registration during a pending poll without losing commands or replies', async () => {
  const bridge = new CanvasSessionBridge();
  bridge.register({canvasId:'canvas',documents:[]});
  const poll = bridge.poll('canvas');
  bridge.register({canvasId:'canvas',documents:[{documentId:'document',name:'Diagram'}]});
  const result = bridge.dispatch('canvas', {method:'snapshot',documentId:'document'});
  const [command] = await poll;
  expect(command.documentId).toBe('document');
  bridge.reply('wrong-canvas',command.id,{value:'wrong'});
  bridge.reply('canvas',command.id,{value:'correct'});
  expect(await result).toBe('correct');
  bridge.dispose();
});
it('rejects outstanding commands when a canvas disconnects', async () => {
  const bridge = new CanvasSessionBridge(); bridge.register({canvasId:'canvas',documents:[]});
  const result = bridge.dispatch('canvas',{method:'snapshot',documentId:'doc'});
  const rejected = expect(result).rejects.toThrow('CANVAS_UNAVAILABLE');
  bridge.unregister('canvas'); await rejected;
  expect(bridge.list()).toEqual([]);
});

it('keeps replacement ownership separate from stable discovery identity', async () => {
  const bridge = new CanvasSessionBridge();
  const scope = { stableWorkspaceId: 'stable-tab', projectId: 'project', documents: [{ documentId: 'doc', name: 'Test' }] };
  bridge.register({ ...scope, canvasId: 'before-refresh' });
  bridge.register({ ...scope, canvasId: 'after-refresh' });
  expect(bridge.list()).toHaveLength(2); // Clients must wait through ambiguous stale registrations.
  const result = bridge.dispatch('after-refresh', { method: 'snapshot', documentId: 'doc' });
  const [command] = await bridge.poll('after-refresh');
  bridge.unregister('before-refresh');
  bridge.reply('before-refresh', command.id, { value: 'stale' });
  bridge.reply('after-refresh', command.id, { value: 'current' });
  expect(await result).toBe('current');
  expect(bridge.list()).toEqual([{ ...scope, canvasId: 'after-refresh' }]);
  bridge.dispose();
});
