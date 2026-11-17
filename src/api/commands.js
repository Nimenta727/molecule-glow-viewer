const GLOW_CMDS = {
  help: { doc: '列出全部命令、参数和选择语法', params: [],
    fn: () => ({ api: GLOW_API, commands: Object.entries(GLOW_CMDS).map(([cmd, d]) => ({ cmd, doc: d.doc, args: d.params, example: d.ex || null })),
      selection: SEL_HELP, postMessage: "{ glow: 'cmd', id, cmd, args } -> { glow: 'reply', id, ok, result | error }；args 可以是对象、数组（按参数顺序）或一个值",
      log: 'glow.log：最近 200 条 {t, cmd, args, ok}；glow.replay(log) 依次重放' }) },
  load: { doc: '打开场景：PDB 编号、预设 key（' + Object.keys(PRESET_BY_KEY).join(' / ') + '；旧的中文名仍可用）、场景包（对象或文本）、只有 scene 的对象、https 链接（.glow / .cif / .pdb）或工坊场景；返回场景概要',
    params: [{ name: 'spec', type: 'string | {pdb, auto?} | {preset} | {pack} | {packText} | {scene, title?, category?} | {url} | {ws: "official/<id>"}' }],
    ex: "glow.load({pdb: '4HHB'})",
    fn: async (spec) => {
      if (typeof spec === 'string') { const s = spec.trim(); spec = PDB_ID.test(s) ? { pdb: s } : /^(official|community)\//.test(s) ? { ws: s } : /^https:\/\//.test(s) ? { url: s } : { preset: s }; }
      if (!spec || typeof spec !== 'object') throw new CmdError('load 需要 {pdb} / {preset} / {pack} / {packText} / {scene} / {url} / {ws}');
      if (spec.seed != null) { loadSeedOverride = spec.seed; $('pause').checked = true; }   /* R3: a seeded load starts paused; animate({step, steps}) advances it */
      const seq0 = loadSeq; let pack = null;
      if (spec.pdb != null) {
        const id = String(spec.pdb).trim().toUpperCase(); if (!PDB_ID.test(id)) throw new CmdError('PDB 编号是 4 位，首位是数字，如 4HHB');
        const preset = spec.auto ? null : Object.entries(PRESETS).find(([, p]) => p.id === id);
        $('pdb').value = id; await loadScene(preset ? { ...preset[1], name: preset[0] } : { id, auto: true });
      } else if (spec.preset != null) {
        const k = presetExact(String(spec.preset)); if (!k) throw new CmdError('没有这个预设：' + spec.preset + '（可用：' + Object.keys(PRESET_BY_KEY).join('、') + '）');
        $('pdb').value = PRESETS[k].id; await loadScene({ ...PRESETS[k], name: k });
      } else if (spec.pack != null || spec.packText != null || spec.scene != null) {
        let raw = spec.scene != null ? packFromApiScene(spec) : spec.pack ?? spec.packText;
        if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { throw new CmdError('不是有效的 JSON：' + e.message); } }
        try { pack = sanitizePack(raw, false); } catch (e) { throw new CmdError(e.message); }
        await openPack(pack, 'local');
      } else if (spec.url != null) {
        const u = String(spec.url); let U0; try { U0 = new URL(u); } catch (e) { throw new CmdError('url-not-allowed：不是有效的链接'); }
        if (!URL_OK(U0)) throw new CmdError('url-not-allowed：只接受本工坊（' + WS_BASE + '）、files.rcsb.org、alphafold.ebi.ac.uk 或同源地址');
        const res = await fetch(U0.href, { signal: loads.signal }); if (!res.ok) throw new CmdError('下载失败 HTTP ' + res.status);   /* not cached: arbitrary files must not pile up in memory */
        const text = await res.text(), name = decodeURIComponent(U0.pathname.split('/').pop() || 'model.cif');
        if (/\.(glow|json)$/i.test(name) || /^\s*\{/.test(text)) { let raw; try { raw = JSON.parse(text); } catch (e) { throw new CmdError('链接内容不是有效的 JSON'); }
          try { pack = sanitizePack(raw, false); } catch (e) { throw new CmdError(e.message); } await openPack(pack, 'local'); }
        else { if (!/\.(cif|mmcif|pdb|ent)$/i.test(name)) throw new CmdError('链接应指向 .glow / .cif / .pdb 文件'); await loadScene({ local: entryFromFile(name, text), name, axis: $('axisMode').value, structure: { name, text } }); }
      } else if (spec.ws != null) {
        const w = String(spec.ws); if (!/^(official|community)\/[a-z0-9._-]+$/.test(w)) throw new CmdError('ws 写成 official/<id> 或 community/<id>');
        const [src, id] = w.split('/'), I = await shopIndex(src); if (!I?.packs?.find(x => x.id === id)) throw new CmdError('工坊里没有 ' + id);
        const entry = I.packs.find(x => x.id === id); let P;
        try { P = await shopFetchPack(src, entry); } catch (e) { throw new CmdError('下载失败：' + e.message); }
        shop.src = src; await openPack(P, src);
      } else throw new CmdError('load 需要 {pdb} / {preset} / {pack} / {packText} / {scene} / {url} / {ws}');
      if (loadSeq !== seq0 + 1) return { cancelled: true, reason: '加载被新的加载取代' };
      if (loadScene.fatal) throw new CmdError('加载失败：' + loadScene.lastError);
      glowSel.expr = 'none'; glowSel.r = []; glowSel.l = [];
      return { ...sceneSummary(), errors: (loadScene.errors || []).slice() };
    } },
  info: { doc: '当前场景：标题、链、小分子、过程动画、计数器、证据等级、显示设置、镜头、选择、可用预设',
    params: [], fn: () => {
      const S = sceneSummary(), byChain = new Map();
      for (const g of groups) for (const a of g.atoms) { let c = byChain.get(a.asym); if (!c) byChain.set(a.asym, c = { asym: a.asym, entity: a.entName || a.part || g.name, part: g.name, residues: 0 }); c.residues++; }
      const L = (model?.ligands || []).filter(x => !x.hidden);
      return { ...S, chainList: [...byChain.values()].slice(0, 2000),
        ligandList: L.slice(0, 500).map(x => ({ name: x.comp, chain: String(x.asym || '').split('_')[0], asym: x.asym || null, atoms: x.atoms.length })),
        parts: groups.map(g => ({ name: g.name, residues: g.atoms.length, visible: g.visible, simplified: !!g.simple, color: g.color })),
        counters: proc ? { ...proc.ctx.counters } : {}, paused: $('pause').checked, timeScale, rotorSpeed: +$('spin').value,
        representation: $('repMode').value, simplify: $('simpDefault').value, style: illustrative() ? 'illustration' : 'glow', colorMode: $('colorMode').value, palette: $('palette').value,
        camera: cameraNow() || null, selection: selSummary(glowSel), caption: $('caption').querySelector('.ct')?.textContent || '', status: $('status').textContent,
        presets: Object.keys(PRESETS), processes: Object.keys(PROCESSES).filter(k => k !== 'dataAnim' && k !== 'auto') };
    } },
  select: { doc: '按表达式选择残基 / 小分子并高亮（其余变淡，选中处加金色标记）；返回数量和样例', params: [{ name: 'expr', type: 'string', doc: SEL_HELP }],
    ex: "glow.select('within 5 of ligand HEM')",
    fn: (expr) => {
      needModel(); const e = String(expr ?? 'all').trim() || 'all', S = evalSel(parseSel(e));
      glowSel.expr = e; glowSel.r = S.r; glowSel.l = S.l;
      if (!S.r.length && !S.l.length) { clearSelection(); return selSummary(S); }
      showSel(S); seqHighlight(); return selSummary(S);
    } },
  sequence: { doc: '序列条：每条链一行，按二级结构着色，虚线是结构里缺失的残基；点击 / 拖选残基即选中（快捷键 Q）', params: [{ name: 'on', type: 'true | false（省略 = 切换）' }], ex: 'glow.sequence(true)',
    fn: (on) => { needModel(); return { open: toggleSeqBar(on == null ? null : onOff(on)), chains: seqChains().map(([k, A]) => ({ chain: A[0]?.ach || k.split('_')[0], label: k, residues: A.length,
      gaps: A.reduce((n, a, i) => n + (i && a.seq - A[i - 1].seq > 1 ? 1 : 0), 0) })) }; } },
  color: { doc: '上色：color(选择, "#e05a4a" 或颜色名)；color("entity" | "chain" | "rainbow") 换配色方式；color("neon" | "pastel" | "goodsell") 换色板；color("reset") 清除自定义颜色',
    params: [{ name: 'target', type: 'string', doc: '选择表达式（默认上一次的选择），或配色方式 / 色板名 / reset' }, { name: 'color', type: 'string', doc: '#rgb / #rrggbb / CSS 颜色名' }],
    ex: "glow.color('chain A', '#e05a4a')",
    fn: ({ target, color }) => {
      needModel(); const t = typeof target === 'string' ? target.trim() : target;
      if (color == null && ['entity', 'chain', 'rainbow'].includes(t)) { $('colorMode').value = t; $('colorMode').onchange(); return { colorMode: t }; }
      if (color == null && PALETTES[t]) { $('palette').value = t; $('palette').onchange(); return { palette: t }; }
      if (t === 'reset') { groups.forEach(g => { delete g.userColor; delete g.resColors; }); rebuildMeshes(); applyCut(); renderLegend(); return { reset: true }; }
      if (!cssColour(color)) throw new CmdError('颜色写成 #rrggbb、#rgb 或 CSS 颜色名（如 tomato）');
      const S = selOrLast(t), want = new Set(S.r), c = new THREE.Color(color); let n = 0;
      if (!S.r.length) throw new CmdError('选择是空的：没有残基可以上色（小分子按元素着色，不能改）');
      for (const g of groups) {
        const hit = g.atoms.filter(a => want.has(a)); if (!hit.length) continue; n += hit.length;
        if (hit.length === g.atoms.length) { g.userColor = '#' + c.getHexString(); delete g.resColors; }
        else { g.resColors ||= new Map(); for (const a of hit) g.resColors.set(a.asym + ':' + a.seq, c.clone()); }
      }
      rebuildMeshes(); applyCut(); renderLegend();
      return { colored: n, color: '#' + c.getHexString() };
    } },
  represent: { doc: '显示模式：blob（团块）/ cartoon（螺旋 / 折叠示意）；可选 simplify: auto | all | none（按功能简化）。按选择设置：represent(选择, "blob" | "cartoon" | "simplified" | "surface" | "hidden" | "default")，作用于选中残基所在的部件（实体），导出的场景包会保存',
    params: [{ name: 'a', type: '"blob" | "cartoon" | {mode?, simplify?} | 选择表达式' }, { name: 'b', type: '（按选择时）"blob" | "cartoon" | "simplified" | "surface" | "hidden" | "default"' }], ex: "glow.represent('chain A', 'cartoon')",
    fn: (x) => {
      needModel();
      let m = x; if (x && typeof x === 'object' && !Array.isArray(x) && ('a' in x || 'b' in x)) m = x.b != null ? { select: x.a, mode: x.b } : x.a;
      if (typeof m === 'string') { const mm = /^(.*\S)\s+(blob|cartoon|simplified|surface|hidden|default)$/.exec(m.trim()); if (mm) m = { select: mm[1], mode: mm[2] }; }
      if (m && typeof m === 'object' && m.select != null) {   /* per selection: the parts (entities) that contain the selected residues */
        const mode = String(m.mode || ''); if (![...REPS, 'default'].includes(mode)) throw new CmdError('按选择时 mode 只能是 ' + [...REPS, 'default'].join(' / '));
        const S = evalSel(parseSel(String(m.select))), hit = groups.filter(g => g.atoms.some(a => S.r.includes(a)));
        if (!hit.length) throw new CmdError('选择里没有残基：' + m.select);
        const reps = current.reps = { ...(current.reps || {}) };
        for (const g of hit) { if (mode === 'default') { delete g.rep; delete reps[g.name]; g.simple = undefined; g.visible = true; } else { g.rep = mode; reps[g.name] = mode; if (mode !== 'hidden') g.visible = true; } }
        rebuildMeshes(); applyCut(); renderLegend();
        return { parts: hit.map(g => g.name), mode, note: hit.some(g => new Set(g.atoms.map(a => a.asym)).size > new Set(g.atoms.filter(a => S.r.includes(a)).map(a => a.asym)).size) ? '按部件（实体）生效：同一实体的其他链也一起改了' : null };
      }
      const o = typeof m === 'string' ? (['auto', 'all', 'none'].includes(m) ? { simplify: m } : { mode: m }) : (m || {});
      if (o.mode != null) { if (!['blob', 'cartoon'].includes(o.mode)) throw new CmdError('mode 只能是 blob 或 cartoon'); $('repMode').value = o.mode; $('repMode').onchange(); }
      if (o.simplify != null) { if (!['auto', 'all', 'none'].includes(o.simplify)) throw new CmdError('simplify 只能是 auto / all / none'); $('simpDefault').value = o.simplify; $('simpDefault').onchange(); }
      return { mode: $('repMode').value, simplify: $('simpDefault').value };
    } },
  style: { doc: '画风：illustration（白底平涂描边）/ glow（黑底辉光）', params: [{ name: 'name', type: '"illustration" | "glow"' }], ex: "glow.style('glow')",
    fn: (name) => {
      const v = { illustration: 'light', light: 'light', glow: 'dark', dark: 'dark', video: 'dark' }[String(name || '').toLowerCase()];
      if (!v) throw new CmdError('style 只能是 illustration 或 glow');
      if ($('bgMode').value !== v) { $('bgMode').value = v; $('bgMode').onchange(); }
      return { style: v === 'light' ? 'illustration' : 'glow' };
    } },
  camera: { doc: '镜头：{reset} 重置；{focus: 选择} 飞到选择处；{orbit: 角度} 绕竖直轴转；{az, el, dist} 设定视角；{autoRotate: true/false}；返回当前视角',
    params: [{ name: 'opts', type: '"reset" | "focus <选择>" | "orbit 90" | {reset?, focus?, orbit?, az?, el?, dist?, autoRotate?}' }], ex: "glow.camera({focus: 'ligand HEM'})",
    fn: (o) => {
      needModel();
      if (typeof o === 'string') { const s = o.trim(), m = /^(\w+)\s*(.*)$/.exec(s) || []; o = m[1] === 'reset' ? { reset: true } : m[1] === 'focus' ? { focus: m[2] || 'sele' } : m[1] === 'orbit' ? { orbit: +m[2] || 90 } : m[1] === 'spin' ? { autoRotate: onOff(m[2] || 'on') } : null;
        if (!o) throw new CmdError('camera 写成 reset / focus <选择> / orbit <角度> / spin on|off'); }
      o = o || {};
      if (o.reset) { camFly = null; resetCamera(); }
      if (o.az != null || o.el != null || o.dist != null) { const c = cameraNow(); camFly = null; resetCamera({ az: +(o.az ?? c.az), el: +(o.el ?? c.el), dist: +(o.dist ?? c.dist) || 1 }); }
      if (o.focus != null) {
        const P = worldPointsOf(selOrLast(o.focus === true ? 'sele' : String(o.focus))); if (!P.length) throw new CmdError('focus 的选择是空的');
        const c = P.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / P.length), r = Math.max(...P.map(p => p.distanceTo(c)));
        flyTo(c, fitDist(r + 10) * 1.05, 650);
      }
      if (o.orbit != null) { const off = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(+o.orbit || 0)); camFly = null; camera.position.copy(controls.target).add(off); controls.update(); }
      if (o.autoRotate != null) { $('autoRot').checked = onOff(o.autoRotate); $('autoRot').onchange(); }
      return { ...cameraNow(), autoRotate: controls.autoRotate };
    } },
  animate: { doc: '动画：play / pause / speed（转子转速 0–3）/ timeScale（slow 看细节 · fast 看粒子流）/ process（显示过程动画）/ morph（0–1 构象，或 "auto"）/ seed（随机种子；要从头重现请先 load 时带 seed 或场景写 seed）/ step + steps（暂停后按固定步长推进 steps 步，可重复）',
    params: [{ name: 'opts', type: '"play" | "pause" | "slow" | "fast" | {play?, pause?, speed?, timeScale?, process?, morph?, seed?, step?, steps?}' }], ex: "glow.animate({seed: 7, step: 1/30, steps: 300})",
    fn: async (o) => {
      if (typeof o === 'string') { const [w, x] = o.trim().split(/\s+/); o = w === 'play' ? { play: true } : w === 'pause' ? { pause: true } : w === 'slow' || w === 'fast' ? { timeScale: w } : w === 'speed' ? { speed: +x } : w === 'morph' ? { morph: x === 'auto' ? 'auto' : +x } : null;
        if (!o) throw new CmdError('animate 写成 play / pause / slow / fast / speed <0–3> / morph <0–1|auto>'); }
      o = o || {};
      if (o.play) $('pause').checked = false; if (o.pause) $('pause').checked = true;
      if (o.timeScale != null) { if (!['slow', 'fast'].includes(o.timeScale)) throw new CmdError('timeScale 只能是 slow 或 fast'); setTimeScale(o.timeScale); }
      if (o.speed != null) { const v = THREE.MathUtils.clamp(+o.speed || 0, 0, 3); $('spin').value = v; $('spin').dispatchEvent(new Event('input')); }
      if (o.process != null) { $('procOn').checked = onOff(o.process); $('procOn').onchange(); }
      if (o.morph != null) { if (o.morph === 'auto') $('morphAuto').checked = true; else { $('morphAuto').checked = false; $('morph').value = THREE.MathUtils.clamp(+o.morph || 0, 0, 1); syncOut($('morph')); } }
      if (o.seed != null) setSeed(o.seed);
      let stepped = null;
      if (o.step != null || o.steps != null) { const n = Math.round(+(o.steps ?? 1)); if (!(n >= 1 && n <= 20000)) throw new CmdError('steps 要在 1–20000 之间');
        stepped = await window.__viewer.step(+(o.step ?? 1 / 60), n); }
      return { seed: randSeed, stepped, events: eventLog.length, paused: $('pause').checked, timeScale, speed: +$('spin').value, process: $('procOn').checked, morph: +$('morph').value, morphAuto: $('morphAuto').checked, counters: proc ? { ...proc.ctx.counters } : {} };
    } },
  snapshot: { doc: '截图，返回 PNG data URL；width 可缩放（64–4096 像素）', params: [{ name: 'opts', type: '{width?}' }], ex: 'glow.snapshot({width: 800})',
    fn: (o) => {
      composer.render(); const src = renderer.domElement, w0 = src.width, h0 = src.height; let w = +(typeof o === 'object' ? o?.width : o) || w0;
      w = Math.round(THREE.MathUtils.clamp(w, 64, 4096)); if (w === w0) return src.toDataURL('image/png');
      const c = document.createElement('canvas'); c.width = w; c.height = Math.max(1, Math.round(w * h0 / w0)); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    } },
  exportPack: { doc: '把当前场景（结构、配色、剖面、镜头、讲解、动画）导出成 .glow 场景包对象；meta 可写 title / tags / author / license',
    params: [{ name: 'meta', type: '{title?, tags?, author?: {name, url?}, license?}' }], ex: "glow.exportPack({title: '我的场景', author: {name: '某某'}})",
    fn: (meta) => {
      const m = {}, x = meta && typeof meta === 'object' ? meta : {};
      if (typeof x.title === 'string' && x.title.trim()) m.title = x.title.slice(0, 80);
      if (Array.isArray(x.tags)) m.tags = x.tags.filter(t => typeof t === 'string').slice(0, 8).map(t => t.slice(0, 20));
      if (x.author && typeof x.author === 'object' && typeof x.author.name === 'string') m.author = { name: x.author.name.slice(0, 60), ...(typeof x.author.url === 'string' && /^https:\/\//.test(x.author.url) ? { url: x.author.url } : {}) };
      if (typeof x.license === 'string') m.license = x.license;
      try { return packFromCurrent(m); } catch (e) { throw new CmdError(e.message); }
    } },
  validatePack: { doc: '按工坊规则检查场景包（对象或 JSON 文本）：{ok, errors, warnings, pack（清理后的版本）}', params: [{ name: 'pack', type: 'object | string' }],
    ex: 'glow.validatePack(packText)', fn: (p) => validatePackReport(p) },
};
