import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkDocs } from '../check-docs.mjs';
import { packageSkill, verifySkill } from '../package-skill.mjs';
import { ZipReader, ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
test('current documentation links resolve after historical archive',()=>{assert.deepEqual(checkDocs(),[]);});
test('standalone Skill archive retains workbench target, references and source integrity',async()=>{
  const result=await packageSkill({allowDirty:true,output:'desktop/dist/skill-test.zip'});
  assert.equal(result.version,JSON.parse(fs.readFileSync('desktop/package.json','utf8')).version);
  const bytes=new Uint8Array(fs.readFileSync(result.file));assert.equal((await verifySkill(bytes)).ok,true);
  const reader=new ZipReader(new Uint8ArrayReader(bytes)),entries=await reader.getEntries(),writer=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false});
  for(const entry of entries)if(!entry.filename.endsWith('/assets/index.html'))await writer.add(entry.filename,new Uint8ArrayReader(await entry.getData(new Uint8ArrayWriter())));
  await reader.close();await assert.rejects(verifySkill(await writer.close()),/Missing Skill resource/);
  const html=fs.readFileSync('skill/assets/index.html','utf8').replace(/\r\n/g,'\n');
  assert.equal(html,fs.readFileSync('web/index.html','utf8').replace(/\r\n/g,'\n'));
});
