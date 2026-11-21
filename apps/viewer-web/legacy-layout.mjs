import { PRESENTATION_METERS_PER_ANGSTROM as scale } from '../../plugins/structure/representation.mjs';
import { matchesPart } from '../../plugins/structure/functional-preview.mjs';
import { cornerLayout } from '../../plugins/simulation/corner-layout.mjs';
export { matchesPart };

const identity = [0, 0, 0, 1];
const up = [0, 1, 0];
const add = (a, b) => a.map((value, i) => value + b[i]);
const sub = (a, b) => a.map((value, i) => value - b[i]);
const times = (a, k) => a.map((value) => value * k);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (v, fallback) => Math.hypot(...v) > 1e-9 ? times(v, 1 / Math.hypot(...v)) : fallback;
const horizontal = ([x, , z]) => [x, 0, z];
const distance = (value) => Number.isFinite(value) ? value * scale : 0;
const mean = (points) => points.length ? times(points.reduce(add, [0, 0, 0]), 1 / points.length) : [0, 0, 0];

function multiply(a, b) {
  const v = add(add(times(b.slice(0, 3), a[3]), times(a.slice(0, 3), b[3])), cross(a, b));
  return [...v, a[3] * b[3] - dot(a.slice(0, 3), b.slice(0, 3))];
}

function rotate(point, q) {
  const t = times(cross(q, point), 2);
  return add(add(point, times(t, q[3])), cross(q, t));
}

function toUp(direction) {
  const axis = normalize(direction, up);
  const w = 1 + dot(axis, up);
  if (w < 1e-9) return [1, 0, 0, 0];
  const q = [...cross(axis, up), w];
  return times(q, 1 / Math.hypot(...q));
}

function principalAxes(points) {
  const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const center = mean(points);
  for (const point of points) {
    const d = sub(point, center);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += d[i] * d[j];
  }
  for (let sweep = 0; sweep < 16; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-12) continue;
      const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
      const c = Math.cos(angle), s = Math.sin(angle);
      for (let k = 0; k < 3; k++) {
        [a[k][p], a[k][q]] = [c * a[k][p] - s * a[k][q], s * a[k][p] + c * a[k][q]];
        [v[k][p], v[k][q]] = [c * v[k][p] - s * v[k][q], s * v[k][p] + c * v[k][q]];
      }
      for (let k = 0; k < 3; k++) {
        [a[p][k], a[q][k]] = [c * a[p][k] - s * a[q][k], s * a[p][k] + c * a[q][k]];
      }
    }
  }
  return [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]).map((i) => ({ value: a[i][i], axis: v.map((row) => row[i]) }));
}

const matches = ({ name, part }, selector) => matchesPart(name, selector) || matchesPart(part, selector);
const named = (groups, selector) => groups.filter((group) => matches(group, selector)).flatMap(({ points }) => points);
const angleY = (angle) => [0, -Math.sin(angle / 2), 0, Math.cos(angle / 2)];
const transform = (position, rotation) => ({ position, rotation, scale: [1, 1, 1] });
const apply = (groups, pose) => groups.map((group) => ({
  ...group, points: group.points.map((point) => add(rotate(point, pose.rotation), pose.position)),
}));

export function legacyColor(colorMap, name, part) {
  const entry = Object.entries(colorMap ?? {}).find(([key]) => matches({ name, part }, key));
  return /^#[0-9a-f]{6}$/i.test(entry?.[1] ?? '') ? entry[1] : undefined;
}

export function createLegacyLayout(main, configuration, warnings) {
  const rows = [];
  let row = [1, 0, 0];
  const all = (groups) => groups.flatMap(({ points }) => points);
  function orient(groups, config, component) {
    const points = all(groups);
    let center = mean(points);
    let rotation = identity;
    const [from, at] = Array.isArray(config.axisFrom) ? config.axisFrom : [];
    const a = named(groups, from), b = named(groups, at);
    if (a.length && b.length) {
      center = mean(a);
      rotation = toUp(sub(mean(b), center));
    } else if (config.axis === 'native') {
      if (component) rotation = toUp([0, 0, 1]);
    } else {
      const fit = Array.isArray(config.axisFit) ? config.axisFit.flatMap((key) => named(groups, key)) : [];
      const [short, middle, long] = principalAxes(fit.length > 50 ? fit : points);
      const symmetricShort = Math.abs(short.value - (middle.value + long.value) / 2) >
        Math.abs(long.value - (short.value + middle.value) / 2);
      if (points.length > 2 && long.value > 1e-9) rotation = toUp(
        config.axisFit || config.axis === 'short' || (config.axis === 'sym' && symmetricShort) ? short.axis : long.axis,
      );
    }
    if (from && (!a.length || !b.length)) warnings.push(`找不到定向部件“${from} / ${at}”，使用坐标轴预览。`);
    const upright = named(groups, config.up || config.down);
    const height = upright.length ? rotate(sub(mean(upright), center), rotation)[1] : 0;
    if (config.flip || (!from && (config.up ? height < 0 : config.down && height > 0))) {
      rotation = multiply([0, 0, 1, 0], rotation);
    }
    return transform(times(rotate(center, rotation), -1), rotation);
  }

  const primary = orient(main, configuration, false);
  const original = apply(main, primary);
  const [, , long] = principalAxes(all(original).map(horizontal));
  row = normalize(horizontal(long.axis), row);
  if (configuration.rowFlip) row = times(row, -1);
  rows.push(...original);

  let corner = false;   // the first component of a cell corner is the channel
  function place(groups, config, maxCopies = 160) {
    const pose = orient(groups, config, true);
    const staged = apply(groups, pose);
    const points = all(staged);
    const middle = mean(points);
    let shift = [0, distance(config.dy), 0];
    const warn = (selector) => warnings.push(`${config.label || config.id} 缺少定位部件“${selector}”。`);
    if (config.alignTo) {
      const own = named(staged, config.alignTo.own), other = named(original, config.alignTo.anchor);
      if (own.length && other.length) shift[1] += mean(other)[1] - mean(own)[1];
      else warn(config.alignTo.anchor || config.alignTo.own);
    }
    const unpositioned = !config.beside && !config.at && !config.anchor &&
      !config.alignTo && !config.arrange && !Number.isFinite(config.dy);
    const beside = config.beside || (unpositioned ? { dir: 'row' } : null);
    if (unpositioned) warnings.push(`${config.label || config.id} 没有静态位置，预览排列在主结构旁。`);
    if (beside) {
      const target = named(original, beside.part);
      const mainCenter = horizontal(mean(all(original)));
      const dir = beside.dir === 'row' ? row
        : normalize(sub(horizontal(mean(target)), mainCenter), row);
      if (beside.part && !target.length) warn(beside.part);
      const placed = beside.dir === 'row' ? rows : original;
      let edge = -Infinity;
      for (const point of all(placed)) edge = Math.max(edge, dot(sub(point, mainCenter), dir));
      let radius = 0;
      for (const point of points) radius = Math.max(radius, Math.hypot(...horizontal(sub(point, middle))));
      const desired = add(mainCenter, times(dir, edge + radius + distance(beside.gap || 20)));
      shift = add(shift, sub(desired, horizontal(middle)));
    }
    if (config.at) {
      const target = named(rows, config.at.part);
      if (target.length) shift = add(shift,
        add(sub(mean(target), middle), add([0, distance(config.at.dy), 0], times(row, distance(config.at.along)))));
      else warn(config.at.part);
    }
    if (config.anchor) {
      const target = named(original, config.anchor);
      if (target.length) {
        let minimum = Infinity, maximum = -Infinity;
        for (const point of target) { minimum = Math.min(minimum, point[1]); maximum = Math.max(maximum, point[1]); }
        let bottom = Infinity, top = -Infinity;
        for (const point of points) { bottom = Math.min(bottom, point[1]); top = Math.max(top, point[1]); }
        if (config.side === 'below') shift[1] += minimum - top - distance(config.gap);
        else if (config.side === 'above') shift[1] += maximum - bottom + distance(config.gap);
        else shift[1] += mean(target)[1] - (bottom + top) / 2;
      } else warn(config.anchor);
    }
    // The cell corner (classic cellCorner): the channel goes into the plane of the ribosome's cross-section, 60 Å above the ribosome and 0.3 of its radius left of the centre (the
    // arithmetic of plugins/simulation/corner-layout.mjs, equal to the classic on the real structures). The classic takes "the plane" from the ribosome's E -> A direction; this layout has no
    // residue names, so the plane is the one of the scene's default view (the camera azimuth), which is how the classic framed it too.
    if (configuration.process === 'cellCorner' && config.corner !== false && !corner) {
      corner = true;
      const k = 1 / scale, toAngstrom = (p) => p.map((v) => v * k), az = Number.isFinite(configuration.camera?.az) ? configuration.camera.az : -0.9;
      const placed = cornerLayout({ ribosome: all(original).map(toAngstrom), eToA: [Math.cos(az), 0, -Math.sin(az)], channel: points.map(toAngstrom) });
      shift = times(placed.shift, scale);
    }
    const arrangement = config.arrange;
    const repeated = ['ring', 'helix'].includes(arrangement?.kind) && Number.isInteger(arrangement.n) && arrangement.n > 0;
    const count = repeated ? Math.min(arrangement.n, 160, maxCopies) : 1;
    if (repeated && count < arrangement.n) warnings.push(`${config.label || config.id} 的预览显示前 ${count} 个副本。`);
    const copies = [];
    for (let i = 0; i < count; i++) {
      const spin = repeated ? angleY(arrangement.kind === 'ring' ? 2 * Math.PI * i / arrangement.n
        : ((Number.isFinite(arrangement.twist) ? arrangement.twist : 0) * i * Math.PI / 180)) : identity;
      const offset = repeated && arrangement.kind === 'ring' ? rotate([distance(arrangement.radius), 0, 0], spin)
        : [0, repeated ? distance(arrangement.rise) * i : 0, 0];
      const placed = transform(add(add(rotate(pose.position, spin), shift), offset), multiply(spin, pose.rotation));
      copies.push(placed);
    }
    return copies;
  }
  function include(groups, poses) {
    for (const pose of poses) rows.push(...apply(groups, pose));
  }
  function camera() {
    const view = configuration.camera;
    let az = Number.isFinite(view?.az) ? view.az : -0.9;
    if (view?.broadside) {
      const [, , axis] = principalAxes(all(rows).map(horizontal));
      az = Math.atan2(-axis.axis[2], axis.axis[0]) + (view.flipSide ? Math.PI : 0);
    }
    const el = Number.isFinite(view?.el) ? view.el : 0.25;
    return {
      direction: [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)],
      distanceScale: view?.dist > 0 && Number.isFinite(view.dist) ? view.dist : 1.2,
    };
  }
  return { primary, place, include, camera };
}
