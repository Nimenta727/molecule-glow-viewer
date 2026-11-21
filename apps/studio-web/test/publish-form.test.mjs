import test from 'node:test';
import assert from 'node:assert/strict';
import { readForm, fillForm, licenseChoices, revisionHint, FormError, EMPTY_FORM } from '../publish-form.mjs';

const filled = { ...EMPTY_FORM, authorName: ' Ann ', authorUrl: 'https://example.org/a', topic: 'mechanism', description: '  A lab.  ', tags: '酶、lab, lab  膜', revision: '2', updated: '2026-11-21', derivedId: 'official.kcsa', derivedRevision: '1' };
test('the form becomes a publication block: trimmed, tags de-duplicated, empty fields left out', () => {
  assert.deepEqual(readForm(filled), { license: 'CC-BY-4.0', author: { name: 'Ann', url: 'https://example.org/a' }, topic: 'mechanism', description: 'A lab.', tags: ['酶', 'lab', '膜'], revision: 2, updated: '2026-11-21', derivedFrom: { id: 'official.kcsa', revision: 1 } });
  assert.deepEqual(readForm({ authorName: 'Bo' }), { license: 'CC-BY-4.0', author: { name: 'Bo' } });
  assert.deepEqual(readForm({ authorName: 'Bo', derivedId: 'official.kcsa' }).derivedFrom, { id: 'official.kcsa' });
});
test('and back: what was read fills the form again', () => {
  const publication = readForm(filled), form = fillForm(publication);
  assert.deepEqual(readForm(form), publication);
  assert.deepEqual(fillForm(null), EMPTY_FORM); assert.equal(form.tags, '酶、lab、膜');
});
test('every wrong entry is refused with a reason a person can act on', () => {
  const bad = (values, pattern) => assert.throws(() => readForm({ ...filled, ...values }), (error) => error instanceof FormError && pattern.test(error.message), JSON.stringify(values));
  bad({ authorName: '  ' }, /作者名/); bad({ authorName: 'x'.repeat(81) }, /80/); bad({ authorUrl: 'http://x.org' }, /https/); bad({ authorUrl: 'javascript:alert(1)' }, /https/);
  bad({ license: 'GPL' }, /授权/); bad({ topic: 'cooking' }, /主题/); bad({ description: 'x'.repeat(401) }, /400/);
  bad({ tags: 'a b c d e f g h i' }, /8/); bad({ tags: 'x'.repeat(21) }, /20/);
  bad({ revision: '0' }, /版本/); bad({ revision: '1.5' }, /版本/); bad({ revision: 'two' }, /版本/); bad({ updated: '21/11/2026' }, /YYYY/);
  bad({ derivedId: 'X' }, /编号/); bad({ derivedRevision: '0' }, /版本/);
});
test('licence choices follow the parent: a share-alike parent leaves one choice, no parent leaves all', () => {
  assert.deepEqual(licenseChoices(null).map(({ allowed }) => allowed), [true, true, true]);
  const sa = licenseChoices({ license: 'CC-BY-SA-4.0' }); assert.deepEqual(sa.filter(({ allowed }) => allowed).map(({ id }) => id), ['CC-BY-SA-4.0']);
  assert.ok(sa.filter(({ allowed }) => !allowed).every(({ reason }) => /BY-SA/.test(reason)));
  assert.deepEqual(licenseChoices({ license: 'CC-BY-4.0' }).filter(({ allowed }) => allowed).map(({ id }) => id), ['CC-BY-4.0', 'CC-BY-SA-4.0']);
});
test('the revision hint says what the catalogue holds and what upgrade is valid', () => {
  const catalog = { templates: [], works: [{ id: 'ann.lab', author: { name: 'Ann' }, revision: 3 }] };
  assert.match(revisionHint(catalog, 'new.lab', 'Ann').text, /第 1 版/);
  assert.deepEqual(revisionHint(catalog, 'ann.lab', 'Ann'), { exists: true, mine: true, next: 4, text: revisionHint(catalog, 'ann.lab', 'Ann').text });
  assert.match(revisionHint(catalog, 'ann.lab', 'Ann').text, /设为 4/);
  assert.equal(revisionHint(catalog, 'ann.lab', 'Mallory').mine, false); assert.match(revisionHint(catalog, 'ann.lab', 'Mallory').text, /换编号/);
  assert.equal(revisionHint(null, 'x', 'y').exists, false);
});
