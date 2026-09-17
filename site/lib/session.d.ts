// lib/session.js — the last batch kept in this browser's IndexedDB (opt-in via mount({ persist: true })).
import type { TraceOptions } from './vectorizer.js';
export interface SavedSession { items: { file: Blob; name: string; options: TraceOptions }[]; active: number; savedAt: number }
export const SESSION_TTL: number;
export function saveSession(data: Omit<SavedSession, 'savedAt'>): Promise<boolean>;
export function loadSession(): Promise<SavedSession | null>;
export function clearSession(): Promise<void>;
