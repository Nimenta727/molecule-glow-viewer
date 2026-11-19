const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function writeManifest(repo, stage, version) {
  const files = [];
  function visit(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error('Packaged resources cannot be symlinks: ' + file);
      if (item.isDirectory()) visit(file);
      else { const bytes = fs.readFileSync(file); files.push({ path: path.relative(stage, file).split(path.sep).join('/'), bytes: bytes.length, sha256: sha256(bytes) }); }
    }
  }
  visit(stage); files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  let trackedDirty = false;
  try { git('diff', '--quiet', 'HEAD', '--'); }
  catch (error) { if (error.status !== 1) throw error; trackedDirty = true; }
  const info = { format: 'glow-desktop-build', version, kind: 'migration-preview',
    sourceCommit: git('rev-parse', 'HEAD'), sourceDirty: trackedDirty || Boolean(git('ls-files', '--others', '--exclude-standard')),
    createdAt: new Date().toISOString(), electron: require(path.join(repo, 'desktop/node_modules/electron/package.json')).version,
    contentSha256: sha256(JSON.stringify(files)), files };
  fs.writeFileSync(path.join(stage, 'build-info.json'), JSON.stringify(info, null, 2));
  return info;
}
module.exports = { writeManifest, sha256 };
