# Source mappings through MCP

Use `set_diagram_source_mappings` to replace a diagram's complete source mappings
and captured evidence without resending its ASCII. The same operation is available
as `nodes.setSourceMappings(...)` inside `exec`.

Read the diagram with `nodes.get`, then submit:

```json
{
  "sessionId": "<attached document session>",
  "changeSessionId": "<proposal session, when editing a proposal>",
  "requestId": "<unique request ID>",
  "expectedVersion": 0,
  "nodeId": "grid:overview",
  "expectedContentHash": "<content.asciiSha256 from the read>",
  "mappings": [
    {
      "id": "map-service",
      "entityId": "service",
      "sourceRangeIndex": 0,
      "sourceRangeId": "service-definition",
      "line": 1,
      "startColumn": 1,
      "endColumn": 7
    }
  ],
  "evidence": {
    "service": {
      "id": "service",
      "handle": "Service",
      "label": "Service",
      "category": "interface-data-struct",
      "summary": "Service declaration",
      "sourceRanges": [{
        "id": "service-definition",
        "path": "src/service.ts",
        "startLine": 12,
        "endLine": 12,
        "originalLines": ["export class Service {}"],
        "symbol": "Service"
      }]
    }
  }
}
```

Diagram coordinates and source line ranges are 1-based and inclusive.
`sourceRangeIndex` is zero-based. Source paths are relative to the bound repository.
Each evidence range must contain the captured lines for that range. The operation
validates the payload and references; callers must capture accurate source text.

Optional `source` replaces the repository binding using the same schema as
`draw_diagram`; omitting it preserves the existing binding. Both `mappings` and
`evidence` are required complete replacements, not merges. Empty values clear them.
The expected version and text hash reject stale uploads. Retry an identical
request with the same request ID after a transport failure.

Live calls update the document controller, notify the UI, and enter the shared
undo history. The page automatically saves that editing history to its workspace.
Proposal calls remain isolated and persist in Changes. Neither operation publishes
a catalog revision by itself. On workspace restore, unchanged drafts advance to
the latest saved catalog revision; locally edited drafts remain intact and show a
newer-revision notice.

The HTTP equivalent is `POST /api/mapping/agent/tools/set_diagram_source_mappings`.

Validation:

```sh
npm run build
node tests/browser/mapping/browser-source-mappings-check.mjs
```

Set `BROWSER_CHROME_PATH` when Chrome is installed outside the browser helper's
default paths. The browser check uses a disposable project and server.
