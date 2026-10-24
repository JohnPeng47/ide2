import { constructDiagram } from './internal/constructDiagram';
import { scopedReplacements } from './diagramSubtreeEdit';
import { validateGeneratedDiagramEdit, type GeneratedDiagramEdit } from './generatedDiagramEdit';
import type { DiagramGenerationRequest } from './diagramGeneration';
import { createDiagram, reviseDiagram, type DiagramRevision, type DiagramRevisionResult } from './diagramRevision';

export function submitDiagramEdit(request: DiagramGenerationRequest, raw: GeneratedDiagramEdit, base: DiagramRevision | undefined, correspondence?: Record<string, number>): DiagramRevisionResult {
  if (request.baseRevisionId && (!base || base.id !== request.baseRevisionId)) throw Error('Generation base revision is missing or mismatched');
  if (base && base.diagram.id !== request.input.id) throw Error('Generation base belongs to another diagram');
  if (!base && raw.replacementRanges) throw Error('REPLACEMENT_SCOPE: new diagrams cannot include replacementRanges');
  const context = base?.diagram ?? request.context?.diagram ?? constructDiagram({ ...request.input, revision: 0, ascii: '[New diagram]', mappings: [] });
  const clean = validateGeneratedDiagramEdit(context, raw, base?.nodeRefs, request.sourceMappings);
  const generated = { ...clean, nodeCorrespondence: { ...correspondence, ...clean.nodeCorrespondence },
    source: context.sourceContext.binding, evidence: context.sourceContext.evidence };
  const ranges = request.editRanges?.length ? request.editRanges : request.editRange ? [request.editRange] : [];
  if (base && ranges.length) {
    const source = base.diagram;
    if (generated.structureKind && generated.structureKind !== source.content.structure.kind) throw Error('REPLACEMENT_SCOPE: preserve the diagram structure kind');
    const { patches, outputRanges } = scopedReplacements(source, generated.ascii, ranges, generated.replacementRanges);
    const retained = source.sourceContext.mappings.flatMap(mapping => {
      if (ranges.some(range => mapping.line >= range.startLine && mapping.line <= range.endLine)) return [];
      const delta = ranges.reduce((sum, range, i) => sum + (mapping.line > range.endLine
        ? outputRanges[i].endLine - outputRanges[i].startLine - (range.endLine - range.startLine) : 0), 0);
      return [{ ...mapping, line: mapping.line + delta }];
    });
    const retainedIds = new Set(retained.map(mapping => mapping.id));
    const mappings = [...retained, ...(generated.mappings ?? []).filter(mapping => !retainedIds.has(mapping.id)
      && outputRanges.some(range => mapping.line >= range.startLine && mapping.line <= range.endLine))];
    return { ...reviseDiagram(base!, { kind: 'patches', retainMappings: !request.sourceMappings, patches, mappings, nodeCorrespondence: generated.nodeCorrespondence }), replacementRanges: outputRanges };
  }
  return request.baseRevisionId
    ? reviseDiagram(base!, { kind: 'replace', retainMappings: !request.sourceMappings, input: generated, nodeCorrespondence: generated.nodeCorrespondence })
    : createDiagram({ ...request.input, ...generated, id: request.input.id, revision: 0 });
}
