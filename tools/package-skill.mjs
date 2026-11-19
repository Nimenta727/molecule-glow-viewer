import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const PREFIX='molecule-glow-viewer/';
export function skillFiles() {
  const base=path.join(ROOT,'skill'),files=[];
  const walk=dir=>{
    for(const e of fs.readdirSync(dir,{withFileTypes:true})) {
      const file=path.join(dir,e.name);
      if(e.isSymbolicLink())throw Error('Skill resource cannot be a symlink: '+file);
      if(e.isDirectory())walk(file);else if(e.isFile())files.push({path:path.relative(base,file).split(path.sep).join('/'),bytes:fs.readFileSync(file)});
    }
  };walk(base);
  for(const name of ['LICENSE','NOTICE'])files.push({path:name,bytes:fs.readFileSync(path.join(ROOT,name))});
  return files.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function verifySkill(bytes) {
  const reader=new ZipReader(new Uint8ArrayReader(bytes));
  try {
    const entries=await reader.getEntries(),files=new Map();
    for(const entry of entries) {
      if(!entry.filename.startsWith(PREFIX)||entry.filename.includes('..')||entry.filename.includes('\\')||files.has(entry.filename))throw Error('Invalid skill ZIP path');
      if(!entry.directory)files.set(entry.filename,await entry.getData(new Uint8ArrayWriter()));
    }
    const get=name=>{const value=files.get(PREFIX+name);if(!value)throw Error('Missing Skill resource: '+name);return value;};
    for(const name of ['SKILL.md','README.md','references/platform.md','assets/index.html','assets/viewer.html','assets/dev.html'])get(name);
    const manifest=JSON.parse(new TextDecoder().decode(get('skill-manifest.json')));
    if(manifest.files.length+1!==files.size)throw Error('Skill manifest does not cover all entries');
    for(const record of manifest.files)if(digest(get(record.path))!==record.sha256)throw Error('Skill hash mismatch: '+record.path);
    if(digest(get('assets/index.html'))!==digest(get('assets/viewer.html')))throw Error('Skill viewer aliases differ');
    const decode=name=>new TextDecoder().decode(get(name));
    if(!/^---\r?\nname: molecule-glow-viewer\r?\ndescription: .+/m.test(decode('SKILL.md')))throw Error('Invalid skill entrypoint');
    if(!decode('assets/dev.html').includes('src="index.html?'))throw Error('Unexpected workbench target');
    for(const record of manifest.files.filter(x=>x.path.endsWith('.md'))) {
      for(const match of decode(record.path).matchAll(/\]\(([^)]+)\)/g)) {
        const link=match[1];if(link.includes('://')||link.startsWith('#'))continue;
        const target=path.posix.normalize(path.posix.join(path.posix.dirname(record.path),link.split('#')[0]));
        if(target.startsWith('../'))throw Error('Skill reference escapes standalone bundle: '+record.path);
        get(target);
      }
    }
    return {ok:true,version:manifest.version,sourceCommit:manifest.sourceCommit,sourceDirty:manifest.sourceDirty,files:manifest.files.length};
  } finally {await reader.close();}
}
export async function packageSkill({output,allowDirty=false}={}) {
  const version=JSON.parse(fs.readFileSync(path.join(ROOT,'desktop/package.json'),'utf8')).version;
  const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  const dirty=spawnSync('git',['diff','--quiet','HEAD'],{cwd:ROOT}).status!==0||Boolean(execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:ROOT,encoding:'utf8'}).trim());
  if(dirty&&!allowDirty)throw Error('Skill release packaging requires a clean source commit');
  const files=skillFiles(),manifest={format:'molecule-glow-viewer-skill-v1',version,sourceCommit:commit,sourceDirty:dirty,
    runtime:'Bundled classic HTML; new platform development requires repository; Three.js CDN and coordinate downloads are separate.',
    files:files.map(({path,bytes})=>({path,bytes:bytes.length,sha256:digest(bytes)}))};
  const zip=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false,level:6});
  const options={lastModDate:new Date('2000-01-01T00:00:00Z')};
  for(const file of files)await zip.add(PREFIX+file.path,new Uint8ArrayReader(file.bytes),options);
  await zip.add(PREFIX+'skill-manifest.json',new Uint8ArrayReader(new TextEncoder().encode(JSON.stringify(manifest,null,2)+'\n')),options);
  const bytes=await zip.close(),verification=await verifySkill(bytes);
  const file=path.resolve(output??path.join(ROOT,'desktop/dist/release',`molecule-glow-viewer-skill-${version}.zip`));
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
  return {file,bytes:bytes.length,sha256:digest(bytes),...verification};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const value=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:undefined;
  const result=value('--verify')?await verifySkill(new Uint8Array(fs.readFileSync(value('--verify')))):
    await packageSkill({output:value('--output'),allowDirty:process.argv.includes('--allow-dirty')});
  console.log(JSON.stringify(result));
}
