/** Reference blocks remain atomic in the editor and become numbered markers on the wire. */
export type PromptBodyBlock<T> = { kind: 'text'; id: string; text: string } | { kind: 'reference'; id: string; reference: T };
export const promptText = (text = ''): Extract<PromptBodyBlock<never>, { kind: 'text' }> => ({ kind: 'text', id: crypto.randomUUID(), text });

export function normalizePromptBody<T>(body: readonly PromptBodyBlock<T>[]): PromptBodyBlock<T>[] {
  const result: PromptBodyBlock<T>[] = [];
  for (const block of body) {
    const last = result.at(-1);
    if (block.kind === 'text' && last?.kind === 'text') result[result.length - 1] = { ...last, text: last.text + block.text };
    else {
      if (block.kind === 'reference' && last?.kind !== 'text') result.push(promptText());
      result.push(block);
    }
  }
  if (result.at(-1)?.kind !== 'text') result.push(promptText());
  if (result[0]?.kind !== 'text') result.unshift(promptText());
  return result;
}

export function serializePromptBody<T>(body: readonly PromptBodyBlock<T>[]): { prompt: string; references: T[] } {
  const references: T[] = [];
  const prompt = body.map(block => {
    if (block.kind === 'text') return block.text;
    references.push(structuredClone(block.reference));
    return `[ref ${references.length}]`;
  }).join('');
  return { prompt, references };
}
