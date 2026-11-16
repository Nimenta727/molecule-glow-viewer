// Copy the single-file viewer into app/. The viewer stays the one source of truth:
// the web version and the desktop app run the same index.html.
//   in the GitHub repo:   desktop/ next to web/index.html
//   in the working folder: glow_studio/ next to glow_viewer/index.html
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const candidates = [path.join(root, '..', 'web', 'index.html'), path.join(root, '..', 'glow_viewer', 'index.html')];
const src = candidates.find(f => fs.existsSync(f));
const dst = path.join(root, 'app', 'index.html');
fs.mkdirSync(path.dirname(dst), { recursive: true });
if (src) { fs.copyFileSync(src, dst); console.log('synced', path.relative(root, src), '-> app/index.html'); }
else if (fs.existsSync(dst)) console.log('viewer source not found, keeping existing app/index.html');
else { console.error('viewer not found, looked in:\n  ' + candidates.join('\n  ')); process.exit(1); }

// Three.js r160 goes into vendor/three/ (same layout as the CDN path). electron-builder strips any
// "examples" folder from node_modules, which is where OrbitControls and the post-processing passes live.
const three = path.join(root, 'node_modules', 'three'), vend = path.join(root, 'vendor', 'three');
if (fs.existsSync(three)) {
  fs.rmSync(vend, { recursive: true, force: true });
  fs.mkdirSync(path.join(vend, 'build'), { recursive: true });
  fs.copyFileSync(path.join(three, 'build', 'three.module.js'), path.join(vend, 'build', 'three.module.js'));
  fs.cpSync(path.join(three, 'examples', 'jsm'), path.join(vend, 'examples', 'jsm'), { recursive: true });
  console.log('vendored three', require(path.join(three, 'package.json')).version, '-> vendor/three');
} else if (!fs.existsSync(vend)) { console.error('three not installed: run npm install'); process.exit(1); }

// The project licence (Apache-2.0) ships inside the app; in the repo it lives one level up.
const lic = path.join(root, '..', 'LICENSE');
if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(root, 'LICENSE'));
