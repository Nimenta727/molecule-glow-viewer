import { superposeParts, motionOf, MODES } from '../superposition.mjs';
import { expressionsFor } from '../contacts.mjs';

/**
 * The "结构叠合" panel (a Studio panel plugin): fits one chain onto a reference part of the same structure (Horn's fit on the alpha carbons), reports the RMSD before and after, and can MOVE that whole
 * chain in the work (a rigid placement kept as the chain's transform; the structure file itself is never changed; one undo step; "还原位置" puts it back). Residues that are still far apart after the
 * fit can be marked in red. Things that were computed on the deposited coordinates — the selection highlight, measurements, labels, interface lists — do not follow a moved chain.
 */
export const SUPERPOSITION_PANEL_ID = 'org.glow.panel.superposition';
export const FAR = 2, FAR_COLOR = '#e05a4a';
const short = (text, n = 48) => (text.length > n ? `${text.slice(0, n - 3)}…` : text);   // the evidence method has room for 200 characters

export function summarize(result) {
  const { angle, shift } = motionOf(result);
  return `链 ${result.chainId} 的 ${result.pairs} 个残基对到参考上：叠合前 RMSD ${result.rmsdBefore.toFixed(2)} Å，叠合后 ${result.rmsd.toFixed(2)} Å（旋转 ${angle.toFixed(1)}°，质心平移 ${shift.toFixed(1)} Å）；最远的一对是 ${result.deviations[0].mobile.resn} ${result.deviations[0].mobile.chain}:${result.deviations[0].mobile.authSeq}，${result.deviations[0].distance.toFixed(2)} Å。`;
}
export const farResidues = (result, limit = FAR) => result.deviations.filter(({ distance }) => distance > limit).map(({ mobile }) => mobile);
export function resultData(result, mobile, reference, mode) {
  return { mobile, reference, mode, chain: result.chainId, pairs: result.pairs, rmsdBefore: +result.rmsdBefore.toFixed(3), rmsd: +result.rmsd.toFixed(3), placed: false };
}

export const superpositionPanel = Object.freeze({
  id: SUPERPOSITION_PANEL_ID, title: '结构叠合', needs: ['structure', 'selection'],
  summary: '把一条链按 Cα 叠到参考部分上，给出叠合前后的 RMSD，可移动画面里的链、标出仍然偏远的残基。',
  mount(container, api) {
    const doc = container.ownerDocument;
    const el = (tag, props = {}, ...kids) => { const n = doc.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } n.append(...kids); return n; };
    const mobile = el('input', { type: 'text', id: 'superposition-mobile', maxlength: '300', placeholder: '移动：chain B', 'aria-label': '移动的部分', autocomplete: 'off', spellcheck: 'false' });
    const reference = el('input', { type: 'text', id: 'superposition-reference', maxlength: '300', placeholder: '参考：chain A', 'aria-label': '参考的部分', autocomplete: 'off', spellcheck: 'false' });
    const models = api.models(), several = models.length > 1;   // with two or more structures in the work the two parts may lie in different ones
    const pick = (id, label) => el('select', { id, 'aria-label': label }, ...models.map((m) => el('option', { value: m.id, text: m.label })));
    const mobileOf = pick('superposition-mobile-structure', '移动的结构'), referenceOf = pick('superposition-reference-structure', '参考的结构'); if (several) referenceOf.selectedIndex = 1;
    const mode = el('select', { id: 'superposition-mode', 'aria-label': '配对方式' }, ...Object.entries(MODES).map(([value, label]) => el('option', { value, text: label })));
    const run = el('button', { type: 'button', id: 'superposition-run', text: '计算叠合' }), place = el('button', { type: 'button', id: 'superposition-place', text: '移动这条链', disabled: '' }), back = el('button', { type: 'button', id: 'superposition-reset', text: '还原位置', disabled: '' });
    const far = el('button', { type: 'button', id: 'superposition-far', text: `标出偏差 > ${FAR} Å 的残基`, disabled: '' }), record = el('button', { type: 'button', id: 'superposition-record', text: '记入作品', disabled: '' });
    const out = el('p', { class: 'tool-note', id: 'superposition-out', role: 'status', 'aria-live': 'polite' }), list = el('ul', { class: 'text-list', id: 'superposition-list', 'aria-label': '偏差最大的残基' });
    container.replaceChildren(
      el('p', { class: 'tool-note', text: '“移动”必须是同一条链（叠合会移动整条链，保存作品时位置随作品保存，原始坐标文件不变）。“参考”默认可取“外观”页的选择。移动后，已算好的选择高亮、测量、标签、界面列表仍按原始坐标，不会跟着走。' }),
      ...(several ? [el('p', { class: 'tool-note', text: '作品里有多个结构：先选“移动的结构”和“参考的结构”，再各写一部分。叠合只用 Cα，两个结构各在自己的原始坐标系里；移动的是被移动结构里的那条链。' }), el('div', { class: 'button-row' }, el('label', { text: '移动的结构' }), mobileOf), el('div', { class: 'button-row' }, el('label', { text: '参考的结构' }), referenceOf)] : []),
      el('div', { class: 'button-row' }, mobile, reference), el('div', { class: 'button-row' }, mode), el('div', { class: 'button-row' }, run, place, back), el('div', { class: 'button-row' }, far, record), out, list);
    const previous = api.data(); if (previous?.mobile) { mobile.value = previous.mobile; reference.value = previous.reference; mode.value = previous.mode; out.textContent = `上次记入作品：${previous.mobile} 叠到 ${previous.reference}，${previous.pairs} 对，RMSD ${previous.rmsdBefore} → ${previous.rmsd} Å。`; }
    let last = null, placed = false;
    const guard = (work) => { try { work(); } catch (error) { out.textContent = error.message; out.dataset.kind = 'error'; } };
    run.addEventListener('click', () => guard(() => {
      out.dataset.kind = ''; const mobileExpr = mobile.value.trim(), referenceExpr = reference.value.trim() || api.selection().expression;
      if (!mobileExpr || !referenceExpr) throw new Error('两部分都要写：例如 移动 chain B，参考 chain A。');
      const mobileEntry = models.find((m) => m.id === mobileOf.value) ?? models[0], referenceEntry = models.find((m) => m.id === referenceOf.value) ?? models[0];
      reference.value = referenceExpr; last = { result: superposeParts(mobileEntry.model, mobileExpr, referenceExpr, { mode: mode.value, referenceModel: referenceEntry.model }), mobileExpr, referenceExpr, mode: mode.value, sourceId: mobileEntry.id, frameId: referenceEntry.id, mobileLabel: mobileEntry.label, referenceLabel: referenceEntry.label, cross: mobileEntry !== referenceEntry };
      out.textContent = summarize(last.result); place.disabled = far.disabled = record.disabled = false; back.disabled = !placed;
      list.replaceChildren(...last.result.deviations.slice(0, 10).map((d) => el('li', { text: `${d.mobile.resn} ${d.mobile.chain}:${d.mobile.authSeq}：${d.distance.toFixed(2)} Å` })));
    }));
    place.addEventListener('click', () => guard(() => {
      if (!last) return; const { result } = last;
      api.placePart({ chain: result.chainId, quaternion: result.quaternion, from: result.from, to: result.to, source: last.sourceId, frame: last.frameId }, `结构叠合：链 ${result.chainId} 已叠到参考上（RMSD ${result.rmsd.toFixed(2)} Å）。`); placed = true; back.disabled = false;
      out.textContent = `${summarize(result)} 已移动画面里的链 ${result.chainId}（原始坐标未变；可“还原位置”或撤销）。`;
    }));
    back.addEventListener('click', () => guard(() => { if (!last) return; api.placePart({ chain: last.result.chainId, reset: true, source: last.sourceId }, `结构叠合：链 ${last.result.chainId} 已还原到原来的位置。`); placed = false; back.disabled = true; out.textContent = `链 ${last.result.chainId} 已还原到原来的位置。`; }));
    far.addEventListener('click', () => guard(() => {
      if (!last) return; const residues = farResidues(last.result);
      if (!residues.length) { out.textContent = `${summarize(last.result)} 没有偏差大于 ${FAR} Å 的残基。`; return; }
      api.applyLook({ colors: { residues: expressionsFor(residues).map((expr) => ({ expr, color: FAR_COLOR })) } }, `结构叠合：${residues.length} 个偏差 > ${FAR} Å 的残基标红。`); out.textContent = `${summarize(last.result)} 已把 ${residues.length} 个偏差大于 ${FAR} Å 的残基标红。`;
    }));
    record.addEventListener('click', () => guard(() => {
      if (!last) return; const { result, mobileExpr, referenceExpr } = last;
      api.addEvidence({ method: `结构叠合：${last.cross ? `${last.mobileLabel} 的 ` : ''}${short(mobileExpr)} 按 Cα 叠到 ${last.cross ? `${last.referenceLabel} 的 ` : ''}${short(referenceExpr)}（Horn 四元数拟合，${result.pairs} 对，${MODES[last.mode]}），RMSD ${result.rmsdBefore.toFixed(2)} → ${result.rmsd.toFixed(2)} Å；位置是计算出来的，不是测得的`, citation: 'Horn 1987' });
      api.setData({ ...resultData(result, mobileExpr, referenceExpr, last.mode), ...(last.cross ? { mobileStructure: last.mobileLabel, referenceStructure: last.referenceLabel } : {}), placed }, '结构叠合：已保存结果。'); out.textContent = `${summarize(result)} 已作为“推导”证据记入作品。`;
    }));
    return { dispose() { /* nothing to undo here: a placement is part of the work, undone with Undo */ } };
  },
});
