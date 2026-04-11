import type { BackendRoute } from '../config/backend-route.js';
import type { CodexBridge } from '../codex/bridge.js';
import type { BridgeEvent } from '../ipc/protocol.js';
import { prepareInboundForClaude, prepareInboundForCodex } from '../weixin/inbound.js';
import type { WeixinMessage } from '../weixin/types.js';
import type { ClaudeToolHandlers } from './tool-handlers.js';

export interface ChatBackend {
  readonly route: BackendRoute;
  ensureReady(chatId: string, contextToken: string): Promise<boolean>;
  deliver(msg: WeixinMessage): Promise<void>;
  tryHandleApprovalReply(chatId: string, contextToken: string, text: string): Promise<boolean>;
}

export interface ClaudeBackendAdapterOptions {
  inboxDir: string;
  debug: (msg: string) => void;
  bridgeServer: {
    sendEventToClaude: (event: BridgeEvent) => boolean;
  } | null;
  sessionState: {
    storeMediaHandle: (handle: string, media: any) => void;
  };
  toolHandlers: ClaudeToolHandlers;
  sendTextMessage: (chatId: string, contextToken: string, text: string) => Promise<void>;
  ensureReady: (chatId: string, contextToken: string) => Promise<boolean>;
  sendUnavailableMessage: (chatId: string, contextToken: string) => Promise<void>;
}

export interface CodexBackendAdapterOptions {
  inboxDir: string;
  debug: (msg: string) => void;
  resolveBridge: (chatId: string, contextToken: string) => Promise<CodexBridge | null>;
  sendUnavailableMessage: (chatId: string, contextToken: string) => Promise<void>;
}

export class ClaudeBackendAdapter implements ChatBackend {
  readonly route = 'claude' as const;
  private readonly options: ClaudeBackendAdapterOptions;

  constructor(options: ClaudeBackendAdapterOptions) {
    this.options = options;
  }

  async ensureReady(chatId: string, contextToken: string): Promise<boolean> {
    return this.options.ensureReady(chatId, contextToken);
  }

  async tryHandleApprovalReply(chatId: string, contextToken: string, text: string): Promise<boolean> {
    const trimmed = text.trim().toLowerCase();

    if (trimmed === 'yesall') {
      const requestIds = this.options.toolHandlers.listPendingPermissionRequestIds();
      if (requestIds.length === 0) {
        return false;
      }
      for (const requestId of requestIds) {
        await this.options.toolHandlers.sendPermissionDecision(requestId, 'allow');
      }
      await this.options.sendTextMessage(chatId, contextToken, `已全部允许 ✓ (${requestIds.length})`).catch(() => {});
      return true;
    }

    const permMatch = /^\s*(y|yes|n|no)\s*$/i.exec(text);
    if (!permMatch || this.options.toolHandlers.pendingPermissionCount === 0) {
      return false;
    }

    const requestId = this.options.toolHandlers.getNextPendingPermissionRequestId();
    if (!requestId) {
      return false;
    }
    if (!this.options.toolHandlers.hasPendingPermission(requestId)) {
      await this.options.sendTextMessage(chatId, contextToken, 'Unknown or expired permission request.').catch(() => {});
      return true;
    }

    const behavior = permMatch[1]!.toLowerCase().startsWith('y') ? 'allow' : 'deny';
    try {
      await this.options.toolHandlers.sendPermissionDecision(requestId, behavior);
    } catch (err) {
      this.options.debug(`permission notify failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.options.sendTextMessage(chatId, contextToken, 'Permission response failed to send. Try again.').catch(() => {});
      return true;
    }
    await this.options.sendTextMessage(chatId, contextToken, behavior === 'allow' ? '已允许 ✓' : '已拒绝 ✗').catch(() => {});
    return true;
  }

  async deliver(msg: WeixinMessage): Promise<void> {
    if (!(await this.ensureReady(msg.from_user_id, msg.context_token))) {
      return;
    }

    const inbound = await prepareInboundForClaude(msg, {
      inboxDir: this.options.inboxDir,
      storeMediaHandle: (handle, media) => this.options.sessionState.storeMediaHandle(handle, media),
      onError: err => {
        this.options.debug(`image download failed: ${err}`);
      },
    });
    if (!inbound.text && !inbound.imagePath && !inbound.attachmentFileId) {
      return;
    }

    const delivered = this.options.bridgeServer?.sendEventToClaude({
      kind: 'event',
      method: 'claude/channel',
      params: {
        content: inbound.text,
        meta: {
          chat_id: msg.from_user_id,
          message_id: String(msg.message_id),
          user: msg.from_user_id,
          ts: new Date(msg.create_time_ms).toISOString(),
          ...(inbound.imagePath ? { image_path: inbound.imagePath } : {}),
          ...(inbound.attachmentFileIds.length > 0 ? { attachment_file_ids: inbound.attachmentFileIds } : {}),
          ...(inbound.attachmentNames.length > 0 ? { attachment_names: inbound.attachmentNames } : {}),
          ...(inbound.attachmentFileId ? { attachment_file_id: inbound.attachmentFileId } : {}),
          ...(inbound.attachmentName ? { attachment_name: inbound.attachmentName } : {}),
        },
      },
    });

    if (!delivered) {
      this.options.debug(`failed to deliver inbound: claude backend unavailable`);
      await this.options.sendUnavailableMessage(msg.from_user_id, msg.context_token);
      return;
    }

    this.options.debug(`handleInbound: delivered to claude for ${msg.from_user_id}`);
  }
}

export class CodexBackendAdapter implements ChatBackend {
  readonly route = 'codex' as const;
  private readonly options: CodexBackendAdapterOptions;

  constructor(options: CodexBackendAdapterOptions) {
    this.options = options;
  }

  async ensureReady(chatId: string, contextToken: string): Promise<boolean> {
    return Boolean(await this.options.resolveBridge(chatId, contextToken));
  }

  async tryHandleApprovalReply(chatId: string, contextToken: string, text: string): Promise<boolean> {
    const bridge = await this.options.resolveBridge(chatId, contextToken);
    return bridge ? bridge.maybeHandleApprovalReply(chatId, contextToken, text) : false;
  }

  async deliver(msg: WeixinMessage): Promise<void> {
    const bridge = await this.options.resolveBridge(msg.from_user_id, msg.context_token);
    if (!bridge) {
      return;
    }

    const inbound = await prepareInboundForCodex(msg, {
      inboxDir: this.options.inboxDir,
      onError: err => {
        this.options.debug(`codex attachment download failed: ${err}`);
      },
    });
    if (!inbound.text && inbound.imagePaths.length === 0 && inbound.attachmentPaths.length === 0) {
      return;
    }

    await bridge.submitMessage({
      chatId: msg.from_user_id,
      contextToken: msg.context_token,
      text: inbound.text,
      imagePaths: inbound.imagePaths,
      attachmentPaths: inbound.attachmentPaths,
    }).then(() => {
      this.options.debug(`handleInbound: delivered to codex for ${msg.from_user_id}`);
    }).catch(async err => {
      this.options.debug(`handleInbound: codex delivery failed for ${msg.from_user_id}: ${err}`);
      await this.options.sendUnavailableMessage(msg.from_user_id, msg.context_token);
    });
  }
}
