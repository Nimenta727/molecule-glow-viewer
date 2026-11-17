# Platform 2.0 compatibility inventory

Baseline commit `32555cca1849821a4eeafe81cd544bf11655cf61` on `main` (2026-11-17). This document records the existing outward display and content contracts that a Platform 2.0 viewer must preserve or adapt.

## Compatibility boundary

The existing viewer is the reference implementation for opening legacy `.glow` v1 packs and rendering their outward-facing scene state. Platform 2.0 should keep a compatibility adapter at the import boundary: accept the established inputs, normalize them to the new scene model, and retain visible content and intent. It may replace the internal renderer, command bus, and storage model.

The generic viewer contract covers structure or embedded-coordinate input, scene composition, representation and color choices, camera, captions, notes, evidence labels, and animation playback.

## Legacy `window.glow` API

`src/api/head.js`, `src/api/commands.js`, and `src/api/bridge.js` define the current API. `window.glow.version` is `1`; commands are queued serially, return JSON-compatible results, and are available as both `glow.run(name, args)` and convenience methods. `glow.help()` is the runtime command/argument reference. `glow.log` retains the last 200 calls; `glow.replay(log)` replays successful non-read-only calls and skips failed, read-only, or truncated entries.

| Command | Existing outward behavior |
|---|---|
| `help`, `info` | Discover commands; inspect scene, display, selection, camera, presets, and process names. |
| `load` | Accept PDB ID, preset key or exact legacy display name, `.glow` object/text, `{scene}`, an allowed HTTPS file URL, or `official/<id>` / `community/<id>`. A seeded load starts paused. |
| `select`, `sequence`, `measure` | Select residues/ligands, show sequence view, and measure. |
| `color`, `represent`, `style` | Set color/palette, representation, simplification, and light/dark visual style. |
| `camera` | Reset/focus/orbit/set view/auto-rotate; legacy text `spin on|off` is accepted. |
| `animate` | Play/pause, speed, slow/fast timescale, process visibility, morph, seed, deterministic fixed-step advancement. |
| `snapshot` | Return a PNG data URL (width 64–4096). |
| `exportPack`, `validatePack` | Export current scene as a v1 pack; validate and return cleaned pack/errors/warnings. |

Legacy input spellings explicitly accepted by the current implementation include exact preset keys and exact display names in `load`, string PDB IDs, and style aliases `light`/`dark`/`video` alongside `illustration`/`glow`. Do not silently drop them in a migration: either retain them at the adapter or emit a precise migration warning. This is not a license to add fuzzy matching; `load` deliberately uses exact matching.

### Embedded `postMessage` API

With `?embed=1` or `?dev=1`, the iframe announces `{glow:'ready', api:1}`. The viewer accepts `{glow:'cmd', id, cmd, args}` and responds to the sender's origin with `{glow:'reply', id, ok:true, result}` or `{glow:'reply', id, ok:false, error}`. Arguments may be an object, positional array, or single value. The official Pages origin and same-origin developer mode are trusted. Other HTTPS origins require explicit user consent. Their allowlist is `help`, `load`, `select`, `color`, `represent`, `style`, `camera`, `animate`, `sequence`, `measure`, `validatePack`, and `info`. The bridge returns results for permitted calls. Preserve consent and the restrictions around local files and pack input when implementing the compatibility facade. File origins and other non-HTTPS origins are ignored outside trusted developer mode.

## `.glow` v1 input and migration

The on-disk contract is UTF-8 JSON with `format: "glow-scene"`, `version: 1`, metadata, and a `scene` object. `src/pack/rules.js` is the validation source used both by the viewer and `workshop/tools/glow-lib.mjs`. Community content is data-only. `process` can reference a built-in process, and `animation` expresses data-driven flows and reactions. The v1 sanitizer retains the `mechanism` key and applies generic data cleaning. Treat it as retained metadata during import until a specific playback contract exists.

Preserve the v1 top-level metadata when present, including `format`, `version`, `id`, `revision`, `title`, `category`, `tags`, `author`, `license`, `description`, `citations`, `cover`, `created`, `updated`, `viewer`, and `scene`. Categories are `cell`, `system`, `single`, and `mechanism`. The workshop tool caps packs at 30 MiB, and the v1 sanitizer separately limits embedded coordinate text to 30 million string code units. The sanitizer cleans untrusted strings and removes unknown scene keys.

Scene compatibility keys are the union of preset fields plus: `caption`, `structure`, `animation`, `mechanism`, `memY`, `states`, `chains`, `assembly`, `auto`, `axis`, `evidence`, `seed`, and `reps`. Existing preset-derived fields include structure IDs, components, colors, notes, site notes, energy steps, membrane placement, cut settings, camera, ligand visibility, and process. Preserve unknown future values as migration metadata where feasible rather than silently losing them.

Animation v1 includes `version`, `orient`, `species`, `compartments`, `pools`, `flows`, and `reactions`. Current limits include 6 compartments, 24 species, 24 pools, 16 flows, and 16 reactions; flow routes have at most 40 points. Anchors include coordinates, ligand(s), residue/part, membrane, and center. Use `workshop/SCHEMA.md` and its two examples as the complete field-level reference.

### Built-in process names

These names are accepted by `scene.process` in the current viewer; they are legacy references and should map to named capabilities or display fallbacks during migration. `dataAnim` is an internal dispatcher for `animation` and is removed from `process` by validation. `auto` is an internal automatic PDB presentation path and is not listed as an API `info().processes` choice.

`atpSynthase`, `kcsa`, `translation`, `respiratoryChain`, `chloroplast`, `flagellarMotor`, `cellCorner`, `wholeCell`, `auto`, `dataAnim`.

When a viewer lacks the capability to play a legacy process, open the pack with its available structure, labels, and evidence, and show a playback-unavailable notice.

## Preset and official pack catalogs

Preset keys are stable ASCII identifiers generated in `src/data/presets.js`; exact legacy display names remain accepted. Current presets and their existing primary catalog IDs:

| Display name | Key | Existing ID |
|---|---|---|
| ATP 合酶（合成 ATP） | `atp-synthase` | `6ZPO` |
| 线粒体呼吸链（电子传递 → ATP） | `respiratory-chain` | `5GUP` |
| 叶绿体光反应（光 → NADPH + ATP） | `chloroplast-light` | `3JCU` |
| 鞭毛马达 | `flagellar-motor` | `7CGO` |
| 钾离子通道 KcsA（膜中，pH 门控，可加阻断剂） | `kcsa` | `1K4C` |
| 细胞一角：核糖体 + 钾通道（同时模拟） | `cell-corner` | `4V6F` |
| 整个细胞：大肠杆菌（从 2 µm 缩放到原子） | `whole-cell` | `4V6F` |
| 腺苷酸激酶（开合） | `adenylate-kinase` | `4AKE` |
| GroEL 伴侣蛋白 | `groel` | `1AON` |
| 核糖体翻译（mRNA → 蛋白质，可加抗生素） | `translation` | `4V6F` |
| 核小体 | `nucleosome` | `1KX5` |
| 20S 蛋白酶体（核心颗粒） | `proteasome-20s` | `5LE5` |
| SARS-CoV-2 刺突蛋白（三聚体） | `spike` | `6VXX` |

Official pack manifest baseline: `workshop/official/index.json`, `glow-index` version 1, updated `2026-11-16`. Revision and SHA-256 below are manifest values (hash of the corresponding pack bytes); use the file as canonical source when refreshing this inventory.

| Pack ID | Revision | SHA-256 | Pack path |
|---|---:|---|---|
| `official.proteasome-20s` | 1 | `194d3bc83f3715db5d4136f9824f1803d64ecd342e992acb3b518e1293b39589` | `workshop/official/packs/official.proteasome-20s.glow` |
| `official.flagellar-motor` | 1 | `2ac4e06d5ca70fe4a4764d940e04e3188f893d111125e09a89fce14238a35c5a` | `workshop/official/packs/official.flagellar-motor.glow` |
| `official.translation` | 1 | `66daa60dda615a5b4930a7219b92e495fda335962c73cf5a861769e9a919e6e4` | `workshop/official/packs/official.translation.glow` |
| `official.nucleosome` | 1 | `e357d3f59fe75c21fad555ee7e315b5512234da6347dbfb62308a80e27683922` | `workshop/official/packs/official.nucleosome.glow` |
| `official.kcsa` | 1 | `380c1efefa945a45564418de2766cc746ddd4e0cc64b5042908b490f39877879` | `workshop/official/packs/official.kcsa.glow` |
| `official.kcsa-data` | 1 | `8f93a90e94e44accadcf55eb1801cdbcff27e4e8c71e191ffd72b163852ca672` | `workshop/official/packs/official.kcsa-data.glow` |
| `official.cell-corner` | 1 | `f2ade9f4e93162add405ea03d2715e138f21dd9583b7173f1854a8a96ea382d1` | `workshop/official/packs/official.cell-corner.glow` |
| `official.respiratory-chain` | 2 | `818da1c09171ae7ef3466409f699044b22ac05052cf59ce46d0afdc350518a8a` | `workshop/official/packs/official.respiratory-chain.glow` |
| `official.adenylate-kinase` | 1 | `365aab38fb34d9c4122587c8ca13989e2df552133d5fe72652085acc6d060b26` | `workshop/official/packs/official.adenylate-kinase.glow` |
| `official.adk-reaction-data` | 1 | `5028e0933d0a04d34eb0a926502f5ba23b6e61fdd58ba2fb131da6a9824352f2` | `workshop/official/packs/official.adk-reaction-data.glow` |
| `official.chloroplast-light` | 2 | `b358b662cc58e734fdd8228076f9775cc08f1b36c749a34e4ce79931f82ef4ce` | `workshop/official/packs/official.chloroplast-light.glow` |
| `official.whole-cell` | 1 | `5844e1fa3da8fff2c8450c3a8bafeb277c49878344cab221eb6bf4ab76795677` | `workshop/official/packs/official.whole-cell.glow` |
| `official.atp-synthase` | 1 | `eabd3a18cf40a4b3fa14ae267f1829fe53053f22da6236675be5ccfeb4432221` | `workshop/official/packs/official.atp-synthase.glow` |
| `official.groel` | 1 | `c30af3fa02568ffe8b1f15b671a53cf4b65a3c7989f0f9e460bcd1138cd2364e` | `workshop/official/packs/official.groel.glow` |
| `official.spike` | 1 | `3eca68a076df85c61e2f105d9113a99301f1b9279bbff0a164152523dfe2d95d` | `workshop/official/packs/official.spike.glow` |

## Migration destination

Keep the legacy adapter as a narrow boundary, separate from new Core contracts:

1. Parse v1 and normalize it into the new versioned scene/document model. Preserve original pack ID, revision, source, and a copy/reference to unrecognized values for diagnostics.
2. Map `scene.id` and embedded `scene.structure` to asset references; keep components, chain filters, camera, visible representations, colors, captions/notes, and evidence as display state.
3. Map v1 `process` names to a versioned playback capability when available. If unavailable, render the static scene and report the unsupported process. Map `animation` to timeline/playback data without running pack code.
4. Keep `.glow` export explicitly versioned. A v2 save must not masquerade as v1; retain a v1 export path only when the converted fields are representable, and report lossy conversions.
5. Preserve old `window.glow` calls through a compatibility facade that forwards commands to the new command service. Keep embed origin checks, safe-command allowlist, user consent, queue semantics, and JSON replies at the boundary.

## Existing compatibility fixtures

Use these existing assets as migration fixtures, without changing their scientific content:

- `desktop/scripts/regress-scenes.json`: baseline display fixtures for `4HHB` automatic mode, the `atp-synthase`, `kcsa`, `translation`, `flagellar-motor`, and `cell-corner` presets; it also contains rapid-switch, deterministic-seed, and repeated-load cases.
- `desktop/regress/baseline.json`: captured result baseline for desktop scene regression.
- `workshop/official/packs/*.glow` and `workshop/official/index.json`: all 15 official v1 package fixtures; include both built-in-process and data-animation examples.
- `workshop/official/packs/official.kcsa-data.glow` and `official.adk-reaction-data.glow`: representative data-animation fixtures.
- `src/api/commands.js`: direct compatibility smoke examples in command docs (`load`, `select`, `sequence`, `color`, `represent`, `style`, `camera`, `animate`, `snapshot`, `exportPack`, `validatePack`); `help` and `info` cover discovery and outward state.

Compatibility acceptance should verify that each fixture opens, visible static scene state is retained, unsupported playback degrades with an explicit notice, pack export/validation reports format honestly, and embedded callers receive only the documented commands and reply shapes.
