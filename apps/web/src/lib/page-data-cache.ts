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
  private select(scope: string | null) {
    if (scope !== this.scope) this.reset(scope);
  }
  private ttl(path: string) {
    if (path.startsWith('workspace:')) {
      // Settings, signed URLs, personal help, and admin data must always be freshly read.
      try { return JSON.parse(path.slice('workspace:'.length)).action === 'catalog' ? 30_000 : 0; }
      catch { return 0; }
    }
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
