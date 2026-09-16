import type { TraceResult, VariantId } from './vectorizer.js';
// lib/ui.js
export interface UsePayload { name: string; background: string | null; colors: string[]; fidelity: number; variants: { id: VariantId; label: string; svg: string }[]; result: TraceResult }
export function mount(root: HTMLElement, opts?: { lang?: 'ar' | 'en'; hostActionLabel?: string; onUse?: (p: UsePayload) => void; onResult?: (r: TraceResult) => void }): { setLang(l: 'ar' | 'en'): void; destroy(): void };
export function supported(): boolean;
