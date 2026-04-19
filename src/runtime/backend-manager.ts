import type { BackendRoute } from '../config/backend-route.js';
import { CodexBridge } from '../codex/bridge.js';

function getBackendDisplayName(backend: BackendRoute): string {
  return backend === 'claude' ? 'Claude Code' : 'Codex';
}

export interface BackendManagerOptions {
  stateDir: string;
  cwd: string;
  codexCommand?: string;
  model?: string;
  approvalPolicy?: any;
  sandbox?: any;
  debug: (msg: string) => void;
  sendTextMessage: (chatId: string, contextToken: string, text: string) => Promise<void>;
  getContextToken: (chatId: string) => string | undefined;
  hasActiveClaudeClient: () => boolean;
}

export class BackendManager {
  private readonly options: BackendManagerOptions;
  private codexBridge: CodexBridge | null = null;
  private codexBridgeStartPromise: Promise<CodexBridge> | null = null;

  constructor(options: BackendManagerOptions) {
    this.options = options;
  }

  async ensureClaudeBackendReady(chatId: string, contextToken: string): Promise<boolean> {
    if (this.options.hasActiveClaudeClient()) {
      return true;
    }
    this.options.debug(`backend unavailable: backend=claude chat=${chatId}`);
    await this.sendBackendUnavailableMessage('claude', chatId, contextToken);
    return false;
  }

  async ensureCodexBackendReady(chatId: string, contextToken: string): Promise<CodexBridge | null> {
    const bridge = await this.ensureCodexBridgeStarted();
    if (bridge) {
      return bridge;
    }
    this.options.debug(`backend unavailable: backend=codex chat=${chatId}`);
    await this.sendBackendUnavailableMessage('codex', chatId, contextToken);
    return null;
  }

  async ensureCodexBridgeStarted(): Promise<CodexBridge | null> {
    if (this.codexBridge) {
      return this.codexBridge;
    }
    if (this.codexBridgeStartPromise) {
      try {
        return await this.codexBridgeStartPromise;
      } catch {
        return null;
      }
    }

    this.codexBridge = new CodexBridge({
      stateDir: this.options.stateDir,
      cwd: this.options.cwd,
      codexCommand: this.options.codexCommand,
      model: this.options.model,
      approvalPolicy: this.options.approvalPolicy,
      sandbox: this.options.sandbox,
      debug: this.options.debug,
      sendText: this.options.sendTextMessage,
      getContextToken: this.options.getContextToken,
    });

    this.codexBridgeStartPromise = this.codexBridge.start().then(() => this.codexBridge!);
    try {
      await this.codexBridgeStartPromise;
      return this.codexBridge;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.options.debug(`codex bridge start failed: ${msg}`);
      this.codexBridge = null;
      return null;
    } finally {
      this.codexBridgeStartPromise = null;
    }
  }

  hasCodexBridge(): boolean {
    return this.codexBridge !== null;
  }

  getCodexBridge(): CodexBridge | null {
    return this.codexBridge;
  }

  async sendBackendUnavailableMessage(
    backend: BackendRoute,
    chatId: string,
    contextToken: string,
  ): Promise<void> {
    await this.options.sendTextMessage(chatId, contextToken, `${getBackendDisplayName(backend)} 未启动`).catch(() => {});
  }

  async stop(): Promise<void> {
    if (!this.codexBridge) {
      return;
    }
    await this.codexBridge.stop().catch(err => {
      this.options.debug(`codex bridge stop failed: ${err}`);
    });
  }
}
