import { request } from './api';
import { configSchema, type RuntimeConfig } from './contracts';

let flight: { expires: number; promise: Promise<RuntimeConfig> } | null = null;
export function runtimeConfig(): Promise<RuntimeConfig> {
  if (flight && flight.expires > Date.now()) return flight.promise;
  const current = { expires: Date.now() + 300_000, promise: request('/v1/config', null, configSchema) };
  flight = current;
  void current.promise.catch(() => { if (flight === current) flight = null; });
  return current.promise;
}
