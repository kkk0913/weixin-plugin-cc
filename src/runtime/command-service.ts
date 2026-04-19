import type { BackendRoute } from '../config/backend-route.js';
import {
  getBackendAlreadyActiveMessage,
  getBackendSwitchMessage,
  getHelpText,
} from './command-text.js';

export interface CommandServiceOptions {
  debug: (msg: string) => void;
  sendTextMessage: (chatId: string, contextToken: string, text: string) => Promise<void>;
  getStatsText: () => Promise<string>;
  getStatusText: (chatId: string) => Promise<string>;
}

export class CommandService {
  private readonly debug: (msg: string) => void;
  private readonly sendTextMessage: (chatId: string, contextToken: string, text: string) => Promise<void>;
  private readonly getStatsText: () => Promise<string>;
  private readonly getStatusText: (chatId: string) => Promise<string>;

  constructor(options: CommandServiceOptions) {
    this.debug = options.debug;
    this.sendTextMessage = options.sendTextMessage;
    this.getStatsText = options.getStatsText;
    this.getStatusText = options.getStatusText;
  }

  async sendBackendAlreadyActive(chatId: string, contextToken: string, backend: BackendRoute): Promise<void> {
    await this.sendSafeText(chatId, contextToken, getBackendAlreadyActiveMessage(backend), 'backend already active');
  }

  async sendBackendSwitched(chatId: string, contextToken: string, backend: BackendRoute): Promise<void> {
    await this.sendSafeText(chatId, contextToken, getBackendSwitchMessage(backend), 'backend switch');
  }

  async sendStats(chatId: string, contextToken: string): Promise<void> {
    await this.sendSafeText(chatId, contextToken, await this.getStatsText(), 'stats');
  }

  async sendStatus(chatId: string, contextToken: string): Promise<void> {
    await this.sendSafeText(chatId, contextToken, await this.getStatusText(chatId), 'status');
  }

  async sendHelp(chatId: string, contextToken: string, activeBackend: BackendRoute): Promise<void> {
    await this.sendSafeText(chatId, contextToken, getHelpText(activeBackend), 'help');
  }

  async switchBackend(
    chatId: string,
    contextToken: string,
    text: string,
    targetBackend: BackendRoute,
    ensureReady: () => Promise<boolean>,
    getCurrentBackend: () => BackendRoute,
    setBackend: (backend: BackendRoute) => void,
  ): Promise<void> {
    this.debug(`handleInbound: switch command chat=${chatId} target=${targetBackend} text=${JSON.stringify(text)}`);
    if (!(await ensureReady())) {
      return;
    }

    const currentBackend = getCurrentBackend();
    if (currentBackend === targetBackend) {
      await this.sendBackendAlreadyActive(chatId, contextToken, targetBackend);
      return;
    }

    setBackend(targetBackend);
    await this.sendBackendSwitched(chatId, contextToken, targetBackend);
  }

  private async sendSafeText(chatId: string, contextToken: string, text: string, label: string): Promise<void> {
    try {
      await this.sendTextMessage(chatId, contextToken, text);
    } catch (err) {
      this.debug(`send text failed (${label}) for ${chatId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
