import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * The "glow" look: what a figure in a paper or a film about the inside of a cell looks like, made from the plain depth buffer of the scene (no scene data is touched):
 *   background   a vertical gradient (the sky where nothing is drawn), with a vignette
 *   ambient occlusion   crevices and the places where parts meet darken (a depth-difference estimate with 12 taps, radius in world units)
 *   rim light    surfaces turning away from the viewer pick up a coloured edge light, and silhouettes in front of something farther away glow
 *   fog          far parts fade into the background colour (depth cueing)
 *   depth of field   a variable blur around a focus distance (the middle of the molecule by default)
 *   grade        exposure and saturation
 * Two passes: shading (occlusion, rim, fog) into an off-screen buffer, then depth of field and grading to the screen. Returns null when the GPU cannot provide depth textures, so the caller keeps the
 * plain renderer. Every look is plain data (see plugins/structure/look-packs.mjs); nothing here depends on a structure.
 */
export const GLOW_DEFAULTS = Object.freeze({
  kind: 'glow',
  background: ['#18275a', '#070d24'],   // top, bottom
  fog: { color: '#0d1638', strength: 0.7 },
  ao: { strength: 0.85, radius: 0.04 },   // radius as a fraction of the camera distance
  rim: { color: '#9fb4ff', strength: 0.35, power: 2.2 },
  dof: { strength: 0.5, focus: 1, range: 0.35 },   // focus: multiple of the camera-to-target distance; range: width of the sharp zone as a multiple of the molecule radius
  vignette: 0.35,
  exposure: 1.05,
  saturation: 1.1,
  lights: { hemisphere: 1.6, key: 2.4 },
});

const VERTEX = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const SHADE = `
uniform sampler2D tDiffuse, tDepth; uniform vec2 uRes; uniform float uNear, uFar, uPx, uAoStrength, uAoRadius, uRimStrength, uRimPower, uFogN, uFogF, uFogStrength;
uniform vec3 uTop, uBottom, uRim, uFog; varying vec2 vUv;
float lz(vec2 uv) { float z = texture2D(tDepth, uv).x; return z >= 0.99999 ? 1e6 : uNear * uFar / (uFar - z * (uFar - uNear)); }
void main() {
  vec4 c = texture2D(tDiffuse, vUv); float d0 = lz(vUv);
  if (d0 > 1e5) { gl_FragColor = vec4(mix(uBottom, uTop, vUv.y), 0.0); return; }
  vec2 p = 1.0 / uRes;
  // occlusion: neighbours clearly in front of this point darken it, within a radius that follows the distance
  float rpx = clamp(uAoRadius / (d0 * uPx), 2.0, 48.0), occ = 0.0;
  float jitter = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));   // a different rotation per pixel: noise instead of rings (the finishing pass smooths it)
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 2.39996 + jitter, r = rpx * (0.25 + 0.75 * float(i + 1) / 12.0);
    float ds = lz(vUv + vec2(cos(a), sin(a)) * r * p);
    float diff = d0 - ds, range = uAoRadius * 3.0;
    if (ds < 1e5 && diff > uAoRadius * 0.05) occ += smoothstep(0.0, 1.0, diff / (uAoRadius * 0.7)) * (1.0 - smoothstep(range * 0.6, range, diff));
  }
  float ao = clamp(1.0 - uAoStrength * occ / 12.0 * 1.6, 0.3, 1.0);   // never fully black
  // normal from the depth gradient; a jump in depth is a silhouette
  float dl = lz(vUv - vec2(p.x, 0.0)), dr = lz(vUv + vec2(p.x, 0.0)), dd = lz(vUv - vec2(0.0, p.y)), du = lz(vUv + vec2(0.0, p.y));
  float w = d0 * uPx * 2.0, lim = 3.0 * w * 2.0;
  float gx = (dr < 1e5 && dl < 1e5 && abs(dr - dl) < lim) ? (dr - dl) / w : 0.0, gy = (du < 1e5 && dd < 1e5 && abs(du - dd) < lim) ? (du - dd) / w : 0.0;
  vec3 n = normalize(vec3(-gx, -gy, 1.0));
  float silhouette = smoothstep(0.0, 1.0, (min(max(max(dl, dr), max(dd, du)), d0 * 1.5) - d0) / (d0 * uPx * 24.0 + 1e-6)) * 0.55;   // a neighbour far behind: this is an edge in front of something
  float rim = clamp(pow(1.0 - clamp(n.z, 0.0, 1.0), uRimPower) * 1.4 + silhouette, 0.0, 1.0) * uRimStrength;
  vec3 col = c.rgb * ao + uRim * rim * mix(0.6, 1.0, ao);
  float f = uFogStrength * smoothstep(uFogN, uFogF, d0);
  col = mix(col, uFog, f);
  gl_FragColor = vec4(col, 1.0);
}`;
const FINISH = `
uniform sampler2D tColor, tDepth; uniform vec2 uRes; uniform float uNear, uFar, uPx, uFocus, uRange, uDof, uVignette, uExposure, uSaturation; varying vec2 vUv;
float lz(vec2 uv) { float z = texture2D(tDepth, uv).x; return z >= 0.99999 ? 1e6 : uNear * uFar / (uFar - z * (uFar - uNear)); }
void main() {
  float d0 = lz(vUv); vec4 c = texture2D(tColor, vUv);
  if (d0 < 1e5) {   // depth-aware smoothing of the occlusion noise: neighbours at about the same depth only
    vec3 acc = c.rgb; float wsum = 1.0;
    for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; vec2 uv = vUv + vec2(cos(a), sin(a)) * (i % 2 == 0 ? 1.5 : 3.0) / uRes; float ds = lz(uv); float w = abs(ds - d0) < d0 * 0.01 ? 1.0 : 0.0; acc += texture2D(tColor, uv).rgb * w; wsum += w; }
    c.rgb = acc / wsum;
  }
  float coc = d0 > 1e5 ? 0.0 : clamp((abs(d0 - uFocus) - uRange) / max(uRange * 2.0, 1e-4), 0.0, 1.0);
  float radius = uDof * coc * 0.012 * uRes.y;
  vec3 col = c.rgb;
  if (radius > 0.6) {
    vec3 sum = vec3(0.0); float wsum = 0.0;
    for (int i = 0; i < 24; i++) {
      float a = float(i) * 2.39996, r = radius * sqrt((float(i) + 0.5) / 24.0);
      vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes; float ds = lz(uv);
      float w = (ds < d0 - uRange * 0.5 && ds < 1e5) ? 0.15 : 1.0;   // a sharp part in front does not bleed over a blurred one behind it
      sum += texture2D(tColor, uv).rgb * w; wsum += w;
    }
    col = mix(col, sum / wsum, smoothstep(0.6, 3.0, radius));
  }
  if (d0 > 1e5) { float v = length((vUv - 0.5) * vec2(1.0, 0.8)); col *= 1.0 - uVignette * smoothstep(0.35, 0.95, v); }
  else { float v = length((vUv - 0.5) * vec2(1.0, 0.8)); col *= 1.0 - uVignette * 0.6 * smoothstep(0.4, 1.0, v); }
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = mix(vec3(l), col, uSaturation) * uExposure;
  col = col / (1.0 + max(col - 1.0, 0.0));   // soft shoulder: bright parts do not clip
  gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
}`;

export function createGlowRenderer({ renderer, scene, camera, look = GLOW_DEFAULTS, getFocus }) {
  let target, shaded, shadeQuad, finishQuad;
  try {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const make = (depth) => { const t = new THREE.WebGLRenderTarget(Math.max(size.x, 1), Math.max(size.y, 1), { type: THREE.HalfFloatType }); if (depth) { t.depthTexture = new THREE.DepthTexture(); t.depthTexture.type = THREE.UnsignedIntType; } return t; };
    target = make(true); shaded = make(false);
    const U = (value) => ({ value });
    const shade = { tDiffuse: U(null), tDepth: U(null), uRes: U(new THREE.Vector2(1, 1)), uNear: U(0.01), uFar: U(1000), uPx: U(0.001), uAoStrength: U(0.85), uAoRadius: U(0.1), uRimStrength: U(0.35), uRimPower: U(2.2), uFogN: U(0), uFogF: U(1), uFogStrength: U(0.7), uTop: U(new THREE.Color()), uBottom: U(new THREE.Color()), uRim: U(new THREE.Color()), uFog: U(new THREE.Color()) };
    const finish = { tColor: U(null), tDepth: U(null), uRes: U(new THREE.Vector2(1, 1)), uNear: U(0.01), uFar: U(1000), uPx: U(0.001), uFocus: U(1), uRange: U(0.3), uDof: U(0.5), uVignette: U(0.35), uExposure: U(1.05), uSaturation: U(1.1) };
    shadeQuad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: shade, vertexShader: VERTEX, fragmentShader: SHADE, depthTest: false, depthWrite: false }));
    finishQuad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: finish, vertexShader: VERTEX, fragmentShader: FINISH, depthTest: false, depthWrite: false }));
    shadeQuad.uniforms = shade; finishQuad.uniforms = finish;
  } catch { target?.dispose(); shaded?.dispose(); return null; }
  let current = GLOW_DEFAULTS;
  function apply(next) {
    current = { ...GLOW_DEFAULTS, ...next, fog: { ...GLOW_DEFAULTS.fog, ...next.fog }, ao: { ...GLOW_DEFAULTS.ao, ...next.ao }, rim: { ...GLOW_DEFAULTS.rim, ...next.rim }, dof: { ...GLOW_DEFAULTS.dof, ...next.dof } };
    const s = shadeQuad.uniforms, f = finishQuad.uniforms;
    s.uTop.value.set(current.background[0]); s.uBottom.value.set(current.background[1]); s.uRim.value.set(current.rim.color); s.uFog.value.set(current.fog.color);
    s.uAoStrength.value = current.ao.strength; s.uRimStrength.value = current.rim.strength; s.uRimPower.value = current.rim.power; s.uFogStrength.value = current.fog.strength;
    f.uDof.value = current.dof.strength; f.uVignette.value = current.vignette; f.uExposure.value = current.exposure; f.uSaturation.value = current.saturation;
    scene.background = new THREE.Color(current.background[1]);
  }
  apply(look);
  return {
    get style() { return current; },
    setStyle: apply,
    setSize() { /* the buffers follow the drawing buffer at every frame */ },
    render() {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      for (const t of [target, shaded]) if (t.width !== size.x || t.height !== size.y) t.setSize(Math.max(size.x, 1), Math.max(size.y, 1));
      const { distance, radius } = getFocus(), R = Math.max(radius, distance * 0.2);
      const s = shadeQuad.uniforms, f = finishQuad.uniforms, px = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / size.y;
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, camera);
      s.tDiffuse.value = target.texture; s.tDepth.value = target.depthTexture; s.uRes.value.set(size.x, size.y); s.uNear.value = camera.near; s.uFar.value = camera.far; s.uPx.value = px;
      s.uAoRadius.value = Math.max(distance * current.ao.radius, 1e-5); s.uFogN.value = distance - 0.25 * R; s.uFogF.value = distance + 1.6 * R;
      renderer.setRenderTarget(shaded); shadeQuad.render(renderer);
      f.tColor.value = shaded.texture; f.tDepth.value = target.depthTexture; f.uRes.value.set(size.x, size.y); f.uNear.value = camera.near; f.uFar.value = camera.far; f.uPx.value = px;
      f.uFocus.value = distance * current.dof.focus; f.uRange.value = Math.max(R * current.dof.range, 1e-5);
      renderer.setRenderTarget(null); finishQuad.render(renderer);
      renderer.setRenderTarget(previous);
    },
    dispose() { shadeQuad.material.dispose(); shadeQuad.dispose(); finishQuad.material.dispose(); finishQuad.dispose(); target.dispose(); shaded.dispose(); },
  };
}
