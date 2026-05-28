import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uploadMedia } from '../../src/weixin/media.js';

test('uploadMedia supports upload_full_url-only responses and extracts encrypted query param', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'weixin-media-'));
  const filePath = join(tmpDir, 'sample.txt');
  writeFileSync(filePath, 'hello file\n');

  const fetchCalls: Array<{ url: string; method: string; contentLength?: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      contentLength: init?.headers && !Array.isArray(init.headers) ? (init.headers as Record<string, string>)['Content-Length'] : undefined,
    });
    return {
      ok: true,
      headers: new Headers({ 'x-encrypted-param': 'enc-from-header' }),
    } as Response;
  };

  try {
    const media = await uploadMedia(filePath, 'chat-1', 3, {
      getUploadUrl: async () => ({
        upload_full_url: 'https://example.invalid/upload?encrypted_query_param=enc-from-url&filekey=abc',
      }),
    } as any);

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].method, 'PUT');
    assert.equal(fetchCalls[0].contentLength, '16');
    assert.equal(media.encrypt_query_param, 'enc-from-header');
    assert.equal(media.encrypt_type, 1);
    assert.ok(media.aes_key.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('uploadMedia falls back to POST when PUT upload fails', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'weixin-media-'));
  const filePath = join(tmpDir, 'sample.txt');
  writeFileSync(filePath, 'hello file\n');

  const methods: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    methods.push(method);
    if (method === 'PUT') {
      return { ok: false, status: 405 } as Response;
    }
    return {
      ok: true,
      headers: new Headers({ 'x-encrypted-param': 'enc-from-header' }),
    } as Response;
  };

  try {
    const media = await uploadMedia(filePath, 'chat-1', 3, {
      getUploadUrl: async () => ({
        upload_full_url: 'https://example.invalid/upload?encrypted_query_param=enc-from-url&filekey=abc',
      }),
    } as any);

    assert.deepEqual(methods, ['PUT', 'POST']);
    assert.equal(media.encrypt_query_param, 'enc-from-header');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
