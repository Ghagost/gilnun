import { createJSONStorage, type StateStorage } from 'zustand/middleware';
import { del, get, set } from 'idb-keyval';

/** IndexedDB-backed storage for zustand persist, with a localStorage fallback (private mode, old browsers). */
const idbStorage: StateStorage = {
  getItem: async name => {
    try {
      const v = await get<string>(name);
      if (v != null) return v;
    } catch { /* fall through */ }
    try { return localStorage.getItem(name); } catch { return null; }
  },
  setItem: async (name, value) => {
    try { await set(name, value); return; } catch { /* fall through */ }
    try { localStorage.setItem(name, value); } catch { /* quota or disabled */ }
  },
  removeItem: async name => {
    try { await del(name); } catch { /* ignore */ }
    try { localStorage.removeItem(name); } catch { /* ignore */ }
  },
};

export const idbJSON = createJSONStorage(() => idbStorage);

export const localJSON = createJSONStorage(() => {
  try {
    const t = '__gl_t';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  }
});

/* ---------- binary blobs (reservation photos) ---------- */
export async function putBlob(id: string, blob: Blob): Promise<void> {
  await set(`blob:${id}`, blob);
}
export async function getBlob(id: string): Promise<Blob | undefined> {
  try { return await get<Blob>(`blob:${id}`); } catch { return undefined; }
}
export async function delBlob(id: string): Promise<void> {
  try { await del(`blob:${id}`); } catch { /* ignore */ }
}
