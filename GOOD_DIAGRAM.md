 Can you save this exact diagram to file:
   PlannotatorWorkspaceState
    |
    +-- workspaceKey
    |   +-- projectRoot
    |   +-- herdrWorkspaceId
    |
    +-- documentsByPath: Map<Path, DocumentState>
    |   |
    |   +-- DocumentState
    |       +-- path
    |       +-- currentRevisionId
    |       +-- revisionTree
    |       |   +-- RevisionNode
    |       |       +-- parentRevisionId
    |       |       +-- childRevisionIds[]
    |       |       +-- patch
    |       |
    |       +-- annotations[]
    |           +-- annotationId
    |           +-- section/block anchor
    |           +-- body
    |
    +-- herdrConnection: HerdrConnection
    |   +-- workspaceId
    |   +-- originTabId
    |   +-- originPaneId
    |   +-- cwd
    |   +-- connectedAgent
    |   |   +-- kind: "codex"
    |   |   +-- name?
    |   |   +-- codexSessionId
    |   |   +-- lifecycle: idle | working | blocked | done | disconnected
    |   |
    |   +-- validation
    |   |   +-- connected
    |   |   +-- lastValidatedAt
    |   |   +-- failureReason?
    |   |
    |   +-- HerdrBridge                         [server-side only]
    |       +-- validate()
    |       |   +-- verify HERDR_ENV
    |       |   +-- verify workspace/pane still exists
    |       |   +-- verify pane still hosts expected Codex session
    |       |
    |       +-- submitToCurrent(batch)
    |       |   +-- herdr agent prompt <bound agent/pane>
    |       |
    |       +-- forkIntoPane(parentChatNode, batch)
    |       |   +-- split from the bound pane in the same workspace
    |       |   +-- preserve cwd
    |       |   +-- start Codex using the parent's native session fork
    |       |   +-- discover the new pane/session IDs
    |       |   +-- submit the batch to the child agent
    |       |
    |       +-- reconnect(chatNode)
    |           +-- reopen/resume its saved Codex session in a new pane
    |
    +-- chatTree: WorkspaceChatTree
    |   +-- rootNodeIds[]
    |   +-- activeChatNodeId                    ["latest open chat"]
    |   +-- nodesById: Map<ChatNodeId, ChatNode>
    |       |
    |       +-- ChatNode
    |           +-- id
    |           +-- title
    |           +-- parentChatNodeId?           [our durable fork edge]
    |           +-- childChatNodeIds[]
    |           +-- forkPoint?
    |           |   +-- parentCodexSessionId
    |           |   +-- parentTurnId?           [allows future mid-chat forks]
    |           |
    |           +-- runtimeBinding
    |           |   +-- herdrWorkspaceId
    |           |   +-- herdrTabId
    |           |   +-- herdrPaneId?
    |           |   +-- agentName?
    |           |   +-- codexSessionId          [native conversation identity]
    |           |
    |           +-- status
    |           |   +-- connected | queued | working | blocked | disconnected
    |           |
    |           +-- turns[]
    |               +-- ChatTurn
    |                   +-- id
    |                   +-- submissionBatchId
    |                   +-- inputs[]             [one or several queued comments]
    |                   |   +-- UserSubmission
    |                   |       +-- id
    |                   |       +-- prompt
    |                   |       +-- documentPath
    |                   |       +-- documentRevisionId
    |                   |       +-- annotationId?
    |                   |       +-- section/block anchor?
    |                   |
    |                   +-- delivery
    |                   |   +-- queuedAt
    |                   |   +-- deliveredAt?
    |                   |   +-- status
    |                   |
    |                   +-- outputs[]            [reserved for later response ingestion]
    |
    +-- commentComposer: ComposerState
    |   +-- text
    |   +-- attachments[]
    |   +-- primaryAction
    |   |   +-- Save                         -> persist annotation only
    |   |   +-- Ask AI
    |   |
    |   +-- askAITargetToggle
    |       +-- Current chat                 -> enqueue on activeChatNodeId
    |       +-- Fork to new pane             -> create child ChatNode, then enqueue
    |
    +-- submissionDispatcher
        +-- accepts submissions immediately, even while an agent is working
        +-- groups compatible queued submissions into SubmissionBatch
        +-- serializes batches within one ChatNode
        +-- allows different forked ChatNodes/panes to run concurrently
        +-- persists delivery state before invoking Herdr
        +-- never derives relationships from pane position
            +-- ChatNode IDs and Codex session IDs remain authoritative

  And then include with it the original user plan proposal in which this diagram was returned as the answer
