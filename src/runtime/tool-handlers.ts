import { statSync } from 'node:fs';
import { downloadMedia, uploadMedia } from '../weixin/media.js';
import { MessageType, type CDNMedia, type MessageItem } from '../weixin/types.js';
import type {
  BridgePermissionRequestParams,
  BridgeToolCallRequest,
  BridgeToolCallResult,
} from '../ipc/protocol.js';
import { FlagFile } from '../state/flag-file.js';
import { chunkText, assertSendable, foldCommandPreview } from '../util/helpers.js';

export interface PendingPermissionRecord {
  chatId: string;
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

  enableAutoApprove(): void {
    this.autoApproveFlag.enable();
  }

  disableAutoApprove(): void {
    this.autoApproveFlag.disable();
  }

  getNextPendingPermissionRequestId(chatId: string): string | null {
    for (const [requestId, record] of this.pendingPermissions) {
      if (record.chatId === chatId) {
        return requestId;
      }
    }
    return null;
  }

  hasPendingPermission(requestId: string): boolean {
    return this.pendingPermissions.has(requestId);
  }

  getPendingPermissionCount(chatId?: string): number {
    if (!chatId) {
      return this.pendingPermissions.size;
    }
    let count = 0;
    for (const record of this.pendingPermissions.values()) {
      if (record.chatId === chatId) {
        count += 1;
      }
    }
    return count;
  }

  isAutoApproveEnabled(): boolean {
    return this.autoApproveFlag.isEnabled();
  }

  listPendingPermissionRequestIds(chatId?: string): string[] {
    if (!chatId) {
      return [...this.pendingPermissions.keys()];
    }
    const requestIds: string[] = [];
    for (const [requestId, record] of this.pendingPermissions) {
      if (record.chatId === chatId) {
        requestIds.push(requestId);
      }
    }
    return requestIds;
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
    const chatId = params.chat_id?.trim();
    if (!chatId) {
      this.options.debug(`permission_request dropped: missing chat_id for ${tool_name} (${request_id})`);
      return;
    }
    if (this.autoApproveFlag.isEnabled()) {
      this.options.debug(`auto-approve: ${tool_name} (${request_id})`);
      await this.sendPermissionDecision(request_id, 'allow');
      return;
    }

    const operation = tool_name.replace(/^mcp__plugin_weixin_weixin__/, '');
    this.pendingPermissions.set(request_id, {
      chatId,
      type: '工具权限',
      operation,
    });

    const lines = [
      '## 权限请求',
      `- **操作**：${operation}`,
    ];
    if (params.description) {
      lines.push(`- **描述**：${foldCommandPreview(params.description, { maxLength: 160, maxLines: 4 })}`);
    }
    if (params.input_preview) {
      lines.push(`- **内容**：${foldCommandPreview(params.input_preview)}`);
    }
    lines.push('', '**可选命令**', '- `y` / `yes`：允许当前请求', '- `n` / `no`：拒绝当前请求', '- `yesall`：允许当前聊天里的全部待审批请求');
    const text = lines.join('\n');
    await this.options.client.sendMessage(chatId, this.options.getContextToken(chatId) ?? '', {
      type: MessageType.TEXT,
      text_item: { text },
    }).catch(err => {
      this.options.debug(`permission_request send failed for ${chatId}: ${err}`);
    });
  }
}
