import { newAsyncContext } from 'quickjs-emscripten';
import type { AgentExecRuntime } from '../../../application/mapping/agent/ports';
import { canvasMethods } from '../../../domain/mapping/agent/contracts';
export class QuickJsAgentRuntime implements AgentExecRuntime {
  async run(code: string, invoke: (method: string, args: unknown) => Promise<unknown>) {
    const context = await newAsyncContext();
    const deadline = Date.now() + 30000;
    let interrupts = 0, calls = 0;
    context.runtime.setMemoryLimit(32 * 1024 * 1024);
    context.runtime.setMaxStackSize(512 * 1024);
    context.runtime.setInterruptHandler(() => Date.now() > deadline || ++interrupts > 20000);
    try {
      const call = context.newAsyncifiedFunction('__call', async (method, json) => {
        if (++calls > 100) throw new Error('Execution exceeds 100 API calls');
        const value = await invoke(context.getString(method), JSON.parse(context.getString(json)));
        const result = JSON.stringify(value ?? null);
        if (result.length > 4 * 1024 * 1024) throw new Error('API result exceeds 4MB');
        return context.newString(result);
      });
      context.setProp(context.global, '__call', call); call.dispose();
      const groups = ['canvas','nodes','edges'].map(group => `const ${group} = Object.freeze({${Object.keys(canvasMethods).filter(name => name.startsWith(`${group}.`)).map(name => `${name.split('.')[1]}: (args = {}) => JSON.parse(__call(${JSON.stringify(name)}, JSON.stringify(args)))`).join(',')}});`).join('\n');
      const result = await context.evalCodeAsync(`"use strict"; ${groups}\nJSON.stringify((function() {\n${code}\n})() ?? null)`);
      if (result.error) { const error = context.dump(result.error); result.error.dispose(); throw new Error(error?.message ?? String(error)); }
      const json = context.getString(result.value); result.value.dispose();
      if (json.length > 4 * 1024 * 1024) throw new Error('Execution result exceeds 4MB');
      return JSON.parse(json);
    } finally { context.dispose(); }
  }
}
