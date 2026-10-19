import { query } from '@anthropic-ai/claude-agent-sdk';

function summarize(message: unknown): string {
  const json = JSON.stringify(message, null, 2);
  return json.length > 2000 ? `${json.slice(0, 2000)}\n…[truncated]` : json;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Set ANTHROPIC_API_KEY before running this spike.');
  }

  let sessionId: string | undefined;
  const seenTypes = new Set<string>();

  const run = query({
    prompt: 'Reply with exactly one short sentence introducing yourself. Do not use any tools.',
    options: {
      model: 'claude-opus-4-8',
      maxTurns: 1,
      systemPrompt: 'You are a sealed test Dot. Reply with exactly one short sentence introducing yourself. Do not use any tools.',
      settingSources: [],
      allowedTools: [],
      permissionMode: 'default',
      canUseTool: async (toolName, input) => {
        console.log(`[canUseTool] DENY ${toolName} ${JSON.stringify(input).slice(0, 200)}`);
        return { allowed: false, reason: 'spike denies all tools' };
      },
    },
  });

  for await (const message of run) {
    const type =
      'type' in (message as Record<string, unknown>)
        ? String((message as { type: unknown }).type)
        : 'unknown';
    const subtype = (message as { subtype?: unknown }).subtype;
    seenTypes.add(subtype ? `${type}/${String(subtype)}` : type);

    if ('session_id' in (message as Record<string, unknown>)) {
      sessionId = String((message as { session_id: unknown }).session_id);
    }

    console.log(`\n===== ${type}${subtype ? `/${String(subtype)}` : ''} =====`);
    console.log(summarize(message));
  }

  console.log('\n\n========== SPIKE SUMMARY ==========');
  console.log('message types seen:', [...seenTypes].join(', '));
  console.log('session_id:', sessionId);
}

main().catch((error) => {
  console.error('SPIKE FAILED:', error);
  process.exit(1);
});
