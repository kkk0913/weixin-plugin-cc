import { join } from 'node:path';
import { chunkText } from '../util/helpers.js';
import { CodexApprovalManager } from './approval-manager.js';
import { CodexAppServerClient } from './app-server.js';
import { CodexServerRequestHandler } from './server-request-handler.js';
import { CodexThreadManager } from './thread-manager.js';
import { CodexTurnState } from './turn-state.js';
import type {
  AgentMessageDeltaNotification,
  ApprovalPolicy,
  ErrorNotification,
  GetAccountRateLimitsResponse,
  ItemCompletedNotification,
  JsonRpcNotification,
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
  private readonly cwd: string;
  private readonly model?: string;
  private readonly approvalPolicy?: ApprovalPolicy;
  private readonly sandbox?: SandboxMode;
  private readonly debug: (msg: string) => void;
  private readonly sendText: (chatId: string, contextToken: string, text: string) => Promise<void>;
  private readonly getContextToken: (chatId: string) => string | undefined;
  private readonly client: CodexAppServerClient;
  private readonly approvalManager: CodexApprovalManager;
  private readonly serverRequestHandler: CodexServerRequestHandler;
  private readonly threadManager: CodexThreadManager;
  private readonly turnState = new CodexTurnState();

  constructor(opts: CodexBridgeOptions) {
    this.stateDir = opts.stateDir;
    this.cwd = opts.cwd;
    this.model = opts.model;
    this.approvalPolicy = opts.approvalPolicy;
    this.sandbox = opts.sandbox;
    this.debug = opts.debug ?? (() => {});
    this.sendText = opts.sendText;
    this.getContextToken = opts.getContextToken;
    this.approvalManager = new CodexApprovalManager({
      autoApproveFile: join(this.stateDir, '.auto-approve'),
      debug: this.debug,
      sendText: this.sendText,
    });
    this.client = new CodexAppServerClient({
      command: opts.codexCommand,
      cwd: this.cwd,
      model: this.model,
      debug: this.debug,
      onProcessExit: () => {
        this.debug('codex app-server exited, clearing active turns');
        this.turnState.clearActiveTurns();
      },
    });
    this.threadManager = new CodexThreadManager({
      stateDir: this.stateDir,
      cwd: this.cwd,
      model: this.model,
      approvalPolicy: this.approvalPolicy,
      sandbox: this.sandbox,
      developerInstructions: THREAD_INSTRUCTIONS,
      debug: this.debug,
      request: (method, params) => this.client.request(method, params),
    });
    this.serverRequestHandler = new CodexServerRequestHandler({
      approvalManager: this.approvalManager,
      threadManager: this.threadManager,
      getContextToken: this.getContextToken,
      replyText: (chatId, contextToken, text) => this.replyText(chatId, contextToken, text),
    });
    this.client.setNotificationHandler(notification => {
      void this.handleNotification(notification);
    });
    this.client.setServerRequestHandler(request => this.serverRequestHandler.handle(request));
  }

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  async submitMessage(message: CodexInboundMessage): Promise<void> {
    const threadId = await this.threadManager.ensureThread(message.chatId);
    const input = this.buildInputs(message);

    this.debug(
      `codex inbound: chat=${message.chatId} thread=${threadId} text=${formatLogText(message.text)} images=${formatPathList(message.imagePaths)} attachments=${formatPathList(message.attachmentPaths)}`,
    );

    const activeTurnId = this.turnState.getActiveTurnId(threadId);
    if (activeTurnId) {
      if (this.approvalManager.hasPendingApprovalsForChat(message.chatId)) {
        this.debug(`codex approval/resend: chat=${message.chatId} thread=${threadId} turn=${activeTurnId}`);
        await this.approvalManager.resendPendingApprovals(message.chatId, message.contextToken);
        return;
      }
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
    this.turnState.startTurn(threadId, resp.turn.id, message.chatId, message.contextToken);
  }

  async maybeHandleApprovalReply(chatId: string, contextToken: string, text: string): Promise<boolean> {
    return this.approvalManager.maybeHandleApprovalReply(chatId, contextToken, text);
  }

  isAutoApproveEnabled(): boolean {
    return this.approvalManager.isAutoApproveEnabled();
  }

  getPendingApprovalCount(chatId?: string): number {
    return this.approvalManager.getPendingApprovalCount(chatId);
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

  private async handleNotification(notification: JsonRpcNotification): Promise<void> {
    switch (notification.method) {
      case 'item/agentMessage/delta':
        this.turnState.handleAgentMessageDelta(notification.params as AgentMessageDeltaNotification);
        return;

      case 'item/completed':
        this.turnState.handleItemCompleted(notification.params as ItemCompletedNotification);
        return;

      case 'turn/completed':
        await this.handleTurnCompleted(notification.params as TurnCompletedNotification);
        return;

      case 'error':
        this.turnState.handleTurnError(notification.params as ErrorNotification);
        return;

      case 'configWarning':
        this.debug(`codex config warning: ${JSON.stringify(notification.params)}`);
        return;

      default:
        return;
    }
  }

  private async handleTurnCompleted(notification: TurnCompletedNotification): Promise<void> {
    const completed = this.turnState.completeTurn(notification);
    if (!completed.turn) {
      return;
    }

    if (completed.reply) {
      this.debug(`codex turn/completed: chat=${completed.turn.chatId} thread=${notification.threadId} turn=${notification.turn.id} status=${notification.turn.status}`);
      await this.replyText(completed.turn.chatId, completed.turn.contextToken, completed.reply);
      return;
    }

    if (completed.errorText) {
      const errorText = completed.errorText;
      this.debug(`codex turn/error: chat=${completed.turn.chatId} thread=${notification.threadId} turn=${notification.turn.id} error=${formatLogText(errorText)}`);
      await this.replyText(completed.turn.chatId, completed.turn.contextToken, `Codex failed:\n${errorText}`);
      return;
    }

    if (completed.interrupted) {
      this.debug(`codex turn/interrupted: chat=${completed.turn.chatId} thread=${notification.threadId} turn=${notification.turn.id}`);
      await this.replyText(completed.turn.chatId, completed.turn.contextToken, 'Turn interrupted.');
    }
  }

  private async replyText(chatId: string, contextToken: string, text: string): Promise<void> {
    this.debug(`codex outbound: chat=${chatId} text=${formatLogText(text)}`);
    const chunks = chunkText(text, MAX_CHUNK_LIMIT);
    for (const chunk of chunks) {
      await this.sendText(chatId, contextToken || this.getContextToken(chatId) || '', chunk);
    }
  }
}
