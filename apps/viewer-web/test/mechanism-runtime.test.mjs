import test from 'node:test';
import assert from 'node:assert/strict';
import { createMechanismRuntime } from '../mechanism-runtime.mjs';
const loaded=()=>({model:{atoms:[]},scene:{legacy:{scene:{process:'kcsa'}},assets:[{provenance:{parserVersion:'1',playback:{seed:7,time:2}}}]},warnings:[]});
test('mechanism adapter forwards the same scene/resources and saved state without owning another player',async()=>{
  const scene=loaded(),prepared={states:new Map()},parse=()=>{},accession=()=>{};let input,create;
  const factory={prepare:async value=>{input=value;return prepared;},create:value=>{create=value;return 'player';}};
  const runtime=createMechanismRuntime({getPlayer:()=>factory,getService:()=>({parse})},{loadAccession:accession});
  const signal=new AbortController().signal;await runtime.preparePlayer(scene,signal);
  assert.equal(input.loaded,scene);assert.equal(input.signal,signal);assert.equal(input.parse,parse);assert.equal(input.loadAccession,accession);
  assert.equal(runtime.createPlayer(scene),'player');assert.equal(create.scene,scene.scene);assert.equal(create.model,scene.model);assert.equal(create.states,prepared.states);assert.deepEqual(create.state,{seed:7,time:2});
  const state={time:8};runtime.createPlayer(scene,state);assert.equal(create.state,state);
});
test('mechanism adapter preserves preview diagnostics on preparation/create failures',async()=>{
  const scene=loaded(),factory={prepare:async()=>{throw Error('offline');},create:()=>{throw Error('invalid state');}};
  const runtime=createMechanismRuntime({getPlayer:()=>factory,getService:()=>({parse(){}})},{});
  await runtime.preparePlayer(scene,new AbortController().signal);assert(!scene.playerInputs);assert.match(scene.warnings[0],/offline/);
  assert.equal(runtime.createPlayer(scene),undefined);assert.match(scene.warnings[1],/invalid state/);
  assert.equal(runtime.createPlayer({...scene,model:null}),undefined);
});
test('late aborted preparations never commit inputs, and absent plugins leave the scene unchanged',async()=>{
  const scene=loaded(),controller=new AbortController();let release;
  const runtime=createMechanismRuntime({getPlayer:()=>({prepare:()=>new Promise(resolve=>{release=resolve;})}),getService:()=>({parse(){}})},{});
  const pending=runtime.preparePlayer(scene,controller.signal);controller.abort();release({states:'stale'});
  await assert.rejects(pending,/abort/i);assert(!scene.playerInputs);assert.deepEqual(scene.warnings,[]);
  const missing=createMechanismRuntime({getPlayer:()=>undefined},{});await missing.preparePlayer(scene,new AbortController().signal);assert.equal(missing.createPlayer(scene),undefined);
});
