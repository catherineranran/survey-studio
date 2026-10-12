#!/usr/bin/env node
// Prepares a video for video questions: splits it into parts (GitHub accepts files up to
// 100 MB) and, unless --plain is given, encrypts each part with a new random key
// (AES-256-GCM, [12-byte IV][ciphertext + tag]). Writes the parts and a video.json
// manifest into the output folder and prints the key. Put the folder online and use
//   https://…/<folder>/video.json#k=<key>
// as the video link in Survey Studio. Keep the key out of public places: whoever has it
// can watch the video.
//
//   node scripts/seal-video.mjs clip.mp4 out/clip --view wrap --span 180 --fov 90 \
//        --duration 89 --width 2048 --height 2048 --title "Captured, bystander"

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;

export function toBase64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function seal(key, bytes) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + sealed.length);
  out.set(iv, 0);
  out.set(sealed, 12);
  return out;
}

/** Part file names carry a hash of their content, so a re-sealed video never mixes with cached old parts. */
export function partName(index, bytes, ext) {
  return `part-${index + 1}-${createHash('sha256').update(bytes).digest('hex').slice(0, 10)}.${ext}`;
}

/**
 * Splits (and encrypts) a file. Returns the parts, the raw key (null with plain) and a
 * key check: the words "survey-studio-video" sealed with the key, so links can be checked.
 */
export async function sealVideo(bytes, { partSize = 16 * 1024 * 1024, plain = false } = {}) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const keyBytes = plain ? null : webcrypto.getRandomValues(new Uint8Array(32));
  const key = keyBytes ? await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']) : null;
  const check = key ? toBase64url(await seal(key, new TextEncoder().encode('survey-studio-video'))) : undefined;
  const parts = [];
  for (let off = 0; off < data.length; off += partSize) {
    const chunk = data.subarray(off, Math.min(data.length, off + partSize));
    if (!key) {
      parts.push(chunk);
      continue;
    }
    parts.push(await seal(key, chunk));
  }
  return { parts, key: keyBytes, check };
}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (k === 'plain') out.plain = true;
      else out[k] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  const [input, outDir] = a._;
  if (!input || !outDir) {
    console.error('Usage: node scripts/seal-video.mjs <video.mp4> <output folder> [--plain] [--part-mb 16] [--view wrap|flat] [--span 180] [--fov 90] [--duration s] [--width px] [--height px] [--title text]');
    process.exit(1);
  }
  const bytes = await readFile(input);
  const partSize = Math.round(Number(a['part-mb'] ?? 16) * 1024 * 1024);
  const { parts, key, check } = await sealVideo(bytes, { partSize, plain: !!a.plain });
  await mkdir(outDir, { recursive: true });
  const ext = key ? 'bin' : basename(input).split('.').pop();
  const names = parts.map((p, i) => partName(i, p, ext));
  for (let i = 0; i < parts.length; i++) await writeFile(join(outDir, names[i]), parts[i]);
  const num = (v) => (v === undefined ? undefined : Number(v));
  const manifest = {
    format: 'survey-studio-video/1',
    type: /\.webm$/i.test(input) ? 'video/webm' : /\.mov$/i.test(input) ? 'video/quicktime' : 'video/mp4',
    parts: names,
    encrypted: !!key,
    bytes: parts.reduce((n, p) => n + p.length, 0),
    duration: num(a.duration),
    width: num(a.width),
    height: num(a.height),
    view: a.view,
    span: num(a.span),
    fov: num(a.fov),
    title: a.title,
    check,
  };
  await writeFile(join(outDir, 'video.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${parts.length} part(s), ${(manifest.bytes / 1048576).toFixed(1)} MB, in ${outDir}`);
  if (key) console.log(`key: ${toBase64url(key)}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
