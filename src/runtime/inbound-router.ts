import type { BackendRoute, BackendRouteControl } from '../config/backend-route.js';
import type { WeixinMessage } from '../weixin/types.js';
import type { ChatBackend } from './backends.js';
import { CommandService } from './command-service.js';
import { parseInboundMessage } from './inbound-parser.js';
import { SystemMessageService } from './system-message-service.js';

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
  getStatusText: (chatId: string) => Promise<string>;
  backends: Record<BackendRoute, ChatBackend>;
}

export function createInboundRouter(options: InboundRouterOptions): (msg: WeixinMessage) => Promise<void> {
  const commands = new CommandService({
    debug: options.debug,
    sendTextMessage: options.sendTextMessage,
    getStatsText: options.getStatsText,
    getStatusText: options.getStatusText,
  });
  const systemMessages = new SystemMessageService({
    debug: options.debug,
    client: options.client,
  });

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
      await systemMessages.sendPairingRequired(userId, msg.context_token, gateResult.code);
      return;
    }

    options.sessionState.setContextToken(userId, msg.context_token);
    options.backendRoutes.reload();
    const activeBackend = options.backendRoutes.getBackend(userId);
    options.debug(`handleInbound: backend=${activeBackend}`);
    const parsed = parseInboundMessage(msg, activeBackend);

    if (parsed.kind === 'backend_switch') {
      await commands.switchBackend(
        userId,
        msg.context_token,
        parsed.text,
        parsed.target,
        () => options.backends[parsed.target].ensureReady(userId, msg.context_token),
        () => {
          options.backendRoutes.reload();
          return options.backendRoutes.getBackend(userId);
        },
        backend => {
          options.backendRoutes.setBackend(userId, backend);
        },
      );
      return;
    }

    if (parsed.kind === 'stats') {
      await commands.sendStats(userId, msg.context_token);
      return;
    }

    if (parsed.kind === 'status') {
      await commands.sendStatus(userId, msg.context_token);
      return;
    }

    if (parsed.kind === 'help') {
      await commands.sendHelp(userId, msg.context_token, activeBackend);
      return;
    }

    if (parsed.kind === 'approval_reply') {
      if (await options.backends[activeBackend].tryHandleApprovalReply(userId, msg.context_token, parsed.text)) {
        return;
      }
    }

    systemMessages.sendTypingIndicator(msg.context_token);

    await options.backends[activeBackend].deliver(msg);
  };
}
