import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { permeationRates, singleChannelCurrent, gateRates, DEFAULTS, reversalPotential } from '../plugins/kcsa/kinetics.mjs';
import { fractionAtPhase, createAdkPlayback } from '../plugins/adenylate-kinase/playback.mjs';
import { createAtpPlayer } from '../plugins/atp-synthase/index.mjs';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { applyBiologicalAssembly } from '../plugins/structure/assembly.mjs';
import { buildAdkStructure, DOMAINS } from '../plugins/adenylate-kinase/structure.mjs';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
export const codeHash = text => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const SOURCES = ['src/sim/processes/kcsa.js','src/sim/processes/atp-synthase.js','src/view/frame-loop.js',
  'src/derived/geometry.js','src/data/parse.js','src/ui/ligand-focus.js',
  'plugins/kcsa/kinetics.mjs','plugins/kcsa/config.mjs','plugins/atp-synthase/index.mjs','plugins/atp-synthase/config.mjs','plugins/adenylate-kinase/playback.mjs','plugins/motion/conformation-machine.mjs','plugins/motion/conformation-set.mjs',
  'plugins/adenylate-kinase/structure.mjs','plugins/adenylate-kinase/config.mjs','plugins/shared/work-config.mjs','plugins/shared/bindings.mjs','plugins/atp-synthase/tool.mjs','plugins/adenylate-kinase/tool.mjs','plugins/kcsa/tool.mjs','plugins/motion/conformation.mjs','plugins/motion/path.mjs','plugins/motion/vectors.mjs','plugins/structure/parser.mjs','plugins/structure/assembly.mjs','plugins/structure/alignment.mjs',
  'plugins/structure/representation.mjs','plugins/structure/functional-preview.mjs','plugins/structure/density-surface.mjs',
  'desktop/package-lock.json','tools/parity-numerics.mjs'];
export function analyticComparison() {
  // Execute the actual classic object methods. Never maintain a copied third kinetic model.
  const classic = vm.runInNewContext('({' + read(SOURCES[0]) + '}).kcsa', {}, {timeout:1000});
  const rows = []; let maxRateRelativeError=0, maxCurrentAbsoluteError=0, maxGateAbsoluteError=0;
  for (const [Ki,Ko] of [[150,150],[140,5],[5,140]]) for (const V of [-150,-50,0,50,150]) {
    const config={...DEFAULTS,Ki,Ko,V,seed:7};
    const a=classic.permRates(config),b=permeationRates(config);
    for (const k of ['f','b']) for(let i=0;i<4;i++) maxRateRelativeError=Math.max(maxRateRelativeError,Math.abs(a[k][i]-b[k][i])/Math.max(1,Math.abs(a[k][i])));
    const old=classic.current(config),current=singleChannelCurrent(config),error=Math.abs(old-current);
    maxCurrentAbsoluteError=Math.max(maxCurrentAbsoluteError,error);
    rows.push({model:'kcsa',observable:'open-channel-current',input:{Ki,Ko,V,seed:7},unit:'pA',classic:old,candidate:current,absolute_error:error,tolerance:1e-10,status:error<=1e-10?'passed':'failed'});
    for (const gate of ['C','O','I']) for (const perm of ['A','B','C','D']) for(const blocked of ['none','tba','ba']) for(const pH of [4,7]) {
      const s={gate,perm,tba:blocked==='tba',ba:blocked==='ba'},c={...config,pH,wt:1,TBA:10,Ba:3};
      classic.s=s;const x=classic.gateRates(c),y=gateRates(s,c);
      if(x.length!==y.length)throw Error('KcsA rate edge count changed');
      for(let i=0;i<x.length;i++){if(x[i][1]!==y[i][1])throw Error('KcsA transition ID changed');maxGateAbsoluteError=Math.max(maxGateAbsoluteError,Math.abs(x[i][0]-y[i][0]));}
    }
  }
  const controls={spin:{value:2*Math.PI*.25},morphAuto:{checked:true},morph:{value:0}};
  const context=vm.createContext({THREE:{Quaternion:class {},Vector3:class {}},$ : key=>controls[key],syncOut(){},
    theta:0,morphT:0,U:{uTime:{value:0},uMorph:{value:0}},grade:{uniforms:{uT:{value:0}}},cellSim:null,kit:null,proc:null,groups:[],ligGroups:[],focus:null,current:{states:['4AKE','1AKE']}});
  vm.runInContext(read('src/derived/geometry.js'),context);
  const loop=read('src/view/frame-loop.js');
  vm.runInContext(loop.slice(loop.indexOf('function simStep('),loop.indexOf('/* scale bar')),context);
  const classicAtp=vm.runInContext(read('src/sim/processes/atp-synthase.js')+'}; PROCESSES.atpSynthase;',context);
  context.fastMode=()=>true;classicAtp.sites=[];classicAtp.lastK=0;classicAtp.flows=()=>{};
  const counters={'H⁺':0};
  for(let i=1;i<=40;i++) {
    context.simStep(.1);classicAtp.update({theta:context.theta,counters},.1);
    const old=+controls.morph.value,newValue=fractionAtPhase(context.morphT),error=Math.abs(old-newValue);
    if(i%10===0)rows.push({model:'adk',observable:'oscillator-at-matched-phase',input:{dt:.1,steps:i,seed:7,phase:context.morphT},unit:'fraction',classic:old,candidate:newValue,absolute_error:error,tolerance:1e-12,status:error<=1e-12?'passed':'failed'});
  }
  // A small epsilon difference at a step boundary is recorded; use exact theta to measure one turn.
  classicAtp.lastK=0;const fullTurn={'H⁺':0};classicAtp.update({theta:2*Math.PI,counters:fullTurn},0);
  const initial=createAdkPlayback({seed:7}).snapshot();
  return {rows,aggregates:{kcsa_max_rate_relative_error:maxRateRelativeError,kcsa_max_current_absolute_error:maxCurrentAbsoluteError,
    kcsa_max_gate_rate_absolute_error:maxGateAbsoluteError,kcsa_parameter_combinations:15*3*4*3*2},
    atpProjection:{scope:'Actual classic update with empty catalytic sites and no rendering flow; only proton rotor ledger is compared.',classic_protons_at_one_exact_turn:fullTurn['H⁺'],classic_spin_rad_per_second:2*Math.PI*.25,candidate_turns_per_second:.25,seed:7},
    adkInitialDifference:{classic_phase:0,classic_fraction:vm.runInContext('ease(.5)',context),candidate_phase:-Math.PI/2,candidate_fraction:initial.fraction,status:'known_difference'},
    reversal_mV:reversalPotential(DEFAULTS)};
}

export async function compare({fixtures}={}) {
  const result={schema_version:1,scope:'Selected analytic and coordinate invariants, not full scientific or visual parity.',
    source_hashes:Object.fromEntries(SOURCES.map(file=>[file,codeHash(read(file))])),...analyticComparison(),coordinate_rows:[],fixtures:[]};
  if(fixtures) {
    const manifest=JSON.parse(read('tools/fixtures/structures.json')).structures;
    const model=id=>{
      const record=manifest.find(x=>x.id===id),bytes=fs.readFileSync(path.join(fixtures,id+'.cif'));
      if(hash(bytes)!==record.sha256)throw Error('Coordinate hash mismatch: '+id);
      result.fixtures.push(record);return parseMmcif(bytes.toString('utf8'));
    };
    const THREE=await import(pathToFileURL(path.join(ROOT,'desktop/node_modules/three/build/three.module.js')));
    const context=vm.createContext({THREE,IGNORE_LIGANDS:new Set(['HOH','WAT'])});
    for(const file of ['src/derived/geometry.js','src/data/parse.js','src/ui/ligand-focus.js'])vm.runInContext(read(file),context);
    const open=model('4AKE'),closed=model('1AKE');
    const onlyA=m=>({...m,atoms:m.atoms.filter(a=>a.authChainId==='A')});
    const structure=buildAdkStructure(onlyA(open),onlyA(closed));
    const oldOpen=context.rowsToEntry(context.parseAtomSite(fs.readFileSync(path.join(fixtures,'4AKE.cif'),'utf8')),{}).atoms.filter(a=>a.ach==='A');
    const oldClosed=context.rowsToEntry(context.parseAtomSite(fs.readFileSync(path.join(fixtures,'1AKE.cif'),'utf8')),{}).atoms.filter(a=>a.ach==='A');
    const byNumber=new Map(oldClosed.map(a=>[a.aseq,a.p]));
    const old=context.domainTurns({},oldOpen,a=>a.p,a=>byNumber.get(a.aseq),DOMAINS.map(d=>[d.name,d.ranges]));
    const next=structure.measurements(1);
    for(let i=0;i<old.length;i++)for(const [oldKey,newKey,unit] of [['ang','angle','degree'],['shift','shift','Angstrom']]){
      const error=Math.abs(old[i][oldKey]-next[i][newKey]);
      result.coordinate_rows.push({model:'adk',observable:old[i].name+' '+newKey,input:{structures:['4AKE','1AKE'],chain:'A',fraction:1,seed:7},unit,
        classic:old[i][oldKey],candidate:next[i][newKey],absolute_error:error,tolerance:1e-6,status:error<=1e-6?'passed':'failed'});
    }
    result.adk_coordinate_summary={matched:structure.matched,core_rmsd_A:structure.rmsd};
    const atpModel=applyBiologicalAssembly(model('6ZPO'),true);
    const names=[...new Set(Object.values(atpModel.chainNames))];
    const scene={assets:[{id:'source',kind:'file',mediaType:'chemical/x-mmcif'}],nodes:names.map((partName,i)=>({id:String(i),parentId:'root',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},extensions:{'org.glow.structure':{sourceAssetId:'source',partName}}}))};
    const atp=createAtpPlayer({model:atpModel,scene,state:{seed:7,speed:.25,time:4}}),snapshot=atp.snapshot();
    result.atpProjection.candidate_counters_at_one_turn=snapshot.counters;
    result.coordinate_rows.push({model:'atp',observable:'proton rotor ledger, not catalytic site events',input:{structure:'6ZPO',seed:7,turns:1},unit:'protons',classic:result.atpProjection.classic_protons_at_one_exact_turn,candidate:snapshot.counters['H⁺'],absolute_error:Math.abs(result.atpProjection.classic_protons_at_one_exact_turn-snapshot.counters['H⁺']),tolerance:0,status:snapshot.counters['H⁺']===result.atpProjection.classic_protons_at_one_exact_turn?'passed':'failed'});
    atp.dispose();
  }
  result.unresolved=[
    {id:'kcsa-clock-rng',status:'pending',reason:'Classic separate gate/permeation RNG consumption and blocking tweens differ from continuous-time, non-blocking candidate scheduling. Seed 7 is not a cross-engine event equivalence proof.'},
    {id:'atp-atp-counter-phase',status:'pending',reason:'Classic synth() counts formation inside occupied sites; candidate counts completed release sectors. Empty-site proton probe does not measure ATP production or full classic event phase.'},
    {id:'adk-initial-and-intermediate',status:'pending',reason:'Classic oscillator starts at phase 0 and persists between loads; candidate starts open at -pi/2. Classic morph uses whole-chain fit, candidate CORE fit; endpoint relative-domain invariants do not prove intermediate geometry parity.'},
    {id:'whole-feature-and-experiment',status:'pending',reason:'Bulk particles, hydration, curves, full workflows and experimental validation remain outside these selected software comparisons.'}];
  result.ok=result.rows.concat(result.coordinate_rows).every(r=>r.status==='passed')&&result.aggregates.kcsa_max_rate_relative_error<=1e-12&&result.aggregates.kcsa_max_gate_rate_absolute_error<=1e-10;
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const option=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:undefined;
  const result=await compare({fixtures:option('--fixtures')});
  if(option('--output'))fs.writeFileSync(option('--output'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({ok:result.ok,analytic_rows:result.rows.length,coordinate_rows:result.coordinate_rows.length,aggregates:result.aggregates}));
  if(!result.ok)process.exitCode=1;
}
