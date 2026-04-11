import { join } from 'node:path';
import type { BackendRoute, BackendRouteConfig } from '../config/backend-route.js';
import { JsonFileStore } from './json-file.js';

const DEFAULT_BACKEND_ROUTE_CONFIG: BackendRouteConfig = {
  defaultBackend: 'claude',
  chatBackends: {},
};

export class BackendRouteRepository {
  private readonly store: JsonFileStore<BackendRouteConfig>;

  constructor(stateDir: string) {
    this.store = new JsonFileStore({
      filePath: join(stateDir, 'backend-route.json'),
      defaults: DEFAULT_BACKEND_ROUTE_CONFIG,
    });
  }

  load(): BackendRouteConfig {
    return this.store.load();
  }

  save(config: BackendRouteConfig): void {
    this.store.save(config);
  }
}
