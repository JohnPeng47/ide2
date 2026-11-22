import { tokenizeTemplate } from '../../../../domain/mapping/evals/promptTemplate';
import { includedTemplateId } from '../../../../domain/mapping/evals/promptTemplateIncludes';

export function PromptTemplateTag({ id }: { id: string }) {
  return <span className="experiment-tag prompt-template-tag" title={id}>{id.replace(/^prompt-snippets\//, '').replace(/\.txt$/, '')}</span>;
}

/** Keep includes at their authored positions while leaving the rest of the prompt readable. */
export function PromptTemplateText({ source }: { source: string }) {
  return <>{tokenizeTemplate(source).map(token => {
    const id = includedTemplateId(token.name);
    return id ? <PromptTemplateTag key={token.start} id={id} /> : token.text;
  })}</>;
}
