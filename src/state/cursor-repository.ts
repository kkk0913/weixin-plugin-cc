import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class CursorRepository {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): string {
    try {
      return readFileSync(this.filePath, 'utf-8').trim();
    } catch {
      return '';
    }
  }

  save(cursor: string): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, cursor, { mode: 0o600 });
    } catch {
      // Ignore cursor persistence failures.
    }
  }
}
