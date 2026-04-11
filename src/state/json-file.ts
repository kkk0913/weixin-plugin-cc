import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface JsonFileStoreOptions<T> {
  filePath: string;
  defaults: T;
}

export class JsonFileStore<T> {
  private readonly filePath: string;
  private readonly defaults: T;

  constructor(options: JsonFileStoreOptions<T>) {
    this.filePath = options.filePath;
    this.defaults = options.defaults;
  }

  load(): T {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        return { ...this.defaults, ...JSON.parse(raw) } as T;
      }
    } catch {
      // Fall back to defaults on missing or corrupted files.
    }

    const value = { ...this.defaults } as T;
    this.save(value);
    return value;
  }

  save(value: T): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }
}
