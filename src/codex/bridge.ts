import { join } from 'node:path';
import { FlagFile } from '../state/flag-file.js';
import { CodexThreadRepository, type ThreadStateFile } from '../state/codex-thread-repository.js';
import { chunkText } from '../util/helpers.js';
import { CodexAppServerClient } from './app-server.js';
import type {
  AgentMessageDeltaNotification,
  ApprovalPolicy,
  CommandExecutionRequestApprovalParams,
  CodexServerRequest,
  ErrorNotification,
  FileChangeRequestApprovalParams,
  GetAccountRateLimitsResponse,
  ItemCompletedNotification,
  JsonRpcNotification,
  PermissionsRequestApprovalParams,
  RequestPermissionProfile,
  SandboxMode,
  ThreadStartResponse,
  TurnCompletedNotification,
  TurnStartResponse,
  UserInput,
} from './types.js';

const MAX_CHUNK_LIMIT = 2048;

const THREAD_INSTRUCTIONS = [
  'You are connected to a WeChat bridge.',
  'Your final assistant text may be sent directly back to the WeChat chat.',
  'Keep replies concise unless the user explicitly asks for depth.',
  'If the bridge mentions absolute local file paths for attachments, read those files directly when useful.',
  'If localImage inputs are attached, inspect them directly.',
].join(' ');

function formatLogText(text: string | null | undefined): string {
  if (!text) {
    return '(empty)';
  }
  return JSON.stringify(text);
}

function formatPathList(paths: string[]): string {
  if (paths.length === 0) {
    return '[]';
  }
  return `[${paths.map(path => JSON.stringify(path)).join(', ')}]`;
}

type TurnContext = {
  chatId: string;
  contextToken: string;
  itemOrder: string[];
  itemTexts: Map<string, string>;
  lastError: string | null;
};

type PendingApproval =
  | {
      requestId: string;
      method: 'item/commandExecution/requestApproval';
      chatId: string;
      contextToken: string;
      params: CodexServerRequest['params'];
      resolve: (value: unknown) => void;
    }
  | {
      requestId: string;
      method: 'item/fileChange/requestApproval';
      chatId: string;
      contextToken: string;
      params: CodexServerRequest['params'];
      resolve: (value: unknown) => void;
    }
  | {
      requestId: string;
      method: 'item/permissions/requestApproval';
      chatId: string;
      contextToken: string;
      params: CodexServerRequest['params'];
      resolve: (value: unknown) => void;
    };

export interface CodexInboundMessage {
  chatId: string;
  contextToken: string;
  text: string | null;
  imagePaths: string[];
  attachmentPaths: string[];
}

export interface CodexBridgeOptions {
  stateDir: string;
  cwd: string;
  codexCommand?: string;
  model?: string;
  approvalPolicy?: ApprovalPolicy;
  sandbox?: SandboxMode;
  debug?: (msg: string) => void;
  sendText: (chatId: string, contextToken: string, text: string) => Promise<void>;
  getContextToken: (chatId: string) => string | undefined;
}

export class CodexBridge {
  private readonly stateDir: string;
  private readonly autoApproveFile: string;
  private readonly cwd: string;
  private readonly model?: string;
  private readonly approvalPolicy?: ApprovalPolicy;
  private readonly sandbox?: SandboxMode;
  private readonly debug: (msg: string) => void;
  private readonly sendText: (chatId: string, contextToken: string, text: string) => Promise<void>;
  private readonly getContextToken: (chatId: string) => string | undefined;
  private readonly threadRepository: CodexThreadRepository;
  private readonly autoApproveFlag: FlagFile;
  private readonly client: CodexAppServerClient;

  private threadState: ThreadStateFile;
  private resumedThreads = new Set<string>();
  private activeTurns = new Map<string, string>();
  private turnContexts = new Map<string, TurnContext>();
  private pendingApprovals = new Map<string, PendingApproval>();

  constructor(opts: CodexBridgeOptions) {
    this.stateDir = opts.stateDir;
    this.autoApproveFile = join(this.stateDir, '.auto-approve');
    this.cwd = opts.cwd;
    this.model = opts.model;
    this.approvalPolicy = opts.approvalPolicy;
    this.sandbox = opts.sandbox;
    this.debug = opts.debug ?? (() => {});
    this.sendText = opts.sendText;
    this.getContextToken = opts.getContextToken;
    this.threadRepository = new CodexThreadRepository(this.stateDir);
    this.autoApproveFlag = new FlagFile(this.autoApproveFile);
    this.threadState = this.loadThreads();
    this.client = new CodexAppServerClient({
      command: opts.codexCommand,
      cwd: this.cwd,
      debug: this.debug,
    });
    this.client.setNotificationHandler(notification => {
      void this.handleNotification(notification);
    });
    this.client.setServerRequestHandler(request => this.handleServerRequest(request));
  }

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  async submitMessage(message: CodexInboundMessage): Promise<void> {
    const threadId = await this.getOrCreateThread(message.chatId);
    const input = this.buildInputs(message);

    this.debug(
      `codex inbound: chat=${message.chatId} thread=${threadId} text=${formatLogText(message.text)} images=${formatPathList(message.imagePaths)} attachments=${formatPathList(message.attachmentPaths)}`,
    );

    const activeTurnId = this.activeTurns.get(threadId);
    if (activeTurnId) {
      this.debug(`codex steer: chat=${message.chatId} thread=${threadId} turn=${activeTurnId}`);
      await this.client.request('turn/steer', {
        threadId,
        input,
        expectedTurnId: activeTurnId,
      });
      return;
    }

    const resp = await this.client.request<TurnStartResponse>('turn/start', {
      threadId,
      input,
    });
    this.debug(`codex turn/start: chat=${message.chatId} thread=${threadId} turn=${resp.turn.id}`);
    this.activeTurns.set(threadId, resp.turn.id);
    this.turnContexts.set(resp.turn.id, {
      chatId: message.chatId,
      contextToken: message.contextToken,
      itemOrder: [],
      itemTexts: new Map(),
      lastError: null,
    });
  }

  async maybeHandleApprovalReply(chatId: string, contextToken: string, text: string): Promise<boolean> {
    const trimmed = text.trim().toLowerCase();

    if (trimmed === 'yesall') {
      const approvals = [...this.pendingApprovals.values()].filter(approval => approval.chatId === chatId);
      if (approvals.length === 0) {
        return false;
      }
      for (const approval of approvals) {
        await this.resolveApproval(approval, true, false);
      }
      await this.sendText(chatId, contextToken, `已全部允许 ✓ (${approvals.length})`);
      return true;
    }

    if (trimmed === 'stopall') {
      this.autoApproveFlag.disable();
      await this.sendText(chatId, contextToken, 'Auto-approve disabled.');
      return true;
    }

    const match = /^\s*(y|yes|n|no)\s*$/i.exec(text);
    if (!match) {
      return false;
    }

    const approvals = [...this.pendingApprovals.values()].filter(approval => approval.chatId === chatId);
    if (approvals.length === 0) {
      return false;
    }

    const approval = approvals[0]!;

    const allow = match[1]!.toLowerCase().startsWith('y');
    await this.resolveApproval(approval, allow, false);
    await this.sendText(chatId, contextToken, allow ? 'Approved.' : 'Denied.');
    return true;
  }

  async getRateLimits(): Promise<GetAccountRateLimitsResponse | null> {
    try {
      await this.start();
      return await this.client.request<GetAccountRateLimitsResponse>('account/rateLimits/read');
    } catch (err) {
      this.debug(`codex rate limits read failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private buildInputs(message: CodexInboundMessage): UserInput[] {
    const textParts: string[] = [];
    if (message.text) {
      textParts.push(message.text);
    }
    if (message.attachmentPaths.length > 0) {
      textParts.push(
        `Attachment paths:\n${message.attachmentPaths.map(path => `- ${path}`).join('\n')}`,
      );
    }
    if (message.imagePaths.length > 0) {
      textParts.push(`Attached image count: ${message.imagePaths.length}.`);
    }

    const inputs: UserInput[] = [
      {
        type: 'text',
        text: textParts.join('\n\n').trim() || '(empty message)',
        text_elements: [],
      },
    ];

    for (const imagePath of message.imagePaths) {
      inputs.push({ type: 'localImage', path: imagePath });
    }

    return inputs;
  }

  private async getOrCreateThread(chatId: string): Promise<string> {
    const existing = this.threadState.threads[chatId];
    if (existing) {
      if (!this.resumedThreads.has(existing)) {
        try {
          await this.client.request('thread/resume', {
            threadId: existing,
            cwd: this.cwd,
            approvalPolicy: this.approvalPolicy,
            approvalsReviewer: 'user',
            sandbox: this.sandbox,
            model: this.model,
            developerInstructions: THREAD_INSTRUCTIONS,
            persistExtendedHistory: true,
          });
          this.resumedThreads.add(existing);
        } catch (err) {
          this.debug(`thread resume failed for ${existing}: ${err}`);
          delete this.threadState.threads[chatId];
          this.saveThreads();
        }
      }
      if (this.threadState.threads[chatId]) {
        return existing;
      }
    }

    const resp = await this.client.request<ThreadStartResponse>('thread/start', {
      cwd: this.cwd,
      approvalPolicy: this.approvalPolicy,
      approvalsReviewer: 'user',
      sandbox: this.sandbox,
      model: this.model,
      serviceName: 'weixin-codex',
      developerInstructions: THREAD_INSTRUCTIONS,
      ephemeral: false,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    });
    this.threadState.threads[chatId] = resp.thread.id;
    this.resumedThreads.add(resp.thread.id);
    this.saveThreads();
    return resp.thread.id;
  }

  private async handleNotification(notification: JsonRpcNotification): Promise<void> {
    switch (notification.method) {
      case 'item/agentMessage/delta':
        this.handleAgentMessageDelta(notification.params as AgentMessageDeltaNotification);
        return;

      case 'item/completed':
        this.handleItemCompleted(notification.params as ItemCompletedNotification);
        return;

      case 'turn/completed':
        await this.handleTurnCompleted(notification.params as TurnCompletedNotification);
        return;

      case 'error':
        this.handleTurnError(notification.params as ErrorNotification);
        return;

      case 'configWarning':
        this.debug(`codex config warning: ${JSON.stringify(notification.params)}`);
        return;

      default:
        return;
    }
  }

  private handleAgentMessageDelta(notification: AgentMessageDeltaNotification): void {
    const turn = this.turnContexts.get(notification.turnId);
    if (!turn) {
      return;
    }
    if (!turn.itemTexts.has(notification.itemId)) {
      turn.itemOrder.push(notification.itemId);
      turn.itemTexts.set(notification.itemId, '');
    }
    turn.itemTexts.set(notification.itemId, (turn.itemTexts.get(notification.itemId) ?? '') + notification.delta);
  }

  private handleItemCompleted(notification: ItemCompletedNotification): void {
    const turn = this.turnContexts.get(notification.turnId);
    if (!turn) {
      return;
    }
    if (notification.item.type !== 'agentMessage') {
      return;
    }
    const item = notification.item as { id: string; text: string };
    if (!turn.itemTexts.has(item.id)) {
      turn.itemOrder.push(item.id);
    }
    turn.itemTexts.set(item.id, item.text);
  }

  private handleTurnError(notification: ErrorNotification): void {
    const turn = this.turnContexts.get(notification.turnId);
    if (!turn) {
      return;
    }
    if (!notification.willRetry) {
      turn.lastError = notification.error.additionalDetails
        ? `${notification.error.message}\n${notification.error.additionalDetails}`
        : notification.error.message;
    }
  }

  private async handleTurnCompleted(notification: TurnCompletedNotification): Promise<void> {
    const turn = this.turnContexts.get(notification.turn.id);
    if (!turn) {
      this.activeTurns.delete(notification.threadId);
      return;
    }

    this.turnContexts.delete(notification.turn.id);
    this.activeTurns.delete(notification.threadId);

    const parts = turn.itemOrder
      .map(itemId => turn.itemTexts.get(itemId)?.trim())
      .filter((text): text is string => Boolean(text));
    const reply = parts.join('\n\n').trim();

    if (reply) {
      this.debug(`codex turn/completed: chat=${turn.chatId} thread=${notification.threadId} turn=${notification.turn.id} status=${notification.turn.status}`);
      await this.replyText(turn.chatId, turn.contextToken, reply);
      return;
    }

    if (notification.turn.error || turn.lastError) {
      const errorText = notification.turn.error?.additionalDetails
        ? `${notification.turn.error.message}\n${notification.turn.error.additionalDetails}`
        : notification.turn.error?.message ?? turn.lastError ?? 'Turn failed.';
      this.debug(`codex turn/error: chat=${turn.chatId} thread=${notification.threadId} turn=${notification.turn.id} error=${formatLogText(errorText)}`);
      await this.replyText(turn.chatId, turn.contextToken, `Codex failed:\n${errorText}`);
      return;
    }

    if (notification.turn.status === 'interrupted') {
      this.debug(`codex turn/interrupted: chat=${turn.chatId} thread=${notification.threadId} turn=${notification.turn.id}`);
      await this.replyText(turn.chatId, turn.contextToken, 'Turn interrupted.');
    }
  }

  private async handleServerRequest(request: CodexServerRequest): Promise<unknown> {
    if (request.method === 'item/tool/call') {
      throw new Error('dynamic tool calls are not implemented by this bridge');
    }

    if (request.method === 'item/tool/requestUserInput') {
      const params = request.params;
      const approvalChatId = this.getChatIdByThreadId(params.threadId);
      if (approvalChatId) {
        await this.replyText(
          approvalChatId,
          this.getContextToken(approvalChatId) ?? '',
          'Codex requested interactive tool input that this bridge cannot relay yet. The request was answered with empty input.',
        );
      }
      return { answers: {} };
    }

    if (request.method === 'mcpServer/elicitation/request') {
      const approvalChatId = this.getChatIdByThreadId(request.params.threadId);
      if (approvalChatId) {
        const body = request.params.mode === 'url'
          ? `${request.params.message}\n${request.params.url ?? ''}`
          : request.params.message;
        await this.replyText(
          approvalChatId,
          this.getContextToken(approvalChatId) ?? '',
          `Codex requested MCP elicitation, which this bridge cannot complete automatically:\n${body}`,
        );
      }
      return { action: 'decline', content: null, _meta: null };
    }

    const chatId = this.getChatIdByThreadId(request.params.threadId);
    if (!chatId) {
      throw new Error(`no chat mapping found for thread ${request.params.threadId}`);
    }

    if (this.autoApproveFlag.isEnabled()) {
      return this.buildApprovalResponse(request, true, true);
    }

    const requestId = String(request.id);
    return new Promise(resolve => {
      const approval: PendingApproval = {
        requestId,
        method: request.method,
        chatId,
        contextToken: this.getContextToken(chatId) ?? '',
        params: request.params,
        resolve,
      };
      this.pendingApprovals.set(requestId, approval);
      this.debug(`codex approval/request: chat=${chatId} request=${requestId} method=${request.method}`);
      void this.replyText(chatId, approval.contextToken, this.formatApprovalRequest(approval));
    });
  }

  private async resolveApproval(approval: PendingApproval, allow: boolean, sessionScope: boolean): Promise<void> {
    const response = this.buildApprovalResponse(
      {
        id: approval.requestId,
        method: approval.method,
        params: approval.params,
      } as CodexServerRequest,
      allow,
      sessionScope,
    );

    this.pendingApprovals.delete(approval.requestId);
    approval.resolve(response);
  }

  private buildApprovalResponse(request: CodexServerRequest, allow: boolean, sessionScope: boolean): unknown {
    switch (request.method) {
      case 'item/commandExecution/requestApproval':
        return {
          decision: allow
            ? (sessionScope ? 'acceptForSession' : 'accept')
            : 'decline',
        };

      case 'item/fileChange/requestApproval':
        return {
          decision: allow
            ? (sessionScope ? 'acceptForSession' : 'accept')
            : 'decline',
        };

      case 'item/permissions/requestApproval':
        return {
          permissions: allow ? request.params.permissions : { network: null, fileSystem: null },
          scope: sessionScope ? 'session' : 'turn',
        };

      case 'item/tool/requestUserInput':
        return { answers: {} };

      case 'mcpServer/elicitation/request':
        return { action: allow ? 'accept' : 'decline', content: null, _meta: null };

      case 'item/tool/call':
        throw new Error('dynamic tool calls are not implemented by this bridge');
    }
  }

  private formatApprovalRequest(approval: PendingApproval): string {
    if (approval.method === 'item/commandExecution/requestApproval') {
      return this.formatCommandApproval(approval.params as CommandExecutionRequestApprovalParams);
    }
    if (approval.method === 'item/fileChange/requestApproval') {
      return this.formatFileChangeApproval(approval.params as FileChangeRequestApprovalParams);
    }
    return this.formatPermissionsApproval(approval.params as PermissionsRequestApprovalParams);
  }

  private formatCommandApproval(params: CommandExecutionRequestApprovalParams): string {
    return [
      '类型: 命令执行',
      `操作: ${params.command ?? params.reason ?? '执行命令'}`,
    ].join('\n');
  }

  private formatFileChangeApproval(params: FileChangeRequestApprovalParams): string {
    return [
      '类型: 文件变更',
      `操作: ${params.reason ?? params.grantRoot ?? '修改文件'}`,
    ].join('\n');
  }

  private formatPermissionsApproval(params: PermissionsRequestApprovalParams): string {
    return [
      '类型: 权限申请',
      `操作: ${params.reason ?? this.formatRequestedPermissions(params.permissions)}`,
    ].join('\n');
  }

  private formatRequestedPermissions(permissions: RequestPermissionProfile): string {
    return JSON.stringify(permissions);
  }

  private formatPendingApprovals(chatId: string): string {
    return [...this.pendingApprovals.values()]
      .filter(approval => approval.chatId === chatId)
      .map(approval => this.formatApprovalRequest(approval))
      .join('\n\n');
  }

  private getChatIdByThreadId(threadId: string): string | null {
    for (const [chatId, storedThreadId] of Object.entries(this.threadState.threads)) {
      if (storedThreadId === threadId) {
        return chatId;
      }
    }
    return null;
  }

  private async replyText(chatId: string, contextToken: string, text: string): Promise<void> {
    this.debug(`codex outbound: chat=${chatId} text=${formatLogText(text)}`);
    const chunks = chunkText(text, MAX_CHUNK_LIMIT);
    for (const chunk of chunks) {
      await this.sendText(chatId, contextToken || this.getContextToken(chatId) || '', chunk);
    }
  }

  private loadThreads(): ThreadStateFile {
    return this.threadRepository.load();
  }

  private saveThreads(): void {
    this.threadRepository.save(this.threadState);
  }
}
