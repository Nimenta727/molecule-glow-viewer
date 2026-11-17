/* ---- workshop: two sources (official / community), each a folder with index.json + packs/ + covers/ in the GitHub repo */
const shop = { src: 'official', cat: 'all', q: '', sort: 'title', idx: {}, err: {}, stats: null };
/* phase 2 on GitHub: workshop/stats.json (built every 6 h by CI from each scene's discussion thread: 👍 / 👎 = rating, replies = comments) */
async function shopStats() {
  if (shop.stats) return shop.stats;
  try { const r = await fetch(WS_BASE + 'stats.json', { cache: 'no-cache' }); if (r.ok) { const J = await r.json(); if (J.format === 'glow-stats') return shop.stats = J.packs || {}; } } catch (e) {}
  return shop.stats = {};
}
const subsGet = () => { try { return JSON.parse(localStorage.getItem('glowSubs') || '{}'); } catch (e) { return {}; } };
const subsSet = (s) => { try { localStorage.setItem('glowSubs', JSON.stringify(s)); } catch (e) {} };
async function sha256Hex(text) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function shopIndex(src, force) {
  if (shop.idx[src] && !force) return shop.idx[src];
  try { const r = await fetch(WS_SRC[src].url + 'index.json', { cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const I = await r.json(); if (I.format !== 'glow-index') throw new Error('目录格式不对'); shop.err[src] = null;
    return shop.idx[src] = I; }
  catch (e) { shop.err[src] = e.message; return null; }
}
async function shopFetchPack(src, entry) {
  const r = await fetch(WS_SRC[src].url + entry.file, { cache: 'no-cache' }); if (!r.ok) throw new Error('下载失败 HTTP ' + r.status);
  const text = await r.text();
  if (entry.sha256 && await sha256Hex(text) !== entry.sha256) throw new PackError('文件校验不一致（目录和文件不匹配），已拒绝打开');
  return sanitizePack(JSON.parse(text), src === 'official');
}
const escT = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
async function renderShop() {
  const grid = $('shopGrid'), subs = subsGet();
  document.querySelectorAll('#shopTabs button').forEach(b => b.classList.toggle('on', b.dataset.src === shop.src));
  document.querySelectorAll('#shopCats button').forEach(b => b.classList.toggle('on', b.dataset.cat === shop.cat));
  let items = [];
  if (shop.src === 'subs') items = Object.values(subs).map(s => ({ ...s.entry, _src: s.src }));
  else { grid.innerHTML = '<div class="shopMsg">正在读取目录…</div>'; const I = await shopIndex(shop.src);
    if (!I) { grid.innerHTML = `<div class="shopMsg">连不上工坊（${escT(shop.err[shop.src])}）。离线时可以打开“已订阅”里看过的场景，或导入本地 .glow 文件。</div>`; return; }
    items = I.packs.map(e => ({ ...e, _src: shop.src })); }
  const ST = await shopStats(), q = shop.q.trim().toLowerCase();
  items = items.filter(e => (shop.cat === 'all' || e.category === shop.cat) && (!q || [e.title, e.description, ...(e.tags || []), e.author?.name, ...(e.pdb || [])].join(' ').toLowerCase().includes(q)));
  const score = (e) => (ST[e.id]?.up || 0) - (ST[e.id]?.down || 0);
  if (shop.sort === 'hot') items.sort((a, b) => score(b) - score(a) || (ST[b.id]?.comments || 0) - (ST[a.id]?.comments || 0));
  else if (shop.sort === 'new') items.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
  if (!items.length) { grid.innerHTML = `<div class="shopMsg">${shop.src === 'subs' ? '还没有订阅的场景。订阅后会出现在左侧预设里，有新版本时自动更新。' : '没有符合条件的场景。'}</div>`; return; }
  const latest = (e) => shop.idx[e._src]?.packs.find(x => x.id === e.id);
  grid.innerHTML = items.map(e => { const sub = subs[e.id], upd = sub && latest(e) && latest(e).revision > sub.revision;
    return `<div class="card" data-id="${escT(e.id)}" data-src="${e._src}">
      <div class="cov">${e.cover ? `<img loading="lazy" src="${escT(WS_SRC[e._src].url + e.cover)}" alt="">` : ''}<span class="badge ${e._src}">${WS_SRC[e._src].name}</span></div>
      <div class="cb"><b>${escT(e.title)}</b><div class="meta">${escT(PACK_CATS[e.category] || '')} · ${escT(e.author?.name || '匿名')} · 第 ${e.revision | 0} 版${upd ? ' · <span class="upd">有更新</span>' : ''}</div>
      <div class="desc">${escT((e.description || '').slice(0, 90))}</div>${ST[e.id] ? `<div class="soc"><span title="GitHub 讨论帖上的 👍 / 👎">👍 ${ST[e.id].up | 0}${ST[e.id].down ? ' · 👎 ' + (ST[e.id].down | 0) : ''}</span><span>💬 ${ST[e.id].comments | 0}</span></div>${ST[e.id].latest?.length ? `<div class="cmt">“${escT(ST[e.id].latest[0].text.slice(0, 70))}” —${escT(ST[e.id].latest[0].author)}</div>` : ''}` : ''}<div class="tags">${(e.tags || []).map(t => `<span>${escT(t)}</span>`).join('')}</div>
      <div class="acts"><button data-a="open">打开</button><button class="ghost" data-a="sub">${sub ? '取消订阅' : '订阅'}</button>${ST[e.id]?.url ? '<button class="ghost" data-a="talk" title="在 GitHub 讨论帖里点赞、评论（用 GitHub 账号登录）">评分 / 评论</button>' : ''}${e._src === 'community' ? '<button class="ghost" data-a="report">举报</button>' : ''}</div></div></div>`; }).join('');
}
async function shopAction(a, id, src) {
  const subs = subsGet();
  const entry = shop.idx[src]?.packs.find(x => x.id === id) || subs[id]?.entry; if (!entry) return;
  if (a === 'talk') { const u = shop.stats?.[id]?.url; if (u && /^https:\/\/github\.com\//.test(u)) open(u, '_blank'); return; }
  if (a === 'report') { open(`${WS_REPO}/issues/new?template=report-scene.yml&title=${encodeURIComponent('举报：' + id)}`, '_blank'); return; }
  if (a === 'sub') { if (subs[id]) delete subs[id]; else subs[id] = { src, revision: entry.revision, entry }; subsSet(subs); renderSubs(); renderShop(); return; }
  if (a === 'open') {
    status(`下载场景 ${entry.title} …`, true);
    try { const P = await shopFetchPack(src, entry); if (subs[id]) { subs[id] = { src, revision: P.revision, entry: { ...entry, revision: P.revision } }; subsSet(subs); renderSubs(); }
      $('shop').classList.remove('on'); await openPack(P, src); }
    catch (e) { console.warn(e); status('打不开这个场景：' + e.message); }
  }
}
/* subscribed packs appear among the presets (★), in their category tab */
function renderSubs() {
  document.querySelectorAll('#presets button.subp').forEach(b => b.remove());
  const subs = subsGet(), active = document.querySelector('#modeTabs button.on')?.dataset.cat;
  for (const [id, s] of Object.entries(subs)) {
    const b = document.createElement('button'); b.className = 'subp' + (s.entry.category !== active ? ' off' : ''); b.dataset.cat = s.entry.category || 'single';
    b.textContent = '★ ' + s.entry.title; b.title = `${WS_SRC[s.src]?.name || ''}工坊 · ${s.entry.author?.name || ''}`;
    b.onclick = () => { shop.src = s.src; shopAction('open', id, s.src); };
    $('presets').appendChild(b);
  }
}
/* auto-update: compare subscribed versions with the indexes once at start (quietly; offline is fine) */
async function checkSubUpdates() {
  const subs = subsGet(), srcs = [...new Set(Object.values(subs).map(s => s.src))]; let n = 0;
  for (const src of srcs) { const I = await shopIndex(src); if (!I) continue;
    for (const [id, s] of Object.entries(subs)) if (s.src === src) { const e = I.packs.find(x => x.id === id); if (e && e.revision > s.revision) { subs[id].entry = e; n++; } } }
  if (n) { subsSet(subs); renderSubs(); status(`${n} 个订阅的场景有新版本，打开时会自动下载最新版`); }
}
function publishHelp() {
  try { const P = packFromCurrent(); downloadPack(P); }
  catch (e) { status('导出失败：' + e.message); return; }
  $('shopPub').style.display = 'block';
}

