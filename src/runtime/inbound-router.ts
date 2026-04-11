import type { BackendRoute, BackendRouteControl } from '../config/backend-route.js';
import { MessageType, type WeixinMessage } from '../weixin/types.js';
import type { ChatBackend } from './backends.js';
import { parseInboundMessage } from './inbound-parser.js';

export interface InboundRouterOptions {
  inboxDir: string;
  debug: (msg: string) => void;
  access: {
    reload: () => void;
    gate: (chatId: string) => { action: 'deliver' | 'drop' | 'pair'; code?: string };
  };
  client: {
    isAuthed: boolean;
    userId?: string | null;
    sendMessage: (chatId: string, contextToken: string, item: any) => Promise<unknown>;
    getConfig: (userId: string, contextToken: string) => Promise<{ typing_ticket: string }>;
    sendTyping: (userId: string, ticket: string) => Promise<unknown>;
  };
  backendRoutes: BackendRouteControl;
  sessionState: {
    setContextToken: (userId: string, token: string) => void;
  };
  sendTextMessage: (chatId: string, contextToken: string, text: string) => Promise<void>;
  getStatsText: () => Promise<string>;
  backends: Record<BackendRoute, ChatBackend>;
}

function getBackendModeMessage(backend: BackendRoute): string {
  return backend === 'claude'
    ? '已切换到 Claude Code 模式。后续消息会转发给 Claude。'
    : '已切换到 Codex 模式。后续消息会转发给 Codex。';
}

function getBackendAlreadyActiveMessage(backend: BackendRoute): string {
  return backend === 'claude'
    ? '当前已经是 Claude Code 模式。'
    : '当前已经是 Codex 模式。';
}

export function createInboundRouter(options: InboundRouterOptions): (msg: WeixinMessage) => Promise<void> {
  async function handleBackendSwitchCommand(chatId: string, contextToken: string, text: string, targetBackend: BackendRoute): Promise<void> {
    options.debug(`handleInbound: switch command chat=${chatId} target=${targetBackend} text=${JSON.stringify(text)}`);
    if (!(await options.backends[targetBackend].ensureReady(chatId, contextToken))) {
      return;
    }

    options.backendRoutes.reload();
    const currentBackend = options.backendRoutes.getBackend(chatId);
    if (currentBackend === targetBackend) {
      await options.sendTextMessage(chatId, contextToken, getBackendAlreadyActiveMessage(targetBackend));
      return;
    }

    options.backendRoutes.setBackend(chatId, targetBackend);
    await options.sendTextMessage(chatId, contextToken, getBackendModeMessage(targetBackend));
  }

  async function handleStatsCommand(chatId: string, contextToken: string): Promise<void> {
    await options.sendTextMessage(chatId, contextToken, await options.getStatsText()).catch(() => {});
  }

  return async function handleInbound(msg: WeixinMessage): Promise<void> {
    const userId = msg.from_user_id;
    options.debug(`handleInbound: from=${userId} type=${msg.message_type}`);

    options.access.reload();
    const gateResult = options.access.gate(userId);
    options.debug(`handleInbound: gate=${JSON.stringify(gateResult)}`);
    if (gateResult.action === 'drop') {
      return;
    }

    if (gateResult.action === 'pair') {
      await options.client.sendMessage(userId, msg.context_token, {
        type: MessageType.TEXT,
        text_item: {
          text: `Pairing required — approve this code in your terminal:\n\n/weixin:access pair ${gateResult.code}`,
        },
      }).catch(err => {
        options.debug(`pairing reply failed: ${err}`);
      });
      return;
    }

    options.sessionState.setContextToken(userId, msg.context_token);
    options.backendRoutes.reload();
    const activeBackend = options.backendRoutes.getBackend(userId);
    options.debug(`handleInbound: backend=${activeBackend}`);
    const parsed = parseInboundMessage(msg, activeBackend);

    if (parsed.kind === 'backend_switch') {
      await handleBackendSwitchCommand(userId, msg.context_token, parsed.text, parsed.target);
      return;
    }

    if (parsed.kind === 'stats') {
      await handleStatsCommand(userId, msg.context_token);
      return;
    }

    if (parsed.kind === 'approval_reply') {
      if (await options.backends[activeBackend].tryHandleApprovalReply(userId, msg.context_token, parsed.text)) {
        return;
      }
    }

    if (options.client.isAuthed && options.client.userId) {
      options.client.getConfig(options.client.userId, msg.context_token).then(cfg => {
        if (cfg.typing_ticket) {
          options.client.sendTyping(options.client.userId!, cfg.typing_ticket).catch(() => {});
        }
      }).catch(() => {});
    }

    await options.backends[activeBackend].deliver(msg);
  };
}
