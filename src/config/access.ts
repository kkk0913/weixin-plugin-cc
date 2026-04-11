import { randomBytes } from 'node:crypto';
import { AccessRepository } from '../state/access-repository.js';

export type AccessMode = 'pairing' | 'allowlist' | 'disabled';

export interface AccessConfig {
  mode: AccessMode;
  allowedUsers: string[]; // user IDs that are allowed
  pendingUsers: Record<string, string>; // userId → pairingCode
}

export type GateResult =
  | { action: 'deliver' }
  | { action: 'drop' }
  | { action: 'pair'; code: string };

export class AccessControl {
  private config: AccessConfig;
  private readonly repository: AccessRepository;

  constructor(stateDir: string) {
    this.repository = new AccessRepository(stateDir);
    this.config = this.load();
  }

  get mode(): AccessMode {
    return this.config.mode;
  }

  get allowedUsers(): string[] {
    return [...this.config.allowedUsers];
  }

  /**
   * Reload config from disk (for cross-process consistency).
   */
  reload(): void {
    this.config = this.load();
  }

  /**
   * Check whether a message from this user should be delivered.
   */
  gate(userId: string): GateResult {
    if (this.config.mode === 'disabled') {
      return { action: 'drop' };
    }

    if (this.config.allowedUsers.includes(userId)) {
      return { action: 'deliver' };
    }

    if (this.config.mode === 'allowlist') {
      return { action: 'drop' };
    }

    // Pairing mode
    if (this.config.pendingUsers[userId]) {
      return { action: 'pair', code: this.config.pendingUsers[userId] };
    }

    // New user — generate pairing code
    const code = randomBytes(5).toString('hex');
    this.config.pendingUsers[userId] = code;
    this.save();
    return { action: 'pair', code };
  }

  /**
   * Approve a pending user by pairing code.
   */
  approve(code: string): string | null {
    for (const [userId, pending] of Object.entries(this.config.pendingUsers)) {
      if (pending === code) {
        this.config.allowedUsers.push(userId);
        delete this.config.pendingUsers[userId];
        this.save();
        return userId;
      }
    }
    return null;
  }

  /**
   * Remove a user from the allowlist.
   */
  revoke(userId: string): boolean {
    const idx = this.config.allowedUsers.indexOf(userId);
    if (idx >= 0) {
      this.config.allowedUsers.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  private load(): AccessConfig {
    return this.repository.load();
  }

  private save(): void {
    this.repository.save(this.config);
  }
}
