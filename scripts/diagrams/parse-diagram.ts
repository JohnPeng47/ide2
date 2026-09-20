import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseDiagram, renderCleaned, type Dialect } from '../../domain/core/diagrams/interpreter/index';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    dialect: { type: 'string', default: 'mixed' },
    format: { type: 'string', default: 'json' },
    strict: { type: 'boolean', default: false },
    'no-repairs': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }
  } });
  if (values.help) {
    process.stdout.write('Usage: npm run parse:diagram -- [file|-] [--dialect tree|graph|mixed|unknown]\n' +
      '       [--format json|cleaned] [--no-repairs] [--strict]\n' +
      'Reads stdin when no file is supplied. Strict mode emits the partial result and exits 1 on warnings/errors.\n');
  } else {
    if (positionals.length > 1) throw new Error('Expected one input file');
    if (!['json', 'cleaned'].includes(values.format!)) throw new Error('Expected --format json or cleaned');
    const source = readFileSync(!positionals[0] || positionals[0] === '-' ? 0 : positionals[0], 'utf8');
    const result = parseDiagram(source, { dialect: values.dialect as Dialect,
      repairs: values['no-repairs'] ? 'none' : 'conservative' });
    const rendered = values.format === 'cleaned' ? renderCleaned(result) : undefined;
    process.stdout.write(rendered ? rendered.text : JSON.stringify(result, null, 2) + '\n');
    for (const diagnostic of rendered ? [...result.diagnostics, ...rendered.diagnostics] : []) {
      process.stderr.write(`line ${diagnostic.line}: ${diagnostic.code}: ${diagnostic.message}\n`);
    }
    if ((rendered?.diagnostics.length ?? 0) || values.strict && result.diagnostics.some(d => d.severity !== 'info')) process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
