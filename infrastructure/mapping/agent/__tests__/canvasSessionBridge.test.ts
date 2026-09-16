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
