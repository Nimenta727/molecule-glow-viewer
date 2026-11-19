# Official KcsA mechanism

`org.glow.legacy-process.kcsa@1.0.0`, API 1, depends on `org.glow.structure@1.0.0`. Registers a player factory and a declarative panel. The application loads it through the trusted mechanism catalog; `.glow` packages contain data only.

`factory.prepare({loaded,parse,loadAccession,signal})` obtains assembly 1 of 1K4C, 5VK6, 5VKE, 2HVK and 2ITD through the host adapters. The primary structure is reused. Four additional raw coordinate files, hashes and source metadata are committed together after successful preparation and are included in v2 exports. Reopening uses these files without fetching again. An unavailable required state leaves the static structure preview and an explicit diagnostic.

`factory.create({model,scene,states,state})` produces the shared player interface plus `setParameters()` and `validateParameters()`. The panel declares pH, voltage, K concentrations, intracellular Na concentration, E71A/wild-type kinetics, TBA/Ba concentrations and separate clock factors. `save()` retains seed, time, playback rate and up to 1000 parameter interventions. Changing a parameter after rewinding replaces future interventions. Seeking and fixed stepping replay the same seeded event history. Teaching steps inspect captions/participants without forcing a stochastic event.

## Structure and kinetics

The 24 chain permutations are tested against the four-chain pore region (author residues 60–80); fits above 2 Å fail. Verified RMSDs against the imported 1K4C tetramer are 0.428 Å (5VK6), 0.666 Å (5VKE), 0.080 Å (2HVK), and 0.247 Å (2ITD). Filter and cavity positions come from deposited K ions; blocker shapes/positions come from deposited TBA and Ba. A clearance-weighted grid search on aligned open-state residue coordinates finds both pore exits. Triangle, line and sphere representations deform through three measured conformations using a residue displacement field. Intermediate shapes, membrane and particle interpolation are teaching models.

The rates and four-state knock-on cycle are ported from `src/sim/processes/kcsa.js`. The new engine is a continuous-time Markov chain on display time with two rate scales: gate/block rates use `gateSpeed`, and permeation rates use `ionSpeed × 1e-9`. Both are multiplied by the simulation speed. Unlike the classic animation, particle interpolation does not block either clock. Actual gate seconds and conducting permeation nanoseconds are displayed separately. Thus frame rate and drawing time do not alter flux.

Current uses the four-state steady-state solution; the voltage factors obey detailed balance and reverse at `25.69 ln(Ko/Ki)` mV. Counters count stochastic transitions. The displayed open-channel current is conditional on an open, unblocked channel; instantaneous conducting current is zero when closed, inactivated or blocked. Open probability is measured in gate-clock time. These are teaching kinetics, not an atomistic MD trajectory or fitted experimental predictions. The open coordinate template is E71A even when the wild-type inactivation option is enabled.

Bulk compartment particles, hydration-shell rendering, extracellular sodium controls, and plotted time series from the classic station are not included in this batch. Cell-level station composition remains a later phase-four task.

## Verification

Node tests cover reversal potential, 80–120 pS symmetric-concentration conductance, ensemble flux against analytic current (128 seeds), pH/block/inactivation responses, clock scaling, replay, parameter validation, resource rollback/reuse, cancellation and expired factories. Electron `GLOW_KCSA_SMOKE` covers real-coordinate representations, captions, parameter changes, voltage reversal, neutral-pH inhibition, fixed stepping, package round-trip, navigation, plugin disable/re-enable, and missing-state fallback. `GLOW_KCSA_CIF_DIR` may point to the five unchanged RCSB files for repeatable tests; they are not bundled in the repository.
