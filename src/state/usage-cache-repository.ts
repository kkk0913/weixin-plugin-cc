import { JsonFileStore } from './json-file.js';

export interface LocalUsageCache {
  planName: string;
  fiveHour: number | null;
  sevenDay: number | null;
  fiveHourResetAt: string | null;
  sevenDayResetAt: string | null;
  timestamp: number;
}

const DEFAULT_USAGE_CACHE: LocalUsageCache = {
  planName: '',
  fiveHour: null,
  sevenDay: null,
  fiveHourResetAt: null,
  sevenDayResetAt: null,
  timestamp: 0,
};

export class UsageCacheRepository {
  private readonly store: JsonFileStore<LocalUsageCache>;

  constructor(filePath: string) {
    this.store = new JsonFileStore({
      filePath,
      defaults: DEFAULT_USAGE_CACHE,
    });
  }

  load(): LocalUsageCache | null {
    try {
      const value = this.store.load();
      if (!value.planName && value.timestamp === 0) {
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }

  save(cache: LocalUsageCache): void {
    this.store.save(cache);
  }
}
