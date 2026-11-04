import type { Judgement } from '../../../../domain/mapping/evals/judgement';
import type { FewShotReference } from '../../../../domain/mapping/evals/fewShot';

function References({ items, previous }: { items: FewShotReference[]; previous?: FewShotReference[] }) {
  return <div className="few-shot-references">{[...items].sort((a, b) => a.slot - b.slot).map(item => {
    const before = previous?.find(p => p.slot === item.slot);
    const changed = before && (before.ascii !== item.ascii || before.title !== item.title);
    return <details key={item.slot}><summary>Slot {item.slot}: {item.title}{before ? changed ? ' · revised' : ' · retained' : ''}</summary>
      <p>{item.rationale}</p>{item.referenceId && <a href={`/evals?reference=${encodeURIComponent(item.referenceId)}`}>Open saved reference</a>}<pre>{item.ascii}</pre>
      {changed && <details><summary>Previous example</summary><pre>{before.ascii}</pre></details>}
    </details>;
  })}</div>;
}
export function FewShotProgress({ judgement }: { judgement: Judgement }) {
  if (judgement.kind !== 'few-shot-progress' || !judgement.data) return null;
  const report = judgement.data;
  const dimensions = ['topology', 'coverage', 'accuracy', 'readability'] as const;
  return <article className="few-shot-progress" aria-label="Few-shot progress report">
    <h2>{report.targetTitle}</h2>
    <p>Five synthetic reference slots · three alternatives per round · {report.rounds.length} of 3 rounds evaluated</p>
    <p className="evals-muted">Scores are model assessments on a 0–5 rubric. Each round uses the same source, title, layout dimensions and base instructions. Only the references change.</p>
    <details><summary>Pinned target diagram</summary><pre>{report.targetAscii}</pre></details>
    <section><h3>Initial five examples</h3><References items={report.initialReferences} /></section>
    {report.rounds.length > 0 && <table aria-label="Progress by round"><thead><tr><th>Round</th>{dimensions.map(d => <th key={d}>{d}</th>)}</tr></thead><tbody>
      {report.rounds.map(round => <tr key={round.round}><th>{round.round}</th>{dimensions.map(d => <td key={d}>{(round.assessments.reduce((sum, a) => sum + a[d], 0) / round.assessments.length).toFixed(2)}</td>)}</tr>)}
    </tbody></table>}
    {report.rounds.map(round => <section key={round.round} aria-label={`Round ${round.round}`}>
      <h3>Round {round.round}</h3><p className="few-shot-prose">{round.progress}</p>
      <details><summary>Five examples used in this round</summary><References items={round.references} /></details>
      {round.assessments.map((a, i) => <details key={a.key}><summary>Alternative {i + 1} · topology {a.topology}/5 · accuracy {a.accuracy}/5</summary>
        <a href={`/evals?canvas=${encodeURIComponent(a.canvasId)}`}>Open generated canvas</a>
        <p><strong>Coverage:</strong> {a.coverage}/5 · <strong>Readability:</strong> {a.readability}/5</p>
        <p className="few-shot-prose"><strong>Evidence:</strong> {a.evidence}</p><p className="few-shot-prose"><strong>Strengths:</strong> {a.strengths}</p><p className="few-shot-prose"><strong>Weaknesses:</strong> {a.weaknesses}</p>
        <pre>{a.ascii}</pre>
      </details>)}
      <h4>{round.round === 3 ? 'Further improvements · untested' : `Reference changes for round ${round.round + 1}`}</h4>
      <p className="few-shot-prose">{round.recommendations}</p><References items={round.nextReferences} previous={round.references} />
    </section>)}
  </article>;
}
