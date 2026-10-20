# One DiffSession per push

A connected Git repository can trigger `diff-session-create` through a generic HTTP
push endpoint. Cloudflare Artifacts is the first provider adapter. One push produces
one proposal covering the push's complete change, with astra-high and the existing
two sequential user messages in one agent session. Proposals remain unaccepted.

## Records and behavior

There are two new records, under `<store>/push-integrations/`:

- `connections/<id>.json`: local repository ID, remote provider identity, HTTPS Git
  URL, optional credential environment-variable name, optional live canvas ID, enabled.
- `generations/<push-id>.json`: push identity, ref, before/after SHAs, complete newly
  reachable commit list, status, workflow ID, proposal ID and error/reason.

The local repository must already be registered with this project. Connecting its
remote does not change its identity, diagrams, branches or working tree. Missing
commit objects are fetched into the registered Git repository by exact SHA. The
remote URL contains no credentials; `credentialEnv` names a server environment
variable holding a Git Bearer token.

Generic callers supply a stable `eventId` for a push and reuse it for redelivery.
A different payload under the same ID is rejected. Artifacts has no event ID in its
push schema, so its adapter derives one from repository identity, event timestamp,
ref, before and after. Queue message IDs and subscription IDs do not affect identity.
An atomic on-disk claim prevents duplicate execution across concurrent receivers.

Git discovery always walks the pinned graph instead of trusting the event's
possibly truncated `commits` array or the branch's current HEAD:

| Push | Commits retained | Comparison used for the DiffSession |
| --- | --- | --- |
| Existing branch | Reachable from `after`, excluding `before` | `before` tree → `after` tree |
| New branch (`before` null/all zeros) | All commits reachable from `after` | Empty tree → `after` tree |
| Force-push | Reachable from `after`, excluding `before` | Actual old tree → replacement tree, including removals |
| Rewind to ancestor | Empty newly reachable list | Actual old tree → earlier tree; still generates |
| Deleted branch | None | Recorded as skipped |
| Unchanged ref / equal content trees | Captured when applicable | Recorded as skipped |
| Tag update | None | Recorded as skipped; branch pushes only |

Push sessions preserve the full commit list but map **net push hunks** to the final
head. `comparisonBase` records the old SHA (null for an empty tree); each hunk's
`parent` is that comparison base. Ordinary manually selected commit workflows
retain their existing first-parent-per-commit behavior.

Existing limits apply: 2,000 selected commits, 2,000 hunks, and 8 MiB captured diff.
A full clone is required. Failures are visible in the generation record. Automatic
recovery, delivery-outage handling, backlog scheduling and automatic acceptance are
outside this feature. Status reads reflect the underlying workflow's progress.

## Start and connect

Set a shared `NEW_DIAGRAM_PUSH_TOKEN` on the app server and the calling CLI/Worker.
Start the app with `--pi`. The integration endpoints require this token even for
reads; without it they return 503. Existing HTTP write settings for other APIs
remain independent.

```sh
npm run dev -- --pi
```

Create a connection JSON file (replace values with your account/repository):

```json
{
  "repositoryId": "repo-REGISTERED-LOCAL-ID",
  "external": {
    "provider": "artifacts",
    "accountId": "YOUR_32_HEX_ACCOUNT_ID",
    "namespace": "default",
    "repoName": "new-diagram-test"
  },
  "remoteUrl": "https://YOUR_32_HEX_ACCOUNT_ID.artifacts.cloudflare.net/git/default/new-diagram-test.git",
  "credentialEnv": "ARTIFACTS_TOKEN",
  "enabled": true
}
```

For another CI provider, use `external: {"provider":"generic",
"repositoryKey":"provider/owner/repo"}`. If multiple live workspaces are attached,
set `canvasId` to select the one whose drafts should be captured. Otherwise the
workflow captures the existing saved/live diagrams using its usual rules.

```sh
node --import tsx scripts/integrations/push.ts connect artifacts-test /tmp/connection.json --url http://127.0.0.1:5173
node --import tsx scripts/integrations/push.ts connections --url http://127.0.0.1:5173
```

The connection ID is permanent for a repository identity; updating the same ID may
change credentials, enabled state or canvas selection. Use a new ID for a different
repository. The connection schema requires the Artifacts URL to match its identity.

## Submit and inspect

A generic event is:

```json
{
  "eventId": "stable-ci-push-event-id",
  "ref": "refs/heads/main",
  "before": "OLD_FULL_COMMIT_SHA",
  "after": "NEW_FULL_COMMIT_SHA"
}
```

Use full 40- or 64-character lowercase Git SHAs; null or all zeros represent a
missing ref. `occurredAt` is optional. Do not use one ID for different pushes.

```sh
node --import tsx scripts/integrations/push.ts push artifacts-test /tmp/push.json --wait
node --import tsx scripts/integrations/push.ts artifacts artifacts-test /tmp/cloudflare-event.json --wait
node --import tsx scripts/integrations/push.ts status
node --import tsx scripts/integrations/push.ts status push-GENERATION_ID --wait
```

The response includes `workflowRunId` and, once created, `changeSessionId`. Open the
proposal in the application's Changes explorer. Repeating the same event returns
the same generation; a successful response does not mean the model has finished.

HTTP endpoints, all with `Authorization: Bearer <NEW_DIAGRAM_PUSH_TOKEN>`:

| Method | Path under `/api/mapping/integrations` | Purpose |
| --- | --- | --- |
| PUT | `/connections/:id` | Create/update a connection |
| GET | `/connections` | List connections |
| POST | `/connections/:id/pushes` | Submit a generic event |
| POST | `/connections/:id/artifacts` | Submit a raw Artifacts push event |
| GET | `/pushes?connectionId=:id` | List generations; filter optional |
| GET | `/pushes/:id` | Refresh status and proposal link |

## Upload this repository and test Artifacts

The deployment files are in `deploy/artifacts-push/`. The Worker only forwards
push events; it does not host the Git/Node/model runtime. It acknowledges after the
app records/starts the generation, without waiting for the model.

Prerequisites: an Artifacts-enabled Cloudflare account, API access with Artifacts
Read/Edit, Worker/Queue deployment access, and a reachable HTTPS integration
endpoint on the running app. Configure any ingress proxy/tunnel to expose the
integration route required by the Worker.

1. Authenticate Wrangler (`npx wrangler login` or `CLOUDFLARE_API_TOKEN` with
   `CLOUDFLARE_ACCOUNT_ID`). Create a test repository in the chosen namespace using
   the Artifacts REST endpoint:
   `POST /client/v4/accounts/<account>/artifacts/namespaces/<namespace>/repos`
   with `{"name":"new-diagram-test"}`. Its response supplies `result.remote` and
   a short-lived `result.token` for Git. Keep the token out of the remote URL.
2. Set `ARTIFACTS_REMOTE` to that returned URL and `ARTIFACTS_TOKEN` to the Git token.
   **Before subscribing to pushes**, seed the test repository with committed HEAD:

   ```sh
   GIT_CONFIG_COUNT=1 \
   GIT_CONFIG_KEY_0="http.${ARTIFACTS_REMOTE}.extraHeader" \
   GIT_CONFIG_VALUE_0="Authorization: Bearer ${ARTIFACTS_TOKEN}" \
   git push "$ARTIFACTS_REMOTE" HEAD:refs/heads/integration-test
   ```

   This uploads committed history reachable from HEAD, not local uncommitted edits.
   Seeding first avoids generating a proposal for the entire repository import.
   New code here must be committed before it can be included in that upload.
3. Start the app with the shared push token and Git credential environment variable.
   Register the connection above against this project's existing repository ID.
4. Create the queue and set the Worker's `PUSH_ENDPOINT` in `wrangler.jsonc` to the
   app's reachable `/connections/artifacts-test/artifacts` URL. Then deploy and set
   its `PUSH_TOKEN` secret to the same shared token as the app:

   ```sh
   npx wrangler queues create diagram-artifacts-push
   npx wrangler deploy --config deploy/artifacts-push/wrangler.jsonc
   npx wrangler secret put PUSH_TOKEN --config deploy/artifacts-push/wrangler.jsonc
   ```

5. Subscribe the queue to this repository's push events (flags verified with
   Wrangler 4.151.0):

   ```sh
   npx wrangler queues subscription create diagram-artifacts-push \
     --source artifacts.repo --events pushed \
     --source-namespace default --source-repo-name new-diagram-test
   ```

6. Make two small code commits on a disposable local branch based on the seeded
   HEAD, then push both together to the existing remote `integration-test` branch.
   Expect **one** generation with **two** commits and one ready DiffSession.
   Replay the same captured event to confirm it returns the same IDs. The local
   temporary-repository tests also cover new branches, force-pushes and rollbacks.

Upload preflight on 2026-10-14: current HEAD had 140 reachable commits, about 167 MB
of uncompressed blob content, and no blob over 32 MiB (largest about 20.4 MB).
Artifacts documents a 1 GB repository limit and 32 MB individual blob limit. This
is a local size check, not confirmation that an upload has occurred. Wrangler was
not authenticated and no Cloudflare account/API/Git-token environment was configured.

Official references:

- [Create a repository and push with Git](https://developers.cloudflare.com/artifacts/get-started/rest-api/)
- [Artifacts event schema](https://developers.cloudflare.com/artifacts/guides/event-subscriptions/)
- [Configure event subscriptions](https://developers.cloudflare.com/queues/event-subscriptions/manage-event-subscriptions/)
- [Artifacts storage limits](https://developers.cloudflare.com/artifacts/platform/limits/)

## Validation

```sh
npx vitest run infrastructure/core/integrations/__tests__
npm run build
npx wrangler deploy --dry-run --config deploy/artifacts-push/wrangler.jsonc --outdir /tmp/diagram-artifacts-worker-build
```

The HTTP flow test executes the real forwarding Worker, authenticated endpoint,
Git discovery, two-step workflow, canvas proposal tools, persistence and completion
validation. Only model responses are controlled; no paid model calls or external
Cloudflare mutations are made by these tests.
