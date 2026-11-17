/* ----------------------------------------------------------------------------- UI wiring */
function syncOut(inp) { const o = inp.parentElement.querySelector('output'); if (o) o.textContent = (+inp.value).toFixed(inp.step < 0.05 ? 2 : 1); }
document.querySelectorAll('input[type=range]').forEach(i => { syncOut(i); i.addEventListener('input', () => syncOut(i)); });
/* three levels of display: the whole cell / a local system (several machines working together) / a single protein */
const MODE_NOTE = { cell: '整个细胞：从 2 µm 一路缩放到原子（镜头按钮切换尺度）。', system: '局部系统：几个分子机器在膜上或细胞质里协同工作，带实时模拟。', single: '单个蛋白：一个蛋白或复合体的结构与组成；也可以输入任意 PDB 编号。', mechanism: '分子机理：聚焦一个小分子或蛋白质的具体结合、催化、构象、转移或门控步骤。' };
function setMode(cat) {
  document.querySelectorAll('#modeTabs button').forEach(b => b.classList.toggle('on', b.dataset.cat === cat));
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('off', b.dataset.cat !== cat));
  $('modeNote').textContent = MODE_NOTE[cat]; try { localStorage.setItem('glowMode', cat); } catch (e) {}
}
for (const [name, p] of Object.entries(PRESETS)) {
  const b = document.createElement('button'); b.textContent = name; b.dataset.cat = presetCat(name);
  b.onclick = () => { $('pdb').value = p.id; loadScene({ ...p, name }); };
  $('presets').appendChild(b);
}
document.querySelectorAll('#modeTabs button').forEach(b => b.onclick = () => { setMode(b.dataset.cat); renderSubs(); });
$('shopBtn').onclick = () => { $('shop').classList.add('on'); $('shopPub').style.display = 'none'; renderShop(); };
$('shopX').onclick = () => $('shop').classList.remove('on');
$('shop').onclick = (e) => { if (e.target === $('shop')) $('shop').classList.remove('on'); };
document.querySelectorAll('#shopTabs button').forEach(b => b.onclick = () => { shop.src = b.dataset.src; renderShop(); });
document.querySelectorAll('#shopCats button').forEach(b => b.onclick = () => { shop.cat = b.dataset.cat; renderShop(); });
$('shopQ').oninput = () => { shop.q = $('shopQ').value; renderShop(); };
$('shopSort').onchange = () => { shop.sort = $('shopSort').value; renderShop(); };
$('shopGrid').onclick = (e) => { const b = e.target.closest('button[data-a]'), c = e.target.closest('.card'); if (b && c) shopAction(b.dataset.a, c.dataset.id, c.dataset.src); };
$('shopIssue').href = `${WS_REPO}/issues/new?template=submit-scene.yml`;
$('shopPublish').onclick = publishHelp;
$('packExport').onclick = () => { try { downloadPack(packFromCurrent()); status('已导出场景包（.glow）'); } catch (e) { status('导出失败：' + e.message); } };
$('packImport').onclick = () => $('packFile').click();
$('packFile').onchange = async () => { const f = $('packFile').files[0]; $('packFile').value = ''; if (!f) return;
  try { const P = await importPackText(await f.text(), f.name); status(`已打开场景包：${P.title}`); } catch (e) { console.warn(e); status('打不开场景包：' + e.message); } };
{ let m = 'single'; try { m = localStorage.getItem('glowMode') || m; } catch (e) {} setMode(MODE_NOTE[m] ? m : 'single'); }
$('load').onclick = () => {
  const id = $('pdb').value.trim().toUpperCase();
  if (!/^[0-9][A-Z0-9]{3}$/.test(id)) { status('PDB 编号是 4 位，首位是数字，如 6ZPO'); return; }
  const preset = Object.entries(PRESETS).find(([, p]) => p.id === id);
  loadScene(preset ? { ...preset[1], name: preset[0] } : { id, auto: true });   /* no preset: automatic membrane / pore / explanation */
};
$('pdb').addEventListener('keydown', e => { if (e.key === 'Enter') $('load').click(); });
async function openFile(f) { status(`读取 ${f.name} …`, true); const text = await f.text();
  if (/\.(glow|json)$/i.test(f.name)) { try { const P = await importPackText(text, f.name); status(`已打开场景包：${P.title}`); } catch (e) { status('打不开场景包：' + e.message); } return; }
  loadScene({ local: entryFromFile(f.name, text), name: f.name, axis: $('axisMode').value, structure: { name: f.name, text } }); }
$('fileBtn').onclick = () => $('file').click();
$('file').onchange = () => $('file').files[0] && openFile($('file').files[0]);
addEventListener('dragover', e => { e.preventDefault(); $('drop').classList.add('on'); });
addEventListener('dragleave', e => { if (e.target === $('drop')) $('drop').classList.remove('on'); });
addEventListener('drop', e => { e.preventDefault(); $('drop').classList.remove('on'); const f = e.dataTransfer.files[0]; if (f) openFile(f); });

$('bloom').oninput = () => bloom.strength = illustrative() ? 0 : +$('bloom').value;
$('rim').oninput = () => U.uRim.value = +$('rim').value;
$('glow').oninput = () => U.uGlow.value = +$('glow').value;
$('lumpy').oninput = () => U.uLumpy.value = +$('lumpy').value;
$('jitter').oninput = () => U.uJitter.value = +$('jitter').value;
$('hot').oninput = () => U.uHot.value = +$('hot').value;
$('exposure').oninput = () => renderer.toneMappingExposure = +$('exposure').value;
$('sat').oninput = () => grade.uniforms.uSat.value = +$('sat').value;
$('con').oninput = () => grade.uniforms.uCon.value = +$('con').value;
$('morph').oninput = () => { $('morphAuto').checked = false; };
$('ao').onchange = () => applyQuality(false);
$('dof').onchange = () => applyQuality(false);
$('quality').onchange = () => { userQuality = $('quality').value; autoQ = false; inkPR = 1; applyQuality(true); };
/* each scene starts at the user's level again (an automatic step-down belongs to the scene that needed it) */
function restoreQuality() { if (autoQ && userQuality && $('quality').value !== userQuality) { $('quality').value = userQuality; applyQuality(false); } autoQ = false; slowT = 0; fastT = 0; }
$('autoRot').onchange = () => controls.autoRotate = $('autoRot').checked;
$('blob').onchange = () => { rebuildMeshes(); applyCut(); };
$('ligScale').onchange = () => { if (model) { rebuildLigands(); renderLegend(); if (current?.process) loadScene(current); } };
$('ligStyle').onchange = () => { if (!model) return; for (const lg of ligGroups) rebuildLigGroupObj(lg); if (focus) focusLigand(focus.L, focus.idx, focus.n); };
$('ligOn').onchange = () => { for (const lg of ligGroups) lg.obj.visible = lg.visible && $('ligOn').checked; };
$('procOn').onchange = () => { procRoot.visible = $('procOn').checked; $('caption').style.display = $('procOn').checked ? '' : 'none'; };
$('colorMode').onchange = () => { rebuildMeshes(); applyCut(); renderLegend(); };
$('palette').onchange = () => { rebuildMeshes(); applyCut(); renderLegend(); };
for (const id of ['memOn', 'mem2On', 'mem1', 'mem2', 'memR']) $(id).addEventListener('change', rebuildMembranes);
$('cut').oninput = applyCut; $('cutWhat').onchange = applyCut;
$('axisMode').onchange = () => current && loadScene({ ...current, axis: $('axisMode').value });
$('assembly').onchange = () => current && loadScene({ ...current, assembly: $('assembly').checked });
$('resetCam').onclick = () => resetCamera();
$('aimCut').onclick = () => aimCut();
$('repMode').onchange = () => { rebuildMeshes(); applyCut(); };
$('simpDefault').onchange = () => { groups.forEach(g => g.simple = undefined); rebuildMeshes(); applyCut(); renderLegend(); };
function applyBg() {
  const light = $('bgMode').value === 'light';
  scene.background.set(light ? 0xf4f5f8 : 0x000000);
  bloom.strength = light ? 0 : +$('bloom').value;
  grade.uniforms.uSat.value = light ? 1.0 : 1.3; grade.uniforms.uCon.value = light ? 1.03 : 1.12;
  grade.uniforms.uVig.value = light ? 0.1 : 0.45; grade.uniforms.uGrain.value = light ? 0.01 : 0.018;
  document.querySelectorAll('.illusOnly').forEach(r => r.style.display = light ? '' : 'none');
  document.body.classList.toggle('lightbg', light);
  U.uIllus.value = light ? 1 : 0;
  renderer.toneMapping = light ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;   // illustration: colours exactly as specified (ACES greys pastels)
}
$('bgMode').onchange = () => { applyBg(); if ($('quality').value === 'low') applyQuality(false); if (model) { rebuildMeshes(); rebuildLigands(); renderLegend(); rebuildMembranes(); applyCut(); } };
applyBg();   // startup default: illustration style (white paper + ink)
$('simpRes').onchange = $('simpStyle').onchange = () => { if (groups.some(g => g.simple)) { rebuildMeshes(); applyCut(); } };
let labelsTouched = false;
$('labelsOn').onchange = () => { labelsTouched = true; rebuildLabels(); };
$('infoX').onclick = () => { $('infoCard').style.display = 'none'; clearSelection(); if (focus) { clearFocus(); status('已退出聚焦'); } };
$('shellOn').onchange = () => { if ($('repMode').value === 'cartoon') { rebuildMeshes(); applyCut(); } };
$('shot').onclick = () => { composer.render(); const a = document.createElement('a'); a.download = `${$('tId').textContent.replace(/\W+/g, '_')}.png`; a.href = renderer.domElement.toDataURL('image/png'); a.click(); };
$('toggle').onclick = () => { $('panel').classList.toggle('hidden'); setTimeout(() => updateViewOffset(true), 300); };
$('caption').onclick = () => $('caption').classList.toggle('open');
$('aboutBtn').onclick = () => showAutoCard();
$('backBtn').onclick = () => goBack();
$('seqLink').onclick = (e) => { e.preventDefault(); if (model) toggleSeqBar(); };
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
  if (e.key === 'h' || e.key === 'H') $('panel').classList.toggle('hidden');
  if ((e.key === 'q' || e.key === 'Q') && model) toggleSeqBar();
  if (e.key === ' ') { $('pause').checked = !$('pause').checked; e.preventDefault(); }
  if (e.key === 'Escape' && kit) { if (kit.sel) kitSelect(null); else exitKit(); return; }
  if (e.key === 'Escape') { if (focus) { clearFocus(); status('已退出聚焦'); } clearSelection(); $('infoCard').style.display = 'none'; }
});
addEventListener('resize', () => {
  if (innerWidth > 0 && innerHeight > 0) { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  if (aoPass) aoPass.setSize(innerWidth, innerHeight);
});

