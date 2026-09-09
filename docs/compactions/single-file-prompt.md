Read `{{SOURCE_FILE}}` completely and generate a compacted ASCII tree covering its declarations and methods, with every semantic tree line mapped to an identifiable source range.

Supported format:
- Root the tree at its source-file path.
- Use indentation with `|`, `+--`, and `\--` connectors.
- Do not use ellipses or omission placeholders.
- Keep source coordinates outside the rendered tree.

Outputs:
- Save the tree to `{{OUTPUT_STEM}}.txt`.
- Save its source mappings to `{{OUTPUT_STEM}}.json` using this schema:
  `{ "sourceFile": "{{SOURCE_FILE}}", "sourceSha256": "SHA-256 of the exact source file bytes", "treeFile": "{{OUTPUT_STEM}}.txt", "mappings": [{ "treeLine": 1, "sourceRanges": [{ "startLine": 1, "endLine": 10 }] }] }`
- Tree line numbers and source ranges are one-based and inclusive. Include exactly one mapping entry for every semantic tree line, including the root. Blank lines and connector-only lines do not require entries. Each entry may contain multiple source ranges.
- Write only these two output files with apply_patch. Do not modify the source or other files. Do not spawn further agents.
- Verify that all semantic tree lines have valid mappings into the source snapshot, then report the output paths and counts.

Example 1:

```text
PiDiagramAgentRuntime
|
+-- private state
|   +-- modelRuntime?: Promise<ModelRuntime>
|   +-- sessions: Set<{ abort(); dispose() }>
|   +-- mappingPocSessions: Map<string, MappingPocAgentSession>
|   \-- mappingPocPromptBusy = false
|
\-- private runtime()
    +-- modelRuntime ??= ModelRuntime.create({ allowModelNetwork: false })
    \-- return modelRuntime
```

Example 2:

```text
private model(overrideModelId?)
|
+-- runtime = await this.runtime()
+-- provider = "openai-codex"
+-- modelId = overrideModelId || NEW_DIAGRAM_MODEL || DEFAULT_DIAGRAM_MODEL_ID
+-- model = runtime.getModel(provider, modelId)
+-- require model + runtime.hasConfiguredAuth(provider)
\-- return { runtime, model, provider, modelId }
```

Example 3:

```text
submit = defineTool(toolDefinition)
|
+-- parameters: artifactSubmissionParameters(evidenceNoun)
\-- execute(_toolCallId, params)
    +-- resolveCodeEntityPromptAliases(params.codeEntityIds, allowedAliases)
    +-- resolve mapping entity aliases when mappings are present
    +-- candidate: { name, ascii, codeEntityIds, mappings? }
    +-- if state.mappingSource
    |   +-- unchangedArtifactError(state.mappingSource, candidate)
    |   +-- diagramMappingValidationError(candidate.ascii, candidate.mappings, mappedEntities)
    |   \-- invalid: reject submission; allow correction
    \-- state.submissions.push(candidate); terminate turn
```

Example 4:

```text
promptDiagramSelection(request, onProgress?)
|
+-- reject if mappingPocPromptBusy
+-- instruction = request.instruction.trim(); require 1..4000 characters
+-- mappingPocPromptBusy = true
|
+-- state = mappingPocSessions.get(clientSessionId)
|           ?? await createMappingPocSession(request)
+-- require matching ASCII + revision; reject existing pending request
+-- validateMappingPocMappings(state.ascii, state.mappings)
+-- hunk = mappingPocPromptHunk(state.ascii, request.selection)
+-- sourceContext = await mappingPocSourceContextForSelection(contextRequest)
+-- selectionId = "selection-" + randomUUID()
+-- promptNonce = collisionSafePromptNonce(ascii, instruction, selectionId, sourceText)
|
+-- state.pending = { selectionId, expectedRevision, hunk }
+-- state.onProgress = onProgress
+-- state.lastUsedAt = Date.now()
|
+-- state.session.prompt(renderedPrompt)
|   +-- generate: JSON instruction + sourceDiagram + selection + evidence
|   \-- edit: renderMappingPocEditPrompt(editPromptInput)
|
+-- require pending.submission; return pending.submission
+-- catch: disposeMappingPocSession(clientSessionId); rethrow
\-- finally
    +-- clear state.pending + state.onProgress
    \-- mappingPocPromptBusy = false
```
