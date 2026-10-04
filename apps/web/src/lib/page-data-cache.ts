type Entry = { expires: number; promise: Promise<unknown> };

// Memory only, partitioned by the current bearer token. Never persist financial/user data.
export class PageDataCache {
  private entries = new Map<string, Entry>();
  private scope: string | null = null;
  private generation = 0;

  reset(scope: string | null = null) {
    this.scope = scope;
    this.generation++;
    this.entries.clear();
  }

  async request<T>(scope: string | null, path: string, method: string, load: () => Promise<T>): Promise<T> {
    if (scope !== this.scope) this.reset(scope);
    if (method !== 'GET') {
      this.reset(scope);
      const result = await load();
      if (this.scope === scope) this.reset(scope);
      return result;
    }
    // Ops, downloads and diagnostics must remain current. Cache primary page data briefly.
    const ttl = path.startsWith('/market?') ? 30_000 :
      /^\/v1\/(feed|companies|watchlist|portfolio|calendar)([/?]|$)/.test(path) ? 15_000 : 0;
    if (!ttl) return load();
    const found = this.entries.get(path);
    if (found && found.expires > Date.now()) return found.promise as Promise<T>;
    const generation = this.generation;
    const entry: Entry = { expires: Date.now() + ttl, promise: Promise.resolve().then(load) };
    // Bound retained responses even during repeated searches.
    if (this.entries.size >= 100) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(path, entry);
    try { return await entry.promise as T; }
    catch (error) {
      if (generation === this.generation && this.entries.get(path) === entry) this.entries.delete(path);
      throw error;
    }
  }
}

export const pageDataCache = new PageDataCache();
