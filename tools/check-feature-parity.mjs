import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, SOURCES, codeHash } from './parity-numerics.mjs';
import { mechanismPlugins } from '../plugins/mechanism-catalog.mjs';
const json=file=>JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'));
export function checkParity({inventory=json('docs/feature-parity.json'),registry=json(inventory.case_registry),report=json('docs/parity/numerical-baseline.json')}={}) {
  const errors=[];const check=(ok,message)=>{if(!ok)errors.push(message);};
  const list=value=>Array.isArray(value)?value:[];
  const text=value=>typeof value==='string'&&value.trim().length>0;
  const local=(value,label)=>{
    const valid=text(value)&&!path.isAbsolute(value)&&!value.includes('\\')&&!value.split('/').includes('..')&&!value.includes(':');
    check(valid,'Invalid local path: '+label);if(!valid)return false;
    const exists=fs.existsSync(path.join(ROOT,value));check(exists,'Missing path: '+value);return exists;
  };
  check(inventory.schema_version===2,'Inventory schema_version must be 2');
  check(/^[a-f0-9]{40}$/.test(inventory.implementation_baseline),'Missing recorded implementation baseline');
  const features=list(inventory.features),cases=list(registry.cases),data=list(registry.data),regressions=list(registry.classic_regressions);
  check(features.length>=27,'Classic feature inventory was dropped');
  const unique=(items,label)=>{const ids=items.map(x=>x.id);check(ids.every(text)&&new Set(ids).size===ids.length,'Duplicate/missing '+label+' IDs');return new Set(ids);};
  const featureIds=unique(features,'feature'),caseIds=unique(cases,'case'),dataIds=unique(data,'data');unique(regressions,'regression');
  for(const item of data)local(item.path,'data '+item.id);
  for(const item of cases){
    check(['manual-contract','partial-automation','planned'].includes(item.kind),'Invalid case kind '+item.id);
    check(list(item.steps).length>0&&item.steps.every(text)&&text(item.expected),'Case lacks executable instructions/acceptance '+item.id);
    if(item.source)local(item.source,item.id);
    if(item.runner)local(item.runner,item.id);
    if(item.kind==='partial-automation')check(text(item.runner)&&text(item.scope),'Partial automation must declare runner and limits '+item.id);
    if(item.kind==='planned')check(!item.runner,'Planned case must not pretend an existing runner '+item.id);
  }
  const documentedPlugins=new Map();
  for(const f of features){
    check(['pending','preview_only','partial','implemented_scope'].includes(f.status),'Invalid implementation status '+f.id);
    local(f.classic,f.id);if(f.new)local(f.new,f.id);
    for(const file of list(f.evidence))local(file,f.id);
    check(text(f.remaining),'Missing known gap/scope '+f.id);
    const a=f.acceptance??{};
    for(const [key,ids] of [['classic_cases',caseIds],['candidate_cases',caseIds],['data',dataIds]]) {
      check(list(a[key]).length>0,'Missing '+key+' '+f.id);
      for(const id of list(a[key]))check(ids.has(id),'Unknown '+key+' '+id);
    }
    check(list(a.criteria).length>0&&a.criteria.every(c=>text(c.observable)&&text(c.expected)),'No concrete acceptance criteria '+f.id);
    check(['pending','not_applicable','passed'].includes(a.parity),'Invalid parity state '+f.id);
    if(a.parity==='not_applicable')check(f.id.startsWith('release.')||f.id.startsWith('security.'),'Scientific/functional parity cannot silently be N/A '+f.id);
    if(f.status==='implemented_scope') {
      if(local(a.scope_record,'scope proof '+f.id)) {
        const proof=json(a.scope_record);
        check(/^[a-f0-9]{40}$/.test(proof.source_commit)&&proof.source_dirty===false,'Scoped implementation needs recorded clean artifact evidence '+f.id);
        check(proof.candidate?.sourceCommit===proof.source_commit,'Scope artifact source mismatch '+f.id);
      }
    }
    if(a.parity==='passed') {
      if(local(a.proof,'full parity proof '+f.id)) {
        const proof=json(a.proof),expected=[...a.classic_cases,...a.candidate_cases];
        check(proof.feature===f.id&&proof.status==='passed','Full parity proof identity mismatch '+f.id);
        check(expected.every(id=>list(proof.case_results).some(r=>r.id===id&&r.status==='passed')),'Full parity missing passing case records '+f.id);
        check(list(proof.screenshots).length>0,'Full parity needs visual evidence '+f.id);
        for(const file of list(proof.screenshots))local(file,f.id);
        check(Object.keys(proof.source_hashes??{}).length>0,'Full parity needs source content hashes '+f.id);
        for(const [file,digest] of Object.entries(proof.source_hashes??{}))if(local(file,f.id))check(codeHash(fs.readFileSync(path.join(ROOT,file),'utf8'))===digest,'Stale full parity source '+file);
        if(f.scientific_card)check(proof.scientific_review==='accepted_with_named_reviewer'&&text(proof.reviewer),'Scientific parity needs explicit review record '+f.id);
      }
    }
    if(f.id.startsWith('mechanism.')&&!['preview_only','pending'].includes(f.status)) {
      if(local(f.scientific_card,'scientific card '+f.id)) {
        const card=json(f.scientific_card);check(card.feature===f.id,'Scientific card feature mismatch '+f.id);
        check(text(card.plugin?.id)&&text(card.plugin?.version),'Missing card plugin identity '+f.id);
        documentedPlugins.set(card.plugin?.id,card.plugin?.version);
        for(const key of ['species','clocks'])check(text(card[key]),'Scientific card lacks '+key+' '+f.id);
        for(const key of ['experimental','derived','modelled','illustrative'])check(text(card.evidence_classes?.[key]),'Missing evidence class '+f.id);
        check(list(card.equations).length>0&&card.equations.every(x=>text(x.formula)&&text(x.unit)),'Equations/units missing '+f.id);
        check(Object.values(card.parameters??{}).length>0&&Object.values(card.parameters).every(x=>text(x.unit)),'Parameter units missing '+f.id);
        check(list(card.limitations).length>0&&list(card.literature).length>0,'Scientific limitations/literature missing '+f.id);
        const pinned=json('tools/fixtures/structures.json').structures;
        for(const s of list(card.structures))check(pinned.some(x=>x.id===s.id&&x.sha256===s.sha256&&x.url===s.url),'Unknown coordinate identity '+s.id);
        check(list(card.structures).length>0,'No structures '+f.id);
        for(const file of [...list(card.software),...list(card.classic_sources),...list(card.new_sources)])local(file,f.id);
        local(card.validation?.comparison_report,f.id);local(card.structure_metadata,f.id);
        check(card.validation?.expert_experimental_validation==='pending'||a.parity==='passed','Experimental validation must not be silently inferred '+f.id);
      }
    }
  }
  for(const plugin of mechanismPlugins)check(documentedPlugins.get(plugin.manifest.id)===plugin.manifest.version,'Installed mechanism lacks matching scientific card '+plugin.manifest.id);
  const classic=json('desktop/scripts/regress-scenes.json');
  const required=[...classic.list.map(x=>'scene.'+x.key),'rapid-switch','seed-7-kcsa','seed-7-atp-synthase','seed-7-translation','whole-cell-twice','return-navigation','pending-animation','failed-load-keeps-scene','bridge','rrna-length','particle-names'];
  for(const id of required)check(regressions.some(x=>x.id===id),'Dropped classic regression mapping '+id);
  for(const r of regressions){
    local(r.classic_runner,r.id);local(r.source_config,r.id);
    check(list(r.features).length>0&&r.features.every(x=>featureIds.has(x)),'Regression lacks mapped feature '+r.id);
    check(list(r.candidate_cases).length>0&&r.candidate_cases.every(x=>caseIds.has(x)),'Regression lacks candidate contract '+r.id);
    check(r.candidate_status==='pending','Only selected numeric comparisons currently run; regression mapping is not full parity '+r.id);
  }
  check(report.ok===true&&list(report.unresolved).length>0,'Numeric report must retain unresolved differences');
  for(const file of [...SOURCES,'tools/parity-numerics.mjs']) {
    check(text(report.source_hashes?.[file]),'Comparison source hash missing '+file);
    if(report.source_hashes?.[file])check(report.source_hashes[file]===codeHash(fs.readFileSync(path.join(ROOT,file),'utf8')),'Stale numeric comparison '+file);
  }
  check(list(report.rows).length>=19&&list(report.coordinate_rows).length>=5,'Missing analytic/real-coordinate rows');
  for(const row of [...list(report.rows),...list(report.coordinate_rows)]) {
    check([row.classic,row.candidate,row.absolute_error,row.tolerance].every(Number.isFinite)&&row.tolerance>=0,'Invalid numeric row '+row.observable);
    check(Math.abs(Math.abs(row.classic-row.candidate)-row.absolute_error)<1e-12,'Falsified numeric error '+row.observable);
    check(row.status==='passed'&&row.absolute_error<=row.tolerance,'Failed comparison '+row.observable);
    const ceilings={pA:1e-10,fraction:1e-12,degree:1e-6,Angstrom:1e-6,protons:0};
    check(Object.hasOwn(ceilings,row.unit)&&row.tolerance<=ceilings[row.unit],'Unreviewed tolerance relaxation '+row.observable);
  }
  return errors;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const errors=checkParity();if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
  else console.log('Feature contracts, 17 classic mappings, scientific cards and numeric source hashes: valid (full parity remains pending).');
}
