// The public path is the stable, project-independent ID and resolves to the raw template.
const files = import.meta.glob<string>('/public/prompt-snippets/*.txt', {
  eager: true, import: 'default', query: '?raw'
});

export const promptSnippets = Object.entries(files).map(([path, text]) => ({
  id: path.slice('/public/'.length),
  name: path.slice('/public/prompt-snippets/'.length, -'.txt'.length),
  text
}));
