import assert from 'node:assert/strict';
import { builtinModules, isBuiltin } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const coreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtinNames = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/, '')]));

function productionModules(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : productionModules(fullPath);
    return entry.isFile() && entry.name.endsWith('.mjs') ? [fullPath] : [];
  });
}

function importSpecifiers(source) {
  const specs = [];
  const patterns = [
    /\bimport\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'";]*?\s+from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1]);
  }
  if (/\bimport\s*\((?!\s*['"])[^)]*\)/.test(source)) specs.push('[non-literal dynamic import]');
  return specs;
}

test('Core production modules import only Core-local modules and platform built-ins', () => {
  const violations = [];
  for (const file of productionModules(coreRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      if (isBuiltin(specifier) || builtinNames.has(specifier)) continue;
      if (!specifier.startsWith('.')) {
        violations.push(`${path.relative(coreRoot, file)} imports external module "${specifier}"`);
        continue;
      }
      const target = path.resolve(path.dirname(file), specifier);
      const relative = path.relative(coreRoot, target);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        violations.push(`${path.relative(coreRoot, file)} imports outside Core: "${specifier}"`);
      }
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'));
});
