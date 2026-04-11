import type { ClaudeBridgeServer } from './bridge-server.js';
import type { BackendManager } from './backend-manager.js';
import type { PollLeaseControl } from '../config/poll-owner.js';
import type { SessionState } from './session-state.js';

export interface LifecycleState {
  polling: boolean;
  shuttingDown: boolean;
}

export interface DaemonLifecycleOptions {
  state: LifecycleState;
  pollLease: PollLeaseControl;
  sessionState: SessionState;
  getBridgeServer: () => ClaudeBridgeServer | null;
  backendManager: BackendManager;
  debug: (msg: string) => void;
}

export class DaemonLifecycle {
  private readonly options: DaemonLifecycleOptions;

  constructor(options: DaemonLifecycleOptions) {
    this.options = options;
  }

  installSignalHandlers(): void {
    process.on('SIGTERM', () => {
      void this.shutdown().finally(() => process.exit(0));
    });
    process.on('SIGINT', () => {
      void this.shutdown().finally(() => process.exit(0));
    });
    process.stdin.on('end', () => {
      void this.shutdown().finally(() => process.exit(0));
    });
    process.stdin.on('close', () => {
      void this.shutdown().finally(() => process.exit(0));
    });
  }

  async shutdown(): Promise<void> {
    if (this.options.state.shuttingDown) {
      return;
    }
    this.options.state.shuttingDown = true;
    this.options.state.polling = false;
    this.options.pollLease.release();
    this.options.getBridgeServer()?.closeAllClients();
    this.options.sessionState.dispose();
    await this.options.backendManager.stop();
    await this.options.getBridgeServer()?.stop().catch(err => {
      this.options.debug(`bridge stop failed: ${err}`);
    });
    process.stderr.write('weixin channel: shutting down\n');
  }
}
