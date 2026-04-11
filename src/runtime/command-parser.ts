import type { BackendRoute } from '../config/backend-route.js';

function normalizeSwitchCommandText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[。！!？?，,；;：:]+$/gu, '')
    .replace(/\s+/g, ' ');
}

function parseDirectBackendAlias(text: string): BackendRoute | null {
  switch (text) {
    case '/codex':
    case 'codex':
    case 'code x':
      return 'codex';
    case '/claude':
    case '/cc':
    case 'claude':
    case 'claude code':
    case 'cloud code':
    case 'cc':
    case 'code s':
      return 'claude';
    default:
      return null;
  }
}

function parseBackendSwitchTarget(text: string): BackendRoute | null {
  switch (text) {
    case '/codex':
    case 'codex':
    case 'code x':
      return 'codex';
    case '/claude':
    case '/cc':
    case 'claude':
    case 'claude code':
    case 'cloud code':
    case 'cc':
    case 'code s':
      return 'claude';
    default:
      return null;
  }
}

export function detectBackendSwitchCommand(text: string): BackendRoute | null {
  const normalized = normalizeSwitchCommandText(text);
  const directAlias = parseDirectBackendAlias(normalized);
  if (directAlias) {
    return directAlias;
  }

  const naturalCommand = normalized.match(
    /^(切换(?:到|成|为)?|切到|切回(?:到)?|切回|转到|转成|改到|改成|改回(?:到)?|switch(?: to)?|route(?: to)?|use)\s+(.+)$/u,
  );
  if (!naturalCommand) {
    return null;
  }
  return parseBackendSwitchTarget(naturalCommand[2].trim());
}

export function isStatsCommand(text: string): boolean {
  return text.trim().toLowerCase() === '/stats';
}
