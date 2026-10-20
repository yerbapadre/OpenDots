import { authHeaders } from './api';
import type { CodingTask } from '../shared/coding-task';

// Subscribes to the server's coding-task SSE stream. Uses fetch instead of
// EventSource so the owner token can travel in the Authorization header.
// Reconnects with a fixed backoff until aborted.
export function subscribeCodingTasks(
  onTask: (task: CodingTask) => void,
  signal: AbortSignal,
): void {
  const RETRY_MS = 5000;

  const connect = async () => {
    while (!signal.aborted) {
      try {
        const response = await fetch('/api/coding-tasks-stream', {
          headers: authHeaders(),
          signal,
        });
        if (!response.ok || !response.body) throw new Error('stream failed');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');
            const event = frame.match(/^event: (.*)$/m)?.[1];
            const data = frame.match(/^data: (.*)$/m)?.[1];
            if (event === 'task' && data) {
              try {
                onTask(JSON.parse(data) as CodingTask);
              } catch {
                continue;
              }
            }
          }
        }
      } catch {
        // fall through to retry
      }
      if (signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  };

  void connect();
}
