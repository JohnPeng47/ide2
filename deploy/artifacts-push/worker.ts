interface Environment {
  /** Full URL ending in /connections/<id>/artifacts. */
  PUSH_ENDPOINT: string;
  PUSH_TOKEN: string;
}
interface QueueMessage {
  body: unknown;
  ack(): void;
  retry(): void;
}
/** Transport only: all push identity, commit discovery and generation live in the app. */
export default {
  async queue(batch: { messages: QueueMessage[] }, env: Environment) {
    for (const message of batch.messages) {
      const body = message.body;
      if (!body || typeof body !== 'object' || !('type' in body) || body.type !== 'cf.artifacts.repo.pushed') {
        message.ack();
        continue;
      }
      const response = await fetch(env.PUSH_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.PUSH_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw Error(`Push endpoint returned HTTP ${response.status}`);
      // The app has recorded the push and started (or deduplicated) its workflow.
      // Do not hold Queue delivery open for the LLM's multi-minute execution.
      message.ack();
    }
  }
};
