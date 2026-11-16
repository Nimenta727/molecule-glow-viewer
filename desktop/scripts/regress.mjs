#!/usr/bin/env node
// Regression baseline for the viewer (docs/ROADMAP.md, audit Sprint 1).
//   node scripts/regress.mjs            run the fixed scenes, compare with regress/baseline.json
//   node scripts/regress.mjs --accept   run them and make this run the new baseline
// Each scene: did it load, how long, what it built (entities / chains / residues / ligands), what the GPU holds (geometries,
// textures, draw calls), how fast it draws, the process counters after a few seconds, and a screenshot (regress/latest/*.jpg).
// Finally the first scene is loaded again: growing geometry / texture counts mean clearScene() missed something.
// Hard failures (exit 1): a scene fails to load, its content counts change, a resource leak. FPS is machine dependent: warning only.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'regress'), latest = path.join(dir, 'latest'), basef = path.join(dir, 'baseline.json');
const accept = process.argv.includes('--accept');
fs.rmSync(latest, { recursive: true, force: true });

spawnSync(process.execPath, [path.join(root, 'scripts', 'sync.js')], { stdio: 'ignore' });
const exe = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const r = spawnSync(exe, ['.'], { cwd: root, env: { ...process.env, GLOW_REGRESS: latest }, encoding: 'utf8', timeout: 15 * 60e3 });
const pageErrors = (r.stdout || '').split('\n').filter(l => l.startsWith('[page error]'));
const repf = path.join(latest, 'report.json');
if (!fs.existsSync(repf)) { console.error('没有生成 report.json\n' + r.stdout + r.stderr); process.exit(1); }
const rep = JSON.parse(fs.readFileSync(repf, 'utf8')); rep.pageErrors = pageErrors;
const base = fs.existsSync(basef) ? JSON.parse(fs.readFileSync(basef, 'utf8')) : null;

const fails = [], warns = [], CONTENT = ['entities', 'chains', 'residues', 'ligands'];
if (rep.fatal) fails.push('运行中断：' + rep.fatal);
const row = (...c) => console.log(c.map((x, i) => String(x ?? '—').padEnd([22, 8, 8, 8, 9, 7, 7, 8, 30][i] || 10)).join(''));
row('场景', '载入s', '实体', '链', '残基', '配体', 'FPS', '几何体', '过程计数');
for (const s of rep.scenes) {
  const b = base?.scenes.find(x => x.key === s.key);
  row(s.key, (s.loadMs / 1000).toFixed(1), s.entities, s.chains, s.residues, s.ligands, s.fps, s.geometries,
    Object.entries(s.counters || {}).map(([k, v]) => `${k} ${v}`).join(' ').slice(0, 30));
  if (s.error || /^出错/.test(s.status)) fails.push(`${s.key}：载入失败 ${s.error || s.status}`);
  for (const e of s.errors || []) fails.push(`${s.key}：${e}`);   // component / process failures inside a load
  if (!s.residues) fails.push(`${s.key}：没有画出任何残基`);
  if (!b) continue;
  for (const k of CONTENT) if (s[k] !== b[k]) fails.push(`${s.key}：${k} ${b[k]} → ${s[k]}`);
  if (s.geometries > b.geometries * 1.25 + 20) fails.push(`${s.key}：几何体 ${b.geometries} → ${s.geometries}（多了 25% 以上）`);
  if (s.fps < b.fps * 0.6) warns.push(`${s.key}：FPS ${b.fps} → ${s.fps}`);
  if (s.loadMs > b.loadMs * 2 + 3000) warns.push(`${s.key}：载入 ${b.loadMs} → ${s.loadMs} ms`);
}
const first = rep.scenes[0];
if (rep.revisit && first) {
  console.log(`\n回到 ${rep.revisit.key}：几何体 ${first.geometries} → ${rep.revisit.geometries}，纹理 ${first.textures} → ${rep.revisit.textures}，场景对象 ${first.objects} → ${rep.revisit.objects}`);
  if (rep.revisit.geometries > first.geometries + 5) fails.push(`资源泄漏：切换 ${rep.scenes.length} 个场景后回到第一个，几何体多了 ${rep.revisit.geometries - first.geometries} 个`);
  if (rep.revisit.textures > first.textures + 2) fails.push(`资源泄漏：纹理多了 ${rep.revisit.textures - first.textures} 个`);
  if (rep.revisit.objects > first.objects + 5) fails.push(`资源泄漏：场景对象多了 ${rep.revisit.objects - first.objects} 个`);
}
if (rep.revisit && first) {
  for (const k of ['overlayObjects', 'domTags', 'listeners']) if (first[k] != null && rep.revisit[k] > first[k] + (k === 'overlayObjects' ? 5 : 0))
    fails.push(`残留：回到 ${rep.revisit.key} 后 ${k} ${first[k]} → ${rep.revisit[k]}`);
}
if (rep.rapid) {   // rapid switch must end exactly like loading the last scene alone
  const R = rep.rapid, S = rep.scenes.find(x => x.key === R.compare);
  console.log(`连切 ${R.compare}：残基 ${R.residues}，覆盖层对象 ${R.overlayObjects}，DOM 标签 ${R.domTags}，监听器 ${R.listeners}${S ? `（单独加载：${S.residues} / ${S.overlayObjects} / ${S.domTags} / ${S.listeners}）` : ''}`);
  if (R.error) fails.push(`连切：载入失败 ${R.error}`);
  for (const e of R.errors || []) fails.push(`连切：${e}`);
  if (S) {
    for (const k of CONTENT) if (R[k] !== S[k]) fails.push(`连切：${k} ${S[k]} → ${R[k]}（应和单独加载 ${R.compare} 一样）`);
    if (R.domTags > S.domTags + 5) fails.push(`连切：DOM 标签残留 ${S.domTags} → ${R.domTags}`);
    if (R.listeners > S.listeners) fails.push(`连切：监听器 ${S.listeners} → ${R.listeners}`);
    if (R.procRootChildren > S.procRootChildren * 1.5 + 10) fails.push(`连切：过程对象残留 ${S.procRootChildren} → ${R.procRootChildren}`);
    if (R.pools > S.pools) fails.push(`连切：粒子池 ${S.pools} → ${R.pools}`);
  }
}
for (const e of pageErrors) warns.push(e);
console.log('');
warns.forEach(w => console.log('⚠ ' + w)); fails.forEach(f => console.log('✗ ' + f));
if (accept) { fs.writeFileSync(basef, JSON.stringify(rep, null, 1) + '\n'); console.log(`已存为基线：${path.relative(root, basef)}`); }
else if (!base) { console.log('还没有基线：用 --accept 把这次结果存为基线'); process.exit(2); }
console.log(fails.length ? `\n${fails.length} 项不通过` : '\n全部通过' + (base ? '（和基线一致）' : ''));
process.exit(fails.length && !accept ? 1 : 0);
