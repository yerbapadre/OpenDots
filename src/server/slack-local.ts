import pkg from '@slack/bolt';
import { runLocalTurn, type LocalTurnDeps } from './local-turn.js';

// SPIKE — self-hosted Slack coworker, no CopilotKit Intelligence.
//
// This is the local analog of slack-channel.ts (which relies on managed
// CopilotKit Intelligence to relay Slack events). Here we open our own Socket
// Mode connection with @slack/bolt and drive the local Claude Dot directly via
// runLocalTurn — so the reasoning is 100% Claude CLI and there is no managed
// cloud transport and no public webhook to expose.
//
// Socket Mode is an OUTBOUND WebSocket from the server to Slack, so this works
// on a localhost-only box with no tunnel and no inbound port. It also lives on
// the local (no intelligenceKey) path, so it coexists with the proactive
// ScheduledTurnService — you get reactive + proactive at the same time.
//
// Gated behind SLACK_LOCAL_ENABLED; see .env.example. Not wired into the
// default path — opt in explicitly.

const { App, LogLevel } = pkg;

export interface LocalSlackConfig {
  /** Bot token (xoxb-). Reuses SLACK_MCP_XOXB_TOKEN if a dedicated one is unset. */
  botToken: string;
  /** App-level token (xapp-) with connections:write — required for Socket Mode. */
  appToken: string;
  /** Allowlisted Slack workspace/team id (SLACK_TEAM_ID). */
  teamId: string;
  /** Allowlisted Slack user ids (SLACK_USER_IDS). Only these humans are answered. */
  userIds: string[];
  /** Which Dot answers (SLACK_DOT_ID, else the first Dot). */
  dotId: string;
}

export interface LocalSlackHandle {
  stop(): Promise<void>;
}

type Report = (operation: string, errors: string[]) => void;
const defaultReport: Report = (operation, errors) =>
  console.error(`${operation}: ${errors.join('; ')}`);

// Never surface raw provider errors (they can carry tokens); reduce to a name.
function safe(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}

/**
 * Start the self-hosted Slack coworker. Returns a handle whose stop() closes
 * the Socket Mode connection. Throws if the configured Dot does not exist.
 */
export async function startLocalSlack(
  turnDeps: LocalTurnDeps,
  config: LocalSlackConfig,
  report: Report = defaultReport,
): Promise<LocalSlackHandle> {
  if (!turnDeps.workspace.dot(config.dotId))
    throw new Error('SLACK_DOT_ID does not identify an existing Dot.');

  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // Per-thread serialization: runLocalTurn REPLACES the thread's message
  // snapshot on each run (see local-turn.ts), so two concurrent turns on the
  // same thread would clobber each other. Chain runs per threadId.
  const tails = new Map<string, Promise<void>>();
  function serialize(threadId: string, task: () => Promise<void>): Promise<void> {
    const prev = tails.get(threadId) ?? Promise.resolve();
    const next = prev.then(task, task);
    // Drop the tail once it settles so the map does not grow unbounded.
    tails.set(
      threadId,
      next.finally(() => {
        if (tails.get(threadId) === next) tails.delete(threadId);
      }),
    );
    return next;
  }

  function allowed(teamId: string | undefined, userId: string | undefined): boolean {
    return (
      teamId === config.teamId &&
      !!userId &&
      config.userIds.includes(userId)
    );
  }

  // Strip the bot's own @-mention and any other user mentions from the text.
  function cleanPrompt(text: string | undefined, botUserId: string | undefined): string {
    if (!text) return '';
    let out = text;
    if (botUserId) out = out.split(`<@${botUserId}>`).join(' ');
    return out.replace(/<@[A-Z0-9]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  async function drive(params: {
    channel: string;
    threadTs: string;
    prompt: string;
    say: (text: string) => Promise<void>;
  }): Promise<void> {
    const threadId = `slack:${params.channel}:${params.threadTs}`;
    // Bind a local OpenDots thread to this Slack thread on first contact.
    try {
      turnDeps.workspace.requireThread(threadId);
    } catch {
      turnDeps.workspace.bindThread(
        threadId,
        config.dotId,
        `Slack ${params.channel}`,
      );
    }

    await serialize(threadId, async () => {
      try {
        const { text } = await runLocalTurn(turnDeps, {
          threadId,
          prompt: params.prompt,
          source: 'slack',
        });
        await params.say(text || '(no response)');
      } catch (error) {
        report('Slack local turn failed', [safe(error)]);
        try {
          await params.say(
            "I couldn't complete that request. Check OpenDots and send a new message when you're ready to try again.",
          );
        } catch (postError) {
          report('Slack error reply failed', [safe(postError)]);
        }
      }
    });
  }

  // Direct @-mention: always answer (this is how a thread gets "followed").
  app.event('app_mention', async ({ event, context, say }) => {
    const e = event as {
      user?: string;
      text?: string;
      channel: string;
      ts: string;
      thread_ts?: string;
    };
    if (!allowed(context.teamId, e.user)) return;
    const prompt = cleanPrompt(e.text, context.botUserId);
    if (!prompt) return;
    await drive({
      channel: e.channel,
      threadTs: e.thread_ts ?? e.ts,
      prompt,
      say: async (text) =>
        void (await say({ text, thread_ts: e.thread_ts ?? e.ts })),
    });
  });

  // Follow-up replies: continue only in threads we already answered, so we do
  // not respond to unrelated channel chatter. Mentions are handled above, so
  // skip messages that @-mention us here to avoid double-processing.
  app.message(async ({ message, context, say }) => {
    const m = message as {
      subtype?: string;
      user?: string;
      text?: string;
      channel: string;
      ts: string;
      thread_ts?: string;
    };
    if (m.subtype) return; // edits, joins, bot_message, etc.
    if (!m.thread_ts) return; // only threaded replies
    if (!allowed(context.teamId, m.user)) return;
    if (context.botUserId && m.text?.includes(`<@${context.botUserId}>`)) return;

    const threadId = `slack:${m.channel}:${m.thread_ts}`;
    try {
      turnDeps.workspace.requireThread(threadId); // only if we're in this thread
    } catch {
      return;
    }
    const prompt = cleanPrompt(m.text, context.botUserId);
    if (!prompt) return;
    await drive({
      channel: m.channel,
      threadTs: m.thread_ts,
      prompt,
      say: async (text) => void (await say({ text, thread_ts: m.thread_ts })),
    });
  });

  await app.start();
  console.log('[dots] self-hosted Slack coworker (Socket Mode) connected.');

  return {
    stop: async () => {
      try {
        await app.stop();
      } catch (error) {
        report('Slack local shutdown failed', [safe(error)]);
      }
    },
  };
}
