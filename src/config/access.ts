import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

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

const DEFAULT_CONFIG: AccessConfig = {
  mode: 'pairing',
  allowedUsers: [],
  pendingUsers: {},
};

export class AccessControl {
  private config: AccessConfig;
  private configPath: string;

  constructor(stateDir: string) {
    this.configPath = join(stateDir, 'access.json');
    this.config = this.load();
  }

  get mode(): AccessMode {
    return this.config.mode;
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
    const code = randomBytes(3).toString('hex');
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
    try {
      if (existsSync(this.configPath)) {
        const raw = readFileSync(this.configPath, 'utf-8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch {
      // corrupted config — use defaults
    }
    const defaults = { ...DEFAULT_CONFIG };
    this.config = defaults;
    this.save();
    return defaults;
  }

  private save(): void {
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }
}
