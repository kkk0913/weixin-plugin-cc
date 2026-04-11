import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class LoginTriggerRepository {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  consume(): boolean {
    try {
      if (existsSync(this.filePath)) {
        unlinkSync(this.filePath);
        return true;
      }
    } catch {
      // Ignore trigger read failures.
    }
    return false;
  }

  write(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    writeFileSync(tmp, 'login\n', { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }
}
