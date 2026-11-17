/* postMessage bridge (X1): only with ?embed=1 or ?dev=1; the sender must be same-origin or listed in ?origin=https://a,https://b
   (exact https origins); origin "null" (file://, sandboxed frames) is never accepted; replies go only to the sender's origin */
const BRIDGE_ON = params.get('embed') === '1' || params.get('dev') === '1';
/* A1: who may drive the viewer. The list is in the code, never in the URL (the embedder would write itself in).
   Trusted = the official site, or the same origin with ?dev=1 (the workbench). Any other https page gets only the
   SAFE commands, and only after the person looking at the viewer clicks "允许"; it never gets data back
   (no snapshot, export, log, or info while a local file is open). */
const EMBED_ORIGINS = new Set(['https://nimenta727.github.io']);
const BRIDGE_SAFE = new Set(['help', 'load', 'select', 'color', 'represent', 'style', 'camera', 'animate', 'sequence', 'measure', 'validatePack', 'info']);
const bridgeTrusted = (o) => typeof o === 'string' && o !== 'null' && (EMBED_ORIGINS.has(o) || (params.get('dev') === '1' && o === location.origin && location.origin !== 'null'));
const bridgeConsent = new Map();   /* origin -> 'yes' | 'no' | [pending messages] */
function askBridgeConsent(origin) {
  if (document.getElementById('bridgeAsk')) return;
  const d = document.createElement('div'); d.id = 'bridgeAsk';
  d.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:50;background:#fff;color:#1c2233;border:1px solid rgba(0,0,0,.2);border-radius:10px;padding:10px 14px;box-shadow:0 6px 24px rgba(0,0,0,.18);font-size:13px;max-width:min(520px,92vw)';
  d.innerHTML = `<div>网页 <b></b> 想控制这个查看器（只能换场景、选择、上色、改镜头和动画；不能截图、导出或读取你打开的文件）。</div>
    <div style="margin-top:8px;text-align:right"><button data-a="no">拒绝</button> <button data-a="yes">允许此网页控制查看器</button></div>`;
  d.querySelector('b').textContent = origin; document.body.appendChild(d);
  d.onclick = (ev) => { const a = ev.target.dataset?.a; if (!a) return; const pend = bridgeConsent.get(origin); bridgeConsent.set(origin, a); d.remove();
    if (a === 'yes' && Array.isArray(pend)) for (const m of pend) handleBridge(m); };
}
async function handleBridge(e) {
  const d = e.data, trusted = bridgeTrusted(e.origin);
  const reply = (m) => { try { e.source.postMessage({ glow: 'reply', id: d.id ?? null, ...m }, e.origin); } catch (err) { console.warn('glow reply', err); } };
  if (!trusted) {
    const cmd = d.cmd;
    if (!BRIDGE_SAFE.has(cmd) || (cmd === 'info' && current?.local) || (cmd === 'load' && (d.args?.pack != null || d.args?.packText != null))) { reply({ ok: false, error: `这个网页不能使用 ${cmd}` }); return; }
  }
  try { reply({ ok: true, result: d.cmd === 'replay' ? await glow.replay(d.args) : d.cmd === 'log' ? glowLog.slice() : await glowRun(d.cmd, d.args) }); }
  catch (err) { reply({ ok: false, error: String(err?.message || err) }); }
}
if (BRIDGE_ON) addEventListener('message', (e) => {
  const d = e.data; if (!d || typeof d !== 'object' || d.glow !== 'cmd' || !e.source) return;
  if (bridgeTrusted(e.origin)) { handleBridge(e); return; }
  if (typeof e.origin !== 'string' || !/^https:\/\//.test(e.origin)) return;   /* file:// (null) and http pages: never */
  const st = bridgeConsent.get(e.origin);
  if (st === 'yes') { handleBridge(e); return; }
  if (st === 'no') return;
  const pend = Array.isArray(st) ? st : []; if (pend.length < 20) pend.push(e); bridgeConsent.set(e.origin, pend); askBridgeConsent(e.origin);   /* no reply before the click */
});
if (params.get('embed') === '1') { document.body.classList.add('embed'); $('panel').classList.add('hidden'); }
if (BRIDGE_ON && window.parent !== window) try { window.parent.postMessage({ glow: 'ready', api: GLOW_API }, '*'); } catch (e) {}   /* no data in it */

