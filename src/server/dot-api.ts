// Shared helper for Dot MCP tools that reach back to the long-lived main server
// (work that must outlive the per-turn MCP subprocess: coding tasks, scheduled
// turns). The owner token and base URL come from the subprocess environment.

function apiConfig() {
  const base = process.env.OPENDOTS_API_URL;
  if (!base)
    throw new Error('OPENDOTS_API_URL is not configured for the Dot MCP server.');
  const token = process.env.OWNER_TOKEN;
  return {
    base,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
}

export async function callOpenDotsApi(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const { base, headers } = apiConfig();
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new Error(data.error ?? `OpenDots API returned ${response.status}.`);
  return data;
}

export function toolText(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}
