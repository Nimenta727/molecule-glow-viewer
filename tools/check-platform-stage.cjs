// Compile modules without evaluating application code. All resolution is rooted in the stage.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { sha256 } = require('../desktop/scripts/stage-manifest.cjs');
function checkStage(directory) {
  if (!vm.SourceTextModule) throw new Error('Run with --experimental-vm-modules');
  const stage = fs.realpathSync(directory), app = path.join(stage, 'app');
  const context = vm.createContext({}), visited = new Set(); let modules = 0;
  function required(file) {
    if (!file.startsWith(stage + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.realpathSync(file).startsWith(stage + path.sep)) throw new Error('Missing or escaped packaged dependency: ' + file);
    return file;
  }
  function resolve(specifier, importer, imports, base) {
    let target = specifier;
    const alias = Object.keys(imports).sort((a, b) => b.length - a.length).find((key) => key === specifier || key.endsWith('/') && specifier.startsWith(key));
    if (alias) target = new URL(imports[alias] + (alias.endsWith('/') ? specifier.slice(alias.length) : ''), base).href;
    else if (!/^\.?\.?\//.test(target) && !target.startsWith('file:') && !target.startsWith('https:')) throw new Error('Unmapped packaged import: ' + target);
    const cdn = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
    if (target.startsWith(cdn)) return required(path.join(stage, 'vendor/three', target.slice(cdn.length)));
    const url = new URL(target, pathToFileURL(importer));
    if (url.protocol !== 'file:') throw new Error('Unbundled remote module: ' + url.href);
    return required(fileURLToPath(url));
  }
  function compile(source, file, imports, base) {
    const parsed = new vm.SourceTextModule(source, { identifier: file, context }); modules++;
    const dynamic = [...source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g)].map((match) => match[2]);
    for (const specifier of new Set([...parsed.dependencySpecifiers, ...dynamic])) visit(resolve(specifier, file, imports, base), imports, base);
  }
  function visit(file, imports, base) {
    if (visited.has(file)) return; visited.add(file);
    compile(fs.readFileSync(required(file), 'utf8'), file, imports, base);
  }
  for (const entry of ['index.html', 'dev.html', 'apps/viewer-web/index.html', 'apps/studio-web/index.html']) {
    const file = required(path.join(app, entry)), html = fs.readFileSync(file, 'utf8'), base = pathToFileURL(file);
    const map = html.match(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
    const imports = map ? JSON.parse(map[1]).imports : {};
    for (const match of html.matchAll(/<(script|link)\b([^>]*)>(?:([\s\S]*?)<\/script>)?/gi)) {
      const [, tag, attributes, body] = match, src = attributes.match(/\b(?:src|href)=["']([^"']+)["']/i)?.[1];
      if (src && !src.startsWith('data:')) {
        const resource = resolve(src.startsWith('.') || src.includes(':') ? src : './' + src, file, imports, base);
        if (tag.toLowerCase() === 'script' && /\btype=["']module["']/.test(attributes)) visit(resource, imports, base);
      } else if (tag.toLowerCase() === 'script' && /\btype=["']module["']/.test(attributes)) compile(body, file, imports, base);
    }
  }
  const info = JSON.parse(fs.readFileSync(required(path.join(stage, 'build-info.json')), 'utf8'));
  if (sha256(JSON.stringify(info.files)) !== info.contentSha256) throw new Error('Build file-list hash mismatch');
  for (const record of info.files) if (sha256(fs.readFileSync(required(path.resolve(stage, record.path)))) !== record.sha256) throw new Error('Build content hash mismatch: ' + record.path);
  const commonjs = new Set();
  function checkCommonJs(file) {
    required(file); if (commonjs.has(file)) return; commonjs.add(file);
    const source = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.json')) { JSON.parse(source); return; }
    new vm.Script(source, { filename: file });
    for (const match of source.matchAll(/\brequire\s*\(\s*(['"])(\.[^'"]+)\1\s*\)/g)) checkCommonJs(path.resolve(path.dirname(file), match[2]));
  }
  for (const file of ['main.js', 'preload.js', 'platform-shell.cjs', 'smoke-runner.cjs']) checkCommonJs(path.join(stage, file));
  return { ok: true, modules, contentSha256: info.contentSha256, sourceCommit: info.sourceCommit, sourceDirty: info.sourceDirty };
}
module.exports = { checkStage };
if (require.main === module) {
  try { console.log(JSON.stringify(checkStage(process.argv[2]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
