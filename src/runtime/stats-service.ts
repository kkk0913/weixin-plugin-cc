import type { CodexBridge } from '../codex/bridge.js';
import { ClaudeActivityProvider } from './claude-activity-provider.js';
import { ClaudeUsageProvider } from './claude-usage-provider.js';
import { CodexRateLimitProvider } from './codex-rate-limit-provider.js';
import { formatBackendStatusText } from './stats-format.js';

export interface StatsServiceOptions {
  debug: (msg: string) => void;
  getCodexBridge: () => Promise<CodexBridge | null>;
  isClaudeConnected: () => boolean;
  isCodexConnected: () => boolean;
  model?: string;
}

export class StatsService {
  private readonly claudeUsageProvider: ClaudeUsageProvider;
  private readonly claudeActivityProvider: ClaudeActivityProvider;
  private readonly codexRateLimitProvider: CodexRateLimitProvider;
  private readonly isClaudeConnected: () => boolean;
  private readonly isCodexConnected: () => boolean;

  constructor(options: StatsServiceOptions) {
    this.claudeUsageProvider = new ClaudeUsageProvider(options.debug);
    this.claudeActivityProvider = new ClaudeActivityProvider();
    this.codexRateLimitProvider = new CodexRateLimitProvider(options);
    this.isClaudeConnected = options.isClaudeConnected;
    this.isCodexConnected = options.isCodexConnected;
  }

  async getCombinedStatsText(): Promise<string> {
    const [claudeUsage, codexRateLimits] = await Promise.all([
      this.claudeUsageProvider.getText(),
      this.codexRateLimitProvider.getText(),
    ]);
    const backendStatus = formatBackendStatusText({
      claudeConnected: this.isClaudeConnected(),
      codexConnected: this.isCodexConnected(),
    });
    return `${backendStatus}${claudeUsage}${this.claudeActivityProvider.getText()}${codexRateLimits}`;
  }
}
