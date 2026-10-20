import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// Standalone stdio MCP server exposing read-only, schema-scoped Databricks SQL
// to Dots. Governance (per the Leland data-platform guide) is enforced here, not
// trusted to the model:
//   - only leland_analytics.ai (default catalog/schema + a denylist of others)
//   - read-only statements only (SELECT/WITH/SHOW/DESCRIBE/EXPLAIN)
//   - a single statement per call
// Credentials come from ~/.databrickscfg (OAuth M2M service principal); they are
// read by this process and never placed in argv or the model's context.

const CFG_PATH =
  process.env.DATABRICKS_CONFIG_PATH ?? resolve(homedir(), '.databrickscfg');
const PROFILE = process.env.DATABRICKS_PROFILE ?? 'DEFAULT';
const WAREHOUSE = process.env.DATABRICKS_WAREHOUSE_ID ?? 'abdf7db705feccb8';
const CATALOG = process.env.DATABRICKS_CATALOG ?? 'leland_analytics';
const SCHEMA = process.env.DATABRICKS_SCHEMA ?? 'ai';
const MAX_ROWS = Number(process.env.DATABRICKS_MAX_ROWS ?? 200);

function loadConfig(): { host: string; clientId: string; clientSecret: string } {
  const text = readFileSync(CFG_PATH, 'utf8');
  const section: Record<string, string> = {};
  let current = 'DEFAULT';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      current = header[1];
      continue;
    }
    if (current !== PROFILE) continue;
    const eq = line.indexOf('=');
    if (eq > 0) section[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const host = (section.host ?? '').replace(/\/$/, '');
  const clientId = section.client_id ?? '';
  const clientSecret = section.client_secret ?? '';
  if (!host || !clientId || !clientSecret)
    throw new Error(
      `Databricks profile "${PROFILE}" in ${CFG_PATH} is missing host/client_id/client_secret.`,
    );
  return { host, clientId, clientSecret };
}

const config = loadConfig();

let cachedToken = '';
let tokenExpiresAt = 0;
async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;
  const credentials = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString('base64');
  const response = await fetch(`${config.host}/oidc/v1/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'all-apis',
    }),
  });
  if (!response.ok)
    throw new Error(`Databricks token request failed: HTTP ${response.status}`);
  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

// --- governance enforcement ---
const ALLOWED_VERBS = /^(select|with|show|describe|desc|explain)\b/i;
const FORBIDDEN = [
  /\bproddata\b/i,
  /leland_analytics\.business\b/i,
  /leland_analytics\.extract\b/i,
  /leland_analytics\.transform\b/i,
  /\bhive_metastore\b/i,
  /\binformation_schema\b/i,
];

function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();
}

function assertReadOnlyScoped(sql: string): void {
  const body = stripComments(sql).replace(/;\s*$/, '');
  if (!body) throw new Error('Empty query.');
  if (body.includes(';'))
    throw new Error('Only a single statement is allowed per call.');
  if (!ALLOWED_VERBS.test(body))
    throw new Error(
      'Read-only access only: queries must start with SELECT, WITH, SHOW, DESCRIBE, or EXPLAIN.',
    );
  for (const pattern of FORBIDDEN)
    if (pattern.test(body))
      throw new Error(
        `This connection is scoped to ${CATALOG}.${SCHEMA} only. Querying ${pattern.source.replace(/\\b|\\/g, '')} is not permitted.`,
      );
}

async function runSql(
  sql: string,
  question?: string,
): Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean }> {
  assertReadOnlyScoped(sql);
  const token = await getToken();
  const statement = question
    ? `-- Q: ${question.replace(/\s+/g, ' ').slice(0, 300)}\n${sql}`
    : sql;
  const start = await fetch(`${config.host}/api/2.0/sql/statements`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      statement,
      warehouse_id: WAREHOUSE,
      catalog: CATALOG,
      schema: SCHEMA,
      wait_timeout: '50s',
      on_wait_timeout: 'CONTINUE',
    }),
  });
  if (!start.ok)
    throw new Error(`Databricks SQL request failed: HTTP ${start.status}`);
  let result = (await start.json()) as StatementResult;
  let state = result.status?.state ?? '';
  const id = result.statement_id;
  for (let i = 0; i < 30 && !['SUCCEEDED', 'FAILED', 'CANCELED'].includes(state); i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(
      `${config.host}/api/2.0/sql/statements/${id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    result = (await poll.json()) as StatementResult;
    state = result.status?.state ?? '';
  }
  if (state !== 'SUCCEEDED')
    throw new Error(
      `Query ${String(state).toLowerCase()}: ${result.status?.error?.message ?? 'unknown error'}`,
    );
  const columns: string[] = (result.manifest?.schema?.columns ?? []).map(
    (c: { name: string }) => c.name,
  );
  const allRows: unknown[][] = result.result?.data_array ?? [];
  return {
    columns,
    rows: allRows.slice(0, MAX_ROWS),
    truncated: allRows.length > MAX_ROWS,
  };
}

interface StatementResult {
  status?: { state?: string; error?: { message?: string } };
  statement_id?: string;
  manifest?: { schema?: { columns?: Array<{ name: string }> } };
  result?: { data_array?: unknown[][] };
}

function textResult(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

const server = createSdkMcpServer({
  name: 'databricks',
  version: '0.1.0',
  tools: [
    tool(
      'databricks_query',
      `Run a READ-ONLY SQL query against Databricks, scoped to ${CATALOG}.${SCHEMA} (the PII-safe analytics layer). ` +
        `Only SELECT/WITH/SHOW/DESCRIBE/EXPLAIN are allowed; other catalogs/schemas are blocked. ` +
        `Unqualified table names resolve to ${CATALOG}.${SCHEMA}. Pass the user's question in "question" for audit logging. ` +
        `Use Pacific day boundaries and the canonical views/definitions when computing metrics.`,
      { sql: z.string(), question: z.string().optional() },
      async ({ sql, question }) => {
        const { columns, rows, truncated } = await runSql(sql, question);
        return textResult(
          JSON.stringify({
            columns,
            rowCount: rows.length,
            truncated,
            rows,
          }),
        );
      },
    ),
    tool(
      'databricks_list_tables',
      `List tables available in ${CATALOG}.${SCHEMA}.`,
      {},
      async () => {
        const { rows } = await runSql(`SHOW TABLES IN ${CATALOG}.${SCHEMA}`);
        return textResult(
          JSON.stringify(rows.map((r) => r[1] ?? r[0]).filter(Boolean)),
        );
      },
    ),
  ],
});

await server.instance.connect(new StdioServerTransport());
