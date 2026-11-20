import { bondsFromTemplate, bondsByDistance } from '../../plugins/structure/chemical-component.mjs';
import { elementStyle } from '../../plugins/structure/elements.mjs';
import { valenceGeometry } from '../../packages/render-three/molecule-geometry.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';

/**
 * The drawing of one small molecule: bonds with orders from its chemical component template (matched by atom name), else guessed from distances,
 * and the ball-and-stick geometry around its own centre (viewport units). `atoms`: [{ name, element, position (Å) }].
 * Returns { geometry, bonds, source: 'CCD' | 'distance', centre (Å) }.
 */
export function ligandGeometry(atoms, template) {
  let bonds = template ? bondsFromTemplate(atoms, template) : null, source = 'CCD';
  if (!bonds) { bonds = bondsByDistance(atoms); source = 'distance'; }
  const centre = atoms.reduce((sum, a) => sum.map((v, k) => v + a.position[k] / atoms.length), [0, 0, 0]);
  const geometry = valenceGeometry(atoms.map((a) => {
    const [color, radius] = elementStyle(a.element);
    return { position: a.position.map((v, k) => (v - centre[k]) * PRESENTATION_METERS_PER_ANGSTROM), color, radius };
  }), bonds, PRESENTATION_METERS_PER_ANGSTROM);
  return { geometry, bonds, source, centre };
}
