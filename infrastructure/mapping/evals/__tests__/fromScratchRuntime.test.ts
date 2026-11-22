import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { preflight, single, treeSchema, validateCanvas } from '../../../../scripts/evals/from-scratch/artifacts';
import { modelCall } from '../../../../scripts/evals/from-scratch/model';

it('isolates inputs, pins Astra/high, retains raw events, and never pays twice for a saved or incomplete job', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'discovery-runtime-test-'));
  const old=process.env.NEW_DIAGRAM_CODEX_BIN;
  try {
    const executable=path.join(root,'fake-codex');
    await writeFile(executable,`#!/usr/bin/env node
const fs=require('fs');
const args=process.argv.slice(2);
if(!process.cwd().startsWith('/tmp/canvas-discovery-model-'))throw Error('Not isolated');
if(args[args.indexOf('--model')+1]!=='gpt-6-astra'||!args.includes('model_reasoning_effort="high"'))throw Error('Wrong settings');
const files=fs.readdirSync('.').sort();if(JSON.stringify(files)!==JSON.stringify(['context.json','output-schema.json']))throw Error('Unexpected input leak');
const input=JSON.parse(fs.readFileSync('context.json','utf8'));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:input.invalid?'not JSON':JSON.stringify({ascii:'Root\\n\u0060-- Child'})}}));
console.log(JSON.stringify({type:'turn.completed',usage:{output_tokens:12}}));
`);await chmod(executable,0o700);process.env.NEW_DIAGRAM_CODEX_BIN=executable;
    const prepare=async(name:string,invalid=false)=>{const dir=path.join(root,name);await mkdir(dir);await writeFile(path.join(dir,'inputs.json'),JSON.stringify({files:{'context.json':{}}}));await writeFile(path.join(dir,'context.json'),JSON.stringify({invalid}));await writeFile(path.join(dir,'neighbour-output.json'),'Must not reach model');return dir;};
    const schema=z.object({ascii:z.string()}).strict(),dir=await prepare('valid');
    const first=await modelCall(dir,'Generate tree',schema,new AbortController().signal);
    expect(first.output).toEqual({ascii:'Root\n`-- Child'});
    expect(await modelCall(dir,'Generate tree',schema,new AbortController().signal)).toEqual(first);
    expect(await readFile(path.join(dir,'events.jsonl'),'utf8')).toContain('agent_message');
    const invalid=await prepare('invalid',true);
    await expect(modelCall(invalid,'Generate tree',schema,new AbortController().signal)).rejects.toThrow('Invalid JSON');
    expect(await readFile(path.join(invalid,'events.jsonl'),'utf8')).toContain('not JSON');
    await expect(modelCall(invalid,'Generate tree',schema,new AbortController().signal)).rejects.toMatchObject({code:'EEXIST'});
  } finally {if(old===undefined)delete process.env.NEW_DIAGRAM_CODEX_BIN;else process.env.NEW_DIAGRAM_CODEX_BIN=old;await rm(root,{recursive:true,force:true});}
});

it('saves and reopens a generated canvas with a tree above the former output limits', async () => {
  const branches = Array.from({ length: 80 }, (_, i) => `|-- Component ${i} ${'x'.repeat(768)}`);
  const ascii = ['Core', ...branches].join('\n');
  const tree = treeSchema.parse({ ascii });
  const canvas = validateCanvas(single(tree.ascii));
  expect(canvas.diagrams[0].ascii).toBe(ascii);
  const result = await preflight(canvas, 'large-output-project', 'large-output-input');
  expect(result.checks).toContain('load output');
});
