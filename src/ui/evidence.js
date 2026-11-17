/* ---- evidence levels (audit invariant "illustrative parts are labelled"). Four badges under the title; a click lists what in
   THIS scene belongs to each level. Built from the scene config; a preset or pack can add lines with
   evidence: { experimental: [...], derived: [...], modelled: [...], illustrative: [...] }. */
const EVID = [['experimental', '实验', '实验测得的原子坐标，直接来自结构文件'], ['derived', '推算', '由坐标或数据库注释计算出来，规则固定、可重复'],
  ['modelled', '建模', '按结构和文献搭出来的，合理但不是直接测得'], ['illustrative', '示意', '为了讲清机制画的，不代表真实数量、位置或速度']];
/* what each built-in process takes from the literature (modelled) and what is only drawn (illustrative) — C6 */
const PROC_EVIDENCE = {
  atpSynthase: { modelled: ['整圈 8 H⁺ : 3 ATP（牛 c8 环，6ZPO）：H⁺ 按 c 环转角计，ATP 按 β 位点完成的结合变构循环计', 'β 亚基三个位点依次开放 → 松弛 → 紧密（Boyer 结合变构机制），γ 每转 120° 一步'],
    illustrative: ['H⁺ 粒子的路径和速度', '转速由滑块设定（真实约每秒 100 转以上）', '快放时两个计数有相位差，短时间读数的比值会偏离 8:3'] },
  flagellarMotor: { modelled: ['H⁺ 经定子 MotA/MotB 流入驱动 C 环旋转（机制顺序）'], illustrative: ['H⁺ 计数和转速（实测每转约 1000 个以上 H⁺）', '定子的数量和位置按结构摆放，没有画定子的结合 / 解离'] },
  respiratoryChain: { modelled: ['每个 NADH（2 e⁻）：复合体 I 泵 4 H⁺，Q 循环释放 4 H⁺（Qo 氧化 2 个 QH₂，Qi 还原 1 个 Q），复合体 IV 每个 e⁻ 泵 1 H⁺ 并消耗 1 个基质 H⁺，4 e⁻ 还原一个 O₂',
      '电子沿结构里真实辅因子（铁硫簇、血红素、铜中心）的位置传递', 'ATP = 经 ATP 合酶回流的 H⁺ × 3/8（牛 c8 环）'],
    illustrative: ['电子、H⁺、醌、细胞色素 c 的路径和速度', '各复合体在膜上的相对位置（组装位置）', '回流的 H⁺ 跟随转子转速，不一定等于泵出的 H⁺'] },
  chloroplast: { modelled: ['线性电子流的顺序：H₂O → PSII → 质体醌 → b6f → 质体蓝素 → PSI → 铁氧还蛋白 → FNR → NADPH', '电子沿真实辅因子位置传递'],
    illustrative: ['光子、电子、H⁺ 的路径和速度', '各复合体的相对位置', '计数只按步骤累加，不是测得的通量'] },
  translation: { modelled: ['延伸循环每一步按文献测得的速率常数随机发生（Gillespie 算法）：选择、GTP 水解、肽键形成、移位、终止', '抗生素按解离常数占据各自的结合位点', '三元复合物、EF-G、RF1 的浓度可调'],
    illustrative: ['tRNA、因子在核糖体周围的扩散路径和数量', '时间被放慢，便于看清每一步'] },
  kcsa: { modelled: ['门控：按胞内 pH 的开放 / C 型失活随机模拟（文献速率）', 'K⁺ 按敲击机制在过滤器位点之间跳跃，沿由开放结构算出的孔道路径移动；Na⁺ 被排斥'],
    illustrative: ['K⁺ 的数量和速度（真实电流约每秒 10⁷–10⁸ 个离子）', '阻断剂的结合位置按示意摆放'] },
  cellCorner: { modelled: ['核糖体翻译和 KcsA 门控两套模拟同时运行，速率与各自的单独场景相同', '背景分子：' + CROWD_RULE.split('；')[0]],
    illustrative: ['两个机器的相对位置和距离', '两套模拟的时间尺度不同，各自放慢（右下角分别标出）', '背景分子的位置、朝向和运动'] },
  auto: { illustrative: [] },
  wholeCell: { modelled: ['细胞尺寸和膜层按大肠杆菌文献值', '背景分子：' + CROWD_RULE.split('；')[0] + '；' + CROWD_RULE.split('；')[1]], illustrative: ['分子的位置、朝向和运动（随机摆放，速度放慢）', '远处的分子用简化外形代替'] },
  dataAnim: { illustrative: ['场景包作者写的动画：粒子、路径、速率（作者在 evidence 里补充具体等级）'] },
};
const procEvidence = (k) => PROCESSES[k]?.evidence || PROC_EVIDENCE[k] || null;   /* a process may also carry its own .evidence */
function evidenceOf(cfg, main) {
  const E = { experimental: [], derived: [], modelled: [], illustrative: [] }, ids = cfg.states || [main?.id || cfg.id].filter(Boolean);
  const declared = cfg.structure?.source?.pdb;   /* an embedded structure counts as experimental only if the pack names its PDB source */
  if (cfg.local) { if (typeof declared === 'string' && /^[0-9][A-Za-z0-9]{3}$/.test(declared)) E.experimental.push(`内嵌结构的原子坐标（包里声明来源 PDB ${declared}，查看器未核对）`);   /* C5: a declaration, not a check */
    else E.modelled.push(`用户提供的模型（可能是预测或自建）：${cfg.name || cfg.structure?.name || '本地文件'}`); }
  else E.experimental.push(`${ids.join('、')} 的原子坐标（RCSB PDB）；每个团块的位置 = 一个残基的 Cα（核酸为 P）`);
  (cfg.components || []).forEach(c => E.experimental.push(`${c.id} 的原子坐标`));
  const L = ligCount(); if (L.types) E.experimental.push(`${L.types} 种 / ${L.copies} 个小分子 / 离子在结构里的位置`);
  if (groups.some(g => g.simple)) E.derived.push('简化外形：由 Cα / P 坐标计算的低分辨率近似外形（不是分子表面）/ 结构域形状');
  if (groups.some(g => g.coreIdx?.length)) E.derived.push('功能核心（保留原子细节的部分）：按配体口袋自动找出');
  if (cfg.auto && cfg.autoMem) E.derived.push(`膜的位置和厚度：${MEM_SRC[cfg.autoMem.src] || cfg.autoMem.src}（自动定膜）`);
  else if (cfg.membranes || cfg.memY != null) E.modelled.push('膜位置按预设手动放置（按某个部件的高度 + 偏移）');
  if (cfg.axis !== 'native') E.derived.push('朝向：按主轴或预设对齐，不是结构文件里的原始朝向');
  if (cfg.states?.length > 1) E.modelled.push(`构象变化：在 ${cfg.states.join(' 和 ')} 两个实验结构之间线性插值，中间态不是测得的`);
  if ((cfg.components || []).length) E.modelled.push('几个结构之间的相对摆放（组装位置）');
  if (groups.some(g => !g.simple)) E.illustrative.push(`团块大小：半径 ${(+$('blob').value).toFixed(1)} Å，每个残基随机 ±15 %（只为好看，不是原子体积）`);
  if (+$('jitter').value > 0) E.illustrative.push('团块的热抖动（示意，不是分子动力学）');
  if ($('memOn').checked && membraneObjs.length) E.illustrative.push('膜里的脂质分子：随机排布，数量和位置不是测得的');
  if (L.types && Math.abs(+$('ligScale').value - 1) > 0.01) E.illustrative.push(`小分子放大 ${(+$('ligScale').value).toFixed(1)}×（为了看得见）`);
  if (cellHost()) { const ids = [...new Set([...(cfg._prov || []).map(p => p.id), ...crowdSets.flatMap(C => C.types.map(t => t.id))])];
    const si = ids.map(id => standIn(id)).filter(Boolean); if (si.length) E.modelled.unshift(...[...new Set(si)].map(t => '物种：' + t)); }
  const procKey = cfg.process || (cfg.animation ? 'dataAnim' : null), PE = procKey && procEvidence(procKey);
  if (PE) { for (const k of Object.keys(E)) for (const t of PE[k] || []) E[k].push(t); }
  else if (procKey) E.illustrative.push('动画里的粒子、路径和速度（这个过程没有声明证据等级）');
  if (cfg.auto && proc?.pore) E.derived.push('孔道轴线和半径：从结构自动找出（推算，不是测得的通道构象）');
  if (cfg.cell || PROCESSES[cfg.process]?.cell) E.illustrative.push('细胞里分子的数量、位置和运动：按文献浓度随机摆放，速度按需要放慢');
  for (const k of Object.keys(E)) for (const t of (cfg.evidence?.[k] || [])) if (typeof t === 'string') E[k].push(t.slice(0, 200));
  return E;
}
const ligCount = () => ({ types: ligGroups.length, copies: ligGroups.reduce((n, l) => n + (l.n || 0), 0) });   /* one count everywhere: badge, status bar, probe */
const unesc = (t) => String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
let evidArgs = null;
function renderEvidence(cfg, main) {
  evidArgs = [cfg, main];
  const E = evidenceOf(cfg, main), box = $('evid'), pop = $('evidPop'); if (!box) return;
  box.innerHTML = EVID.map(([k, n], i) => E[k].length ? `<span class="ev${i}" data-k="${k}">${n} ${E[k].length}</span>` : '').join('');
  pop.classList.remove('open');
  pop.innerHTML = EVID.map(([k, n, d], i) => E[k].length ? `<b class="ev${i}">${n}：${d}</b><ul>${E[k].map(t => `<li>${escT(unesc(t))}</li>`).join('')}</ul>` : '').join('');   /* pack text arrives escaped once already: escape exactly once */
  const PV = cfg._prov || [], METH = { 'X-RAY DIFFRACTION': 'X 射线衍射', 'ELECTRON MICROSCOPY': '冷冻电镜', 'SOLUTION NMR': '溶液 NMR', 'SOLID-STATE NMR': '固体 NMR' };
  const pvLine = (p) => p.local ? `${escT(p.id)}：用户提供的文件（无来源信息）` : `<b style="display:inline">${escT(p.label ? p.label + ' · ' : '')}${escT(p.id)}</b>：${escT(p.method ? (METH[p.method] || p.method) : '方法未知')}${p.resolution != null ? ` · ${(+p.resolution).toFixed(2)} Å` : ''}${p.organisms?.length ? ' · <i>' + escT(p.organisms.join('、')) + '</i>' : ''}${p.citation ? ' · ' + escT(p.citation) : ''}${p.doi ? ` · <a href="https://doi.org/${encodeURI(p.doi)}" target="_blank" rel="noopener">DOI</a>` : ''}`;
  if (PV.length) pop.innerHTML = `<b>来源</b><ul>${PV.map(p => `<li>${pvLine(p)}</li>`).join('')}</ul>` + pop.innerHTML;
  let pl = $('prov'); if (!pl) { pl = document.createElement('div'); pl.id = 'prov'; $('evid').after(pl); }
  const p0 = PV[0]; pl.innerHTML = p0 && !p0.local ? `${escT(p0.method ? (METH[p0.method] || p0.method) : '')}${p0.resolution != null ? ` ${(+p0.resolution).toFixed(1)} Å` : ''}${p0.organisms?.length ? ' · ' + escT(p0.organisms[0]) : ''}${PV.length > 1 ? ` · 另有 ${PV.length - 1} 个结构` : ''}` : '';
  box.onclick = () => pop.classList.toggle('open');
  if (window.__viewer) { window.__viewer.evidence = E; window.__viewer.provenance = PV; }
}
function clearEvidence() { evidArgs = null; if ($('evid')) $('evid').innerHTML = ''; if ($('prov')) $('prov').innerHTML = ''; if ($('evidPop')) { $('evidPop').innerHTML = ''; $('evidPop').classList.remove('open'); } if (window.__viewer) window.__viewer.evidence = null; }
/* display settings that the badges describe (sizes, jitter, lipids) */
for (const id of ['blob', 'jitter', 'ligScale', 'memOn', 'repMode', 'simpDefault']) $(id)?.addEventListener('change', () => { if (evidArgs) setTimeout(() => evidArgs && renderEvidence(...evidArgs), 0); });

