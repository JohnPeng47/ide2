import { subtreeReplacement } from '../../../../domain/core/diagrams/diagramSubtreeEdit';
import { AgentContext } from '../../../../domain/core/agents/agentContext';
import { Type } from '@earendil-works/pi-ai';
import { DefaultResourceLoader, defineTool, getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import type { DiagramGenerationRequest, DiagramGenerator, GenerationOptions } from '../../../../domain/core/diagrams/diagramService';
import { validateGeneratedDiagramEdit, type GeneratedDiagramEdit } from '../../../../domain/core/diagrams/generatedDiagramEdit';
import { defaultTemplateSelection, renderPromptTemplate, resolvePromptTemplate } from '../../../../domain/mapping/agent/promptTemplates';
import { PiAgentRuntime, progressFor } from '../../../core/agents/agentRuntime';
import { createValidatedSubmission } from '../../../core/agents/validatedSubmission';

/** Renders the request's validated template; requests without one use the default edit template. */
export function renderDiagramEditPrompt(request: DiagramGenerationRequest) {
  if (!request.context) throw Error('Diagram generation requires captured context');
  const prompt = request.prompt ?? (() => {
    const template = resolvePromptTemplate(defaultTemplateSelection('edit-diagram'), 'edit-diagram');
    return { markdown: template.markdown, options: template.options, parameters: template.definition.parameters, references: [] };
  })();
  return (request.editRange ? `Only change raw lines ${request.editRange.startLine} through ${request.editRange.endLine} (the selected subtree). Return the complete diagram with every line before and after that range unchanged. Preserve the branch indentation and connectors. Changes outside that range are rejected.\n\n` : '') + renderPromptTemplate(prompt, {
    context: JSON.stringify({ baseRevisionId: request.baseRevisionId ?? null, diagram: request.context.diagram, editableSubtree: request.editRange ?? null, connections: request.context.connections ?? [] }),
    references: JSON.stringify(prompt.references), instruction: JSON.stringify(request.instruction) });
}

export class PiDiagramEditRuntime extends PiAgentRuntime implements DiagramGenerator {
  constructor(private readonly sourceRoot: string, enabled = false) { super(enabled); }
  async generate(request: DiagramGenerationRequest, options: GenerationOptions) {
    this.requireEnabled();
    const base = request.context?.diagram;
    if (!base) throw Error('Diagram edit context is required');
    options.signal?.throwIfAborted();
    const configured = await this.model();
    const prompt = renderDiagramEditPrompt(request);
    const submission = createValidatedSubmission<GeneratedDiagramEdit>({ toolName: 'submit_diagram_edit',
      validate: candidate => { try { validateGeneratedDiagramEdit(base, candidate); if (request.editRange) subtreeReplacement(base, candidate.ascii, request.editRange); } catch (error) { return String(error); } },
      acceptedMessage: () => 'Validated diagram edit submitted.' });
    const submit = defineTool({ name: 'submit_diagram_edit', label: 'Submit diagram edit',
      description: 'Submit the complete revised ASCII and mappings into the supplied evidence.',
      promptSnippet: 'Submit a complete revised diagram', promptGuidelines: [submission.promptGuideline],
      parameters: Type.Object({ ascii: Type.String({ minLength: 1, maxLength: 20000 }),
        structureKind: Type.Union([Type.Literal('diagram'), Type.Literal('tree')]),
        mappings: Type.Array(Type.Object({ id: Type.String(), entityId: Type.String(), sourceRangeIndex: Type.Integer({ minimum: 0 }),
          sourceRangeId: Type.Optional(Type.String()), line: Type.Integer({ minimum: 1 }),
          startColumn: Type.Integer({ minimum: 1 }), endColumn: Type.Integer({ minimum: 1 }) }), { maxItems: 2000 }) }),
      execute: (id, candidate) => submission.execute(id, candidate)
    });
    const settingsManager = SettingsManager.inMemory({ defaultProvider: configured.provider,
      defaultModel: configured.modelId, defaultThinkingLevel: 'medium' });
    const resourceLoader = new DefaultResourceLoader({ cwd: this.sourceRoot, agentDir: getAgentDir(), settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: 'You create and edit ASCII diagrams using captured context. Follow the specification and finish with a validated submit_diagram_edit tool call.' });
    await resourceLoader.reload(); options.signal?.throwIfAborted();
    const agentContext = request.agentContext ? AgentContext.fromSnapshot(request.agentContext) : undefined;
    const { session } = await this.createSession({ cwd: this.sourceRoot, modelRuntime: configured.runtime, model: configured.model,
      thinkingLevel: 'medium', tools: ['submit_diagram_edit'], customTools: [submit], resourceLoader, settingsManager }, agentContext);
    const unsubscribe = session.subscribe(event => {
      const progress = progressFor(event, `${configured.provider}/${configured.modelId}`, session.sessionId);
      if (progress) options.onProgress?.(progress.message);
    });
    const abort = () => { void session.abort().catch(() => {}); };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      options.signal?.throwIfAborted();
      await session.prompt(prompt);
      options.signal?.throwIfAborted();
      if (!submission.value) throw Error('Diagram edit agent finished without a validated submission');
      const candidate = validateGeneratedDiagramEdit(base, submission.value);
      return { ...candidate, source: base.sourceContext.binding, evidence: base.sourceContext.evidence };
    } finally {
      options.signal?.removeEventListener('abort', abort); unsubscribe(); session.dispose(); this.sessions.delete(session);
    }
  }
}

export class FakeDiagramEditRuntime implements DiagramGenerator {
  async generate(request: DiagramGenerationRequest, options: GenerationOptions) {
    options.signal?.throwIfAborted();
    const base = request.context!.diagram, instruction = request.instruction.replace(/[\r\n]/g, ' ');
    options.onProgress?.('Generating fake diagram edit');
    if (!request.baseRevisionId) return { ascii: `[created: ${instruction}]`, structureKind: 'diagram' as const, mappings: [],
      source: base.sourceContext.binding, evidence: base.sourceContext.evidence };
    const lines = base.content.ascii.split('\n');
    if (request.editRange) lines[request.editRange.startLine - 1] += ` [edited: ${instruction}]`;
    else lines.push(`[edited: ${instruction}]`);
    return { ascii: lines.join('\n'),
      structureKind: base.content.structure.kind, mappings: [...base.sourceContext.mappings],
      source: base.sourceContext.binding, evidence: base.sourceContext.evidence };
  }
  dispose() {}
}
