import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandTilde } from '../util/helpers.js';

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadProjectEnv(cwd = process.cwd()): void {
  const envPath = process.env.WEIXIN_ENV_FILE?.trim() || join(cwd, '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const raw = readFileSync(envPath, 'utf-8');
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1]!;
    const value = expandTilde(stripWrappingQuotes(match[2]!.trim()));
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function getEnvSummary(): string {
  const entries = [
    { key: 'WEIXIN_SERVER_ROLE', value: process.env.WEIXIN_SERVER_ROLE ?? 'auto' },
    { key: 'WEIXIN_ENV_FILE', value: process.env.WEIXIN_ENV_FILE ? expandTilde(process.env.WEIXIN_ENV_FILE.trim()) : '(none)' },
    { key: 'WEIXIN_STATE_DIR', value: process.env.WEIXIN_STATE_DIR ? expandTilde(process.env.WEIXIN_STATE_DIR.trim()) : '(default)' },
    { key: 'WEIXIN_CLAUDE_CONFIG_DIR', value: process.env.WEIXIN_CLAUDE_CONFIG_DIR ? expandTilde(process.env.WEIXIN_CLAUDE_CONFIG_DIR.trim()) : (process.env.CLAUDE_CONFIG_DIR ? expandTilde(process.env.CLAUDE_CONFIG_DIR.trim()) : '~/.claude') },
    { key: 'WEIXIN_CODEX_CWD', value: expandTilde(process.env.WEIXIN_CODEX_CWD?.trim() || process.cwd()) },
    { key: 'WEIXIN_CODEX_MODEL', value: process.env.WEIXIN_CODEX_MODEL?.trim() || '(unset)' },
    { key: 'WEIXIN_CODEX_APPROVAL_POLICY', value: process.env.WEIXIN_CODEX_APPROVAL_POLICY?.trim() || 'on-request' },
    { key: 'WEIXIN_CODEX_SANDBOX', value: process.env.WEIXIN_CODEX_SANDBOX?.trim() || 'workspace-write' },
    { key: 'WEIXIN_CODEX_COMMAND', value: process.env.WEIXIN_CODEX_COMMAND?.trim() || 'codex' },
  ];

  const maxKey = Math.max(...entries.map(e => e.key.length));
  const lines = entries.map(e => `  ${e.key.padEnd(maxKey)} = ${e.value}`);
  return ['weixin channel: environment', ...lines].join('\n');
}
