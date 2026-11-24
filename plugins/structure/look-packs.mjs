/**
 * Look packs ("光影包"): the whole look of a figure as plain data — the background and lighting of the renderer (`render`, read by packages/render-three/glow-style.mjs) and the colour of the parts
 * (`colors`, residue colour rules in the selection language that are written into the work as its colour rules; small molecules keep the colour the structure plugin gives them). A work remembers its pack by id (`lookPack` in the structure file's viewer state), so the Studio
 * and the Viewer draw it the same way. A pack changes how things LOOK; it never changes coordinates, evidence or any analysis result.
 *
 * The conventions behind the colours: nucleic acids warm (red), proteins cool (violet or blue); one hue per kind of thing, not per chain,
 * so a figure with many chains stays readable. Check any figure for colour-blind readers by luminance too (the packs keep protein and nucleic acid apart in lightness as well as hue).
 */
export class LookPackError extends Error { constructor(message) { super(message); this.name = 'LookPackError'; } }

const rules = (...pairs) => pairs.map(([expr, color]) => ({ expr, color }));

export const LOOK_PACKS = Object.freeze({
  'glow.cell-dark': {
    id: 'glow.cell-dark', name: '暗场·细胞内部', summary: '深蓝暗场、强环境遮蔽、深色描边、分子边缘的蓝色光晕向背景过渡、远处淡入背景并带景深：细胞内部拥挤分子的画面（核酸红、蛋白紫、其余暖黄）。',
    render: { kind: 'glow', background: ['#1b2d66', '#070d26'], fog: { color: '#0e1a44', strength: 0.55 }, ao: { strength: 1.45, radius: 0.05 }, rim: { color: '#ff9ad8', strength: 0.12, power: 3.2 }, dof: { strength: 0.65, focus: 1, range: 0.3 }, vignette: 0.42, exposure: 1.1, saturation: 1.2, lights: { hemisphere: 1.3, key: 3.0 }, outline: { color: '#04081c', strength: 0.75, width: 1.6 }, halo: { color: '#5b7cff', strength: 0.3, radius: 22 }, shade: 0.45 },
    colors: rules(['all', '#e8c98a'], ['protein', '#b04df5'], ['nucleic', '#d92f1c']),
  },
  'glow.membrane-cool': {
    id: 'glow.membrane-cool', name: '冷光·膜蛋白', summary: '青蓝冷光、边缘青色轮廓光：膜蛋白、通道、转运体。',
    render: { kind: 'glow', background: ['#0f3a4e', '#030f18'], fog: { color: '#06202e', strength: 0.5 }, ao: { strength: 1.7, radius: 0.06 }, rim: { color: '#6fe3ff', strength: 0.18, power: 3.0 }, dof: { strength: 0.35, focus: 1, range: 0.45 }, vignette: 0.4, exposure: 1.1, saturation: 1.15, lights: { hemisphere: 1.2, key: 3.2 }, outline: { color: '#010a10', strength: 0.75, width: 1.6 }, halo: { color: '#39c4f0', strength: 0.28, radius: 22 }, shade: 0.45 },
    colors: rules(['all', '#8fa9b8'], ['protein', '#4fc3f7'], ['nucleic', '#ef476f']),
  },
  'glow.active-site-warm': {
    id: 'glow.active-site-warm', name: '暖光·活性位点', summary: '深褐暗场、暖色轮廓光：酶的活性位点、配体结合口袋（蛋白与其余骨白，核酸砖红）。',
    render: { kind: 'glow', background: ['#33211a', '#0b0605'], fog: { color: '#150c08', strength: 0.5 }, ao: { strength: 1.5, radius: 0.06 }, rim: { color: '#ffb36b', strength: 0.16, power: 3.0 }, dof: { strength: 0.45, focus: 1, range: 0.35 }, vignette: 0.45, exposure: 1.1, saturation: 1.15, lights: { hemisphere: 1.2, key: 3.2 }, outline: { color: '#0c0503', strength: 0.75, width: 1.6 }, halo: { color: '#e08a48', strength: 0.26, radius: 22 }, shade: 0.45 },
    colors: rules(['all', '#d9c4a8'], ['protein', '#d9c4a8'], ['nucleic', '#c4513a']),
  },
  'paper.clean-white': {
    id: 'paper.clean-white', name: '论文白底·描边', summary: '白底墨线描边、柔和的环境遮蔽和体积明暗、分子边缘向背景淡出的浅灰光晕；不加景深：投稿用图（蛋白蓝、核酸砖红、其余灰蓝）。',
    render: { kind: 'glow', background: ['#ffffff', '#f1f3f7'], fog: { color: '#f4f6f9', strength: 0.35 }, ao: { strength: 0.9, radius: 0.03 }, rim: { color: '#ffffff', strength: 0.0, power: 2.6 }, dof: { strength: 0, focus: 1, range: 0.5 }, vignette: 0.0, exposure: 1.08, saturation: 1.1, lights: { hemisphere: 2.3, key: 2.0 }, outline: { color: '#1f2532', strength: 1.0, width: 2.0 }, halo: { color: '#9ca6ba', strength: 0.55, radius: 26 }, shade: 0.6 },
    colors: rules(['all', '#9aa7b8'], ['protein', '#4f78c8'], ['nucleic', '#cf5a45']),
  },
});

export const LOOK_PACK_IDS = Object.freeze(Object.keys(LOOK_PACKS));

/** The pack with this id; a LookPackError that lists the known ids otherwise. */
export function lookPackById(id) {
  if (typeof id !== 'string' || !Object.hasOwn(LOOK_PACKS, id)) throw new LookPackError(`没有光影包“${String(id)}”：可用 ${LOOK_PACK_IDS.join('、')}。`);
  return LOOK_PACKS[id];
}

/** Checks the `lookPack` field of a viewer state: an id of a known pack, or undefined. */
export function validateLookPack(value) {
  if (value === undefined || value === null) return undefined;
  lookPackById(value);
  return value;
}

/** The colour state (the shape of apps/viewer-web/color-scheme.mjs) a pack asks for: the rules, no chain-wide colours. */
export const colorStateOf = (pack) => ({ scheme: 'entity', chains: {}, residues: pack.colors.map(({ expr, color }) => ({ expr, color })) });
