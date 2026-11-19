import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function checkDocs() {
  const files=['README.md','desktop/README.md','src/README.md','web/README.md'];
  const walk=dir=>{for(const e of fs.readdirSync(path.join(ROOT,dir),{withFileTypes:true})){
    if(e.name.toLowerCase()==='routine'||dir==='docs'&&['history','images','validation'].includes(e.name))continue;
    const name=dir+'/'+e.name;
    if(e.isDirectory())walk(name);else if(e.name.endsWith('.md'))files.push(name);
  }};walk('docs');walk('skill');
  const errors=[];
  for(const file of files)for(const match of fs.readFileSync(path.join(ROOT,file),'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    const value=match[1].replace(/^<|>$/g,'');if(value.includes('://')||value.startsWith('#'))continue;
    const target=path.resolve(ROOT,path.dirname(file),value.split('#')[0]);
    if(!target.startsWith(ROOT+path.sep)||!fs.existsSync(target))errors.push(file+': missing/escaped link '+value);
  }
  const archive=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/history/ARCHIVE_MAP.json'),'utf8'));
  for(const [old,current] of Object.entries(archive)) {
    if(!current.startsWith('docs/history/')||!fs.existsSync(path.join(ROOT,current)))errors.push('Missing archived document '+current);
    if(old!=='docs/CODEX_MIGRATION_HANDOFF.md'&&fs.existsSync(path.join(ROOT,old)))errors.push('Obsolete root document retained: '+old);
  }
  return errors;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const errors=checkDocs();if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Current docs/Skill links and historical archive mapping: valid; routine excluded.');
}
