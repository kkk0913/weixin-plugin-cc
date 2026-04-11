import { statSync } from 'node:fs';
import { downloadMedia, uploadMedia } from '../weixin/media.js';
import { MessageType, type CDNMedia, type MessageItem } from '../weixin/types.js';
import type {
  BridgePermissionRequestParams,
  BridgeToolCallRequest,
  BridgeToolCallResult,
} from '../ipc/protocol.js';
import { FlagFile } from '../state/flag-file.js';
import { chunkText, assertSendable } from '../util/helpers.js';

export interface PendingPermissionRecord {
  type: string;
  operation: string;
}

export interface ToolHandlersOptions {
  stateDir: string;
  inboxDir: string;
  autoApproveFile: string;
  maxChunkLimit: number;
  debug: (msg: string) => void;
  sendTextMessage: (chatId: string, contextToken: string, text: string) => Promise<void>;
  sendPermissionDecision: (requestId: string, behavior: 'allow' | 'deny') => boolean;
  assertAllowedChat: (chatId: string) => void;
  getContextToken: (chatId: string) => string | undefined;
  takeMediaHandle: (handle: string) => CDNMedia | null;
  client: {
    sendMessage: (chatId: string, contextToken: string, item: MessageItem) => Promise<unknown>;
  };
  access: {
    reload: () => void;
    allowedUsers: Iterable<string>;
  };
}

export class ClaudeToolHandlers {
  private readonly options: ToolHandlersOptions;
  private readonly pendingPermissions = new Map<string, PendingPermissionRecord>();
  private readonly autoApproveFlag: FlagFile;

  constructor(options: ToolHandlersOptions) {
    this.options = options;
    this.autoApproveFlag = new FlagFile(options.autoApproveFile);
  }

  getNextPendingPermissionRequestId(): string | null {
    const next = this.pendingPermissions.keys().next();
    return next.done ? null : next.value;
  }

  hasPendingPermission(requestId: string): boolean {
    return this.pendingPermissions.has(requestId);
  }

  get pendingPermissionCount(): number {
    return this.pendingPermissions.size;
  }

  listPendingPermissionRequestIds(): string[] {
    return [...this.pendingPermissions.keys()];
  }

  async sendPermissionDecision(requestId: string, behavior: 'allow' | 'deny'): Promise<void> {
    if (!this.options.sendPermissionDecision(requestId, behavior)) {
      throw new Error('claude backend unavailable');
    }
    this.pendingPermissions.delete(requestId);
  }

  async handleToolCall(req: BridgeToolCallRequest): Promise<BridgeToolCallResult> {
    const args = req.arguments;
    try {
      switch (req.name) {
        case 'reply': {
          const chatId = args.chat_id as string;
          const text = args.text as string;
          const files = (args.files as string[] | undefined) ?? [];
          this.options.assertAllowedChat(chatId);

          const chunks = chunkText(text, this.options.maxChunkLimit);
          for (const chunk of chunks) {
            await this.options.client.sendMessage(chatId, this.options.getContextToken(chatId) ?? '', {
              type: MessageType.TEXT,
              text_item: { text: chunk },
            });
          }

          for (const filePath of files) {
            assertSendable(filePath, this.options.stateDir);
            const st = statSync(filePath);
            if (st.size > 50 * 1024 * 1024) {
              throw new Error(`file too large: ${filePath} (${(st.size / 1024 / 1024).toFixed(1)}MB, max 50MB)`);
            }
            const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
            const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
            const isVideo = ['mp4', 'avi', 'mov', 'mkv'].includes(ext);
            const mediaType = isImage ? 1 : isVideo ? 2 : 3;
            const cdnMedia = await uploadMedia(filePath, chatId, mediaType, this.options.client as any);

            let item: MessageItem;
            if (isImage) {
              item = { type: MessageType.IMAGE, image_item: { media: cdnMedia } };
            } else if (isVideo) {
              item = { type: MessageType.VIDEO, video_item: { media: cdnMedia } };
            } else {
              item = { type: MessageType.FILE, file_item: { media: cdnMedia, file_name: filePath.split('/').pop() } };
            }
            await this.options.client.sendMessage(chatId, this.options.getContextToken(chatId) ?? '', item);
          }

          return { content: [{ type: 'text', text: `sent${chunks.length > 1 ? ` (${chunks.length} chunks)` : ''}` }] };
        }

        case 'react':
          return { content: [{ type: 'text', text: 'WeChat does not support emoji reactions.' }] };

        case 'download_attachment': {
          const handle = args.file_id as string;
          const cdnMedia = this.options.takeMediaHandle(handle);
          if (!cdnMedia) {
            throw new Error('invalid or expired attachment handle');
          }
          const filePath = await downloadMedia(cdnMedia, this.options.inboxDir);
          return { content: [{ type: 'text', text: filePath }] };
        }

        case 'edit_message': {
          const chatId = args.chat_id as string;
          const text = args.text as string;
          this.options.assertAllowedChat(chatId);
          await this.options.client.sendMessage(chatId, this.options.getContextToken(chatId) ?? '', {
            type: MessageType.TEXT,
            text_item: { text: `(edited) ${text}` },
          });
          return { content: [{ type: 'text', text: 'sent as new message (WeChat has no edit API)' }] };
        }

        default:
          return { content: [{ type: 'text', text: `unknown tool: ${req.name}` }], isError: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `${req.name} failed: ${msg}` }], isError: true };
    }
  }

  async handlePermissionRequest(params: BridgePermissionRequestParams): Promise<void> {
    const { request_id, tool_name } = params;
    if (this.autoApproveFlag.isEnabled()) {
      this.options.debug(`auto-approve: ${tool_name} (${request_id})`);
      await this.sendPermissionDecision(request_id, 'allow');
      return;
    }

    const operation = tool_name.replace(/^mcp__plugin_weixin_weixin__/, '');
    this.pendingPermissions.set(request_id, {
      type: '工具权限',
      operation,
    });

    this.options.access.reload();
    for (const userId of this.options.access.allowedUsers) {
      const text = [
        '类型: 工具权限',
        `操作: ${operation}`,
      ].join('\n');
      await this.options.client.sendMessage(userId, this.options.getContextToken(userId) ?? '', {
        type: MessageType.TEXT,
        text_item: { text },
      }).catch(err => {
        this.options.debug(`permission_request send failed: ${err}`);
      });
    }
  }
}
