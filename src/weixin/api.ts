import type {
  AccountConfig,
  BaseInfo,
  GetConfigReq,
  GetConfigResp,
  GetUpdatesReq,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  LoginQrResp,
  MessageItem,
  QrStatusResp,
  SendMessageReq,
  SendMessageResp,
  SendTypingReq,
} from './types.js';
import { encodeVersion, randomUinBase64, createBaseInfo } from '../util/helpers.js';

const BASE_URL = 'https://ilinkai.weixin.qq.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const LONG_POLL_TIMEOUT_MS = 35_000;
const APP_ID = 'bot';
const APP_VERSION = '2.1.3';

export interface WeixinClientOptions {
  baseUrl?: string;
  timeout?: number;
}

export class WeixinClient {
  private config: AccountConfig | null = null;
  private baseUrl: string;
  private timeout: number;
  private baseInfo: BaseInfo;
  private clientVersion: number;

  constructor(opts: WeixinClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
    this.baseInfo = createBaseInfo(APP_VERSION);
    this.clientVersion = encodeVersion(APP_VERSION);
  }

  get isAuthed(): boolean {
    return this.config !== null;
  }

  get userId(): string | null {
    return this.config?.userId ?? null;
  }

  get token(): string | null {
    return this.config?.token ?? null;
  }

  /**
   * Authenticate with an existing token (from saved config).
   */
  setAuth(config: AccountConfig): void {
    this.config = config;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  /**
   * Get QR code for login. Returns QR code and URL for browser login.
   */
  async getLoginQr(): Promise<{ qrcode: string; qrcodeUrl: string }> {
    const qrResp = await this.get<LoginQrResp>('/ilink/bot/get_bot_qrcode?bot_type=3', 5000);
    if (qrResp.ret !== 0) {
      throw new Error(`Failed to get QR code: ${qrResp.errmsg} (${qrResp.ret})`);
    }
    return {
      qrcode: qrResp.qrcode,
      qrcodeUrl: qrResp.qrcode_img_content,
    };
  }

  /**
   * Check QR status. Returns status and credentials if confirmed.
   */
  async checkQrStatus(qrcode: string): Promise<{
    status: string;
    config?: AccountConfig;
  }> {
    const status = await this.get<QrStatusResp>(
      `/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      35000,
    );

    if (status.status === 'confirmed' && status.bot_token) {
      const config: AccountConfig = {
        token: status.bot_token,
        baseUrl: status.baseurl ?? this.baseUrl,
        userId: status.ilink_user_id!,
        ilinkBotId: status.ilink_bot_id!,
        qrcode,
        createdAt: Date.now(),
        expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds (typical WeChat session)
      };
      this.config = config;
      if (status.baseurl) {
        this.baseUrl = status.baseurl;
      }
      return { status: status.status, config };
    }

    if (status.status === 'scaned_but_redirect' && status.redirect_host) {
      this.baseUrl = `https://${status.redirect_host}`;
      return { status: 'scaned' };
    }

    return { status: status.status };
  }

  /**
   * Full QR login flow: get QR → poll status → return AccountConfig.
   * Retries up to 3 times on QR expiration.
   * Throws on timeout or error.
   * @deprecated Use getLoginQr + pollQrStatus for browser-based login
   */
  async loginWithQr(onQr?: (data: { qrUrl: string; status?: string }) => void | Promise<void>): Promise<AccountConfig> {
    const maxRetries = 3;

    for (let retry = 0; retry < maxRetries; retry++) {
      // Step 1: get QR code
      const { qrcode, qrcodeUrl } = await this.getLoginQr();

      // qrcode_img_content is actually the scannable QR URL (not a PNG image)
      if (onQr) {
        await onQr({ qrUrl: qrcodeUrl });
      }

      // Step 2: poll for scan/confirm
      const maxAttempts = 480; // 8 minutes at 1s intervals
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const result = await this.checkQrStatus(qrcode);

        if (result.config) {
          return result.config;
        }

        if (result.status === 'scaned') {
          if (onQr) await onQr({ qrUrl: '', status: 'scaned' });
          continue;
        }

        if (result.status === 'expired') {
          break; // break inner loop to retry with new QR
        }
      }
      // QR expired — loop will retry with a fresh QR
    }
    throw new Error('QR login timed out after retries');
  }

  /**
   * Long-poll for new messages.
   */
  async getUpdates(cursor: string = ''): Promise<GetUpdatesResp> {
    const body: GetUpdatesReq = {
      get_updates_buf: cursor,
      base_info: this.baseInfo,
    };
    return this.post<GetUpdatesResp>(
      '/ilink/bot/getupdates',
      body,
      LONG_POLL_TIMEOUT_MS,
    );
  }

  /**
   * Send a message to a user.
   */
  async sendMessage(
    toUserId: string,
    contextToken: string,
    item: MessageItem,
  ): Promise<SendMessageResp> {
    return this.sendMessageItems(toUserId, contextToken, [item]);
  }

  /**
   * Send a message with multiple items to a user.
   */
  async sendMessageItems(
    toUserId: string,
    contextToken: string,
    items: MessageItem[],
  ): Promise<SendMessageResp> {
    const { randomUUID } = await import('node:crypto');
    const msg: Record<string, unknown> = {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: randomUUID(),
      message_type: 2, // BOT
      message_state: 2, // FINISH
      item_list: items,
    };
    if (contextToken) {
      msg.context_token = contextToken;
    }
    const body: SendMessageReq = { msg: msg as any, base_info: this.baseInfo };
    const resp = await this.post<SendMessageResp>('/ilink/bot/sendmessage', body);
    if (resp.ret != null && resp.ret !== 0) {
      throw new Error(`sendMessage failed: ${resp.errmsg} (${resp.ret})`);
    }
    return resp;
  }

  /**
   * Send typing indicator.
   */
  async sendTyping(ilinkUserId: string, typingTicket: string): Promise<void> {
    const body: SendTypingReq = {
      ilink_user_id: ilinkUserId,
      typing_ticket: typingTicket,
      status: 1, // TYPING
    };
    await this.post('/ilink/bot/sendtyping', body);
  }

  /**
   * Get config (typing ticket).
   */
  async getConfig(ilinkUserId: string, contextToken?: string): Promise<GetConfigResp> {
    const body: GetConfigReq = {
      ilink_user_id: ilinkUserId,
      context_token: contextToken,
      base_info: this.baseInfo,
    };
    return this.post<GetConfigResp>('/ilink/bot/getconfig', body);
  }

  /**
   * Get upload URL for CDN media.
   */
  async getUploadUrl(req: GetUploadUrlReq): Promise<GetUploadUrlResp> {
    return this.post<GetUploadUrlResp>('/ilink/bot/getuploadurl', {
      ...req,
      base_info: this.baseInfo,
    });
  }

  // ─── Internal HTTP ──────────────────────────────────────────────

  private buildHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'iLink-App-Id': APP_ID,
      'iLink-App-ClientVersion': String(this.clientVersion),
      'X-WECHAT-UIN': randomUinBase64(),
    };
    const t = token ?? this.config?.token;
    if (t) {
      headers['Authorization'] = `Bearer ${t}`;
    }
    return headers;
  }

  private async get<T>(path: string, timeout?: number): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout ?? this.timeout);

    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      return (await resp.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async post<T>(
    path: string,
    body: unknown,
    timeout?: number,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout ?? this.timeout);
    const jsonBody = JSON.stringify(body);
    const headers = this.buildHeaders();
    headers['Content-Length'] = String(Buffer.byteLength(jsonBody, 'utf-8'));

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: jsonBody,
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      return (await resp.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
