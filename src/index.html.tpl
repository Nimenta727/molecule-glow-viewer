<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>分子光影查看器</title>
<style>
<!-- @include styles/viewer.css -->
</style>
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
} }
</script>
</head>
<body>
<!-- @include ui/body.html -->
<script type="module">
<!-- @include core/boot.js -->
<!-- @include data/presets.js -->
<!-- @include repr/palettes.js -->
<!-- @include core/utils.js -->
<!-- @include core/session.js -->
<!-- @include data/parse.js -->
<!-- @include data/rcsb.js -->
<!-- @include derived/geometry.js -->
<!-- @include view/renderer.js -->
<!-- @include repr/materials.js -->
<!-- @include core/state.js -->
<!-- @include repr/cartoon.js -->
<!-- @include repr/simplified.js -->
<!-- @include repr/illustration.js -->
<!-- @include derived/partition.js -->
<!-- @include ui/labels.js -->
<!-- @include derived/selection.js -->
<!-- @include ui/sequence-bar.js -->
<!-- @include repr/molecules.js -->
<!-- @include sim/anim-runner.js -->
<!-- @include view/tags.js -->
<!-- @include sim/motion-kit.js -->
<!-- @include data/extra-entries.js -->
<!-- @include repr/crowding.js -->
<!-- @include derived/tunnel.js -->
<!-- @include sim/translation-constants.js -->
<!-- @include sim/processes/atp-synthase.js -->
<!-- @include sim/processes/flagellar-motor.js -->
<!-- @include sim/processes/respiratory-chain.js -->
<!-- @include sim/processes/chloroplast.js -->
<!-- @include sim/processes/translation.js -->
<!-- @include sim/processes/kcsa.js -->
<!-- @include sim/processes/cell-corner.js -->
<!-- @include view/placement.js -->
<!-- @include core/load-guard.js -->
<!-- @include sim/processes/auto.js -->
<!-- @include sim/processes/whole-cell.js -->
<!-- @include core/load-scene.js -->
<!-- @include sim/cell-kinetics.js -->
<!-- @include ui/take-apart.js -->
<!-- @include sim/context.js -->
<!-- @include ui/evidence.js -->
<!-- @include core/clear-scene.js -->
<!-- @include repr/rebuild.js -->
<!-- @include repr/membrane.js -->
<!-- @include ui/legend.js -->
<!-- @include ui/ligand-focus.js -->
<!-- @include derived/pocket.js -->
<!-- @include ui/energy-strip.js -->
<!-- @include view/camera.js -->
<!-- @include pack/rules.js -->
<!-- @include pack/pack-io.js -->
<!-- @include sim/data-anim.js -->
<!-- @include pack/workshop.js -->
<!-- @include ui/controls.js -->
<!-- @include view/frame-loop.js -->
<!-- @include core/start.js -->
<!-- @include api/head.js -->
<!-- @include derived/selection-language.js -->
<!-- @include api/helpers.js -->
<!-- @include api/commands.js -->
<!-- @include api/measure.js -->
<!-- @include api/run.js -->
<!-- @include api/bridge.js -->
<!-- @include core/open-ws.js -->
</script>
</body>
</html>
