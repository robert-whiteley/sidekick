#!/usr/bin/env node
// Turns iPhone screenshots into the size App Store Connect asks for (6.5" display, 1284 × 2778).
// An iPhone 13 mini screenshot (1080 × 2340) has almost the same shape, so it is scaled up and a
// few pixels are trimmed; nothing is stretched. Usage:
//   node scripts/iphone-screenshots.mjs <folder with the phone's PNG/JPG screenshots>
// Writes fastlane/metadata/ios/en-GB/screenshots/iphone65-<n>.jpg (in name order).
import { mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const Jimp = createRequire(import.meta.url)('jimp-compact');
const W = 1284;
const H = 2778;
const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/iphone-screenshots.mjs <folder>');
  process.exit(1);
}
const out = 'fastlane/metadata/ios/en-GB/screenshots';
mkdirSync(out, { recursive: true });
const files = readdirSync(src)
  .filter((f) => /\.(png|jpe?g)$/i.test(f))
  .sort();
let n = 0;
for (const f of files) {
  const img = await Jimp.read(join(src, f));
  // App Store Connect rejects alpha channels: flatten onto black (the app’s dark background) and
  // save as JPEG, which has none.
  const flat = new Jimp(W, H, 0x000000ff);
  flat.composite(img.cover(W, H), 0, 0);
  const dest = join(out, `iphone65-${++n}.jpg`);
  await flat.quality(95).writeAsync(dest);
  console.log(`${f} → ${dest} (${W} × ${H})`);
}
if (!n) console.error('No PNG or JPG files in that folder.');
