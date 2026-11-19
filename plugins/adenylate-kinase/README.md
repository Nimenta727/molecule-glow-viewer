# Official AdK conformation player

`org.glow.legacy-process.adenylate-kinase@1.0.0`, API 1, depends on `org.glow.structure@1.0.0`. Registers a player and a declarative panel. The trusted application catalog recognizes the declared `4AKE → 1AKE` pair on a 4AKE scene without composite components. It does not infer a catalytic simulation from an arbitrary PDB ID, and does not handle `official.adk-reaction-data.glow`.

The host's asynchronous preparation adapter downloads 1AKE from RCSB, or reads its existing package resource. It validates the A-chain mapping, CORE alignment and Ap5A before committing the additional coordinate asset. Both original files remain unchanged; 1AKE has its own SHA-256 and provenance. Failed preparation preserves the static preview and a diagnostic. A v2 package reopens offline with the same model and playback state.

## Measured coordinates and teaching display

The primary model is 4AKE A, with 214 matched Cα residues. The closed reference is 1AKE A, with deposited Ap5A coordinates (57 heavy atoms after alternate-conformer selection). Following the classic domain definitions, CORE is 1–29 / 60–121 / 160–214, NMP is 30–59, and LID is 122–159. Closed coordinates are aligned onto the open CORE, making it the stable reference rather than using the whole-chain fit from the original morph loader. The measured CORE RMSD is 1.975 Å.

Domain measurements use the classic `domainTurns` procedure: re-fit the current CORE to the open CORE, then obtain each domain's rigid-fit rotation angle and centroid displacement. At the measured closed endpoint, NMP moves 44.82° / 9.79 Å and LID moves 52.16° / 14.38 Å (rounded figures shown by the panel). Intermediate measurements are derived from interpolated Cα positions, and are not reported as a measured transition trajectory.

Blue CORE, green NMP and orange LID are teaching colors. Runtime layers split by domain while retaining point identities. Cartoon, backbone, spheres and surfaces use a residue displacement field. Functional mode creates separate Gaussian domain surfaces and uses the classic 1.5 Å inward shrink to expose seams. These are coarse representations, not atomic solvent-excluded surfaces. The magenta Ap5A reference appears only at the closed end (`morph >= .99`) and can be hidden. It is an inhibitor reference, not an ATP/AMP reaction animation.

## Controls and persistence

`morph` is a 0–1 slider, `auto` is 0/1, and `ap5` is 0/1. `setMorph(number)` enters manual mode; `setMorph('auto')` resumes automatic motion continuously from the current shape. The oscillator follows the classic sine/ease/endpoint holds at 0.35 radians per demonstration second, with a configurable speed multiplier. Display time, phase, speed and parameter interventions are saved; edits after rewind replace future edits. Seek, fixed stepping and reopening are deterministic. The shared seed is retained for API compatibility; this player has no random events.

Teaching steps inspect captions and participants without forcing chemical transitions. The only counter is the displayed closure percentage. There are no ADP production counters, enzyme rates, ATP/AMP pools or reversible-reaction kinetics. The generic pure-data reaction pack, full ligand interaction analysis and reaction/compartment authoring remain separate migration tasks.

`glow.animate({morph:0.5})`, `glow.animate({morph:'auto',pause:false})` and `glow.animate({parameters:{ap5:0}})` operate the same instance as the panel. `glow.info()` returns `morph` and domain measurements in degrees/Å. `exportPack()` retains coordinates, parameters, selection and camera. The shared Viewer also restores saved state from the actual coordinate asset, avoiding unused external references, and follows moving point geometry with the selection marker.

## Verification

Synthetic rigid-domain tests independently verify known rotation angles, complete residue mapping, exact point deformation, identity retention, state validation and persistence. Real-coordinate Electron tests use `GLOW_ADK_SMOKE=<output directory>` with optional `GLOW_ADK_CIF_DIR=<directory containing unchanged 4AKE.cif and 1AKE.cif>`. They cover all five representations, manual/automatic motion, inhibitor visibility, endpoint measurements, fixed stepping, saved selection/camera, moving selection markers, offline reopen, navigation, plugin disable/re-enable and missing-state fallback. RCSB coordinate files are downloaded at runtime and are not bundled in the repository.
