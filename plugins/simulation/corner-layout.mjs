/**
 * The layout of the cell corner (classic: the setup of `cellCorner` in src/sim/processes/cell-corner.js): the KcsA channel is moved into the plane of the ribosome's cross-section (the
 * view looks along the plane, E -> A of the ribosome runs to the right), 60 Å above the top of the ribosome where the plasma membrane is, a little left of the ribosome's centre (0.3 of its
 * radius, clear of the panels on the right). Around it the cytoplasm below the membrane is filled with crowd (the box below). Pure arithmetic on positions in the classic's frame (Å, y up).
 *
 *   ribosome     positions of all atoms of the ribosome entry without the channel (the classic's `rib`): its centre, top and bottom
 *   body         positions of the ribosome without tRNAs and mRNA (the classic's translation setup): their centre and farthest distance are the radius `Rr`
 *   eToA         the vector from the E-site to the A-site tRNA (translation setup's `eA`); the view azimuth is atan2(-eA.z, eA.x)
 *   channel      positions of the channel; its centroid is moved to the target
 * Returns { az, right, membraneY, shift, radius, centre, crowdBox: { min, max }, top, bottom }.
 */
export const MEMBRANE_ABOVE = 60, LATERAL_FRACTION = 0.3, CROWD_MARGIN = 170, CROWD_BELOW = 70, CROWD_UNDER_MEMBRANE = 34;
const centroid = (points) => points.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]], [0, 0, 0]).map((v) => v / Math.max(1, points.length));

export function cornerLayout({ ribosome, body = ribosome, eToA, channel }) {
  if (!ribosome?.length || !channel?.length || !eToA) throw new TypeError('cornerLayout needs the ribosome, the channel and the E -> A vector');
  const az = Math.atan2(-eToA[2], eToA[0]);
  const bodyCentre = centroid(body), radius = Math.max(...body.map((p) => Math.hypot(p[0] - bodyCentre[0], p[1] - bodyCentre[1], p[2] - bodyCentre[2])));
  const centre = centroid(ribosome);
  let top = -Infinity, bottom = Infinity; for (const p of ribosome) { top = Math.max(top, p[1]); bottom = Math.min(bottom, p[1]); }
  const right = [Math.cos(az), 0, -Math.sin(az)], membraneY = top + MEMBRANE_ABOVE;
  const target = [centre[0] - right[0] * radius * LATERAL_FRACTION, membraneY, centre[2] - right[2] * radius * LATERAL_FRACTION];
  const here = centroid(channel), shift = [target[0] - here[0], target[1] - here[1], target[2] - here[2]];
  const h = radius + CROWD_MARGIN;
  return { az, right, membraneY, shift, radius, centre, top, bottom,
    crowdBox: { min: [centre[0] - h, bottom - CROWD_BELOW, centre[2] - h], max: [centre[0] + h, membraneY - CROWD_UNDER_MEMBRANE, centre[2] + h] } };
}
