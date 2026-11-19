import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkParity } from '../check-feature-parity.mjs';
import { analyticComparison, ROOT } from '../parity-numerics.mjs';
const load=file=>JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'));
const inputs=()=>({inventory:load('docs/feature-parity.json'),registry:load('docs/parity/cases.json'),report:load('docs/parity/numerical-baseline.json')});
test('every classical feature and special regression has an explicit acceptance contract',()=>{assert.deepEqual(checkParity(),[]);});
test('parity checker rejects dropped classic scenarios, fake paths and duplicate feature IDs',()=>{
  const a=inputs();a.registry.classic_regressions.pop();assert(checkParity(a).some(x=>x.includes('Dropped classic')));
  const b=inputs();b.inventory.features[0].classic='../outside';assert(checkParity(b).some(x=>x.includes('Invalid local path')));
  const c=inputs();c.inventory.features.push(c.inventory.features[0]);assert(checkParity(c).some(x=>x.includes('Duplicate')));
});
test('script existence and scoped implementation cannot establish complete scientific parity',()=>{
  const a=inputs(),feature=a.inventory.features.find(x=>x.id==='mechanism.kcsa');feature.acceptance.parity='passed';
  assert(checkParity(a).some(x=>x.includes('full parity proof')));
  const b=inputs();b.inventory.features.find(x=>x.id==='mechanism.translation').status='implemented_scope';assert(checkParity(b).some(x=>x.includes('scope proof')));
  const c=inputs();c.inventory.features.find(x=>x.id==='mechanism.translation').acceptance.parity='not_applicable';assert(checkParity(c).some(x=>x.includes('cannot silently be N/A')));
});
test('changed model sources and falsified numeric rows invalidate recorded comparisons',()=>{
  const a=inputs();a.report.source_hashes['plugins/kcsa/kinetics.mjs']='0'.repeat(64);assert(checkParity(a).some(x=>x.includes('Stale numeric')));
  const b=inputs();b.report.rows[0].candidate+=1;assert(checkParity(b).some(x=>x.includes('Falsified numeric error')));
  const c=inputs();c.report.unresolved=[];assert(checkParity(c).some(x=>x.includes('retain unresolved')));
  const d=inputs();d.report.rows[0].tolerance=10;assert(checkParity(d).some(x=>x.includes('tolerance relaxation')));
  const e=inputs();e.inventory.features.find(x=>x.id==='mechanism.kcsa').scientific_card=null;assert(checkParity(e).some(x=>x.includes('lacks matching scientific card')));
});
test('actual classic analytic methods and candidate kinetics retain matching scoped invariants',()=>{
  const result=analyticComparison();assert(result.rows.every(x=>x.status==='passed'));
  assert(result.aggregates.kcsa_max_rate_relative_error<1e-12);assert(result.aggregates.kcsa_max_current_absolute_error<1e-10);assert.equal(result.aggregates.kcsa_max_gate_rate_absolute_error,0);
  assert.equal(result.atpProjection.classic_protons_at_one_exact_turn,8);
  assert.equal(result.adkInitialDifference.classic_fraction,.5);assert.equal(result.adkInitialDifference.candidate_fraction,0);
});
