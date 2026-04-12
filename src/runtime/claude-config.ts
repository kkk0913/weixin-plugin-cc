import { homedir } from 'node:os';
import { join } from 'node:path';
import { expandTilde } from '../util/helpers.js';

export function getClaudeConfigDir(): string {
  const configured = process.env.WEIXIN_CLAUDE_CONFIG_DIR?.trim();
  if (configured) {
    return expandTilde(configured);
  }
  // Fall back to CLAUDE_CONFIG_DIR (set by Claude Code itself) before hardcoding ~/.claude
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (claudeConfigDir) {
    return expandTilde(claudeConfigDir);
  }
  return join(homedir(), '.claude');
}

export function getClaudeConfigPath(fileName: string): string {
  return join(getClaudeConfigDir(), fileName);
}
