#!/usr/bin/env node
// Workshop phase 2 on GitHub alone: every scene gets a discussion thread (GitHub Discussions, category "Show and tell"),
// 👍 / 👎 on the thread are the rating, replies are the comments, the GitHub account is the login. This script
//  1. creates a thread for every pack in the two indexes that has none yet (marker <!-- glow-id: ID --> in the body),
//  2. writes workshop/stats.json: per pack the thread URL, 👍 / 👎 / ❤️ counts, comment count and the 3 latest comments.
// The viewer reads stats.json (one static file, no API rate limits, nothing to log in to for reading).
// Needs GH_TOKEN with discussions: write. Output is deterministic (no timestamps), so CI commits only real changes.
import fs from 'node:fs';
import path from 'node:path';
import { WS, SOURCES } from './glow-lib.mjs';

const [owner, name] = (process.env.GITHUB_REPOSITORY || 'Nimenta727/molecule-glow-viewer').split('/');
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN; if (!token) { console.error('GH_TOKEN missing'); process.exit(1); }
const dry = process.argv.includes('--dry');
async function gql(query, variables = {}) {
  const r = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { authorization: 'bearer ' + token, 'content-type': 'application/json', 'user-agent': 'glow-workshop' }, body: JSON.stringify({ query, variables }) });
  const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors)); return j.data;
}
const MARK = /<!--\s*glow-id:\s*([a-z0-9._-]+)\s*-->/;
const plain = (s) => String(s || '').replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '[代码]').replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]').replace(/\s+/g, ' ').trim().slice(0, 220);

const repo = (await gql(`query($o:String!,$n:String!){repository(owner:$o,name:$n){id discussionCategories(first:25){nodes{id slug}}}}`, { o: owner, n: name })).repository;
const cat = repo.discussionCategories.nodes.find(c => c.slug === 'show-and-tell') || repo.discussionCategories.nodes.find(c => c.slug === 'general');
if (!cat) throw new Error('no Show and tell / General discussion category');

/* existing threads */
const threads = new Map(); let after = null;
do {
  const d = (await gql(`query($o:String!,$n:String!,$c:ID!,$a:String){repository(owner:$o,name:$n){discussions(first:50,after:$a,categoryId:$c){pageInfo{hasNextPage endCursor}
    nodes{id url title body closed reactionGroups{content reactors{totalCount}} comments(last:3){totalCount nodes{author{login} createdAt body isMinimized}}}}}}`, { o: owner, n: name, c: cat.id, a: after })).repository.discussions;
  for (const t of d.nodes) { const m = MARK.exec(t.body || ''); if (m && !t.closed) threads.set(m[1], t); }
  after = d.pageInfo.hasNextPage ? d.pageInfo.endCursor : null;
} while (after);

const packs = SOURCES.flatMap(src => { const f = path.join(WS, src, 'index.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).packs.map(p => ({ ...p, src })) : []; });
for (const p of packs) {
  if (threads.has(p.id)) continue;
  const body = `<!-- glow-id: ${p.id} -->\n**${p.title}**（${p.src === 'official' ? '官方' : '社区'}场景，作者 ${p.author?.name || '匿名'}）\n\n${p.description || ''}\n\n` +
    `- 在查看器里打开：创意工坊 → 搜索 \`${p.id}\`，或网址参数 \`?ws=${p.src}/${p.id}\`\n- 结构：${(p.pdb || []).map(x => `[${x}](https://www.rcsb.org/structure/${x})`).join('、') || '—'}\n\n` +
    `👍 / 👎 给这个场景打分；在下面回复写评论、提问、报告错误。查看器的工坊卡片会显示这里的点赞数和最新评论（每 6 小时更新）。`;
  if (dry) { console.log('would create thread for', p.id); continue; }
  const t = (await gql(`mutation($r:ID!,$c:ID!,$t:String!,$b:String!){createDiscussion(input:{repositoryId:$r,categoryId:$c,title:$t,body:$b}){discussion{id url title body closed reactionGroups{content reactors{totalCount}} comments(last:3){totalCount nodes{author{login} createdAt body isMinimized}}}}}`,
    { r: repo.id, c: cat.id, t: `场景讨论：${p.title}`, b: body })).createDiscussion.discussion;
  threads.set(p.id, t); console.log('+ thread', p.id, t.url);
}

const R = (t, k) => t.reactionGroups?.find(g => g.content === k)?.reactors.totalCount || 0;
const stats = { format: 'glow-stats', version: 1, packs: {} };
for (const p of [...packs].sort((a, b) => a.id.localeCompare(b.id))) {
  const t = threads.get(p.id); if (!t) continue;
  stats.packs[p.id] = { url: t.url, up: R(t, 'THUMBS_UP'), down: R(t, 'THUMBS_DOWN'), heart: R(t, 'HEART'), comments: t.comments.totalCount,
    latest: t.comments.nodes.filter(c => !c.isMinimized).reverse().map(c => ({ author: c.author?.login || 'ghost', at: c.createdAt.slice(0, 10), text: plain(c.body) })) };
}
const out = path.join(WS, 'stats.json'), json = JSON.stringify(stats, null, 1) + '\n';
if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== json) { fs.writeFileSync(out, json); console.log(`↻ stats.json：${Object.keys(stats.packs).length} 个场景`); }
else console.log('= stats.json 无变化');
