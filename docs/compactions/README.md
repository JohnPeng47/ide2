# Source compactions

Seven independently generated single-file ASCII compactions. Each worker received the same [single-file prompt](single-file-prompt.md), with its source-file path and output stem substituted, in an isolated conversation. Exactly one subagent was launched per source file; at most three workers ran concurrently.

| Source | Compacted tree | Source map | Source lines | Semantic tree lines |
| --- | --- | --- | ---: | ---: |
| `src/domain.ts` | [Tree](src-domain.txt) | [Mappings](src-domain.json) | 1,047 | 662 |
| `src/refBuffer.ts` | [Tree](src-refBuffer.txt) | [Mappings](src-refBuffer.json) | 121 | 55 |
| `src/referenceResolver.ts` | [Tree](src-referenceResolver.txt) | [Mappings](src-referenceResolver.json) | 104 | 39 |
| `src/prompt.ts` | [Tree](src-prompt.txt) | [Mappings](src-prompt.json) | 946 | 187 |
| `src/derivativePrompt.ts` | [Tree](src-derivativePrompt.txt) | [Mappings](src-derivativePrompt.json) | 206 | 55 |
| `server/agentRuntime.ts` | [Tree](server-agentRuntime.txt) | [Mappings](server-agentRuntime.json) | 1,278 | 260 |
| `server/application.ts` | [Tree](server-application.txt) | [Mappings](server-application.json) | 2,856 | 381 |
| **Total** | | | **6,558** | **1,639** |

Coordinates do not appear in the rendered trees. Each JSON sidecar contains the source path, exact source-byte SHA-256, tree path, and one mapping per semantic tree line. `treeLine`, `startLine`, and `endLine` are one-based; source ranges are inclusive. Root rows map to the full source file. Blank or connector-only rows need no mapping. These are compressed summaries with recoverable source locations, not lossless code translations.

Validate every artifact from the repository root:

```sh
node scripts/validate-compactions.mjs
```

The validator checks source hashes, ASCII format, absence of ellipses, exact semantic-row coverage, valid source bounds, and named top-level declarations/class methods with overlapping source mappings. Workers also reviewed the meanings and source ranges of their summaries. The original source files were not modified. These outputs are disk artifacts; they have not been imported into the project diagram catalog.
