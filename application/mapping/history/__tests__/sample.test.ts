import { expect, it, vi } from 'vitest';
import { validatedHistorySample } from '../../../../scripts/evals/history/sample';
it.each(['Invalid diagram revision parent','Output does not match the plan'])('never spends on automatic repairs: %s',async(message)=>{
  const generate=vi.fn(async()=>({output:{candidate:true}})), save=vi.fn(async()=>{});
  await expect(validatedHistorySample({readSaved:async()=>undefined,generate,save,validate:()=>{throw Error(message);}})).rejects.toThrow(message);
  expect(generate).toHaveBeenCalledTimes(1);expect(save).toHaveBeenCalledTimes(1);
});
it('replays a saved response after a local fix without paying again',async()=>{
  const generate=vi.fn(), save=vi.fn();
  expect(await validatedHistorySample({readSaved:async()=>({output:42}),generate,save,validate:value=>value})).toBe(42);
  expect(generate).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});
it('stops on an invalid saved response without generating a replacement',async()=>{
  const generate=vi.fn(),save=vi.fn();
  await expect(validatedHistorySample({readSaved:async()=>({output:42}),generate,save,validate:()=>{throw Error('Storage broken');}})).rejects.toThrow('Storage broken');
  expect(generate).not.toHaveBeenCalled();
});
