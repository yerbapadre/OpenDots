// Direct (no-middleman) MCP connections for Dots: Linear, PostHog, GitHub,
// Slack. Each server attaches only when its token is configured in the
// environment, and its tools are admitted through the Dot's --allowedTools
// allowlist. Data flows straight between this machine and each vendor.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface ExternalMcp {
  // claude --mcp-config "mcpServers" entries, keyed by server name.
  servers: Record<string, unknown>;
  // Tool patterns (mcp__<name>__*) to append to --allowedTools.
  allowedTools: string[];
}

const DATABRICKS_SERVER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'databricks-mcp-server.ts',
);

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function externalMcp(env: NodeJS.ProcessEnv = process.env): ExternalMcp {
  const servers: Record<string, unknown> = {};
  const allowedTools: string[] = [];
  const add = (name: string, config: unknown) => {
    servers[name] = config;
    allowedTools.push(`mcp__${name}__*`);
  };

  if (env.GITHUB_MCP_TOKEN)
    add('github', {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: bearer(env.GITHUB_MCP_TOKEN),
    });

  if (env.POSTHOG_MCP_TOKEN)
    add('posthog', {
      type: 'http',
      url: 'https://mcp.posthog.com/mcp',
      headers: bearer(env.POSTHOG_MCP_TOKEN),
    });

  if (env.LINEAR_MCP_TOKEN)
    add('linear', {
      type: 'http',
      // Set LINEAR_MCP_READONLY=1 to use Linear's read-only endpoint.
      url:
        env.LINEAR_MCP_READONLY === '1'
          ? 'https://mcp.linear.app/mcp/readonly'
          : 'https://mcp.linear.app/mcp',
      headers: bearer(env.LINEAR_MCP_TOKEN),
    });

  // Official @modelcontextprotocol/server-slack: lists channels + reads
  // history/users with only channels:read + channels:history + users:read
  // (no DM scopes, unlike the korotovsky server which lists all four channel
  // types at boot). Needs a bot token and the team id.
  if (env.SLACK_MCP_XOXB_TOKEN && env.SLACK_TEAM_ID) {
    servers.slack = {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: {
        SLACK_BOT_TOKEN: env.SLACK_MCP_XOXB_TOKEN,
        SLACK_TEAM_ID: env.SLACK_TEAM_ID,
        ...(env.SLACK_CHANNEL_IDS
          ? { SLACK_CHANNEL_IDS: env.SLACK_CHANNEL_IDS }
          : {}),
      },
    };
    // Read tools are always allowed. This server always exposes the write
    // tools, so posting is gated here at the allowlist rather than in the
    // server: enabled only when SLACK_MCP_ADD_MESSAGE_TOOL is set.
    allowedTools.push(
      'mcp__slack__slack_list_channels',
      'mcp__slack__slack_get_channel_history',
      'mcp__slack__slack_get_thread_replies',
      'mcp__slack__slack_get_users',
      'mcp__slack__slack_get_user_profile',
    );
    if (env.SLACK_MCP_ADD_MESSAGE_TOOL)
      allowedTools.push(
        'mcp__slack__slack_post_message',
        'mcp__slack__slack_reply_to_thread',
        'mcp__slack__slack_add_reaction',
      );
  }

  // Browser: Microsoft's Playwright MCP, headless + isolated (ephemeral context,
  // no saved logins / no access to your real browser sessions). Opt-in.
  // We allowlist only safe browsing tools and deliberately EXCLUDE the dangerous
  // ones the server also exposes: browser_run_code_unsafe (RCE-equivalent),
  // browser_evaluate (arbitrary page JS), browser_file_upload, browser_drop.
  if (env.BROWSER_MCP === '1') {
    servers.browser = {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--headless', '--isolated'],
    };
    allowedTools.push(
      ...[
        'browser_navigate',
        'browser_navigate_back',
        'browser_snapshot',
        'browser_find',
        'browser_take_screenshot',
        'browser_click',
        'browser_type',
        'browser_fill_form',
        'browser_select_option',
        'browser_press_key',
        'browser_hover',
        'browser_wait_for',
        'browser_tabs',
        'browser_console_messages',
        'browser_network_requests',
        'browser_network_request',
        'browser_resize',
        'browser_handle_dialog',
        'browser_close',
      ].map((t) => `mcp__browser__${t}`),
    );
  }

  // Databricks: a local, read-only, schema-scoped SQL server reading the
  // service principal from ~/.databrickscfg. Opt-in (sensitive company data).
  if (env.DATABRICKS_MCP === '1') {
    servers.databricks = {
      type: 'stdio',
      command: process.execPath,
      args: ['--import', 'tsx', DATABRICKS_SERVER],
      env: {
        ...(env.DATABRICKS_CONFIG_PATH
          ? { DATABRICKS_CONFIG_PATH: env.DATABRICKS_CONFIG_PATH }
          : {}),
        ...(env.DATABRICKS_PROFILE
          ? { DATABRICKS_PROFILE: env.DATABRICKS_PROFILE }
          : {}),
        ...(env.DATABRICKS_WAREHOUSE_ID
          ? { DATABRICKS_WAREHOUSE_ID: env.DATABRICKS_WAREHOUSE_ID }
          : {}),
        ...(env.DATABRICKS_CATALOG
          ? { DATABRICKS_CATALOG: env.DATABRICKS_CATALOG }
          : {}),
        ...(env.DATABRICKS_SCHEMA
          ? { DATABRICKS_SCHEMA: env.DATABRICKS_SCHEMA }
          : {}),
      },
    };
    allowedTools.push('mcp__databricks__*');
  }

  return { servers, allowedTools };
}
