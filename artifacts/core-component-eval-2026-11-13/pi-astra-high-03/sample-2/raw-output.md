# Pi generation 2

The model completed successfully. Canvas validation failed: `Expected one ASCII tree root`. Source/legend continuation lines below the title prevent the parser from recognizing the title as the root. The exact generated ASCII is preserved below; it has not been repaired or regenerated.

```text
Pi coding-agent session -- AgentSession connects conversation, model execution, tools and durable history
|   [M] module/API boundary; [C] call flow; [O] state/lifetime; [D] data dependency
|
|-- [M] Session-facing API: AgentSession
|   |   packages/coding-agent/src/core/agent-session.ts:409
|   |-- Exposes prompt(), steer(), followUp(), abort(), subscribe(), waitForIdle()
|   |-- Exposes setModel(), setThinkingLevel(), setActiveToolsByName(), compact(), navigateTree()
|   |-- [O] Retains Agent, SessionManager, SettingsManager and ModelRuntime
|   |   `-- Internally coordinates extension runner, tool registry, queued context and recovery controllers
|   `-- Hosts share this behavior rather than implementing separate agent loops
|       |-- main.ts -> InteractiveMode / runPrintMode / runRpcMode
|       |   packages/coding-agent/src/main.ts:1010
|       `-- SDK createAgentSession() -> { session, extensionsResult, modelFallbackMessage }
|           packages/coding-agent/src/core/sdk.ts:191
|
|-- [C] createAgentSession() assembles a runnable conversation
|   |   packages/coding-agent/src/core/sdk.ts:191-480
|   |-- Resolve cwd; obtain SettingsManager, SessionManager, ModelRuntime and ResourceLoader
|   |-- [D] buildSessionContext() + branch model selection + settings + configured auth
|   |   `-- Restore messages/model/thinking level, or select initial defaults
|   |-- new Agent({ initialState, convertToLlm, streamFn, transformContext, ... })
|   |   |-- streamFn -> ModelRuntime.streamSimple()
|   |   `-- transformContext -> ExtensionRunner.emitContext()
|   `-- new AgentSession(...) installs persistence, request, turn-boundary and tool hooks
|       `-- _buildRuntime() -> ExtensionRunner + built-in/custom tool registry
|
|-- [C] prompt(text, options) runs one session activity
|   |   packages/coding-agent/src/core/agent-session.ts:1943-2288
|   |-- Extension slash command? -> command.handler(ctx), without an ordinary prompt
|   |-- _preparePrompt()
|   |   |-- Input hooks -> skill expansion -> prompt-template expansion
|   |   |-- Already running -> enqueue steering or follow-up input
|   |   `-- Otherwise validate model/auth -> BeforeAgentStartTrigger
|   |-- _prepareRun()
|   |   |-- Check compaction -> emitBeforeAgentStart()
|   |   `-- [D] Prompt options + active tools + normalized images + pending custom messages
|   |       `-- Starting messages, including a system/tool-loadout patch when needed
|   `-- _startRun() -> agent.prompt(messages)
|       |-- _handlePostAgentRun() may retry, compact or drain newly queued input
|       |   `-- agent.continue() re-enters execution with updated context
|       `-- Before-settle hooks may continue; finally emit agent_settled
|           `-- waitForIdle() covers session recovery/settlement, not only one model response
|
|-- [M] Agent owns transient execution; agent-loop supplies the model/tool cycle
|   |   packages/agent/src/agent.ts:188; packages/agent/src/agent-loop.ts:180
|   |-- [O] Agent state
|   |   |-- messages, model, thinkingLevel, tools
|   |   |-- isStreaming, streamingMessage, pendingToolCalls, errorMessage
|   |   `-- steeringQueue, followUpQueue, activeRun.promise and AbortController
|   |-- [C] runAgentLoop() / runAgentLoopContinue()
|   |   |-- prepareNextTurn -> apply queued messages and tool declaration changes
|   |   |-- prepareRequest -> session projection and request model selection
|   |   |-- streamAssistantResponse()
|   |   |   |-- [D] AgentMessage[] -> transformContext -> convertToLlm -> normalized Context
|   |   |   `-- streamFunction(model, context, options) -> streamed assistant events
|   |   |-- Assistant tool calls -> executeToolCalls() -> ToolResultMessage[]
|   |   |   `-- Results enter context before the next assistant request
|   |   `-- finishTurn() decides continuation/end
|   |       |-- Tool calls or steering -> another inner turn
|   |       `-- Follow-up queue -> another cycle after the agent would otherwise stop
|   |-- [M] ModelRuntime is the provider/auth boundary
|   |   |   packages/coding-agent/src/core/model-runtime.ts:744
|   |   |-- resolveModel() handles virtual selections
|   |   `-- streamSimple() prepares provider request -> provider.streamSimple()
|   `-- [C] Agent events -> AgentSession._handleAgentEvent()
|       |   packages/coding-agent/src/core/agent-session.ts:1163
|       |-- Extension handlers -> public subscribe() listeners
|       |-- message_end -> SessionManager.appendMessage() / appendCustomMessageEntry()
|       `-- turn_end -> flush context-only custom messages after tool results
|
|-- [M] Tool and extension boundary -- capabilities are assembled per session
|   |   packages/coding-agent/src/core/agent-session.ts:3650-3812
|   |-- _buildRuntime() -> createAllToolDefinitions(cwd, options)
|   |   |   packages/coding-agent/src/core/tools/index.ts
|   |   |-- read / bash / edit / write are the base default active tools
|   |   `-- powershell / grep / find / ls are also available built-ins
|   |-- _refreshToolRegistry()
|   |   |-- Built-in definitions + ExtensionRunner.getAllRegisteredTools() + SDK customTools
|   |   |-- Allowed/excluded names filter registration and activation
|   |   `-- wrapRegisteredTools() -> executable AgentTool registry
|   |-- [D] Tool exposure + active selection -> model declarations versus callable tools
|   |   `-- _preparePromptAndToolLoadout() and declareToolChanges() record loadout changes
|   |       packages/coding-agent/src/core/agent-session.ts:1828; packages/agent/src/agent-loop.ts:350
|   `-- ExtensionRunner hooks connect input, context, tools, provider traffic and session boundaries
|       `-- Extensions participate through bound APIs; session retains coordination and persistence
|
|-- [O] SessionManager retains canonical history; Agent messages are its working projection
|   |   packages/coding-agent/src/core/session-manager.ts:995
|   |-- fileEntries[] + byId + leafId + labels + session identity/cwd
|   |   |-- Entries link id -> parentId: one history file can contain multiple branches
|   |   `-- Messages, model/thinking changes, compactions, context edits and summaries coexist
|   |-- appendMessage() / appendCompaction() / other append APIs
|   |   |-- Append child of current leaf -> advance leaf -> _persist()
|   |   `-- JSONL persistence, or in-memory operation; initial file write waits for conversation
|   |       packages/coding-agent/src/core/session-manager.ts:1174-1306
|   |-- [D] buildSessionProjection(entries, leafId, byId)
|   |   |   packages/coding-agent/src/core/session-manager.ts:468-584
|   |   |-- Follow selected leaf path
|   |   |-- Latest compaction -> summary/system checkpoint + retained tail + newer entries
|   |   |-- Latest context_edit per target -> replace content or omit from model context
|   |   `-- Return provenance-linked projected entries, messages, model and thinking level
|   |-- _refreshFinalizedContext() -> agent.state.messages = projection.messages
|   |   packages/coding-agent/src/core/agent-session.ts:999
|   `-- compact(), navigateTree() and retry recovery change the selected/projected context
|       |-- [D] Context token estimate + model limits + settings -> compaction decision
|       |-- Summarization -> appendCompaction() -> rebuild projection
|       `-- Failed retry attempts remain in raw history but can be durably omitted from requests
|           packages/coding-agent/src/core/agent-session.ts:2923,3097,3948,4126
|
`-- [O] AgentSessionRuntime controls session replacement and teardown
    |   packages/coding-agent/src/core/agent-session-runtime.ts:74
    |-- Retains current session/services and a createRuntime factory
    |-- switchSession() / newSession() / fork() / importFromJsonl()
    |   |-- Before-switch/fork hooks may cancel supported transitions
    |   |-- teardownCurrent(): await session.abort() -> session_shutdown -> dispose()
    |   |   `-- Settle and persist the outgoing turn before invalidating its context
    |   `-- Apply replacement -> rebind host -> optional withSession callback
    `-- AgentSession.dispose()
        |   packages/coding-agent/src/core/agent-session.ts:1477
        |-- Abort retry, compaction, branch summary, bash and agent execution
        |-- Invalidate extension contexts; detach agent/public listeners
        `-- Cancel cache warming and cleanupSessionResources(sessionId)
            `-- Durable session history survives the live runtime's lifetime
```
