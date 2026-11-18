# Platform 2.0 migration baseline

The legacy reference is commit [`32555cca`](https://github.com/Nimenta727/molecule-glow-viewer/commit/32555cca1849821a4eeafe81cd544bf11655cf61). Keep comparisons pinned to that commit and consult the [compatibility inventory](PLATFORM_2_0_COMPATIBILITY.md) for entry points and input fixtures.

## Reproduce the baseline

Run these checks from the repository root. The sync command generates the Electron viewer copies before the hash comparison.

```sh
node tools/build.mjs --check
node desktop/scripts/sync.js --viewer-only
node tools/check-copies.mjs
node workshop/tools/validate.mjs
```

All four commands exited 0 on Windows 10.0.26300 with Node 26.13.1. Both generated Web files matched their sources. The Skill and desktop copies matched the Web files by SHA-256. Workshop validation passed all 15 official packs, and their file hashes matched the official index.

For desktop regression, run `npm ci` and then `node scripts/regress.mjs` from `desktop/`. Use the locked Electron 33.4.11 Windows x64 runtime. If the package manager skips Electron's install script, complete the runtime installation before starting the runner.

The runner compares with [the checked-in reference](../desktop/regress/baseline.json). The [fixture list](../desktop/scripts/regress-scenes.json) defines the six scenes, rapid switch, deterministic replay and repeated whole-cell load. Each run produces measurements and screenshots under the ignored `desktop/regress/latest/` directory. Archive these outputs before the next run if they are needed for comparison. Keep the original reference when measuring a migration. Compare FPS and load time on the same graphics host and record network or cache differences.

| Fixture | Entities | Chains | Residues | Ligands | Geometries |
| --- | ---: | ---: | ---: | ---: | ---: |
| `4HHB-hemoglobin` | 2 | 4 | 574 | 2 | 26 |
| `6ZPO-atp-synthase` | 18 | 29 | 5,150 | 4 | 53 |
| `1K4C-kcsa` | 1 | 4 | 412 | 2 | 19 |
| `4V6F-translation` | 53 | 55 | 10,600 | 2 | 81 |
| `7CGO-flagellar-motor` | 19 | 612 | 154,583 | 0 | 572 |
| `cell-corner` | 54 | 59 | 11,012 | 4 | 85 |

These counts come from the checked-in reference. The first four numeric columns are exact comparisons in the legacy runner. The geometry comparison uses its existing tolerance.

## P0 desktop capture

The run used Electron 33.4.11 on the Windows Hyper-V Video host. The six captures matched the checked-in entity, chain, residue and ligand counts. Geometry counts in fixture order were 25, 53, 19, 79, 572 and 85, all within the existing tolerance. Rapid switch, fixed-seed replay, repeated whole-cell loads, back navigation, animation cleanup, failed-load scene retention and the embed trust checks passed.

The runner initially exited 1 after a Git restoration converted the generated Web files to CRLF during the run. Both desktop copies still held the original generated LF bytes. After restoring generated LF files and synchronizing the copies, we replayed the runner's existing comparison against the captured `report.json`. The comparison exited 0 and matching SHA-256 values were verified independently. The checked-in reference was kept at its original revision.

This host reported FPS warnings for 4HHB, ATP synthase and KcsA, and load-time warnings for ATP synthase, KcsA and translation. Keep those measurements as local observations and use the same host for new performance comparisons.
