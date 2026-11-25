/**
 * Values of the per-integration switches (registry.ts), stored on the phone like settings.
 * A switch nobody touched has its registry default.
 */
import { INTEGRATIONS } from './registry';

export type KvStore = { get(key: string): string | null; set(key: string, value: string): void };

const KEY = 'integrations.v1'; // gitleaks:allow (storage key name, not a secret)
type Values = Record<string, Record<string, boolean>>;

let store: KvStore | null = null;
let cache: Values | null = null;
const listeners = new Set<() => void>();

function defaultStore(): KvStore {
  // Loaded lazily so plain logic tests don't need the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const native = require('../../modules/sidekick-native').default;
  return { get: (k) => native.kvGet(k), set: (k, v) => native.kvSet(k, v) };
}

/** Tests: use an in-memory store. */
export function setPrefsStore(s: KvStore | null) {
  store = s;
  cache = null;
}

function values(): Values {
  if (cache) return cache;
  store ??= defaultStore();
  try {
    cache = JSON.parse(store.get(KEY) ?? '{}') as Values;
  } catch {
    cache = {};
  }
  return cache;
}

export function isOn(integrationId: string, switchId: string): boolean {
  const saved = values()[integrationId]?.[switchId];
  if (saved !== undefined) return saved;
  const sw = INTEGRATIONS.find((i) => i.id === integrationId)?.switches.find(
    (s) => s.id === switchId,
  );
  return sw?.default ?? false;
}

export function setSwitch(integrationId: string, switchId: string, on: boolean) {
  const v = values();
  cache = { ...v, [integrationId]: { ...v[integrationId], [switchId]: on } };
  store!.set(KEY, JSON.stringify(cache));
  listeners.forEach((l) => l());
}

export function onPrefsChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
