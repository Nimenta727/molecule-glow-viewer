const startWs = params.get('ws');   /* ?ws=official/<id> or community/<id>: open a workshop scene directly */
if (startWs && /^(official|community)\/[a-z0-9._-]+$/.test(startWs)) {
  const [src, id] = startWs.split('/');
  shopIndex(src).then(I => { const e = I?.packs.find(x => x.id === id); if (!e) throw new Error('工坊里没有 ' + id); shop.src = src; return shopAction('open', id, src); }).catch(e => status('打不开工坊场景：' + e.message));
}
else if (startPreset && PRESETS[startPreset]) { $('pdb').value = PRESETS[startPreset].id; loadScene({ ...PRESETS[startPreset], name: startPreset }); }
else if (startId) { $('pdb').value = startId; $('load').click(); }
