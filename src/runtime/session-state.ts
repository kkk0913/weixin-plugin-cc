import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
  contextTokenFile?: string;
  getContextTokenScope?: () => string | undefined;
}

export class SessionState {
  private readonly mediaHandleTtlMs: number;
  private readonly contextTokenTtlMs: number;
  private readonly contextTokenFile?: string;
  private readonly getContextTokenScope?: () => string | undefined;
  private readonly mediaHandles = new Map<string, TimedMediaHandle>();
  private readonly contextTokens = new Map<string, ContextTokenEntry>();
  private readonly mediaHandleEvictionTimer: ReturnType<typeof setInterval>;
  private readonly contextTokenEvictionTimer: ReturnType<typeof setInterval>;
  private readonly contextTokenPersistDelayMs = 250;
  private contextTokenPersistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SessionStateOptions) {
    this.mediaHandleTtlMs = options.mediaHandleTtlMs;
    this.contextTokenTtlMs = options.contextTokenTtlMs;
    this.contextTokenFile = options.contextTokenFile;
    this.getContextTokenScope = options.getContextTokenScope;
    this.restoreContextTokens();

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
    this.contextTokens.set(this.makeContextTokenKey(userId), {
      token,
      expiresAt: Date.now() + this.contextTokenTtlMs,
    });
    this.schedulePersistContextTokens();
  }

  getContextToken(userId: string): string | undefined {
    const now = Date.now();
    const key = this.makeContextTokenKey(userId);
    const entry = this.contextTokens.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= now) {
      this.contextTokens.delete(key);
      this.persistContextTokensNow();
      return undefined;
    }
    entry.expiresAt = now + this.contextTokenTtlMs;
    return entry.token;
  }

  listContextTokenUsers(): string[] {
    this.pruneExpiredContextTokens();
    const scopePrefix = `${this.getCurrentScope()}:`;
    const users: string[] = [];
    for (const key of this.contextTokens.keys()) {
      if (key.startsWith(scopePrefix)) {
        users.push(key.slice(scopePrefix.length));
      }
    }
    return users;
  }

  dispose(): void {
    clearInterval(this.mediaHandleEvictionTimer);
    clearInterval(this.contextTokenEvictionTimer);
    if (this.contextTokenPersistTimer) {
      clearTimeout(this.contextTokenPersistTimer);
      this.contextTokenPersistTimer = null;
    }
    this.persistContextTokensNow();
  }

  private pruneExpiredMediaHandles(now = Date.now()): void {
    for (const [handle, entry] of this.mediaHandles) {
      if (entry.expiresAt <= now) {
        this.mediaHandles.delete(handle);
      }
    }
  }

  private pruneExpiredContextTokens(now = Date.now()): void {
    let changed = false;
    for (const [userId, entry] of this.contextTokens) {
      if (entry.expiresAt <= now) {
        this.contextTokens.delete(userId);
        changed = true;
      }
    }
    if (changed) {
      this.persistContextTokensNow();
    }
  }

  private makeContextTokenKey(userId: string): string {
    return `${this.getCurrentScope()}:${userId}`;
  }

  private getCurrentScope(): string {
    return this.getContextTokenScope?.()?.trim() || 'default';
  }

  private restoreContextTokens(): void {
    if (!this.contextTokenFile || !existsSync(this.contextTokenFile)) {
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.contextTokenFile, 'utf-8')) as Record<string, ContextTokenEntry>;
      const now = Date.now();
      for (const [key, value] of Object.entries(parsed ?? {})) {
        if (!value || typeof value.token !== 'string' || typeof value.expiresAt !== 'number') {
          continue;
        }
        if (value.expiresAt > now) {
          this.contextTokens.set(key, value);
        }
      }
    } catch {
      // Ignore malformed persisted token state.
    }
  }

  private schedulePersistContextTokens(): void {
    if (this.contextTokenPersistTimer) {
      return;
    }
    this.contextTokenPersistTimer = setTimeout(() => {
      this.contextTokenPersistTimer = null;
      this.persistContextTokensNow();
    }, this.contextTokenPersistDelayMs);
    this.contextTokenPersistTimer.unref?.();
  }

  private persistContextTokensNow(): void {
    if (!this.contextTokenFile) {
      return;
    }
    try {
      mkdirSync(dirname(this.contextTokenFile), { recursive: true });
      const data = Object.fromEntries(this.contextTokens.entries());
      writeFileSync(this.contextTokenFile, JSON.stringify(data, null, 2));
    } catch {
      // Ignore persistence failures; in-memory tokens still work.
    }
  }
}
