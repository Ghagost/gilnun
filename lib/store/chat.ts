import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMsg } from '../types';
import { idbJSON } from './idb';

type ChatState = {
  messages: ChatMsg[];
  busy: boolean;
  add: (m: ChatMsg) => void;
  patch: (id: string, p: Partial<ChatMsg>) => void;
  setBusy: (b: boolean) => void;
  clear: () => void;
};

export const useChat = create<ChatState>()(
  persist(
    set => ({
      messages: [],
      busy: false,
      add: m => set(s => ({ messages: [...s.messages, m].slice(-80) })),
      patch: (id, p) => set(s => ({ messages: s.messages.map(m => (m.id === id ? { ...m, ...p } : m)) })),
      setBusy: busy => set({ busy }),
      clear: () => set({ messages: [] }),
    }),
    {
      name: 'gilnun.chat',
      version: 1,
      storage: idbJSON,
      // Photos are not kept (size); pending answers are not restored.
      partialize: s => ({ messages: s.messages.filter(m => !m.pending).slice(-50).map(m => ({ ...m, image: null })) }) as unknown as ChatState,
    },
  ),
);

export const chat = () => useChat.getState();
