type Entry = {
  expires: number;
  staleUntil: number;
  value?: unknown;
  hasValue: boolean;
  promise?: Promise<unknown>;
};

// An in-memory, auth-scoped cache. No personalized data is persisted to storage.
export class PageDataCache {
  private entries = new Map<string, Entry>();
  private scope: string | null = null;
  private generation = 0;
  reset(scope: string | null = null) {
    this.scope = scope;
    this.generation++;
    this.entries.clear();
  }
  isCurrent(scope: string | null) { return scope === this.scope; }
  /** Refresh one read without throwing away the other tabs' data. */
  invalidate(scope: string | null, path?: string) {
    if (!this.isCurrent(scope)) return;
    if (path === undefined) {
      this.reset(scope);
      return;
    }
    const entry = this.entries.get(path);
    if (entry) {
      // Replace the entry so an older in-flight response cannot overwrite a
      // confirmed mutation or a refresh requested after it started.
      this.entries.set(path, { ...entry, expires: 0, promise: undefined });
    }
  }
  /** Apply a server-confirmed change and revalidate the rest on the next read. */
  update<T>(scope: string | null, path: string, updater: (value: T | undefined) => T | undefined) {
    if (!this.isCurrent(scope)) return;
    const entry = this.entries.get(path);
    const value = updater(entry?.hasValue ? entry.value as T : undefined);
    if (value === undefined) {
      this.entries.delete(path);
      return;
    }
    this.entries.set(path, {
      value, hasValue: true, expires: 0,
      staleUntil: entry?.staleUntil ?? Date.now() + 300_000,
    });
  }
  private select(scope: string | null) {
    if (scope !== this.scope) this.reset(scope);
  }
  private ttl(path: string) {
    if (path.startsWith('workspace:')) {
      // Settings, signed URLs, personal help, and admin data must always be freshly read.
      try {
        const request = JSON.parse(path.slice('workspace:'.length));
        if (request.action === 'design_directory') return 60_000;
        if (['home_snapshot', 'catalog', 'source_overview', 'design_dashboard', 'content_notifications'].includes(request.action)) return 30_000;
        // History is consent-sensitive and is never prefetched or cached.
        if (request.action === 'saved_list' && request.p?.kind !== 'history') return 30_000;
        return 0;
      }
      catch { return 0; }
    }
    if (path.startsWith('calendar-data:')) return 60_000;
    if (path.startsWith('calendar-coverage:')) return 30_000;
    if (path.startsWith('/market?')) return 30_000;
    if (/^\/v1\/(feed)([/?]|$)/.test(path)) return 15_000;
    if (/^\/v1\/(companies|watchlist|portfolio|calendar)([/?]|$)/.test(path)) return 60_000;
    if (/^\/v1\/(notifications)([/?]|$)/.test(path)) return 30_000;
    return 0;
  }
  peek<T>(scope: string | null, path: string): T | undefined {
    this.select(scope);
    const entry = this.entries.get(path);
    return entry?.hasValue && entry.staleUntil > Date.now() ? entry.value as T : undefined;
  }
  isFresh(scope: string | null, path: string) {
    this.select(scope);
    const entry = this.entries.get(path);
    return Boolean(entry?.hasValue && entry.expires > Date.now());
  }
  async request<T>(scope: string | null, path: string, method: string, load: () => Promise<T>): Promise<T> {
    this.select(scope);
    if (method !== 'GET') {
      const value = await load();
      if (this.isCurrent(scope)) this.reset(scope);
      return value;
    }
    const ttl = this.ttl(path);
    if (ttl === 0) return load();
    const now = Date.now();
    let entry = this.entries.get(path);
    if (entry?.promise) return entry.promise as Promise<T>;
    if (entry?.hasValue && entry.expires > now) return entry.value as T;
    const capturedGeneration = this.generation;
    if (!entry) {
      if (this.entries.size >= 100) this.entries.delete(this.entries.keys().next().value!);
      entry = { expires: 0, staleUntil: 0, hasValue: false };
      this.entries.set(path, entry);
    }
    const capturedEntry = entry;
    const promise = Promise.resolve().then(load);
    entry.promise = promise;
    try {
      const value = await promise;
      if (capturedGeneration === this.generation && this.entries.get(path) === capturedEntry) {
        capturedEntry.value = value;
        capturedEntry.hasValue = true;
        capturedEntry.expires = Date.now() + ttl;
        capturedEntry.staleUntil = Date.now() + (path.startsWith('/market?') ? ttl : 300_000);
      }
      return value;
    } catch (error) {
      if (capturedGeneration === this.generation && this.entries.get(path) === capturedEntry && !capturedEntry.hasValue) this.entries.delete(path);
      throw error;
    } finally {
      if (capturedGeneration === this.generation && this.entries.get(path) === capturedEntry && capturedEntry.promise === promise) capturedEntry.promise = undefined;
    }
  }
}
export const pageDataCache = new PageDataCache();
