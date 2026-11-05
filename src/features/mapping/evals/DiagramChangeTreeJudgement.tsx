import { strategyCodes } from '../../../../domain/mapping/evals/diagramChangeTree';
import type { Judgement } from '../../../../domain/mapping/evals/judgement';

export function DiagramChangeTreeJudgement({ judgement }: { judgement: Judgement }) {
  if (judgement.kind !== 'diagram-change-tree' || !judgement.data) return null;
  const data = judgement.data;
  return <section className="diagram-change-judgement">
    <h3>Diagram change tree · deterministic parse v{data.version}</h3>
    <p>{data.validOutputs} / {data.outputs.length} outputs have valid tree syntax. Option 3 appears in {data.outputsUsing3} outputs; option 4 in {data.outputsUsing4} outputs.</p>
    <p className="evals-muted">Counts describe parsed operations, including recognized operations in invalid outputs. This parser does not assess architectural correctness or infer strategies from prose.</p>
    <table className="experiment-table"><thead><tr><th>Strategy</th>{strategyCodes.map(code => <th key={code}>[{code}]</th>)}</tr></thead><tbody>
      <tr><th>Operations</th>{strategyCodes.map(code => <td key={code}>{data.totals[code]}</td>)}</tr>
    </tbody></table>
    {data.outputs.map((output, i) => <details key={`${output.runId}:${output.outputKey}`} open={!output.valid}>
      <summary>Output {i + 1} · {output.valid ? 'Valid' : `${output.issues.length} format issues`} · {strategyCodes.map(code => `[${code}] ${output.counts[code]}`).join(' · ')}</summary>
      <p className="evals-muted">{output.runId} · {output.outputKey}</p>
      {!!output.issues.length && <ul>{output.issues.map((issue, n) => <li key={n}>Line {issue.line}: {issue.message}</li>)}</ul>}
      <pre>{output.text}</pre>
    </details>)}
  </section>;
}
