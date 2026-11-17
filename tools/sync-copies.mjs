#!/usr/bin/env node
// Copy the viewer source into its copies: skill/assets/viewer.html, skill/assets/dev.html (and desktop/app via desktop/scripts/sync.js).
//   node tools/sync-copies.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const [src, dst] of [['web/index.html', 'skill/assets/viewer.html'], ['web/dev.html', 'skill/assets/dev.html']]) {
  fs.copyFileSync(path.join(ROOT, src), path.join(ROOT, dst));
  console.log('synced', src, '->', dst);
}
