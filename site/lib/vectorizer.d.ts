// Types for hosts written in TypeScript (e.g. Brand Kit Builder).
export type VariantId = 'color-on-background' | 'color-transparent' | 'color-for-light-backgrounds' | 'color-for-dark-backgrounds' | 'mono-black' | 'mono-white';
export interface Variant { id: VariantId; fills?: string[]; mono?: string; bg?: string; preview: string; padded?: boolean }
export interface TraceWarning { code: 'fewFlat' | 'tooManyColors' | 'unexplained' | 'smallSource' | 'smallParts' | 'lowFidelity'; [k: string]: unknown }
export interface TraceOptions { background?: 'auto' | 'transparent' | string; colors?: string[] | null; fillEnclosed?: boolean; maxColors?: number }
export interface TraceResult {
  source: { width: number; height: number; name: string };
  crop: [number, number, number, number]; width: number; height: number; scale: number; W: number; H: number; transform: string;
  background: string | null; colors: string[]; areas: number[]; layers: string[]; monoLayer: string; monoKnockout: boolean;
  variants: Variant[]; warnings: TraceWarning[]; fidelity: number; ms: number; options: TraceOptions;
  cropPixels: Uint8ClampedArray; diffMap: Uint8ClampedArray;
}
export type FileError = { code: 'noFile' | 'alreadyVector' | 'badType' | 'tooLarge' | 'tooManyPixels' | 'unreadable'; mb?: number };

// lib/vectorizer.js
export const LIMITS: { maxFileBytes: number; maxSourcePixels: number; maxWorkPixels: number; types: string[] };
export function checkFile(file: Blob): Promise<FileError | null>;
export function vectorize(file: Blob, options?: TraceOptions, onProgress?: (step: string, pct: number) => void): Promise<TraceResult>;
export function cancel(): void;
export function buildSVG(r: TraceResult, v: Variant, o?: { title?: string }): string;
export function previewSVG(r: TraceResult, v: Pick<Variant, 'fills' | 'mono'>, label?: string): string;
export function toPDF(svg: string): Promise<Uint8Array>;
export function toEPS(r: TraceResult, v: Variant, o?: { title?: string }): string;
export function toPNG(svg: string, width: number): Promise<Uint8Array>;
export function buildFiles(r: TraceResult, o?: { name?: string; title?: string; variants?: Variant[]; formats?: ('svg' | 'pdf' | 'eps' | 'png')[]; pngWidths?: number[] }, onProgress?: (pct: number) => void): Promise<Record<string, Uint8Array>>;
export function zip(files: Record<string, Uint8Array>): Blob;
export function download(data: Blob | BlobPart, filename: string, type?: string): void;
export function slugify(s: string): string;
export function setPdfLoader(fn: () => Promise<{ jsPDF: any }>): void;
export function originalCanvas(r: TraceResult): HTMLCanvasElement;
export function diffCanvas(r: TraceResult): HTMLCanvasElement;

