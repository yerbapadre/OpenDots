import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { AbstractAgent } from '@ag-ui/client';
import { type BaseEvent, type RunAgentInput, EventType } from '@ag-ui/core';
import { CopilotSseRuntime, InMemoryAgentRunner, createCopilotHonoHandler } from '@copilotkit/runtime/v2';
import { serve } from '@hono/node-server';

class EchoAgent extends AbstractAgent {
  clone() {
    return new EchoAgent({ agentId: this.agentId });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const messageId = randomUUID();
      subscriber.next({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent);
      subscriber.next({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as BaseEvent);
      subscriber.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: 'Echo agent speaking. No Intelligence, no gateway — SSE runtime served this.' } as BaseEvent);
      subscriber.next({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
      subscriber.next({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as BaseEvent);
      subscriber.complete();
    });
  }
}

async function main(): Promise<void> {
  const runtime = new CopilotSseRuntime({
    runner: new InMemoryAgentRunner(),
    agents: async () => ({ echo: new EchoAgent({ agentId: 'echo' }) }),
  });

  console.log('runtime.mode =', runtime.mode);
  console.log('runtime.intelligence =', runtime.intelligence);

  const handler = createCopilotHonoHandler({
    runtime,
    basePath: '/api/copilotkit',
    cors: { origin: [] },
  });

  const port = 4399;
  const server = serve({ fetch: handler.fetch, hostname: '127.0.0.1', port }, async (info) => {
    console.log(`SSE runtime listening on http://127.0.0.1:${info.port}`);
    try {
      const res = await fetch(`http://127.0.0.1:${info.port}/api/copilotkit/info`);
      console.log('\n===== GET /api/copilotkit/info =====');
      console.log('status', res.status);
      console.log(JSON.stringify(await res.json(), null, 2));
    } catch (error) {
      console.error('info fetch failed:', error);
    } finally {
      console.log('\n========== SSE SPIKE: runtime booted without Intelligence ==========');
      server.close();
    }
  });
}

main().catch((error) => {
  console.error('SSE SPIKE FAILED:', error);
  process.exit(1);
});
