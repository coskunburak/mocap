// IMPORTANT: Some TS setups treat MMKV exports as type-only from d.ts.
// Use require() to guarantee a runtime value.
let createMMKV: typeof import("react-native-mmkv").createMMKV;
try {
  ({ createMMKV } = require("react-native-mmkv") as { createMMKV: typeof import("react-native-mmkv").createMMKV });
  // eslint-disable-next-line no-console
  console.log("[Entry] MMKV loaded");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[Entry] MMKV failed to load", e);
  throw e;
}

export const storage = createMMKV({
  id: "mocap-storage",
});

export function setJson<T>(key: string, value: T) {
  storage.set(key, JSON.stringify(value));
}

export function getJson<T>(key: string): T | undefined {
  const s: string | undefined = storage.getString(key);
  if (!s) return undefined;
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
}

export function remove(key: string) {
  storage.delete(key);
}

export function exists(key: string) {
  return storage.contains(key);
}
