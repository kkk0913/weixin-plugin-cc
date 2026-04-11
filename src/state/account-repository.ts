import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccountConfig } from '../weixin/types.js';

export class AccountRepository {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): AccountConfig | null {
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8')) as AccountConfig;
    } catch {
      return null;
    }
  }

  save(config: AccountConfig): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }

  clear(): void {
    try {
      unlinkSync(this.filePath);
    } catch {
      // Ignore cleanup failures.
    }
  }
}
