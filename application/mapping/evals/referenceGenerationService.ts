import { ApplicationError } from '../../core/errors';
import { documentFromHistory, type CanvasHistoryRecord } from '../../../domain/core/diagrams/canvasHistory';
import { DefaultCanvasHistoryService } from '../../../domain/core/diagrams/canvasHistoryService';
import { singleBoxScene } from '../../../domain/core/diagrams/promoteDiagram';
import { sha256 } from '../../../domain/core/sha256';
import type { CompareSource } from '../../../domain/mapping/compare/comparePageSession';
import { generateReferencesSchema, loadReferenceSourcesSchema, openReferenceSessionSchema, REFERENCE_GENERATION_INSTRUCTIONS, referenceContextMessage, referenceGenerationMessage, referenceSources, referenceSourcesMessage, referenceSourcesStatus, type ReferenceGenerationSession } from '../../../domain/mapping/evals/referenceGeneration';
import type { AgentChatService } from '../agent-chat/agentChatService';

export interface ReferenceGenerationStore { read(id: string): Promise<ReferenceGenerationSession | null>; save(session: ReferenceGenerationSession): Promise<void> }

/** Generates more snippets like a reference, in one agent conversation per diagram revision. Snippets are parsed from the chat stream. */
export class ReferenceGenerationService {
  private opening = new Map<string, Promise<ReferenceGenerationSession>>();
  constructor(private store: ReferenceGenerationStore, private chats: Pick<AgentChatService, 'createBackground' | 'get' | 'send'>,
    private canvases: { captureCanvas(source: CompareSource): Promise<{ history: CanvasHistoryRecord }> }) {}
  private async held(id: string) {
    const session = await this.store.read(id);
    return session && await this.chats.get(session.chatId).then(() => true, () => false) ? session : undefined;
  }
  /** The diagram's conversation, created with the diagram text the first time. Its sources are added by loadSources. */
  async open(raw: unknown) {
    const input = openReferenceSessionSchema.parse(raw), id = sha256(input.revisionId).slice(0, 40);
    let pending = this.opening.get(id);
    if (!pending) {
      pending = (async () => {
        const existing = await this.held(id);
        if (existing?.sources) return existing;
        const { history } = await this.canvases.captureCanvas(input.source);
        const document = documentFromHistory(history);
        new DefaultCanvasHistoryService('current').openContext(document, history.snapshots[history.headId].view, history);
        const scene = singleBoxScene(document.scene, input.boxId), diagram = Object.values(scene.contents).find(item => item.revisionId === input.revisionId);
        if (!diagram) throw new ApplicationError('invalid-input', 'This diagram changed. Reopen it to generate from the current version.');
        const chat = await this.chats.createBackground({ title: `References: ${diagram.diagramId}`, instructions: REFERENCE_GENERATION_INSTRUCTIONS, context: referenceContextMessage(diagram.content.ascii) });
        const session: ReferenceGenerationSession = { schemaVersion: 1, id, chatId: chat.id, diagramId: diagram.diagramId, revisionId: diagram.revisionId, sources: referenceSources(diagram.sourceContext), createdAt: new Date().toISOString() };
        await this.store.save(session);
        return session;
      })().finally(() => this.opening.delete(id));
      this.opening.set(id, pending);
    }
    return pending;
  }
  private async session(id: string) {
    const session = await this.store.read(id);
    if (!session) throw new ApplicationError('invalid-input', 'This generation session no longer exists. Reopen the dialog.');
    return session;
  }
  /** Asks the agent to read the diagram's source files. Whether it managed to is read back from the chat stream. */
  async loadSources(id: string, raw: unknown) {
    const { requestId } = loadReferenceSourcesSchema.parse(raw), session = await this.session(id), chat = await this.chats.get(session.chatId);
    if (!session.sources.files.length) throw new ApplicationError('invalid-input', 'No source files are mapped to this diagram.');
    if (referenceSourcesStatus(chat).state === 'loaded') return { requestId };
    await this.chats.send(session.chatId, { ...chat.settings, requestId, text: referenceSourcesMessage(session.sources, requestId) });
    return { requestId };
  }
  async generate(id: string, raw: unknown) {
    const { requestId, ...request } = generateReferencesSchema.parse(raw), session = await this.session(id);
    const chat = await this.chats.get(session.chatId);
    await this.chats.send(session.chatId, { ...chat.settings, requestId, text: referenceGenerationMessage(request) });
    return { requestId };
  }
}
