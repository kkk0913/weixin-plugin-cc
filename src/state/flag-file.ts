import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class FlagFile {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  isEnabled(): boolean {
    return existsSync(this.filePath);
  }

  enable(contents = '1\n'): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    writeFileSync(tmp, contents, { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }

  disable(): void {
    try {
      unlinkSync(this.filePath);
    } catch {
      // Ignore cleanup failures.
    }
  }
}
