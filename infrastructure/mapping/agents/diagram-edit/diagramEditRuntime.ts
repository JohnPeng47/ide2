import { readFile } from 'node:fs/promises';
import { Type } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, defineTool, getAgentDir, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import type { DiagramGenerationRequest, DiagramGenerator, GenerationOptions } from '../../../../domain/core/diagrams/diagramService';
import { validateGeneratedDiagramEdit, type GeneratedDiagramEdit } from '../../../../domain/core/diagrams/generatedDiagramEdit';
import { PiAgentRuntime, progressFor } from '../../../core/agents/agentRuntime';
import { createValidatedSubmission } from '../../../core/agents/validatedSubmission';

export function renderDiagramEditPrompt(template: string, request: DiagramGenerationRequest) {
  if (!request.context || !request.baseRevisionId) throw Error('Diagram edits require a captured base revision');
  if (!template.includes('{{context}}') || !template.includes('{{instruction}}')) throw Error('Invalid diagram edit prompt template');
  const fields: Record<string, string> = { context: JSON.stringify({ baseRevisionId: request.baseRevisionId,
    diagram: request.context.diagram, connections: request.context.connections ?? [] }), instruction: JSON.stringify(request.instruction) };
  return template.replace(/{{([^{}]+)}}/g, (_, key: string) => {
    if (!(key in fields)) throw Error(`Unknown diagram edit template field: ${key}`);
    return fields[key];
  });
}

export class PiDiagramEditRuntime extends PiAgentRuntime implements DiagramGenerator {
  constructor(private readonly sourceRoot: string) { super(); }
  async generate(request: DiagramGenerationRequest, options: GenerationOptions) {
    const base = request.context?.diagram;
    if (!base) throw Error('Diagram edit context is required');
    options.signal?.throwIfAborted();
    const configured = await this.model();
    const template = await readFile(new URL('./prompts/edit-diagram.md', import.meta.url), 'utf8');
    const prompt = renderDiagramEditPrompt(template, request);
    const submission = createValidatedSubmission<GeneratedDiagramEdit>({ toolName: 'submit_diagram_edit',
      validate: candidate => { try { validateGeneratedDiagramEdit(base, candidate); } catch (error) { return String(error); } },
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
      systemPrompt: 'You edit ASCII diagrams using captured context. Follow the editing specification and finish with a validated submit_diagram_edit tool call.' });
    await resourceLoader.reload(); options.signal?.throwIfAborted();
    const { session } = await createAgentSession({ cwd: this.sourceRoot, modelRuntime: configured.runtime, model: configured.model,
      thinkingLevel: 'medium', tools: ['submit_diagram_edit'], customTools: [submit], resourceLoader, settingsManager,
      sessionManager: SessionManager.inMemory(this.sourceRoot) });
    const unsubscribe = session.subscribe(event => {
      const progress = progressFor(event, `${configured.provider}/${configured.modelId}`, session.sessionId);
      if (progress) options.onProgress?.(progress.message);
    });
    const abort = () => { void session.abort().catch(() => {}); };
    this.sessions.add(session); options.signal?.addEventListener('abort', abort, { once: true });
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
    const base = request.context!.diagram;
    options.onProgress?.('Generating fake diagram edit');
    return { ascii: `${base.content.ascii}\n[edited: ${request.instruction.replace(/[\r\n]/g, ' ')}]`,
      structureKind: base.content.structure.kind, mappings: [...base.sourceContext.mappings],
      source: base.sourceContext.binding, evidence: base.sourceContext.evidence };
  }
  dispose() {}
}
