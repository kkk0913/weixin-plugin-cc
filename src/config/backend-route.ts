import { BackendRouteRepository } from '../state/backend-route-repository.js';

export type BackendRoute = 'claude' | 'codex';

export interface BackendRouteConfig {
  defaultBackend: BackendRoute;
  chatBackends: Record<string, BackendRoute>;
}

export class BackendRouteControl {
  private readonly repository: BackendRouteRepository;
  private config: BackendRouteConfig;

  constructor(stateDir: string) {
    this.repository = new BackendRouteRepository(stateDir);
    this.config = this.load();
  }

  reload(): void {
    this.config = this.load();
  }

  getBackend(chatId: string): BackendRoute {
    return this.config.chatBackends[chatId] ?? this.config.defaultBackend;
  }

  setBackend(chatId: string, backend: BackendRoute): void {
    if (backend === this.config.defaultBackend) {
      delete this.config.chatBackends[chatId];
    } else {
      this.config.chatBackends[chatId] = backend;
    }
    this.save();
  }

  private load(): BackendRouteConfig {
    return this.repository.load();
  }

  private save(): void {
    this.repository.save(this.config);
  }
}
