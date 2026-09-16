import { startMappingMcpServer } from '../../infrastructure/mapping/mcp/server';
const url = process.argv[2] ?? process.env.MAPPING_URL;
if (!url) throw new Error('Usage: npm run mcp:mapping -- http://127.0.0.1:<mapping-port>');
await startMappingMcpServer(url);
