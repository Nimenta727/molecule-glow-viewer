/* ----------------------------------------------------------------------------- legend */
function renderLegend() {
  const L = $('legend');
  L.innerHTML = '<div class="hdr"><span></span><span>名称（数量）</span><span title="显示">显</span><span title="绕主轴旋转">转</span><span title="剖开：切掉朝向镜头的一半，露出内部">剖</span><span title="简化：按“简化样式”画成示意图 / 低分辨率表面">简</span></div>';
  groups.forEach((g) => {
    const d = document.createElement('div'); d.className = 'ent';
    const gsid = (g.atoms[0]?.src || '').toUpperCase(), gst = !current?.local && standIn(gsid);
    d.innerHTML = '<span class="sw"></span><span class="nm"></span><input type="checkbox" data-k="vis"><input type="checkbox" data-k="spin"><input type="checkbox" data-k="ghost"><input type="checkbox" data-k="simple">';
    const sw = d.querySelector('.sw'), nm = d.querySelector('.nm'), sub = document.createElement('span');
    sw.style.background = g.color; sw.style.color = g.color;
    nm.title = g.name + (gst ? ' · ' + gst : ''); nm.append(g.name + ' ');
    sub.className = 'sub'; sub.textContent = `(${g.atoms.length.toLocaleString()})${gst ? ' · 代用：' + (ORG_ZH[Object.keys(ORG_ZH).find(k => orgOf(gsid)?.startsWith(k))] || orgOf(gsid)) : ''}`; nm.append(sub);
    for (const [key, value] of Object.entries({vis:g.visible, spin:g.spin, ghost:g.ghost, simple:g.simple})) d.querySelector(`[data-k=${key}]`).checked = value;
    d.querySelector('[data-k=vis]').onchange = (ev) => { g.visible = ev.target.checked; g.mesh.visible = g.visible; };
    d.querySelector('[data-k=spin]').onchange = (ev) => { g.spin = ev.target.checked; spinPose(g); };
    d.querySelector('[data-k=ghost]').onchange = (ev) => { g.ghost = ev.target.checked; if (g.ghost) aimCut(); rebuildMeshes(); applyCut(); };
    d.querySelector('[data-k=simple]').onchange = (ev) => { g.simple = ev.target.checked; rebuildMeshes(); applyCut(); };
    const nmEl = d.querySelector('.nm'); nmEl.style.cursor = 'pointer'; nmEl.onclick = () => selectPart(g);
    L.appendChild(d);
  });
  for (const lg of ligGroups) {
    const st = elStyle(lg.comp.length <= 2 ? lg.comp : 'P');
    const d = document.createElement('div'); d.className = 'ent';
    d.innerHTML = '<span class="sw"></span><span class="nm"></span><input type="checkbox"><span></span><span></span><span></span>';
    const sw = d.querySelector('.sw'), nm = d.querySelector('.nm'), sub = document.createElement('span');
    sw.style.background = st[0]; sw.style.color = st[0]; sw.style.borderRadius = '3px';
    nm.title = String(lg.name ?? ''); nm.append(`◆ ${lg.comp}${lg.state ? '（构象 2）' : ''} `);
    sub.className = 'sub'; sub.textContent = `${String(lg.name ?? '').toLowerCase()} ×${lg.n}`; nm.append(sub);
    d.querySelector('input').checked = lg.visible;
    d.querySelector('input').onchange = (ev) => { lg.visible = ev.target.checked; lg.obj.visible = lg.visible && $('ligOn').checked; };
    const fb = document.createElement('button'); fb.className = 'fbtn'; fb.textContent = '⌖'; fb.title = '聚焦：结合位点、相互作用、构象变化（再点切换到下一个）';
    fb.onclick = () => { const list = model.ligands.filter(l => l.comp === lg.comp && (l.state || 0) === lg.state); if (!list.length) return;
      lg.fi = ((lg.fi ?? -1) + 1) % list.length; focusLigand(list[lg.fi], lg.fi, list.length); };
    d.children[3].replaceWith(fb);
    L.appendChild(d);
  }
  /* ligands the process animation replaced with its own moving copies: still focusable (their real binding sites) */
  const shownKeys = new Set(ligGroups.map(l => l.comp + '|' + l.state));
  const hiddenBy = new Map(); for (const l of model?.ligands || []) if (l.hidden && !shownKeys.has(l.comp + '|' + (l.state || 0))) { const k = l.comp + '|' + (l.state || 0); if (!hiddenBy.has(k)) hiddenBy.set(k, []); hiddenBy.get(k).push(l); }
  for (const [k, list] of hiddenBy) {
    const d = document.createElement('div'); d.className = 'ent';
    d.innerHTML = `<span class="sw" style="background:transparent;border:1px dashed var(--dim);border-radius:3px"></span><span class="nm" title="晶体结构中的位置（动画中用移动的副本表示）">◇ ${esc(list[0].comp)} <span class="sub">晶体结构位点 ×${list.length}（动画中另行显示）</span></span><span></span><span></span><span></span><span></span>`;
    const fb = document.createElement('button'); fb.className = 'fbtn'; fb.textContent = '⌖'; fb.title = '聚焦晶体结构中的结合位点';
    let fi = -1; fb.onclick = () => { fi = (fi + 1) % list.length; focusLigand(list[fi], fi, list.length); };
    d.children[3].replaceWith(fb); L.appendChild(d);
  }
}

