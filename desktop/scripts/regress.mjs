#!/usr/bin/env node
// Regression baseline for the viewer (docs/history/ROADMAP.md, audit Sprint 1).
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
import crypto from 'node:crypto';

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
/* T8: the app must run the same bytes as the viewer source (web/index.html in the repo, glow_viewer/index.html in the working folder) */
{ const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  for (const name of ['index.html', 'dev.html']) {
    const src = [path.join(root, '..', 'web', name), path.join(root, '..', 'glow_viewer', name)].find(f => fs.existsSync(f)), app = path.join(root, 'app', name);
    if (src && fs.existsSync(app)) { const a = sha(src), b = sha(app); console.log(`sha256 ${name}：${a.slice(0, 16)}…${a === b ? '' : '　✗ app 里的副本不同 ' + b.slice(0, 16) + '…'}`); if (a !== b) fails.push(`app/${name} 和源文件 ${path.relative(root, src)} 不一致（同步失败？）`); } } }
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
{ const miss = new Set((rep.scenes || []).flatMap(x => x.procNoEvidence || [])); if (miss.size) fails.push(`这些内置过程没有声明证据等级（evidence）：${[...miss].join('、')}`); }
const RRNA = { '16S': [1450, 1560], '23S': [2780, 2930], '5S': [105, 125] };   // 4V6F is Thermus thermophilus: 16S ~1518, 23S ~2915, 5S ~122 nt; allow unmodelled ends
for (const sc of rep.scenes || []) if (Object.keys(sc.rRNA || {}).length) console.log(`rRNA 长度 ${sc.key}：${Object.entries(sc.rRNA).map(([k, n]) => `${k} ${n}`).join('，')}`);
for (const sc of rep.scenes || []) for (const [k, n] of Object.entries(sc.rRNA || {})) if (RRNA[k] && (n < RRNA[k][0] || n > RRNA[k][1])) fails.push(`${sc.key}：${k} rRNA 有 ${n} 个核苷酸（应在 ${RRNA[k].join('–')}）`);
for (const d of rep.determinism || []) {   // seed + fixed steps: run twice, must be identical; and something must have happened
  const { a, b } = d, same = JSON.stringify(a.counters) === JSON.stringify(b.counters) && JSON.stringify(a.events) === JSON.stringify(b.events);
  console.log(`可重复 ${d.key}：seed ${a.seed}，${Object.entries(a.counters || {}).map(([k, v]) => `${k} ${v}`).join('，')}；事件 ${a.events?.length}（${a.ms} ms）${same ? '' : '　✗ 两次不同'}`);
  if (a.error || b.error) { fails.push(`可重复 ${d.key}：${a.error || b.error}`); continue; }
  if (!same) fails.push(`可重复 ${d.key}：同一 seed 两次结果不同`);
  for (const [k, min] of Object.entries(d.expect)) if (!((a.counters?.[k] ?? 0) >= min)) fails.push(`活动 ${d.key}：${k} = ${a.counters?.[k] ?? 0}（应 ≥ ${min}）`);
}
for (const w of rep.twice || []) {   // the same scene twice in a row
  const { a, b } = w; console.log(`连载两次 ${w.key}：几何体 ${a.geometries} → ${b.geometries}，监听器 ${a.listeners} → ${b.listeners}，DOM 标签 ${a.domTags} → ${b.domTags}`);
  if (a.error || b.error) fails.push(`连载两次 ${w.key}：${a.error || b.error}`);
  for (const k of CONTENT) if (a[k] !== b[k]) fails.push(`连载两次 ${w.key}：${k} ${a[k]} → ${b[k]}`);
  if (b.listeners > a.listeners) fails.push(`连载两次 ${w.key}：监听器 ${a.listeners} → ${b.listeners}`);
  if (b.domTags > a.domTags + 5) fails.push(`连载两次 ${w.key}：DOM 标签 ${a.domTags} → ${b.domTags}`);
  if (b.geometries > a.geometries + 10) fails.push(`连载两次 ${w.key}：几何体 ${a.geometries} → ${b.geometries}`);
}
/* round 4 checks */
for (const sc of rep.scenes || []) if (sc.unnamedParticles) fails.push(`${sc.key}：${sc.unnamedParticles} 个粒子没有名字`);
for (const sc of rep.scenes || []) if (sc.pendingAfterClear) fails.push(`${sc.key}：清场后还有 ${sc.pendingAfterClear} 个等待中的动画`);
{ const B = rep.backTest; if (!B) warns.push('没有返回导航测试'); else if (B.error) fails.push('返回导航：' + B.error); else { console.log(`返回导航：${B.mid?.key} → ${B.title}，差异 ${B.diff.length}`); for (const d of B.diff) fails.push('返回导航：' + d); } }
{ const A = rep.animTest; if (!A) warns.push('没有动画计数测试'); else if (A.error) fails.push('动画计数：' + A.error); else { console.log(`等待中的动画：运行中 ${A.mid}，清场后 ${A.afterClear}`); if (A.afterClear) fails.push(`清场后还有 ${A.afterClear} 个等待中的动画`); if (!(A.mid > 0)) warns.push('运行中没有测到等待中的动画（pendingAnims 计数可能没接上）'); } }
{ const G = rep.bridgeTest; if (!G) warns.push('没有桥接测试'); else if (G.error) fails.push('桥接：' + G.error); else { console.log(`桥接：官方站 ${G.trustedOfficial}，其他站 ${G.trustedOther}，null ${G.trustedNull}`);
  if (!G.trustedOfficial || G.trustedOther || G.trustedNull) fails.push('桥接：信任名单不对'); if (G.unsafeAnswered.length) fails.push('桥接：未授权网页拿到了 ' + G.unsafeAnswered.join('、')); } }
/* T10: console errors from the page fail the run, except known, harmless ones (whitelist) */
const ERR_OK = [/ResizeObserver loop/, /favicon/i, /net::ERR_INTERNET_DISCONNECTED/];
for (const e of pageErrors) (ERR_OK.some(re => re.test(e)) ? warns : fails).push(e);
console.log('');
warns.forEach(w => console.log('⚠ ' + w)); fails.forEach(f => console.log('✗ ' + f));
if (accept) { fs.writeFileSync(basef, JSON.stringify(rep, null, 1) + '\n'); console.log(`已存为基线：${path.relative(root, basef)}`); }
else if (!base) { console.log('还没有基线：用 --accept 把这次结果存为基线'); process.exit(2); }
console.log(fails.length ? `\n${fails.length} 项不通过` : '\n全部通过' + (base ? '（和基线一致）' : ''));
process.exit(fails.length && !accept ? 1 : 0);
