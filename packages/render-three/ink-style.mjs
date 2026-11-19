import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * core.ink — the built-in default art style: white paper, flat colour, ink outlines (Goodsell-style illustration).
 * Ported from the classic viewer's InkPass (src/view/renderer.js). It only changes presentation: it reads the depth buffer
 * and never touches scene data, selection or simulation. Other styles (e.g. dark "glow") are meant to be style packs.
 */
export const CORE_INK = Object.freeze({
  id: 'core.ink',
  background: '#f7f7f4',   // paper
  ink: '#2a3140',          // line colour
  line: 1,                 // 0..1.5 overall line strength
  fog: 0.4,                // far parts fade toward the paper colour (depth cueing)
  shade: 1,                // 0..1 macro shading that rounds whole domains
});

// Depth is measured in "unit" lengths so thresholds are independent of the scene's scale.
// unit = camera distance / 150, i.e. about one angstrom for a protein filling the view.
const UNIT_PER_DISTANCE = 1 / 150;

const VERTEX = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const FRAGMENT = `
uniform sampler2D tDiffuse, tDepth; uniform vec2 uRes;
uniform float uNear, uFar, uUnit, uPx, uLine, uFog, uFogN, uFogF, uLW, uShade, uMacro, uT1, uT2, uG1, uG2;
uniform vec3 uBg, uInk; varying vec2 vUv;
float lz(vec2 uv) { float z = texture2D(tDepth, uv).x; return z >= 0.99999 ? 1e6 : uNear * uFar / (uFar - z * (uFar - uNear)) / uUnit; }
void main() {
  vec4 c = texture2D(tDiffuse, vUv); vec2 p = 1.0 / uRes;
  float d0 = lz(vUv), dl = lz(vUv - vec2(p.x, 0.0)), dr = lz(vUv + vec2(p.x, 0.0)), dd = lz(vUv - vec2(0.0, p.y)), du = lz(vUv + vec2(0.0, p.y));
  float dn = min(d0, min(min(dl, dr), min(dd, du)));
  float dq[8];
  for (int i = 0; i < 8; i++) { float an = float(i) * 0.785398; dq[i] = lz(vUv + vec2(cos(an), sin(an)) * uLW * p); dn = min(dn, dq[i]); }
  if (dn > 1e5) { gl_FragColor = vec4(c.rgb, 1.0); return; }
  float px = dn * uPx;
  float gap = max(max(d0 - dl, d0 - dr), max(d0 - dd, d0 - du));
  float strong = clamp((gap - (uT1 + uT2 * px)) / (1.0 + px), 0.0, 1.0);
  float tagW = 1.0;
  for (int i = 0; i < 8; i++) {
    float an = float(i) * 0.785398; vec2 o = vec2(cos(an), sin(an)) * uLW * p;
    float st = clamp((d0 - dq[i] - (uT1 + uT2 * uLW * px)) / (1.0 + uLW * px), 0.0, 1.0);
    if (texture2D(tDiffuse, vUv + o).a < 0.75) st *= 0.0;
    strong = max(strong, st);
  }
  if (c.a < 0.75 || texture2D(tDiffuse, vUv + vec2(p.x, 0.0)).a < 0.75 || texture2D(tDiffuse, vUv - vec2(p.x, 0.0)).a < 0.75) tagW = 0.4;
  float lap = d0 < 1e5 && max(max(dl, dr), max(dd, du)) < 1e5 ? 4.0 * d0 - dl - dr - dd - du : 0.0;
  float groove = smoothstep(uG1 * px + 0.2, uG2 * px + 1.0, lap) * 0.5;
  float ink = clamp(max(strong * tagW, groove) * uLine, 0.0, 1.0);
  vec3 col = c.rgb;
  if (d0 < 1e5) {
    float r = uMacro, rx = r * p.x, ry = r * p.y;
    float a = lz(vUv + vec2(rx, 0.0)), b = lz(vUv - vec2(rx, 0.0)), u2 = lz(vUv + vec2(0.0, ry)), e = lz(vUv - vec2(0.0, ry));
    float w = 2.0 * r * px, lim = 2.5 * w;
    float gx = (a < 1e5 && b < 1e5 && abs(a - b) < lim) ? (a - b) / w : (a < 1e5 && abs(a - d0) < lim) ? 2.0 * (a - d0) / w : (b < 1e5 && abs(d0 - b) < lim) ? 2.0 * (d0 - b) / w : 0.0;
    float gy = (u2 < 1e5 && e < 1e5 && abs(u2 - e) < lim) ? (u2 - e) / w : (u2 < 1e5 && abs(u2 - d0) < lim) ? 2.0 * (u2 - d0) / w : (e < 1e5 && abs(d0 - e) < lim) ? 2.0 * (d0 - e) / w : 0.0;
    vec3 n = normalize(vec3(gx, gy, 1.0));
    float lam = dot(n, normalize(vec3(-0.45, 0.6, 0.66)));
    col *= mix(1.0, min(1.0, 0.72 + 0.34 * lam), uShade);
  }
  float f = d0 < 1e5 ? uFog * smoothstep(uFogN, uFogF, d0) : 0.0;
  col = mix(col, uBg, f);
  col = mix(col, uInk, ink * (1.0 - 0.55 * f));
  gl_FragColor = vec4(col, 1.0);
}`;

class InkPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.uniforms = {
      tDiffuse: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 1 }, uFar: { value: 1000 }, uUnit: { value: 1 }, uPx: { value: 0.001 },
      uLine: { value: 1 }, uFog: { value: 0.4 }, uFogN: { value: 0 }, uFogF: { value: 1 }, uLW: { value: 2 },
      uShade: { value: 1 }, uMacro: { value: 7 }, uT1: { value: 2.0 }, uT2: { value: 1.2 }, uG1: { value: 0.3 }, uG2: { value: 1.2 },
      uBg: { value: new THREE.Color() }, uInk: { value: new THREE.Color() },
    };
    this.fsq = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT }));
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uRes.value.set(readBuffer.width, readBuffer.height);
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    u.uMacro.value = Math.max(3, 8 * readBuffer.height / 900);
    u.uLW.value = Math.max(1.5, 2.2 * readBuffer.height / 900);
    u.uPx.value = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / readBuffer.height;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsq.render(renderer);
  }

  dispose() { this.fsq.material.dispose(); this.fsq.dispose(); }
}

/**
 * Renders `scene` through the ink pass. Returns null when the GPU cannot provide depth textures,
 * so callers fall back to the plain renderer.
 */
export function createInkRenderer({ renderer, scene, camera, style = CORE_INK, getFocus }) {
  let composer;
  let pass;
  try {
    composer = new EffectComposer(renderer);
    for (const target of [composer.renderTarget1, composer.renderTarget2]) {
      target.depthTexture = new THREE.DepthTexture();
      target.depthTexture.type = THREE.UnsignedIntType;
    }
    composer.addPass(new RenderPass(scene, camera));
    pass = new InkPass(camera);
    composer.addPass(pass);
    composer.addPass(new OutputPass());
  } catch {
    composer?.dispose?.();
    return null;
  }
  let current = style;
  function apply(next) {
    current = { ...CORE_INK, ...next };
    pass.uniforms.uBg.value.set(current.background);
    pass.uniforms.uInk.value.set(current.ink);
    pass.uniforms.uLine.value = current.line;
    pass.uniforms.uFog.value = current.fog;
    pass.uniforms.uShade.value = current.shade;
    scene.background = new THREE.Color(current.background);
  }
  apply(style);
  return {
    get style() { return current; },
    setStyle: apply,
    setSize(width, height) { composer.setSize(width, height); },
    render() {
      const { distance, radius } = getFocus();
      const unit = Math.max(distance * UNIT_PER_DISTANCE, 1e-6);
      const R = Math.max(radius, distance * 0.2) / unit;
      const d = distance / unit;
      pass.uniforms.uUnit.value = unit;
      pass.uniforms.uFogN.value = d - 0.25 * R;
      pass.uniforms.uFogF.value = d + 1.3 * R;
      composer.render();
    },
    dispose() { pass.dispose(); composer.dispose(); },
  };
}
