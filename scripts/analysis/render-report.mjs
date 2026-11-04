import { readFileSync, writeFileSync } from 'node:fs';
import MarkdownIt from 'markdown-it';

// Rebuild the offline viewer with: node scripts/analysis/render-report.mjs
// The report is authoritative; fail on changed table contracts instead of inventing data.
const root = new URL('../../', import.meta.url);
const source = readFileSync(new URL('docs/analysis/architecture-whole-repository.md', root), 'utf8');
const md = new MarkdownIt({ html: false, linkify: false });
function required(pattern) {
  const match = source.match(pattern);
  if (!match) throw new Error(`Report format changed: ${pattern}`);
  return match;
}
function table(header, width) {
  const block = source.slice(source.indexOf(header)).split('\n\n')[0];
  const rows = block.split('\n').slice(2).filter(line => line.startsWith('|')).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
  if (!rows.length || rows.some(row => row.length !== width)) throw new Error(`Invalid table: ${header}`);
  return rows;
}
const groups = [...source.matchAll(/^### (.+)\n\n(\d+) findings[^\n]*\n\n([\s\S]*?)(?=\n##|(?![\s\S]))/gm)].map((match, index) => ({
  id: `category-${index}`, title: match[1], total: Number(match[2]),
  findings: match[3].split('\n').filter(line => line.startsWith('- ')).map(line => {
    const parts = line.slice(2).split(' Evidence: ');
    return { html: md.renderInline(parts[0]), text: line.slice(2), evidence: parts[1] || '' };
  }),
}));
if (groups.length !== 4) throw new Error('Expected four finding categories');
const counts = required(/Analyzed \*\*(\d+) files\*\*, with \*\*(\d+) resolution-only files\*\*, \*\*(\d+) entities\*\* and \*\*(\d+) relations\*\*/);
const data = {
  snapshot: required(/snapshot:[a-f0-9]+/)[0], commit: required(/based on commit `([^`]+)`/)[1],
  counts: counts.slice(1).map(Number),
  views: table('| View | Status |', 5), metrics: table('| Partition | Edge layer |', 7),
  partitions: [...source.matchAll(/\*\*(directory|layer|custom)\*\*: (\d+) groups; line coverage ([\d.]+)%, overlap ([\d.]+)%; baseline (\d+) shuffles, seed (\d+)/g)].map(m => ({id:m[1], groups:+m[2], coverage:+m[3], overlap:+m[4], shuffles:+m[5], seed:+m[6]})),
  cycles: table('| Layer | Nontrivial SCCs |', 3), uncertainty: table('| View / classification / reason |', 2), groups,
};
const template = readFileSync(new URL('report-viewer.html', import.meta.url), 'utf8');
const output = template.replace('<!-- REPORT_HTML -->', md.render(source)).replace('/* REPORT_DATA */null', JSON.stringify(data).replace(/</g, '\\u003c'));
const path = new URL('docs/analysis/architecture-explorer.html', root);
writeFileSync(path, output);
console.log(`Generated ${path.pathname} (${Buffer.byteLength(output).toLocaleString()} bytes; ${groups.reduce((n,g)=>n+g.findings.length,0)} sample findings)`);
