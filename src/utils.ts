/**
 * Tiny UUID v4 utility (no external dependency needed in the extension host).
 */
export function uuidv4(): string {
  const bytes = new Uint8Array(16);
  // Use Math.random as a fallback — crypto is available in Node 20
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Format a Unix ms timestamp as a human-readable string. */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** Format milliseconds remaining as "Xh Ym". */
export function formatTimeRemaining(resetAtMs: number): string {
  const diff = resetAtMs - Date.now();
  if (diff <= 0) return 'Reset now';
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Clamp a number between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Deep-clone a plain JSON-serialisable value. */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
