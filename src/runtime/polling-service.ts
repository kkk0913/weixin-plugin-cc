import type { PollLeaseControl } from '../config/poll-owner.js';
import { CursorRepository } from '../state/cursor-repository.js';
import type { WeixinClient } from '../weixin/api.js';
import type { WeixinMessage } from '../weixin/types.js';
import { pollLoop as runPollLoop } from './polling.js';

export interface PollingServiceOptions {
  cursorFile: string;
  client: WeixinClient;
  pollLease: PollLeaseControl;
  handleInbound: (msg: WeixinMessage) => Promise<void>;
  debug: (msg: string) => void;
  checkLoginTrigger: () => boolean;
  onLoginTriggered: () => void;
  onSessionExpired: () => void;
  isPolling: () => boolean;
  pollLeaseRetryMs: number;
}

export class PollingService {
  private readonly options: PollingServiceOptions;
  private readonly cursorRepository: CursorRepository;

  constructor(options: PollingServiceOptions) {
    this.options = options;
    this.cursorRepository = new CursorRepository(options.cursorFile);
  }

  async run(): Promise<void> {
    await runPollLoop({
      client: this.options.client,
      pollLease: this.options.pollLease,
      loadCursor: () => this.cursorRepository.load(),
      saveCursor: cursor => this.cursorRepository.save(cursor),
      handleInbound: this.options.handleInbound,
      debug: this.options.debug,
      checkLoginTrigger: this.options.checkLoginTrigger,
      onLoginTriggered: this.options.onLoginTriggered,
      onSessionExpired: this.options.onSessionExpired,
      isPolling: this.options.isPolling,
      pollLeaseRetryMs: this.options.pollLeaseRetryMs,
    });
  }
}
