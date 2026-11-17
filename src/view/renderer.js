/* ----------------------------------------------------------------------------- renderer + lights + post */
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;
renderer.localClippingEnabled = true;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.12;

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 1e6);
const controls = new OrbitControls(camera, renderer.domElement);
/* listener counter for the regression probe: listeners added by scenes (controls, window) must go away with them */
const listenerCount = { controls: 0, window: 0, document: 0, canvas: 0 };
for (const [obj, key] of [[controls, 'controls'], [window, 'window'], [document, 'document'], [renderer.domElement, 'canvas']]) {
  const add = obj.addEventListener.bind(obj), rem = obj.removeEventListener.bind(obj), live = new Map();   /* type|capture -> WeakSet of handlers */
  const slot = (t, o) => { const k = t + '|' + !!(typeof o === 'boolean' ? o : o?.capture); if (!live.has(k)) live.set(k, new WeakSet()); return live.get(k); };
  obj.addEventListener = (t, f, o) => { if (f && (typeof f === 'function' || typeof f === 'object')) { const S = slot(t, o); if (!S.has(f)) { S.add(f); listenerCount[key]++; } } return add(t, f, o); };
  obj.removeEventListener = (t, f, o) => { if (f && (typeof f === 'function' || typeof f === 'object')) { const S = slot(t, o); if (S.has(f)) { S.delete(f); listenerCount[key]--; } } return rem(t, f, o); };
}
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.autoRotateSpeed = 0.6;

/* lighting recipe (matches the reference): strong top key, no fill from below (undersides fall to black),
   cool back rim + magenta side kicker for coloured edges */
scene.add(new THREE.HemisphereLight(0x9fb7ff, 0x000000, 0.12));
const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(0.35, 1.0, 0.45); scene.add(key);
const rimL = new THREE.DirectionalLight(0x8fb4ff, 2.4); rimL.position.set(-0.6, 0.5, -1.0); scene.add(rimL);
const kick = new THREE.DirectionalLight(0xff7ae0, 1.2); kick.position.set(1.0, 0.1, -0.6); scene.add(kick);

/* overlay scene: process objects (animated ATP/ADP/Pi, H+, K+) are drawn AFTER ambient occlusion and depth of field,
   on top of the proteins ("X-ray"), so molecules buried in a binding pocket stay visible and are not blackened by AO */
const overlay = new THREE.Scene();
overlay.environment = scene.environment; overlay.environmentIntensity = 0.3;
overlay.add(new THREE.HemisphereLight(0x9fb7ff, 0x000000, 0.3));
{ const k2 = new THREE.DirectionalLight(0xffffff, 2.0); k2.position.set(0.35, 1.0, 0.45); overlay.add(k2);
  const r2 = new THREE.DirectionalLight(0x8fb4ff, 1.5); r2.position.set(-0.6, 0.5, -1.0); overlay.add(r2); }

const composer = new EffectComposer(renderer);
for (const rt of [composer.renderTarget1, composer.renderTarget2]) { rt.depthTexture = new THREE.DepthTexture(); rt.depthTexture.type = THREE.UnsignedIntType; }
composer.addPass(new RenderPass(scene, camera));
/* illustration ink (screen space, from the depth buffer, so it works for every representation and every custom vertex
   shader): bold lines where one object passes in front of another (depth gap), fine lines in the grooves between residues /
   domains (depth Laplacian = Goodsell's texture lines), and depth cueing: far parts fade toward the paper colour. Line width
   is constant in pixels; thresholds scale with the size of a pixel at that depth. */
class InkPass extends Pass {
  constructor() {
    super();
    this.uniforms = { tDiffuse: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 1 }, uFar: { value: 1000 },
      uPx: { value: 0.001 }, uLine: { value: 1 }, uFog: { value: 0.5 }, uFogN: { value: 0 }, uFogF: { value: 1 }, uLW: { value: 2 }, uShade: { value: 1 }, uMacro: { value: 7 }, uT1: { value: 2.0 }, uT2: { value: 1.2 }, uG1: { value: 0.3 }, uG2: { value: 1.2 }, uBg: { value: new THREE.Color() }, uInk: { value: new THREE.Color(0x0b0c14) } };
    this.fsq = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse, tDepth; uniform vec2 uRes; uniform float uNear, uFar, uPx, uLine, uFog, uFogN, uFogF, uLW, uShade, uMacro, uT1, uT2, uG1, uG2; uniform vec3 uBg, uInk; varying vec2 vUv;
        float lz(vec2 uv) { float z = texture2D(tDepth, uv).x; return z >= 0.99999 ? 1e6 : uNear * uFar / (uFar - z * (uFar - uNear)); }
        void main() {
          vec4 c = texture2D(tDiffuse, vUv); vec2 p = 1.0 / uRes;
          float d0 = lz(vUv), dl = lz(vUv - vec2(p.x, 0.0)), dr = lz(vUv + vec2(p.x, 0.0)), dd = lz(vUv - vec2(0.0, p.y)), du = lz(vUv + vec2(0.0, p.y));
          float dn = min(d0, min(min(dl, dr), min(dd, du)));
          float dq[8];
          for (int i = 0; i < 8; i++) { float an = float(i) * 0.785398; dq[i] = lz(vUv + vec2(cos(an), sin(an)) * uLW * p); dn = min(dn, dq[i]); }
          if (dn > 1e5) { gl_FragColor = c; return; }
          float px = dn * uPx;                                                    // Angstrom per pixel here
          float gap = max(max(d0 - dl, d0 - dr), max(d0 - dd, d0 - du));          // on the far side of an edge -> line just outside the nearer object
          float strong = clamp((gap - (uT1 + uT2 * px)) / (1.0 + px), 0.0, 1.0);
          float tagW = 1.0;
          for (int i = 0; i < 8; i++) {   // silhouettes uLW px wide (ring of 8 samples at radius uLW); thin + light where the nearer object is tagged (lipids)
            float an = float(i) * 0.785398; vec2 o = vec2(cos(an), sin(an)) * uLW * p;
            float st = clamp((d0 - dq[i] - (uT1 + uT2 * uLW * px)) / (1.0 + uLW * px), 0.0, 1.0);
            if (texture2D(tDiffuse, vUv + o).a < 0.75) st *= 0.0;
            strong = max(strong, st);
          }
          if (c.a < 0.75 || texture2D(tDiffuse, vUv + vec2(p.x, 0.0)).a < 0.75 || texture2D(tDiffuse, vUv - vec2(p.x, 0.0)).a < 0.75) tagW = 0.4;
          float lap = d0 < 1e5 && max(max(dl, dr), max(dd, du)) < 1e5 ? 4.0 * d0 - dl - dr - dd - du : 0.0;   // > 0 in a groove
          float groove = smoothstep(uG1 * px + 0.2, uG2 * px + 1.0, lap) * 0.5;
          float ink = clamp(max(strong * tagW, groove) * uLine, 0.0, 1.0);
          /* macro shading: normal from the depth gradient over ~uMacro px -> whole domains look rounded, single residues stay flat */
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
        }` }));
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms; u.tDiffuse.value = readBuffer.texture; u.tDepth.value = readBuffer.depthTexture; u.uRes.value.set(readBuffer.width, readBuffer.height);
    u.uNear.value = camera.near; u.uFar.value = camera.far; u.uMacro.value = Math.max(3, 8 * readBuffer.height / 900); u.uLW.value = Math.max(1.5, 2.2 * readBuffer.height / 900); u.uPx.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / readBuffer.height;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.fsq.render(renderer);
  }
}
const inkPass = new InkPass(); inkPass.enabled = false;
composer.addPass(inkPass);
let aoPass = null;
try {
  const { GTAOPass } = await import('three/addons/postprocessing/GTAOPass.js');
  aoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
  aoPass.blendIntensity = 1.0;
  composer.addPass(aoPass);
} catch (e) { console.warn('GTAO unavailable', e); }
const bokeh = new BokehPass(scene, camera, { focus: 1000, aperture: 0.00002, maxblur: 0.01 });
composer.addPass(bokeh);
/* AO and depth-of-field render the scene themselves; hide the translucent outline shells during those renders */
function hideShellsDuring(pass) {
  if (!pass) return;
  const r = pass.render.bind(pass);
  pass.render = (...a) => {
    const sh = []; world.traverse(x => { if (x.userData.shell && x.visible) { sh.push(x); x.visible = false; } });
    r(...a); sh.forEach(x => x.visible = true);
  };
}
hideShellsDuring(aoPass); hideShellsDuring(bokeh);
/* RenderPass.clearDepth in r160 clears the PREVIOUS target, so clear the depth of readBuffer ourselves */
class ClearDepthPass extends Pass { constructor() { super(); this.needsSwap = false; }
  render(r, w, read) { r.setRenderTarget(read); r.clearDepth(); } }
composer.addPass(new ClearDepthPass());
const overlayPass = new RenderPass(overlay, camera); overlayPass.clear = false;
composer.addPass(overlayPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.45, 0.75);
composer.addPass(bloom);
composer.addPass(new OutputPass());
/* final colour grade: saturation, contrast, vignette, fine grain */
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.3 }, uCon: { value: 1.12 }, uVig: { value: 0.45 }, uGrain: { value: 0.018 }, uT: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uCon, uVig, uGrain, uT; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uT) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat); c.rgb = (c.rgb - 0.5) * uCon + 0.5;
      c.rgb *= 1.0 - uVig * smoothstep(0.3, 0.85, distance(vUv, vec2(0.5)));
      c.rgb += (rnd(vUv * 1000.0) - 0.5) * uGrain; gl_FragColor = vec4(max(c.rgb, 0.0), c.a); }`,
});
composer.addPass(grade);

