import type { ComparisonReport } from './comparisonReport';

/**
 * The steps of a comparison report, in reading order: each finding (compare block), or the page itself
 * when it holds only text. Keys are stable across renders and safe to place in a URL.
 */
export interface ReportStep { key: string; pageIndex: number; pageTitle: string; findingId?: string; title: string }
export function reportSteps(report: Readonly<ComparisonReport>): ReportStep[] {
  return report.pages.flatMap((page, pageIndex) => {
    const findings = page.blocks.flatMap(block => block.kind === 'text' ? [] : [{ key: `finding:${block.spec.id}`, pageIndex, pageTitle: page.title, findingId: block.spec.id, title: block.spec.title }]);
    return findings.length ? findings : [{ key: `page:${page.id}`, pageIndex, pageTitle: page.title, title: page.title }];
  });
}
