const GLOW_READONLY = new Set(['help', 'info', 'snapshot', 'exportPack', 'validatePack']);
const glowLog = [];
let glowQueue = Promise.resolve(), GLOW_TIMEOUT_MS = 180000;
function glowArgs(def, args) {
  const ps = def.params; if (ps.length <= 1) return args;
  if (Array.isArray(args)) return Object.fromEntries(ps.map((p, i) => [p.name, args[i]]));
  if (typeof args === 'string') { const m = /^(.*?)\s+(\S+)$/.exec(args.trim()); return m && cssColour(m[2]) ? { [ps[0].name]: m[1], [ps[1].name]: m[2] } : { [ps[0].name]: args.trim() }; }
  return args && typeof args === 'object' ? args : { [ps[0].name]: args };
}
function logArgs(args) { try { const s = JSON.stringify(args ?? null); return s.length > 200000 ? { truncated: true, bytes: s.length } : JSON.parse(s); } catch (e) { return { unserialisable: true }; } }
function glowRun(cmd, args, authorize) {
  const job = glowQueue.then(async () => {
    if (typeof cmd !== 'string' || !Object.hasOwn(GLOW_CMDS, cmd)) throw new CmdError(`没有这个命令：${cmd}（glow.help() 列出全部命令）`);
    authorize?.();
    let ok = false;
    /* X5: one hung command must not block the queue: 180 s, then the next command runs (the late result is dropped) */
    let to; const limit = new Promise((_, no) => { to = setTimeout(() => no(new CmdError(`${cmd} 超过 180 秒没有完成，已跳过`)), GLOW_TIMEOUT_MS); });
    try { const r = await Promise.race([GLOW_CMDS[cmd].fn(glowArgs(GLOW_CMDS[cmd], args)), limit]); authorize?.('result'); ok = true; return r === undefined ? null : JSON.parse(JSON.stringify(r)); }
    finally { clearTimeout(to); glowLog.push({ t: new Date().toISOString(), cmd, args: logArgs(args), ok, seed: randSeed }); if (glowLog.length > 200) glowLog.splice(0, glowLog.length - 200); }
  });
  glowQueue = job.catch(() => {});
  return job;
}
const glow = window.glow = {
  version: GLOW_API, log: glowLog, run: glowRun,
  async replay(log, authorize) {
    if (typeof log === 'string') log = JSON.parse(log);
    if (!Array.isArray(log) || log.length > 200) throw new CmdError('replay 需要日志数组（glow.log 的格式）');
    const out = [];
    for (const e of log.slice()) {
      authorize?.();
      if (!e || typeof e.cmd !== 'string' || e.ok === false || GLOW_READONLY.has(e.cmd) || e.args?.truncated) { out.push({ cmd: e?.cmd, skipped: true }); continue; }
      try { await glowRun(e.cmd, e.args, authorize); out.push({ cmd: e.cmd, ok: true }); } catch (err) { out.push({ cmd: e.cmd, ok: false, error: String(err?.message || err) }); }
    }
    return out;
  },
};
for (const [cmd, d] of Object.entries(GLOW_CMDS)) glow[cmd] = (...a) => glowRun(cmd, d.params.length > 1 && a.length > 1 ? a : a[0]);
