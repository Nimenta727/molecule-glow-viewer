/* ----------------------------------------------------------------------------- materials */
const U = { uTime: { value: 0 }, uJitter: { value: 0.25 }, uRim: { value: 0.55 }, uGlow: { value: 0.05 }, uLumpy: { value: 0.5 },
  uHot: { value: 0.6 }, uMorph: { value: 0 }, uUpView: { value: new THREE.Vector3(0, 1, 0) }, uCutA: { value: new THREE.Vector4(0, 0, 0, -1) }, uCutB: { value: new THREE.Vector4(0, 0, 0, -1) }, uIllus: { value: 0 } };
const cutPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e9);
const noPlanes = [];
/* "剖开" parts: a WEDGE (default ±62 deg around the view direction at load time) is removed. The wedge is FIXED to the
   model, so nothing appears/disappears while the user orbits the camera; "剖面对准当前视角" re-aims it.
   Blob materials test the blob centre in the vertex shader (uCutA/uCutB); cartoon meshes use two clipping planes
   with clipIntersection (removed only where BOTH planes clip). */
const wedgePlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e9), new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e9)];
const planesFor = (g) => $('cutWhat').value === 'all' ? [cutPlane] : noPlanes;
function aimCut(halfDeg = 62, margin = 4) {
  const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(world.quaternion);
  const d = camera.position.clone().sub(world.position); d.addScaledVector(ax, -d.dot(ax));
  if (d.lengthSq() < 1) return;
  d.normalize();
  const half = THREE.MathUtils.degToRad(halfDeg);
  const m1 = d.clone().applyAxisAngle(ax, half - Math.PI / 2), m2 = d.clone().applyAxisAngle(ax, Math.PI / 2 - half);
  U.uCutA.value.set(m1.x, m1.y, m1.z, -margin); U.uCutB.value.set(m2.x, m2.y, m2.z, -margin);
  wedgePlanes[0].set(m1.clone().negate(), margin); wedgePlanes[1].set(m2.clone().negate(), margin);
}

function blobMaterial(opts = {}) {   // opts.cutaway: wedge cutaway; opts.shell: 'depth' | 'color' (outline shell of the schematic mode)
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: opts.roughness ?? 0.3, metalness: 0,
    clearcoat: 1.0, clearcoatRoughness: 0.12, sheen: 0.08, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff) });
  /* outline shell = two passes over the same enlarged blobs: 1) depth only, 2) colour with depthFunc <=, so only the
     OUTERMOST surface is drawn once (no build-up into fog); alpha comes from the Fresnel term -> glowing silhouette */
  if (opts.shell === 'depth') { m.colorWrite = false; m.transparent = true; }
  if (opts.shell === 'color') { m.transparent = true; m.depthWrite = false; m.depthFunc = THREE.LessEqualDepth; m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1; }
  m.customProgramCacheKey = () => 'blob-' + (opts.shell || '') + (opts.tag ? 't' : '');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { uCutOn: { value: opts.cutaway ? 1 : 0 } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uJitter, uLumpy, uMorph, uCutOn; uniform vec4 uCutA, uCutB;
        attribute float aHot; attribute vec3 aDelta; varying float vHot;
        float h1(float n){ return fract(sin(n) * 43758.5453); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float iid = float(gl_InstanceID);
        vec3 sq = vec3(1.0 + uLumpy*0.35*(h1(iid*1.3)-0.5), 1.0 + uLumpy*0.35*(h1(iid*2.1)-0.5), 1.0 + uLumpy*0.35*(h1(iid*3.7)-0.5));
        transformed *= sq * (1.0 + uLumpy*0.18*sin(position.x*5.0+iid)*sin(position.y*4.0+iid*.7));
        float isc = max(length(instanceMatrix[0].xyz), 1e-3);
        transformed += uJitter*0.35*vec3(sin(uTime*2.3+iid*1.7), sin(uTime*1.9+iid*2.9), sin(uTime*2.7+iid*0.6));
        transformed += aDelta * uMorph / isc;
        vec3 cw = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        if (uCutOn > 0.5 && dot(uCutA.xyz, cw) + uCutA.w > 0.0 && dot(uCutB.xyz, cw) + uCutB.w > 0.0) transformed = vec3(0.0);   // whole-blob wedge cutaway
        vHot = aHot;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uRim, uGlow, uHot, uTime, uIllus; uniform vec3 uUpView; varying float vHot;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #if defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)   // USE_INSTANCING_COLOR alone is vertex-only
          vec3 baseC = vColor.rgb;
        #else
          vec3 baseC = diffuse.rgb;
        #endif
        float fres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.6);
        float up = saturate(dot(normal, uUpView) * 0.5 + 0.5);
        float front = gl_FrontFacing ? 1.0 : 0.0;   // back faces = inside of a cut blob: dark, no rim
        diffuseColor.rgb *= mix(0.3, 1.0, front);
        totalEmissiveRadiance += baseC * (uGlow * up + front * uRim * fres * (0.25 + 1.1 * up));
        totalEmissiveRadiance += baseC * vHot * uHot * (0.55 + 0.45 * sin(uTime * 3.0));
        totalEmissiveRadiance = mix(totalEmissiveRadiance, baseC * (0.62 + 0.12 * up) * mix(0.3, 1.0, front), uIllus);   // illustrative: flat colour (Mol* / PDB-101)
        diffuseColor.rgb *= 1.0 - 0.8 * uIllus;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        { vec3 Ld = normalize(uUpView * 0.75 + vec3(-0.35, 0.0, 0.55)); float lam = saturate(dot(normal, Ld));
          vec3 ic = baseC * (0.86 + 0.14 * lam);   // nearly flat per residue; volume comes from the screen-space macro shading (InkPass)
          gl_FragColor.rgb = mix(gl_FragColor.rgb, ic * mix(0.35, 1.0, front), uIllus); }   // illustrative: soft volume, no gloss
        ${opts.tag ? 'if (uIllus > 0.5) gl_FragColor.a = 0.5;   // tag for InkPass: thin, light lines (membrane lipids)' : ''}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        ${opts.shell === 'color' ? `{ float fr = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.2);
          gl_FragColor = vec4(baseC * (0.12 + 1.5 * fr), 0.025 + 0.42 * fr); }` : ''}`);
  };
  return m;
}
/* schematic (cartoon) material: vertex colours + the same top-lit rim emission as the blobs */
function cartoonMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.15, side: THREE.DoubleSide });
  m.customProgramCacheKey = () => 'cartoon';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uRim, uGlow, uIllus; uniform vec3 uUpView;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 baseC = vColor.rgb;
        float fres = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.6);
        float up = saturate(dot(normal, uUpView) * 0.5 + 0.5);
        totalEmissiveRadiance += baseC * (uGlow * up + uRim * fres * (0.25 + 1.1 * up));
        totalEmissiveRadiance = mix(totalEmissiveRadiance, baseC * (0.62 + 0.12 * up), uIllus);
        diffuseColor.rgb *= 1.0 - 0.8 * uIllus;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        { vec3 Ld = normalize(uUpView * 0.75 + vec3(-0.35, 0.0, 0.55)); float lam = saturate(dot(normal, Ld));
          vec3 ic = baseC * (0.86 + 0.14 * lam);   // nearly flat per residue; volume comes from the screen-space macro shading (InkPass)
          gl_FragColor.rgb = mix(gl_FragColor.rgb, ic, uIllus); }`);
  };
  return m;
}
function ligandMaterial(boost = 1) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.15 });
  m.customProgramCacheKey = () => 'ligand' + boost;   // different boost = different shader
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uRim, uTime;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #if defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)   // USE_INSTANCING_COLOR alone is vertex-only
          vec3 baseC = vColor.rgb;
        #else
          vec3 baseC = diffuse.rgb;
        #endif
        float fres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.2);
        totalEmissiveRadiance += baseC * ${(0.22 * boost).toFixed(3)} * (1.0 + 0.35 * sin(uTime * 2.0)) + baseC * uRim * fres * 1.4;`);
  };
  return m;
}
/* every blob geometry must carry aHot / aDelta (shader attributes) */
function withAttrs(geo, n, hot, delta) {
  geo.setAttribute('aHot', new THREE.InstancedBufferAttribute(hot || new Float32Array(n), 1));
  geo.setAttribute('aDelta', new THREE.InstancedBufferAttribute(delta || new Float32Array(n * 3), 3));
  return geo;
}

