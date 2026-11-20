import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';
import { buildPieces, computeInterfaces, partnersOf, interfaceResidues, assemblyOrder, pieceOffset } from '../../plugins/structure/pieces.mjs';
import { chainGroupKey } from '../../plugins/structure/representation.mjs';

/**
 * Take-apart mode (classic 拆装): every polymer chain is a piece that can be moved out of the complex and put back, with the small molecules
 * that sit on it; interfaces are listed per partner, shown as the residues that touch and as lines between the nearest residue pairs.
 * The geometry lives in plugins/structure/pieces.mjs; this file moves nodes (viewport.setNodeOffsets) and draws the little panel.
 */
const LINKS_PER_SELECTION = 24;

export function createTakeApart({ viewport, elements, context }) {
  let kit = null, frame = null, last = 0;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const label = (piece) => `${piece.chain}${piece.asym.includes('_') ? `·${piece.asym.split('_')[1]}` : ''}`;

  function nodesOf(piece) {
    const ids = [context.nodeForChain(piece.groupKey), ...piece.ligands.map((ligand) => context.nodeForChain(chainGroupKey(ligand.atom)))];
    return [...new Set(ids.filter(Boolean))];
  }

  function enter() {
    const model = context.model();
    if (!model || kit) return false;
    const built = buildPieces(model);
    computeInterfaces(built);
    const pieces = built.pieces.filter((piece) => context.nodeForChain(piece.groupKey));
    if (pieces.length < 2) { context.setStatus('这个结构只有一条可拆的链（或预览省略了其余链），无法拆装。'); return false; }
    built.pieces = pieces;
    kit = { model: built, state: new Map(pieces.map((piece) => [piece, { e: 0, eTarget: 0, pull: 0, pullTarget: 0 }])), explode: 0, selected: null, play: null };
    const { position, target } = viewport.getCamera();
    kit.baseDistance = Math.hypot(...position.map((v, i) => v - target[i]));
    elements.panel.hidden = false;
    elements.explode.value = '0';
    renderPieces();
    renderInfo();
    elements.step.textContent = '点一个亚基选中它；拖动“拆开程度”或点“全部拆开”。';
    return true;
  }

  function exit() {
    if (!kit) return;
    cancelAnimationFrame(frame);
    frame = null;
    kit = null;
    viewport.setNodeOffsets(new Map());
    viewport.setLinks([]);
    context.clearSelection();
    elements.panel.hidden = true;
    elements.pieces.replaceChildren();
    elements.info.replaceChildren();
  }

  const settle = (now) => {
    if (!kit) return;
    const dt = Math.min(0.25, Math.max(0.001, ((now ?? performance.now()) - (last || (now ?? performance.now()) - 16)) / 1000));
    last = now ?? performance.now();
    const k = 1 - Math.exp(-5 * dt);
    let moving = false;
    if (kit.play) {
      const play = kit.play;
      play.t += dt;
      if (play.t >= 0 && play.i < play.order.length) {
        const piece = play.order[play.i++];
        kit.state.get(piece).eTarget = 0;
        play.t -= play.step;
        const built = play.order.slice(0, play.i - 1);
        const touching = built.reduce((sum, other) => sum + (piece.partners.get(other.index)?.n ?? 0) + (other.partners.get(piece.index)?.n ?? 0), 0);
        elements.step.textContent = `第 ${play.i} / ${play.order.length} 步：装上链 ${label(piece)}（${play.i > 1 ? `和已装好的部分有 ${touching} 个界面残基` : '最大的亚基先放'}）${play.estimated ? ' · 顺序按界面大小估计' : ''}`;
        if (play.i === play.order.length) { kit.play = null; kit.explode = 0; elements.explode.value = '0'; }
      }
      moving = true;
    }
    const offsets = new Map();
    for (const [piece, s] of kit.state) {
      s.e += (s.eTarget - s.e) * k;
      s.pull += (s.pullTarget - s.pull) * k;
      if (Math.abs(s.eTarget - s.e) < 1e-3) s.e = s.eTarget; else moving = true;
      if (Math.abs(s.pullTarget - s.pull) < 1e-3) s.pull = s.pullTarget; else moving = true;
      const ang = pieceOffset(kit.model, piece, s.e, s.pull), offset = ang.map((value) => value * PRESENTATION_METERS_PER_ANGSTROM);
      for (const id of nodesOf(piece)) offsets.set(id, offset);
    }
    viewport.setNodeOffsets(offsets);
    frame = moving ? requestAnimationFrame(settle) : null;
    if (!moving) last = 0;
  };
  const run = () => { if (kit && frame == null) { last = 0; frame = requestAnimationFrame(settle); } };

  function setExplode(value) {
    if (!kit) return;
    kit.play = null;
    kit.explode = value;
    elements.explode.value = String(value);
    for (const s of kit.state.values()) s.eTarget = value;
    // pulled-apart pieces need room: step the camera back (never in) so they stay in view
    if (value > 0.5) {
      const { position, target } = viewport.getCamera(), now = Math.hypot(...position.map((v, i) => v - target[i]));
      const want = kit.baseDistance * (1 + 0.9 * value);
      if (now < want) viewport.setCamera({ position: position.map((v, i) => target[i] + (v - target[i]) * want / now), target });
    }
    run();
  }

  function select(piece) {
    if (!kit) return;
    kit.selected = piece;
    if (!piece) { context.clearSelection(); viewport.setLinks([]); renderInfo(); renderPieces(); return; }
    // keep the piece and everything it touches solid, dim the rest; no markers (the whole chain would be covered in rings)
    const partners = partnersOf(kit.model, piece);
    context.showResidues({ residues: [...piece.residues, ...partners.flatMap(({ piece: other }) => other.residues)], ligands: [] }, { markers: false });
    const pairs = [];
    for (const { piece: other } of partners) {
      const entry = piece.partners.get(other.index);
      if (entry) for (const [ri, rj, d] of entry.pairs) pairs.push({ d, a: piece.residues[ri], b: other.residues[rj] });
    }
    pairs.sort((x, y) => x.d - y.d);
    viewport.setLinks(pairs.slice(0, LINKS_PER_SELECTION).map(({ a, b }) => ({ a: context.targetFor(a), b: context.targetFor(b) })));
    renderInfo();
    renderPieces();
  }

  function showInterface(piece, partner) {
    const mine = interfaceResidues(piece, partner), theirs = interfaceResidues(partner, piece);
    const result = context.showResidues({ residues: [...mine, ...theirs], ligands: [] });
    elements.step.textContent = `界面：链 ${label(piece)} 的 ${mine.length} 个残基 ⇄ 链 ${label(partner)} 的 ${theirs.length} 个残基（Cα 间距 < 6.5 Å 的紧密部分，金框标出）`;
    return result;
  }

  function renderPieces() {
    elements.pieces.replaceChildren();
    for (const piece of kit.model.pieces) {
      const chip = el('button', `take-apart-chip${kit.selected === piece ? ' on' : ''}`, `${label(piece)} · ${piece.residues.length}`);
      chip.type = 'button';
      chip.title = `链 ${piece.asym} · ${piece.residues.length} 个${piece.nucleic ? '核苷酸' : '残基'}${piece.ligands.length ? ` · 带 ${piece.ligands.length} 个小分子` : ''}`;
      chip.addEventListener('click', () => select(kit.selected === piece ? null : piece));
      elements.pieces.append(chip);
    }
  }

  function renderInfo() {
    elements.info.replaceChildren();
    const piece = kit?.selected;
    if (!piece) return;
    const partners = partnersOf(kit.model, piece), state = kit.state.get(piece);
    const interfaceCount = piece.near.filter(Boolean).length;
    elements.info.append(el('div', 'take-apart-title', `链 ${piece.asym} · ${piece.residues.length} 个${piece.nucleic ? '核苷酸' : '残基'}${piece.ligands.length ? ` · 带 ${piece.ligands.length} 个小分子（随它一起移动）` : ''}`));
    const pull = el('button', null, state.pullTarget ? '↩ 装回去' : '⇱ 取下来');
    pull.type = 'button';
    pull.addEventListener('click', () => { state.pullTarget = state.pullTarget ? 0 : 1; renderInfo(); run(); });
    elements.info.append(pull);
    if (!partners.length) { elements.info.append(el('p', null, '和其他链没有接触（单独存在的亚基）。')); return; }
    elements.info.append(el('p', null, `和 ${partners.length} 条链相连（界面 ${interfaceCount} 个${piece.nucleic ? '核苷酸' : '残基'}，残基级：Cα 间距 < ${piece.nucleic ? 10 : 8} Å）：`));
    for (const { piece: other, n, nOther } of partners.slice(0, 12)) {
      const row = el('button', 'take-apart-partner', `链 ${label(other)} · 界面 ${n}+${nOther}`);
      row.type = 'button';
      row.title = '选中两条链相互接触的残基';
      row.addEventListener('click', () => showInterface(piece, other));
      elements.info.append(row);
    }
    if (partners.length > 12) elements.info.append(el('p', null, `… 另 ${partners.length - 12} 条`));
  }

  function play() {
    if (!kit) return;
    setExplode(1);
    const { order, estimated } = assemblyOrder(kit.model, context.assemblyKeywords());
    kit.play = { order, i: 0, t: -1.2, step: Math.min(1.1, Math.max(0.12, 14 / order.length)), estimated };
    for (const s of kit.state.values()) s.pullTarget = 0;
    run();
  }

  elements.explode.addEventListener('input', () => setExplode(+elements.explode.value));
  elements.all.addEventListener('click', () => setExplode(1));
  elements.restore.addEventListener('click', () => { for (const s of kit?.state.values() ?? []) s.pullTarget = 0; setExplode(0); renderInfo(); });
  elements.play.addEventListener('click', play);

  return {
    toggle() { if (kit) { exit(); return false; } return enter(); },
    exit, get active() { return Boolean(kit); },
    /** For tests and the command API: the state of every piece. */
    snapshot() { return kit && { pieces: kit.model.pieces.map((p) => ({ chain: p.asym, residues: p.residues.length, ligands: p.ligands.length, ...kit.state.get(p) })), explode: kit.explode }; },
    setExplode, select: (index) => select(index == null ? null : kit?.model.pieces[index] ?? null),
  };
}
