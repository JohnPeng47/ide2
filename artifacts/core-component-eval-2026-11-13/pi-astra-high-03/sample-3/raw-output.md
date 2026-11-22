# Pi generation 3

The model completed successfully. Canvas validation failed: `Expected one ASCII tree root`. Source/legend continuation lines below the title prevent the parser from recognizing the title as the root. The exact generated ASCII is preserved below; it has not been repaired or regenerated.

```text
Pi coding-session runtime -- AgentSession coordinates conversation, execution and history
|   Source: packages/coding-agent/src/core/agent-session.ts
|   [M] module boundary; [C] call flow; [O] state/resource owner; [D] data dependency
|
|-- [M] Entry points share one session API, rather than separate agent implementations
|   |   Source: packages/coding-agent/src/main.ts; core/sdk.ts; core/agent-session-services.ts
|   |-- main() -> createAgentSessionRuntime() -> InteractiveMode / runPrintMode / runRpcMode
|   |   `-- Hosts submit prompts and consume session events; AgentSession owns behavior
|   |-- createAgentSessionServices() -> cwd-bound ModelRuntime, SettingsManager, ResourceLoader
|   |-- createAgentSessionFromServices() -> createAgentSession()
|   |   |-- [D] SessionManager.buildSessionContext() -> restored messages and thinking level
|   |   |-- [D] saved model selection + settings + configured auth -> initial model
|   |   `-- new Agent(...) -> new AgentSession(...) with shared services and session history
|   `-- AgentSession exposes prompt(), steer(), followUp(), compact(), navigateTree(), subscribe()
|       `-- Private orchestration: _prepareRun(), _handleAgentEvent(), _buildRuntime()
|
|-- [C] AgentSession.prompt(text, options) -> one managed activity
|   |-- Extension slash command -> handler; otherwise _preparePrompt()
|   |   |-- input hooks -> skill/template expansion -> model/auth checks
|   |   `-- Already running -> queue via streamingBehavior: 'steer' or 'followUp'
|   |-- _startRun() -> _prepareRun() -> agent.prompt(messages)
|   |   |-- Check compaction; emit before_agent_start; normalize prompt images
|   |   `-- [D] input + pending custom messages + prompt/tool loadout -> starting messages
|   `-- [M] Agent is the reusable, UI-independent execution engine
|       |   Source: packages/agent/src/agent.ts; packages/agent/src/agent-loop.ts
|       |-- [O] Agent.state
|       |   |-- messages[], model, thinkingLevel, tools[] -> current executable context
|       |   |-- streamingMessage, isStreaming, pendingToolCalls, errorMessage -> live progress
|       |   `-- activeRun: promise + AbortController; steeringQueue and followUpQueue
|       |-- Agent.prompt() / continue() -> runAgentLoop() / runAgentLoopContinue()
|       |   `-- runLoop() repeats assistant/tool turns
|       |       |-- prepareNextTurn / prepareRequest -> refresh context, loadout and model
|       |       |-- declareToolChanges() -> record toolsAdded/toolsRemoved in system messages
|       |       |-- [D] AgentMessage[] -> transformContext() -> convertToLlm() -> normalizeContext()
|       |       |   `-- streamAssistantResponse() -> streamFunction(model, context, options)
|       |       |-- Assistant toolCall[] -> executeToolCalls() -> toolResult messages
|       |       |   |-- Resolve tool + validateToolArguments() + before/after tool hooks
|       |       |   |-- Sequential or parallel batch, according to config/tool executionMode
|       |       |   `-- Results enter context before the next assistant request
|       |       `-- Steering enters between turns; follow-ups run when the agent would stop
|       `-- processEvents() reduces Agent.state, then awaits subscribed listeners
|           `-- AgentSession._handleAgentEvent(): extensions -> public listeners -> persistence
|               `-- message_end -> SessionManager.appendMessage() / appendCustomMessageEntry()
|
|-- [M] ModelRuntime separates session policy from provider transport and credentials
|   |   Source: packages/coding-agent/src/core/model-runtime.ts; core/sdk.ts
|   |-- SDK supplies Agent.streamFunction -> ModelRuntime.streamSimple()
|   |   |-- [D] model + normalized transcript + request options -> provider request
|   |   |-- resolveModel() supports virtual selections; prepareRequest() resolves provider/auth
|   |   `-- prepared.provider.streamSimple() -> streamed assistant events and final usage
|   |-- SettingsManager supplies transport, thinking budgets, timeouts and provider retry limits
|   |-- Extension hooks: before_provider_request, before_provider_headers, after_provider_response
|   `-- CacheWarmer retains eligible session requests for warming
|       `-- Request/model/transcript-prefix checks prevent warming an obsolete conversation
|
|-- [M] AgentSession._buildRuntime() assembles the coding capabilities
|   |   Source: packages/coding-agent/src/core/tools/index.ts; core/resource-loader.ts
|   |-- createAllToolDefinitions(cwd, options)
|   |   |-- read, bash, edit, write -> default active coding tools
|   |   `-- powershell, grep, find, ls -> additional built-in definitions
|   |-- ResourceLoader -> extensions, skills, prompt templates and project context
|   |   `-- [D] resources + selected tools + snippets/guidelines -> system prompt options
|   |-- new ExtensionRunner(...) -> bind session actions, events and host UI context
|   |   |-- Extension commands and input hooks may handle a prompt without invoking the model
|   |   `-- Context, tool, lifecycle and compaction hooks participate in session behavior
|   `-- _refreshToolRegistry() merges built-ins + registered extension tools + SDK customTools
|       |-- [O] _toolDefinitions / _toolRegistry retain definitions and wrapped executors
|       |-- Allow/exclude rules + exposure + activation -> executable/declarable loadout
|       `-- _setActiveTools() -> Agent.state.tools; declaration deltas enter the transcript
|
|-- [O] SessionManager owns canonical history; Agent.state.messages is its working projection
|   |   Source: packages/coding-agent/src/core/session-manager.ts
|   |-- fileEntries[] + byId + leafId -> append-only conversation tree
|   |   |-- SessionEntry.id / parentId -> ancestry; append creates a child of the current leaf
|   |   |-- Message, model/thinking change, usage, custom, summary and context-edit entries
|   |   `-- branch(entryId) moves the leaf; subsequent messages preserve other branches
|   |-- _appendEntry() -> _persist() -> JSONL session file
|   |   |-- Setup-only entries stay in memory; first conversation message flushes accumulated entries
|   |   |-- Later entries append; failed persistence rolls back the in-memory append
|   |   `-- SessionManager.inMemory() provides the same model without file persistence
|   |-- [D] selected ancestry + latest compaction + context edits -> buildSessionProjection()
|   |   |-- Summary/checkpoint + retained suffix -> bounded model-visible history
|   |   |-- Context edits replace or omit message content without deleting raw history
|   |   `-- sourceEntry links retain provenance for projected messages
|   `-- buildSessionContext() / AgentSession._refreshFinalizedContext() -> Agent messages
|       `-- navigateTree() can summarize an abandoned path before restoring the selected branch
|
|-- [C] AgentSession maintains continuity beyond a single engine run
|   |-- _handlePostAgentRun() -> retry, compaction or newly queued work -> agent.continue()
|   |   `-- agent_end is not necessarily session idle; _emitAgentSettled() closes the activity
|   |-- _prepareRetry(message)
|   |   |-- [D] retryable error + retry settings + attempt count -> bounded exponential backoff
|   |   `-- Keep failed response in raw history, omit it from projection, wait abortably, retry
|   |-- compact() / _checkCompaction() / _runAutoCompaction()
|   |   |-- [D] branch history + token usage/model limits + settings -> compaction preparation
|   |   |-- session_before_compact may cancel or supply a summary; otherwise generate one
|   |   `-- appendCompaction(summary, firstKeptEntryId, ...) -> rebuild finalized context
|   |-- _installAgentNextTurnRefresh() also compacts and refreshes loadout between tool turns
|   `-- [O] Session tracks compaction, retry, branch-summary and bash AbortControllers
|       `-- Pending bash/custom context is flushed at safe boundaries, not inside call/result pairs
|
`-- [O] AgentSessionRuntime controls session replacement and shutdown
    |   Source: packages/coding-agent/src/core/agent-session-runtime.ts
    |-- Retains current AgentSession, cwd-bound services and createRuntime factory
    |-- New/resume/fork/import flows -> teardownCurrent() -> create replacement -> rebind host
    |   |-- await session.abort() settles outgoing execution before replacement
    |   |-- session_shutdown hooks -> host teardown callback -> session.dispose()
    |   `-- finishSessionReplacement() rebinds consumers to the new session
    |-- AgentSession.dispose()
    |   |-- Abort owned work; invalidate captured extension contexts; detach subscriptions
    |   `-- Clear listeners, cancel CacheWarmer and cleanupSessionResources(sessionId)
    `-- AgentSessionRuntime.dispose() additionally awaits ModelRuntime.settleCredentialWrites()
        `-- Persisted session history remains available for later resume
```
