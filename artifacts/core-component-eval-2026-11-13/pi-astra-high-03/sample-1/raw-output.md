# Pi generation 1

The model completed successfully. Canvas validation failed: `Expected one ASCII tree root`. Source/legend continuation lines below the title prevent the parser from recognizing the title as the root. The exact generated ASCII is preserved below; it has not been repaired or regenerated.

```text
Pi coding-session runtime -- AgentSession coordinates prompts, tools, models and conversation history
|   Core: packages/coding-agent/src/core/agent-session.ts:409
|   [M] module boundary  [C] invocation  [O] state/lifetime  [D] data dependency
|
|-- [M] One session API, several hosts
|   |-- main.ts -> InteractiveMode / runPrintMode / runRpcMode
|   |   `-- Hosts submit prompts and consume session.subscribe(AgentSessionEvent)
|   |       Source: packages/coding-agent/src/main.ts:1010
|   |-- createAgentSession(options) -> { session, extensionsResult, modelFallbackMessage }
|   |   |-- Restores messages, model selection and thinking level from SessionManager
|   |   |-- Creates Agent; injects ModelRuntime, SettingsManager and ResourceLoader
|   |   `-- Constructs AgentSession and installs its request, tool and turn hooks
|   |       Source: packages/coding-agent/src/core/sdk.ts:191
|   `-- AgentSession exposes prompt / steer / followUp / abort / compact / navigateTree
|       `-- Private orchestration: _startRun, _handleAgentEvent, _buildRuntime
|           Hosts need not implement persistence, retry or context preparation
|
|-- [C] Prompt-to-result execution -- AgentSession.prompt(text, options)
|   |   Source: packages/coding-agent/src/core/agent-session.ts:1943,2162
|   |-- _tryExecuteExtensionCommand() may handle slash commands without an LLM request
|   |-- _preparePrompt()
|   |   |-- input hooks -> skill/template expansion -> model/auth validation
|   |   `-- Already streaming -> _queueSteer() or _queueFollowUp()
|   |       |-- steer: deliver after current turn's tool calls, before next request
|   |       `-- followUp: deliver when tool calls and steering would otherwise stop
|   |-- _prepareRun() -> before_agent_start -> prompt/tool loadout + starting messages
|   |   `-- [D] Extension-selected model limits -> image normalization for request/history
|   `-- _startRun() -> Agent.prompt(messages) -> runAgentLoop() -> runLoop()
|       |   Sources: packages/agent/src/agent.ts; packages/agent/src/agent-loop.ts:172
|       |-- [O] Agent retains live state and execution resources
|       |   |-- state: messages, model, thinkingLevel, tools, streaming progress
|       |   |-- steeringQueue / followUpQueue: pending AgentMessage objects
|       |   `-- activeRun: AbortController + completion promise
|       |       Listeners are awaited; agent_end alone does not mean settled
|       |-- prepareRequest() installed by AgentSession
|       |   |-- [D] SessionManager.buildSessionProjection() -> canonical request messages
|       |   |-- agent.state.tools -> executable implementations, not just declarations
|       |   `-- Virtual selection -> ModelRuntime.resolveModel(messages, reason, state)
|       |       Selected model stays in Agent state; routed model applies to this request
|       |       Source: packages/coding-agent/src/core/agent-session.ts:848
|       |-- streamAssistantResponse()
|       |   |-- transformContext() -> convertToLlm() -> streamFunction(model, context)
|       |   `-- [M] ModelRuntime.streamSimple() -> prepared.provider.streamSimple()
|       |       |-- Catalog/config + RuntimeCredentials -> model and request authentication
|       |       |-- Built-in, extension and virtual providers share this boundary
|       |       `-- Streaming provider output -> assistant message events
|       |           Source: packages/coding-agent/src/core/model-runtime.ts:174,744
|       |-- Assistant tool calls -> executeToolCalls() -> ToolResultMessage[]
|       |   `-- [D] Tool results enter context -> next assistant response can use them
|       `-- finishTurn() / prepareNextTurnWithContext() control continuation
|           |-- Refresh compaction, system prompt and active tool loadout between turns
|           |-- More tool calls or steering -> another assistant turn
|           `-- Otherwise drain follow-ups, honor explicit continuation, or emit agent_end
|
|-- [M] Tool and extension boundary -- capabilities are assembled per session
|   |   Source: packages/coding-agent/src/core/agent-session.ts:3761
|   |-- _buildRuntime() -> createAllToolDefinitions(cwd) + new ExtensionRunner(...)
|   |   |-- Built-ins: read / bash / powershell / edit / write / grep / find / ls
|   |   |-- Default active set: read / bash / edit / write
|   |   `-- Custom/extension tools join _toolRegistry and _toolDefinitions
|   |       Source: packages/coding-agent/src/core/tools/index.ts
|   |-- [D] Registered definitions + active names + allow/exclude rules -> executable loadout
|   |   `-- Transcript system messages declare toolsAdded/toolsRemoved to the model
|   |       Implementations remain in context.tools; prepareLoadout may hide declarations
|   |-- [C] prepareToolCall() -> executePreparedToolCall() -> finalizeExecutedToolCall()
|   |   |-- Validate arguments; beforeToolCall can block execution
|   |   |-- tool.execute(id, args, signal, onUpdate) performs the capability
|   |   `-- afterToolCall may transform results; tool failures become isError results
|   |       Source: packages/agent/src/agent-loop.ts:821
|   `-- ExtensionRunner participates in input, context, tools and lifecycle boundaries
|       |-- before_agent_start can change prompt options and inject messages
|       |-- turn_end / agent_before_settle can commit context edits and request continuation
|       `-- Provider request/response hooks are wired through createAgentSession()
|           Sources: packages/coding-agent/src/core/agent-session.ts:947,2087;
|                    packages/coding-agent/src/core/sdk.ts:351
|
|-- [O] SessionManager owns durable conversation structure, not the live stream
|   |   Source: packages/coding-agent/src/core/session-manager.ts:985
|   |-- fileEntries[] + byId + leafId -> append-only session tree in JSONL
|   |   |-- SessionEntry.id / parentId connect history; append creates a child of leafId
|   |   |-- Entries include messages, model/thinking changes, summaries and context edits
|   |   `-- branch() moves the active leaf without deleting earlier branches
|   |       SessionManager.inMemory() provides a non-persisted alternative
|   |-- [C] AgentSession._handleAgentEvent(message_end) -> appendMessage()
|   |   |-- Custom messages use appendCustomMessageEntry()
|   |   |-- _entryIdsByMessage connects runtime objects to durable entries
|   |   `-- Extensions and public listeners receive events before this persistence step
|   |       Source: packages/coding-agent/src/core/agent-session.ts:1164
|   |-- [D] Active root-to-leaf path + latest compaction + context edits
|   |   `-- buildSessionProjection() -> provenance-bearing entries + finalized messages
|   |       |-- Latest compaction summary + retained range replace older request context
|   |       |-- Context edits replace/hide projected content without rewriting source entries
|   |       `-- buildSessionContext() restores messages, model and thinking level
|   |           Source: packages/coding-agent/src/core/session-manager.ts:476
|   `-- [C] AgentSession.navigateTree(targetId)
|       |-- Optionally summarize the departing branch up to its common ancestor
|       `-- branchWithSummary() / branch() / resetLeaf() -> rebuild current context
|           Navigation is rejected during prompting, streaming or compaction
|           Source: packages/coding-agent/src/core/agent-session.ts:4126
|
|-- [C] Context maintenance and recovery keep long-running sessions usable
|   |   Source: packages/coding-agent/src/core/agent-session.ts:2054,2910,3106
|   |-- _handlePostAgentRun()
|   |   |-- Retryable response + retry settings -> _prepareRetry() -> Agent.continue()
|   |   `-- _checkCompaction() handles threshold/overflow recovery when appropriate
|   |-- compact() / _runAutoCompaction()
|   |   |-- [D] Branch entries + model context limits + compaction settings
|   |   |   `-- prepareCompaction() -> summary input and firstKeptEntryId
|   |   |-- session_before_compact can cancel or supply an alternate summary
|   |   `-- Default summarizer -> appendCompaction() -> _refreshFinalizedContext()
|   |       History remains stored; subsequent requests use the compacted projection
|   |-- Manual compact() first aborts the run; it does not resume the interrupted turn
|   `-- [O] AgentSession retains retry counters, failed response and abort controllers
|       `-- Compaction, branch summaries, retry waits and bash have separate cancellation state
|
`-- [O] AgentSessionRuntime owns the current session and cwd-bound services
    |   Sources: packages/coding-agent/src/core/agent-session-runtime.ts:66;
    |            packages/coding-agent/src/core/agent-session-services.ts:73,135
    |-- services: cwd / agentDir / ModelRuntime / SettingsManager / ResourceLoader
    |   `-- createAgentSessionServices() -> resource reload and provider registration
    |       createAgentSessionFromServices() -> createAgentSession()
    |-- newSession() / switchSession() / fork()
    |   |-- Before-switch/fork extension hooks may cancel replacement
    |   |-- teardownCurrent(): await session.abort() -> session_shutdown -> dispose()
    |   |   `-- Settle and persist the outgoing turn before invalidating its context
    |   `-- createRuntime(target cwd, SessionManager) -> apply() -> rebindSession()
    |       Replacement creates a new session rather than mutating captured extension contexts
    `-- AgentSession.dispose()
        |-- Abort work; invalidate ExtensionRunner; disconnect Agent subscription/listeners
        `-- Cancel CacheWarmer and cleanupSessionResources(sessionId)
            Durable SessionManager history remains available for later resume
            Source: packages/coding-agent/src/core/agent-session.ts:1477
```
