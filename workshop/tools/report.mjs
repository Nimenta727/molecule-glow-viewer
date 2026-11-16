#!/usr/bin/env node
// Used by .github/workflows/workshop-report.yml. A "举报社区场景" issue -> find the scene, answer the reporter, and when
// HOLD_AT different people have open reports on the same COMMUNITY scene, put it on hold: workshop/community/held.json lists
// it and build-index.mjs leaves it out of the catalogue until a maintainer reviews it (remove the id from held.json to restore).
// Official scenes are never held automatically; their reports are only acknowledged and labelled.
// The issue body is untrusted data (environment variable, parsed as text, never executed).
import fs from 'node:fs';
import path from 'node:path';
import { WS, SOURCES } from './glow-lib.mjs';

const HOLD_AT = 3;
const body = process.env.ISSUE_BODY || '', repo = process.env.GITHUB_REPOSITORY || '', token = process.env.GH_TOKEN || '';
const out = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${String(v).replace(/[\r\n]/g, ' ')}\n`);
const say = (lines) => { fs.writeFileSync(path.join(process.env.RUNNER_TEMP || '.', 'result.md'), lines.join('\n') + '\n'); console.log(lines.join('\n')); };

const idOf = (b) => { const m = /###\s*场景 id\s*\n+\s*`?([a-z0-9][a-z0-9._-]{2,63})`?/i.exec(b || ''); return m ? m[1].toLowerCase() : null; };
const id = idOf(body);
if (!id) { say(['### ⚠ 没有读到场景 id', '', '请在“场景 id”一栏填写工坊卡片上的 id（例如 `someone.my-scene`），然后编辑 issue。']); out('hold', 'false'); process.exit(0); }

let entry = null, src = null;
for (const s of SOURCES) { const f = path.join(WS, s, 'index.json'); if (!fs.existsSync(f)) continue; const e = JSON.parse(fs.readFileSync(f, 'utf8')).packs.find(p => p.id === id); if (e) { entry = e; src = s; break; } }
const heldF = path.join(WS, 'community', 'held.json'), held = fs.existsSync(heldF) ? JSON.parse(fs.readFileSync(heldF, 'utf8')) : { format: 'glow-held', version: 1, held: [] };
const already = held.held.find(h => h.id === id);
if (!entry && !already) { say([`### ⚠ 工坊里没有 \`${id}\``, '', '请核对卡片上的 id。']); out('hold', 'false'); process.exit(0); }
out('id', id); out('src', src || 'community');

/* how many different people have an open report on this id */
let reporters = new Set([process.env.REPORTER || '']);
if (token) {
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`https://api.github.com/repos/${repo}/issues?labels=scene-report&state=open&per_page=100&page=${page}`, { headers: { authorization: 'bearer ' + token, 'user-agent': 'glow-workshop' } });
    if (!r.ok) break; const list = await r.json(); if (!list.length) break;
    for (const i of list) if (idOf(i.body) === id) reporters.add(i.user.login);
  }
}
reporters.delete('');
const n = reporters.size, lines = [`### 收到举报：${entry ? `**${entry.title}**` : ''}（\`${id}\`，${src === 'official' ? '官方' : '社区'}场景）`, ''];
if (already) lines.push('这个场景已经暂停展示，等待维护者审核。');
else if (src === 'community' && n >= HOLD_AT) {
  held.held.push({ id, since: new Date().toISOString().slice(0, 10), reports: n });
  held.held.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(heldF, JSON.stringify(held, null, 1) + '\n'); out('hold', 'true');
  lines.push(`已有 ${n} 位用户举报，场景**已自动暂停展示**（从社区目录移除），等待维护者审核。审核通过后从 \`workshop/community/held.json\` 删除即可恢复。`);
} else lines.push(`目前有 ${n} 位用户举报这个场景。${src === 'community' ? `达到 ${HOLD_AT} 位时会自动暂停展示。` : '官方场景由维护者直接处理。'}维护者会尽快查看。`);
if (!lines.some(l => l.includes('已自动暂停'))) out('hold', 'false');
say(lines);
