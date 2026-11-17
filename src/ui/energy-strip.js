/* ----------------------------------------------------------------------------- energy-conversion strip
   process / preset field `energy: [[short label, explanation], ...]` + `stage(ctx)` -> index of the highlighted step */
let energyKey = null;
function renderEnergy() {
  const E = proc?.energy || current?.energy, box = $('energy');
  energyKey = null; if (!E) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const HL = energyHLList();
  box.innerHTML = '<span class="eh">能量转化</span>' + E.map((e, i) => `${i ? '<i>→</i>' : ''}<span class="e" data-i="${i}">${e[0]}</span>`).join('')
    + (HL ? `<span class="e fol${energyFollow ? ' on' : ''}" title="播放时自动高亮当前步骤涉及的结构">◎ 跟随</span>` : '');
  box.style.display = 'flex';
  box.querySelectorAll('.e[data-i]').forEach(el => el.onclick = () => { const i = +el.dataset.i, e = E[i];
    if (focus) clearFocus(); if (HL) selectSpecs(HL[i], false);
    $('infoT').textContent = '能量转化 · ' + e[0]; $('infoB').innerHTML = e[1] + (HL?.[i]?.length ? '<div class="sec" style="color:var(--dim)">高亮＝这一步涉及的结构（金色＝关键残基）。点空白处取消。</div>' : ''); $('infoCard').style.display = 'block'; });
  const fol = box.querySelector('.fol'); if (fol) fol.onclick = () => { energyFollow = !energyFollow; fol.classList.toggle('on', energyFollow); energyKey = null; if (!energyFollow) clearSelection(); };
}
let _morphPrev = 0, _morphDir = 1;
function updateEnergy() {
  const E = proc?.energy || current?.energy; if (!E) return;
  let k = 0;
  if (proc?.energy && proc.stage) k = proc.stage(proc.ctx);
  else if (current?.energyStage === 'morph') { const m = U.uMorph.value; if (Math.abs(m - _morphPrev) > 1e-4) _morphDir = Math.sign(m - _morphPrev); _morphPrev = m;
    k = m < 0.15 ? 0 : m > 0.85 ? 2 : _morphDir > 0 ? 1 : 3; }
  if (k === energyKey) return; energyKey = k;
  $('energy').querySelectorAll('.e[data-i]').forEach(el => { el.classList.toggle('on', +el.dataset.i === k); if (+el.dataset.i === k) { const box = $('energy'); box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2, behavior: 'smooth' }); } });
  if (energyFollow && !focus && (!sel.ids.size || sel.source === 'step')) selectSpecs(energyHLList()?.[k], true);   // a user's own pick is not overridden
}

