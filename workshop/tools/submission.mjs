#!/usr/bin/env node
// Used by .github/workflows/workshop-submission.yml: take the scene pack attached to a "submit a scene" issue, check it with
// the viewer's own rules and put it into workshop/community/packs/. Everything from the issue is untrusted DATA: the body
// arrives in an environment variable (never interpolated into a shell), only GitHub attachment URLs are downloaded, archives
// are listed before extraction and only .glow / .json members are taken. Nothing from the pack is ever executed.
// Writes $RUNNER_TEMP/result.md (the comment for the issue) and sets the step outputs ok / id / title.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadRules, checkFile, WS, MAX_BYTES } from './glow-lib.mjs';

const body = process.env.ISSUE_BODY || '', repo = process.env.GITHUB_REPOSITORY || '';
const tmp = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'sub-'));
const out = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${String(v).replace(/[\r\n]/g, ' ')}\n`);
const report = (lines, ok) => { fs.writeFileSync(path.join(process.env.RUNNER_TEMP || tmp, 'result.md'), lines.join('\n') + '\n'); out('ok', ok ? 'true' : 'false'); console.log(lines.join('\n')); process.exit(0); };

const urlRe = new RegExp(String.raw`https://github\.com/(?:user-attachments/files|${repo.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/files)/[\w./%-]+\.(?:zip|json|glow)`, 'gi');
const urls = [...new Set(body.match(urlRe) || [])];
const files = [];
/* small packs can also be pasted into the issue as a ```json (or ```glow) code block */
for (const m of body.matchAll(/```(?:json|glow)[^\n]*\r?\n([\s\S]*?)\r?\n```/g)) {
  if (!m[1].includes('"glow-scene"')) continue;
  const f = path.join(tmp, 'pasted-' + files.length + '.json'); fs.writeFileSync(f, m[1]); files.push(f);
}
if (!urls.length && !files.length) report(['### ❌ 没有找到场景包', '', '请把 `.glow` 文件压缩成 `.zip`（或改名为 `.json`）后拖进 issue 正文里；小的场景包也可以直接粘贴在 ```json 代码块里。然后编辑 issue，机器人会重新检查。'], false);

for (const u of urls.slice(0, 3)) {
  const r = await fetch(u, { redirect: 'follow' }); if (!r.ok) continue;
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > MAX_BYTES) continue;
  const f = path.join(tmp, 'dl-' + files.length + path.extname(new URL(u).pathname).toLowerCase()); fs.writeFileSync(f, buf);
  if (f.endsWith('.zip')) {
    const list = execFileSync('unzip', ['-Z1', f], { encoding: 'utf8' }).split('\n').filter(n => /\.(glow|json)$/i.test(n) && !n.includes('..') && !n.startsWith('/'));
    const sizes = execFileSync('unzip', ['-l', f], { encoding: 'utf8' }); const total = +(sizes.trim().split('\n').pop().trim().split(/\s+/)[0] || 0);
    if (total > MAX_BYTES * 2 || list.length > 5) continue;
    const xd = path.join(tmp, 'x' + files.length); fs.mkdirSync(xd);
    if (list.length) execFileSync('unzip', ['-j', '-o', '-q', f, ...list, '-d', xd]);
    for (const n of fs.readdirSync(xd)) files.push(path.join(xd, n));
  } else files.push(f);
}
if (!files.length) report(['### ❌ 附件里没有 .glow / .json 场景包', '', '附件需要是 `.zip`（里面放 `.glow` 文件）或 `.json`。'], false);

const R = loadRules(), lines = [];
for (const f of files) {
  let id; try { id = JSON.parse(fs.readFileSync(f, 'utf8')).id; } catch { id = null; }
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(id)) { lines.push(`- \`${path.basename(f)}\`：不是有效的场景包（缺少合法的 id）`); continue; }
  const named = path.join(tmp, id + '.glow'); fs.copyFileSync(f, named);
  const r = checkFile(named, 'community', R);
  if (!r.ok) { lines.push(`- \`${id}\`：`, ...r.errors.map(e => `  - ❌ ${e}`)); continue; }
  const dest = path.join(WS, 'community', 'packs', id + '.glow'), existed = fs.existsSync(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(named, dest);
  out('id', id); out('title', r.pack.title);
  report(['### ✅ 自动检查通过', '', `**${r.pack.title}**（\`${id}\`，${R.PACK_CATS[r.pack.category]}，第 ${r.pack.revision} 版）${existed ? '——这是对已有场景的更新' : ''}`,
    r.raw.scene.animation ? '- 带纯数据动画' : r.raw.scene.process ? `- 使用内置过程 \`${r.raw.scene.process}\`` : '- 静态场景',
    ...r.warnings.map(w => `- ⚠ ${w}`), '', '维护者审核合并后，场景会出现在程序的“社区”工坊里。'], true);
}
report(['### ❌ 自动检查没有通过', '', ...lines, '', '改好后重新上传附件并编辑 issue，机器人会再检查一次。格式说明见 `workshop/SCHEMA.md`。'], false);
