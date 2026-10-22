import { startMappingMcpServer } from '../../infrastructure/mapping/mcp/server';
const args = process.argv.slice(2);
const url = args[0] ?? process.env.MAPPING_URL;
const options = args.slice(1);
if (options.length % 2 || options.some((value, index) => index % 2 === 0 && !['--canvas', '--document'].includes(value)))
  throw Error('Expected --canvas <canvasId> --document <documentId>');
const flags = new Map(Array.from({ length: options.length / 2 }, (_, index) => [options[index * 2], options[index * 2 + 1]]));
const canvasId = flags.get('--canvas') ?? process.env.MAPPING_CANVAS_ID;
const documentId = flags.get('--document') ?? process.env.MAPPING_DOCUMENT_ID;
if (!url) throw new Error('Usage: node --import tsx scripts/mapping/mcp.ts http://127.0.0.1:<port> [--canvas <id> --document <id>]');
if (!!canvasId !== !!documentId) throw Error('Provide both canvas and document IDs to bind this connection');
await startMappingMcpServer(url, canvasId && documentId ? { canvasId, documentId } : undefined);
