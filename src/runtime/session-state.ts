import type { CDNMedia } from '../weixin/types.js';

type TimedMediaHandle = {
  media: CDNMedia;
  expiresAt: number;
};

type ContextTokenEntry = {
  token: string;
  expiresAt: number;
};

export interface SessionStateOptions {
  mediaHandleTtlMs: number;
  contextTokenTtlMs: number;
}

export class SessionState {
  private readonly mediaHandleTtlMs: number;
  private readonly contextTokenTtlMs: number;
  private readonly mediaHandles = new Map<string, TimedMediaHandle>();
  private readonly contextTokens = new Map<string, ContextTokenEntry>();
  private readonly mediaHandleEvictionTimer: ReturnType<typeof setInterval>;
  private readonly contextTokenEvictionTimer: ReturnType<typeof setInterval>;

  constructor(options: SessionStateOptions) {
    this.mediaHandleTtlMs = options.mediaHandleTtlMs;
    this.contextTokenTtlMs = options.contextTokenTtlMs;

    this.mediaHandleEvictionTimer = setInterval(() => {
      this.pruneExpiredMediaHandles();
    }, this.mediaHandleTtlMs);
    this.mediaHandleEvictionTimer.unref();

    this.contextTokenEvictionTimer = setInterval(() => {
      this.pruneExpiredContextTokens();
    }, this.contextTokenTtlMs);
    this.contextTokenEvictionTimer.unref();
  }

  storeMediaHandle(handle: string, media: CDNMedia): void {
    this.pruneExpiredMediaHandles();
    this.mediaHandles.set(handle, { media, expiresAt: Date.now() + this.mediaHandleTtlMs });
  }

  takeMediaHandle(handle: string): CDNMedia | null {
    this.pruneExpiredMediaHandles();
    const entry = this.mediaHandles.get(handle);
    if (!entry) {
      return null;
    }
    this.mediaHandles.delete(handle);
    return entry.media;
  }

  setContextToken(userId: string, token: string): void {
    this.pruneExpiredContextTokens();
    this.contextTokens.set(userId, { token, expiresAt: Date.now() + this.contextTokenTtlMs });
  }

  getContextToken(userId: string): string | undefined {
    const now = Date.now();
    const entry = this.contextTokens.get(userId);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= now) {
      this.contextTokens.delete(userId);
      return undefined;
    }
    entry.expiresAt = now + this.contextTokenTtlMs;
    return entry.token;
  }

  dispose(): void {
    clearInterval(this.mediaHandleEvictionTimer);
    clearInterval(this.contextTokenEvictionTimer);
  }

  private pruneExpiredMediaHandles(now = Date.now()): void {
    for (const [handle, entry] of this.mediaHandles) {
      if (entry.expiresAt <= now) {
        this.mediaHandles.delete(handle);
      }
    }
  }

  private pruneExpiredContextTokens(now = Date.now()): void {
    for (const [userId, entry] of this.contextTokens) {
      if (entry.expiresAt <= now) {
        this.contextTokens.delete(userId);
      }
    }
  }
}
