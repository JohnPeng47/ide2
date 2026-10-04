import { readFile, writeFile } from 'node:fs/promises';
import { CanvasApiProjection } from '../../application/mapping/agent/apiProjection';
import type { LiveCanvasContext } from '../../domain/mapping/agent/liveCanvasStatus';

// Usage: node --import tsx scripts/mapping/measure-api-payload.ts input.json [output.json]
// Accepts a captured attached/context.snapshot message, or its raw context.
const [input, output] = process.argv.slice(2);
if (!input) throw Error('Expected a captured canvas payload JSON path');
const payload = JSON.parse(await readFile(input, 'utf8'));
const context: LiveCanvasContext = payload.context ?? payload;
if (!Array.isArray(context.nodes) || !Array.isArray(context.edges)) throw Error('Expected nodes and edges');
if ('apiFormatVersion' in context || context.nodes.some(node => 'apiFormatVersion' in node)) throw Error('Payload is already projected');
const projection = new CanvasApiProjection();
const compact = { ...projection.result(context), edges: context.edges.map(edge => projection.edge(edge)) };
const result = payload.context ? { ...payload, context: compact } : compact;
const before = Buffer.byteLength(JSON.stringify(payload)), after = Buffer.byteLength(JSON.stringify(result));
console.log(JSON.stringify({ beforeBytes: before, afterBytes: after, reductionPercent: Number((100 * (1 - after / before)).toFixed(2)),
  diagrams: context.nodes.filter(node => node.kind === 'diagram').length, edges: context.edges.length }, null, 2));
if (output) await writeFile(output, JSON.stringify(result));
