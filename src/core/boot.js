import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* seeded randomness: ?seed=<n> or a scene's `seed` makes particle paths, pools, crowds, membranes and blob sizes repeatable
   (mulberry32); without a seed it is Math.random. */
/* two streams (seed coverage): rand = simulation (gating, Gillespie picks, process decisions, particle timing),
   randVis = scenery only (blob sizes, crowds, lipids, whole-cell layout, stream jitter). A change in what is drawn (quality level,
   crowd count) then cannot change the simulated history of the same seed. */
let rand = Math.random, randVis = Math.random, randSeed = null, loadSeedOverride = null;
const randDir = (v) => { const u = (randVis() - 0.5) * 2, t = randVis() * 6.283185307, r = Math.sqrt(1 - u * u); return v.set(r * Math.cos(t), u, r * Math.sin(t)); };
const URL_SEED = new URLSearchParams(location.search).get('seed');
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function setSeed(v) {
  if (v == null || v === '') { rand = Math.random; randVis = Math.random; randSeed = null; return; }
  randSeed = (Number.isFinite(+v) ? Math.floor(+v) : [...String(v)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)) >>> 0;
  rand = mulberry32(randSeed); randVis = mulberry32(randSeed ^ 0x9E3779B9);
}
setSeed(URL_SEED);

