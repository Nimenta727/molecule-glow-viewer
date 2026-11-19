// Consent belongs to a specific parent/opener window and the current scene, never a URL flag.
function consentPanel(target, revoke) {
  let panel, pending;
  const remove = () => { pending?.(false); pending = null; panel?.remove(); panel = null; };
  return {
    request(origin, scope, signal) {
      if (!target.document || pending) return Promise.resolve(false);
      panel ??= target.document.createElement('section'); panel.id = 'glow-bridge-permissions';
      panel.setAttribute('aria-label', '嵌入网页权限');
      panel.style.cssText = 'position:fixed;top:12px;left:12px;right:12px;z-index:10000;background:white;color:#172033;border:1px solid #677;padding:14px;max-width:650px;box-shadow:0 2px 16px #0004';
      panel.replaceChildren();
      const text = target.document.createElement('p');
      text.textContent = `网页 ${origin} 请求${scope === 'sensitive' ? '读取当前场景的详细信息、截图、原始结构文件和命令日志。文件可能含有未公开数据。' : '控制当前场景（加载、选择、表示、镜头和动画）。此权限不包含读取结构文件或截图。'}`;
      panel.append(text);
      return new Promise(resolve => {
        const finish = allowed => {
          signal.removeEventListener('abort', abort); pending = null;
          panel.replaceChildren();
          const label = target.document.createElement('span'); label.textContent = allowed ? '嵌入权限已允许，仅对当前窗口和场景有效。 ' : '已拒绝此项嵌入权限。 ';
          const button = target.document.createElement('button'); button.textContent = '撤销全部嵌入权限'; button.dataset.action = 'revoke'; button.onclick = revoke;
          panel.append(label, button); resolve(allowed);
        };
        const abort = () => finish(false); pending = finish;
        for (const [value, label] of [[false, '拒绝'], [true, scope === 'sensitive' ? '允许读取当前场景数据' : '允许控制当前场景']]) {
          const button = target.document.createElement('button'); button.textContent = label; button.dataset.action = value ? 'allow' : 'deny';
          button.onclick = () => finish(value); panel.append(button);
        }
        target.document.body.append(panel);
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      });
    }, reset: remove,
  };
}

export function trustedBridgeOrigin(origin, location) {
  return origin !== 'null' && (origin === 'https://nimenta727.github.io' ||
    new URLSearchParams(location.search).get('dev') === '1' && origin === location.origin);
}
export function attachScopedCommandBridge(target, api, { getSceneToken = () => null, requestConsent, commands = [], allowControlFromOtherHttps = false } = {}) {
  let disposed = false, epoch = 0, pending = 0, scene = getSceneToken();
  const params = new URLSearchParams(target.location.search);
  if (params.get('embed') !== '1' && params.get('dev') !== '1') return () => {};
  const trusted = origin => trustedBridgeOrigin(origin, target.location);
  let grants = new Map(), consentAbort = new AbortController();
  const revoke = () => {
    epoch++; grants.clear(); consentAbort.abort(); consentAbort = new AbortController(); panel.reset(); scene = getSceneToken();
  };
  const panel = consentPanel(target, revoke);
  const ask = requestConsent ?? ((origin, scope, signal) => panel.request(origin, scope, signal));
  const sourceAllowed = source => source && source !== target &&
    (target.parent !== target && source === target.parent || source === target.opener);
  const checkScene = () => { if (scene !== getSceneToken()) revoke(); };
  const listener = async (event) => {
    const message = event.data;
    if (!sourceAllowed(event.source) || !(trusted(event.origin) || allowControlFromOtherHttps && /^https:\/\//.test(event.origin)) || message?.glow !== 'cmd' || disposed) return;
    checkScene();
    const id = typeof message.id === 'string' ? message.id.slice(0, 128)
      : Number.isSafeInteger(message.id) ? message.id : null;
    let reply;
    const send = () => {
      if (!disposed && sourceAllowed(event.source)) {
        try { event.source.postMessage({ glow: 'reply', id, ...reply }, event.origin); } catch { /* Sender closed. */ }
      }
    };
    if (pending >= 16) { reply = { ok: false, error: '嵌入请求过多。' }; send(); return; }
    pending++;
    try {
      if (JSON.stringify(message).length > 256 * 1024) throw new Error('嵌入请求超限。');
      if (!commands.includes(message.cmd) && !['log', 'replay'].includes(message.cmd)) throw new Error('不支持的嵌入命令。');
      // No scene identifiers, filenames, camera or logs are public status.
      const scopes = message.cmd === 'help' ? [] : message.cmd === 'replay' ? ['scene', 'sensitive']
        : [new Set(['info', 'snapshot', 'exportPack', 'log']).has(message.cmd) ? 'sensitive' : 'scene'];
      if (!trusted(event.origin) && scopes.includes('sensitive')) throw new Error('此来源不能读取场景数据。');
      const capturedEpoch = epoch, capturedScene = scene;
      let grant = grants.get(event.source);
      if (!grant || grant.origin !== event.origin) { grant = { origin: event.origin, scopes: new Map() }; grants.set(event.source, grant); }
      const valid = phase => {
        if (disposed || !sourceAllowed(event.source)) throw new Error('嵌入权限已失效。');
        // A started load revokes grants itself; its only permitted reply is an acknowledgement.
        if (phase === 'result' && message.cmd === 'load') return;
        checkScene();
        if (disposed || epoch !== capturedEpoch || capturedScene !== getSceneToken() || !sourceAllowed(event.source) || grants.get(event.source) !== grant) throw new Error('嵌入权限已失效。');
      };
      for (const scope of scopes) {
        valid();
        if (!grant.scopes.has(scope)) {
          // Memoize the pending decision as well as refusal; floods cannot open many prompts.
          grant.scopes.set(scope, Promise.resolve(ask(event.origin, scope, consentAbort.signal)).then(value => value === true));
        }
        if (!await grant.scopes.get(scope)) throw new Error('未获此项嵌入权限。');
      }
      valid();
      const result = message.cmd === 'log' ? api.log.map(({ t, cmd, ok }) => ({ t, cmd, ok, args: { omitted: true } }))
        : message.cmd === 'replay' ? await api.replay(message.args, valid)
          : await api.run(message.cmd, message.args, valid);
      valid('result');
      // Mutation adapters may return info() internally. Never leak that through control-only consent.
      reply = { ok: true, result: scopes.includes('scene') && !scopes.includes('sensitive') ? { accepted: true } : result };
    } catch { reply = { ok: false, error: '命令未完成：未授权、权限已失效或参数无效。' }; }
    finally { pending--; }
    send();
  };
  target.addEventListener('message', listener);
  target.addEventListener('glow:scene-changing', revoke);
  if (target.parent !== target) target.parent.postMessage({ glow: 'ready', api: api.version }, '*');
  return () => {
    disposed = true; revoke(); target.removeEventListener('message', listener); target.removeEventListener('glow:scene-changing', revoke);
  };
}
