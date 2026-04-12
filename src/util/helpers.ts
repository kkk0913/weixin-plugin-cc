import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BaseInfo } from '../weixin/types.js';

export function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

// ─── Version Encoding ──────────────────────────────────────────────
/**
 * Encode semver string as uint32 for iLink-App-ClientVersion header.
 * "2.1.3" → 0x00020103
 */
export function encodeVersion(semver: string): number {
  const parts = semver.split('.').map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return (major << 16) | (minor << 8) | patch;
}

/**
 * Generate random uint32 encoded as base64 for X-WECHAT-UIN header.
 */
export function randomUinBase64(): string {
  const num = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(num)).toString('base64');
}

/**
 * Generate a unique client ID for outgoing messages.
 */
export function generateClientId(): string {
  return `claude-weixin-${randomBytes(8).toString('hex')}`;
}

/**
 * Generate a random file key for CDN uploads.
 */
export function generateFileKey(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Create BaseInfo object for API requests.
 */
export function createBaseInfo(version: string): BaseInfo {
  return { channel_version: version };
}

// ─── Text Chunking ─────────────────────────────────────────────────
/**
 * Split text into chunks respecting a max length.
 * Prefer paragraph (double newline) > line > space boundaries.
 */
export function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const result: string[] = [];
  let rest = text;

  while (rest.length > maxLength) {
    let cut = maxLength;
    // Prefer paragraph boundary
    const para = rest.lastIndexOf('\n\n', maxLength);
    const line = rest.lastIndexOf('\n', maxLength);
    const space = rest.lastIndexOf(' ', maxLength);
    cut =
      para > maxLength / 2
        ? para
        : line > maxLength / 2
          ? line
          : space > 0
            ? space
            : maxLength;

    result.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) result.push(rest);
  return result;
}

// ─── File Helpers ───────────────────────────────────────────────────
const SAFE_INBOX_SUBDIR = 'inbox';

/**
 * Check if a file path is safe to send (not channel state).
 */
export function assertSendable(filePath: string, stateDir: string): void {
  let real: string;
  let stateReal: string;
  try {
    real = realpathSync(filePath);
    stateReal = realpathSync(stateDir);
  } catch {
    return; // will fail on actual send
  }
  const inbox = join(stateReal, SAFE_INBOX_SUBDIR);
  if (real.startsWith(stateReal + '/') && !real.startsWith(inbox + '/')) {
    throw new Error(`refusing to send channel state: ${filePath}`);
  }
}

/**
 * Sanitize a filename for safe storage.
 */
export function safeName(s: string | undefined): string | undefined {
  if (s == null) return undefined;
  const cleaned = s
    .replace(/\0/g, '')
    .replace(/[\/\\<>[\]\r\n;]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim();
  return cleaned || undefined;
}

// ─── Sleep Utility ──────────────────────────────────────────────────
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
