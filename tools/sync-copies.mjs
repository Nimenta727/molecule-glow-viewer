#!/usr/bin/env node
// Build web/ from src/ (tools/build.mjs), then copy it into skill/assets/viewer.html and skill/assets/dev.html.
// (desktop/app is filled by desktop/scripts/sync.js, which also builds first.)
//   node tools/sync-copies.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build.mjs')], { stdio: 'inherit' }).status !== 0) process.exit(1);
for (const [src, dst] of [['web/index.html', 'skill/assets/index.html'], ['web/index.html', 'skill/assets/viewer.html'], ['web/dev.html', 'skill/assets/dev.html']]) {
  fs.copyFileSync(path.join(ROOT, src), path.join(ROOT, dst));
  console.log('synced', src, '->', dst);
}
