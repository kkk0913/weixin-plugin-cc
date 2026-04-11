import { sleep } from '../util/helpers.js';
import { AccountRepository } from '../state/account-repository.js';
import { LoginTriggerRepository } from '../state/login-trigger-repository.js';
import type { WeixinClient } from '../weixin/api.js';
import type { AccountConfig } from '../weixin/types.js';

export interface LoginManagerOptions {
  accountFile: string;
  loginTriggerFile: string;
  client: WeixinClient;
}

export interface PollRuntimeState {
  sessionExpired: boolean;
  polling: boolean;
}

export class LoginManager {
  private readonly client: WeixinClient;
  private readonly accountRepository: AccountRepository;
  private readonly loginTriggerRepository: LoginTriggerRepository;
  private currentQrCode: string | null = null;
  private isPollingQr = false;

  constructor(options: LoginManagerOptions) {
    this.client = options.client;
    this.accountRepository = new AccountRepository(options.accountFile);
    this.loginTriggerRepository = new LoginTriggerRepository(options.loginTriggerFile);
  }

  loadAccount(): AccountConfig | null {
    return this.accountRepository.load();
  }

  saveAccount(config: AccountConfig): void {
    this.accountRepository.save(config);
  }

  clearAccount(): void {
    this.accountRepository.clear();
  }

  checkLoginTrigger(): boolean {
    return this.loginTriggerRepository.consume();
  }

  async waitForLoginTrigger(): Promise<void> {
    process.stderr.write(
      '\n╔══════════════════════════════════════════════════════════╗\n' +
      '║  WeChat channel: waiting for login                       ║\n' +
      '╠══════════════════════════════════════════════════════════╣\n' +
      '║  Run /weixin:configure login to start login flow         ║\n' +
      '╚══════════════════════════════════════════════════════════╝\n\n',
    );

    while (!this.checkLoginTrigger()) {
      await sleep(1000);
    }
  }

  async startBrowserLogin(): Promise<void> {
    if (this.isPollingQr) {
      process.stderr.write('weixin channel: login already in progress\n');
      return;
    }

    this.isPollingQr = true;
    const maxRetries = 3;
    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        const { qrcode, qrcodeUrl } = await this.client.getLoginQr();
        this.currentQrCode = qrcode;
        process.stderr.write(`\n╔══════════════════════════════════════════════════════════╗\n`);
        process.stderr.write(`║  WeChat Login Required                                    ║\n`);
        process.stderr.write(`╠══════════════════════════════════════════════════════════╣\n`);
        process.stderr.write(`║  Open this link in your browser to login:                ║\n`);
        process.stderr.write(`║  ${qrcodeUrl.padEnd(56)}║\n`);
        process.stderr.write(`╚══════════════════════════════════════════════════════════╝\n\n`);

        for (let i = 0; i < 480; i++) {
          await sleep(1000);
          if (!this.currentQrCode) {
            this.isPollingQr = false;
            return;
          }

          const result = await this.client.checkQrStatus(this.currentQrCode);
          if (result.status === 'scaned') {
            process.stderr.write('weixin channel: QR scanned — confirm on your phone\n');
            continue;
          }
          if (result.config) {
            this.saveAccount(result.config);
            this.currentQrCode = null;
            this.isPollingQr = false;
            process.stderr.write('weixin channel: login successful, session saved\n');
            return;
          }
          if (result.status === 'expired') {
            process.stderr.write('weixin channel: QR expired, generating new one...\n');
            break;
          }
        }
      } catch (err) {
        process.stderr.write(`weixin channel: login attempt ${retry + 1} failed: ${err}\n`);
        if (retry === maxRetries - 1) {
          this.isPollingQr = false;
          throw err;
        }
        await sleep(2000);
      }
    }

    this.isPollingQr = false;
    throw new Error('QR login timed out after retries');
  }

  async runWithAutoReLogin(
    runPollLoop: () => Promise<void>,
    state: PollRuntimeState,
  ): Promise<void> {
    while (true) {
      state.sessionExpired = false;
      state.polling = true;
      await runPollLoop();

      if (!state.sessionExpired && !this.checkLoginTrigger()) {
        break;
      }

      if (state.sessionExpired) {
        process.stderr.write('weixin channel: attempting automatic re-login...\n');
      }

      try {
        await this.startBrowserLogin();
        process.stderr.write('weixin channel: re-login successful, resuming...\n');
      } catch (err) {
        process.stderr.write(`weixin channel: automatic re-login failed: ${err}\n`);
        this.clearAccount();
        process.stderr.write('weixin channel: cleared expired session\n');
        break;
      }
    }
  }
}
