#!/usr/bin/env node
/**
 * scripts/upload-asset.mjs
 *
 * PUT the parts of a local file to their pre-signed S3 URLs (the URLs returned
 * by `create_s3_uploads`), capture each part's ETag, and emit the payload that
 * `complete_s3_uploads` expects. Retries 5xx responses with exponential
 * backoff.
 *
 * Usage:
 *   echo '<json>' | node scripts/upload-asset.mjs
 *
 * Stdin JSON:
 *   {
 *     "filePath": "absolute/or/relative/path/to/asset",
 *     "parts": [
 *       { "partNumber": 1, "signedUrl": "https://...", "rangeStart": 0,       "rangeEnd": 5242879 },
 *       { "partNumber": 2, "signedUrl": "https://...", "rangeStart": 5242880, "rangeEnd": 12345678 }
 *     ]
 *   }
 *
 * For a single-part upload, omit rangeStart/rangeEnd; the script will use the
 * whole file:
 *   { "filePath": "...", "parts": [{ "partNumber": 1, "signedUrl": "..." }] }
 *
 * Stdout JSON:
 *   {
 *     "etags": [
 *       { "partNumber": 1, "etag": "\"abc...\"" },
 *       { "partNumber": 2, "etag": "\"def...\"" }
 *     ]
 *   }
 *
 * On any irrecoverable failure: exits non-zero with a message on stderr. The
 * skill is then expected to call `cancel_s3_uploads` for the orphan session
 * before retrying.
 */

import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};

const readRange = (filePath, start, end) => {
  const fd = openSync(filePath, 'r');
  try {
    const len = end - start + 1;
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    return buf;
  } finally {
    closeSync(fd);
  }
};

const putPart = async (signedUrl, body) => {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(signedUrl, {
        method: 'PUT',
        body,
        headers: { 'Content-Length': String(body.byteLength) },
      });
      if (res.ok) {
        const etag = res.headers.get('etag');
        if (!etag) throw new Error('missing ETag in response');
        return etag;
      }
      const text = await res.text().catch(() => '');
      lastError = new Error(`PUT failed with ${res.status}: ${text}`);
      if (res.status < 500 || attempt === MAX_ATTEMPTS) throw lastError;
    } catch (e) {
      lastError = e;
      if (attempt === MAX_ATTEMPTS) throw e;
    }
    await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
  }
  throw lastError;
};

const main = async () => {
  const input = JSON.parse(await readStdin());
  const filePath = resolve(input.filePath);
  const stats = statSync(filePath);
  const parts = input.parts ?? [];

  if (parts.length === 0) {
    throw new Error('no parts provided in stdin payload');
  }

  const etags = [];
  for (const part of parts) {
    const start = part.rangeStart ?? 0;
    const end = part.rangeEnd ?? stats.size - 1;
    if (end >= stats.size) {
      throw new Error(
        `part ${part.partNumber}: range ${start}-${end} exceeds file size ${stats.size}`
      );
    }
    if (start > end) {
      throw new Error(`part ${part.partNumber}: invalid range ${start}-${end}`);
    }
    const body = readRange(filePath, start, end);
    const etag = await putPart(part.signedUrl, body);
    etags.push({ partNumber: part.partNumber, etag });
  }

  process.stdout.write(JSON.stringify({ etags }, null, 2) + '\n');
};

main().catch((e) => {
  process.stderr.write(`upload-asset: ${e.message}\n`);
  process.exit(1);
});
