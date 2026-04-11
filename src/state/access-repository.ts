import { join } from 'node:path';
import type { AccessConfig } from '../config/access.js';
import { JsonFileStore } from './json-file.js';

const DEFAULT_ACCESS_CONFIG: AccessConfig = {
  mode: 'pairing',
  allowedUsers: [],
  pendingUsers: {},
};

export class AccessRepository {
  private readonly store: JsonFileStore<AccessConfig>;

  constructor(stateDir: string) {
    this.store = new JsonFileStore({
      filePath: join(stateDir, 'access.json'),
      defaults: DEFAULT_ACCESS_CONFIG,
    });
  }

  load(): AccessConfig {
    return this.store.load();
  }

  save(config: AccessConfig): void {
    this.store.save(config);
  }
}
