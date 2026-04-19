import type { BackendRoute } from '../config/backend-route.js';
import { extractTextContent } from '../weixin/inbound.js';
import type { WeixinMessage } from '../weixin/types.js';
import { detectBackendSwitchCommand, isHelpCommand, isStatsCommand, isStatusCommand } from './command-parser.js';

export type ParsedInbound =
  | { kind: 'backend_switch'; text: string; target: BackendRoute }
  | { kind: 'stats'; text: string }
  | { kind: 'status'; text: string }
  | { kind: 'help'; text: string }
  | { kind: 'approval_reply'; text: string }
  | { kind: 'chat'; text: string | null };

export function parseInboundMessage(
  msg: WeixinMessage,
  activeBackend: BackendRoute,
): ParsedInbound {
  const text = extractTextContent(msg);
  if (!text) {
    return { kind: 'chat', text: null };
  }

  const switchTarget = detectBackendSwitchCommand(text);
  if (switchTarget) {
    return { kind: 'backend_switch', text, target: switchTarget };
  }

  if (isStatsCommand(text)) {
    return { kind: 'stats', text };
  }

  if (isStatusCommand(text)) {
    return { kind: 'status', text };
  }

  if (isHelpCommand(text)) {
    return { kind: 'help', text };
  }

  if (/^\s*(yesall|stopall|y|yes|n|no)\s*$/i.test(text)) {
    return { kind: 'approval_reply', text };
  }

  return { kind: 'chat', text, };
}
