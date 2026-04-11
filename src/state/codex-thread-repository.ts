import { join } from 'node:path';
import { JsonFileStore } from './json-file.js';

export interface ThreadStateFile {
  version: 1;
  threads: Record<string, string>;
}

const DEFAULT_THREADS: ThreadStateFile = {
  version: 1,
  threads: {},
};

export class CodexThreadRepository {
  private readonly store: JsonFileStore<ThreadStateFile>;

  constructor(stateDir: string) {
    this.store = new JsonFileStore({
      filePath: join(stateDir, 'codex-threads.json'),
      defaults: DEFAULT_THREADS,
    });
  }

  load(): ThreadStateFile {
    return this.store.load();
  }

  save(state: ThreadStateFile): void {
    this.store.save(state);
  }
}
