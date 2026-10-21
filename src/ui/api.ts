import type { Claim, Run } from '../schemas/contracts';

export interface InputCapabilities {
  image: boolean;
  post: boolean;
  limits: { imageBytes: number; imageMegapixels: number; formats: string[]; textChars: number };
  postPlatforms: string[];
}
export interface AppConfig {
  liveAvailable: boolean;
  providers: { model: string; search: string; fetch: string };
  inputs?: InputCapabilities;
}
export interface ImageRecognition {
  inputId: string;
  text: string;
  legible: true;
  image: { width: number; height: number; format: string };
  notice: string;
}
export interface PostReading {
  inputId: string;
  platform: 'instagram' | 'tiktok';
  url: string;
  author: string | null;
  text: string;
  scope: 'caption';
  notice: string;
}

/** An error the server explained in German; `fallback` lists the input paths that can still work. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details: { code?: string; reason?: string; fallback?: string[]; claims?: Claim[] } = {}) {
    super(message);
    this.name = 'ApiError';
  }
}
const GENERIC = 'Die Anfrage ist fehlgeschlagen. Bitte versuche es erneut.';

async function read<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(typeof data?.error === 'string' ? data.error : GENERIC, response.status, { code: data?.code, reason: data?.reason, fallback: data?.fallback, claims: Array.isArray(data?.claims) ? data.claims : undefined });
  }
  return data as T;
}
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  });
  return read<T>(response);
}
/** The image goes to the server as raw bytes; the server decides by content, not by this declared type. */
export async function uploadImage(file: Blob, signal?: AbortSignal): Promise<ImageRecognition> {
  const response = await fetch('/api/inputs/image', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file, credentials: 'same-origin', signal });
  return read<ImageRecognition>(response);
}
/** Older servers or mocks may omit newer fields; the UI always works with complete objects. */
export function normalizeRun(run: Run): Run {
  return { ...run, found: run.found ?? [], result: run.result ? { ...run.result, technicalNotes: run.result.technicalNotes ?? [] } : null };
}
export const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
