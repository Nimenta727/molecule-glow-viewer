const MISSING = new Set(['.', '?']);

export class CoordinateParseError extends Error {
  constructor(message) { super(message); this.name = 'CoordinateParseError'; }
}

function emptyResult(format, atoms, secondaryStructure) {
  if (!atoms.length) throw new CoordinateParseError(`No coordinate atoms found in ${format} input`);
  return { format, atoms, secondaryStructure };
}

function present(value) {
  const text = value == null ? '' : String(value);
  return MISSING.has(text) ? '' : text;
}

function coordinate(value, field, row) {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) {
    throw new CoordinateParseError(`Invalid ${field} coordinate in ${row}`);
  }
  return n;
}

function inferElement(atomName) {
  return atomName.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase();
}

function parsePdbSecondaryStructure(lines) {
  const ranges = [];
  for (const line of lines) {
    const record = line.slice(0, 6).trim();
    if (record === 'HELIX') {
      ranges.push({
        type: 'helix', chainId: line.slice(19, 20).trim() || line.slice(31, 32).trim(),
        from: line.slice(21, 25).trim() + line.slice(25, 26).trim(),
        to: line.slice(33, 37).trim() + line.slice(37, 38).trim(), numbering: 'auth',
      });
    } else if (record === 'SHEET') {
      ranges.push({
        type: 'sheet', chainId: line.slice(21, 22).trim() || line.slice(32, 33).trim(),
        from: line.slice(22, 26).trim() + line.slice(26, 27).trim(),
        to: line.slice(33, 37).trim() + line.slice(37, 38).trim(), numbering: 'auth',
      });
    }
  }
  return ranges.filter((range) => range.chainId && range.from && range.to);
}

export function parsePdb(text) {
  if (typeof text !== 'string' || !text.trim()) throw new CoordinateParseError('PDB input must be a non-empty string');
  const lines = text.split(/\r?\n/);
  const atoms = [];
  let modelId = '1';
  let sawModelRecord = false;
  let insideModel = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const record = line.slice(0, 6).trim();
    if (record === 'MODEL') {
      modelId = line.slice(10, 14).trim() || String(atoms.length + 1);
      sawModelRecord = true;
      insideModel = true;
      continue;
    }
    if (record === 'ENDMDL') { insideModel = false; continue; }
    if (record !== 'ATOM' && record !== 'HETATM') continue;
    if (sawModelRecord && !insideModel) continue;
    const atomName = line.slice(12, 16).trim();
    const residueName = line.slice(17, 20).trim();
    const chainId = line.slice(21, 22).trim();
    const sequence = line.slice(22, 26).trim();
    let element = line.slice(76, 78).trim().toUpperCase();
    if (!element) element = inferElement(atomName);
    const row = `PDB line ${lineIndex + 1}`;
    atoms.push({
      record,
      serial: line.slice(6, 11).trim(),
      element,
      position: [
        coordinate(line.slice(30, 38).trim(), 'x', row),
        coordinate(line.slice(38, 46).trim(), 'y', row),
        coordinate(line.slice(46, 54).trim(), 'z', row),
      ],
      name: atomName,
      authAtomId: atomName,
      labelAtomId: atomName,
      residueName,
      authChainId: chainId,
      labelChainId: chainId,
      authSeqId: sequence,
      labelSeqId: sequence,
      insertionCode: line.slice(26, 27).trim(),
      altLoc: line.slice(16, 17).trim(),
      modelId: sawModelRecord ? modelId : '',
    });
  }
  return emptyResult('pdb', atoms, parsePdbSecondaryStructure(lines));
}

function cifTokens(text) {
  const lines = text.split(/\r?\n/);
  const tokens = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line.startsWith(';')) {
      const contents = [line.slice(1)];
      let closed = false;
      for (lineIndex += 1; lineIndex < lines.length; lineIndex += 1) {
        if (lines[lineIndex].startsWith(';')) { closed = true; break; }
        contents.push(lines[lineIndex]);
      }
      if (!closed) throw new CoordinateParseError(`Unterminated mmCIF multiline value starting at line ${lineIndex + 1}`);
      tokens.push({ value: contents.join('\n'), quoted: true });
      continue;
    }
    let i = 0;
    while (i < line.length) {
      while (i < line.length && /\s/.test(line[i])) i += 1;
      if (i >= line.length || line[i] === '#') break;
      const quote = line[i] === "'" || line[i] === '"' ? line[i] : '';
      if (quote) {
        const start = ++i;
        let end = -1;
        while (i < line.length) {
          if (line[i] === quote && (i + 1 === line.length || /\s|#/.test(line[i + 1]))) { end = i; break; }
          i += 1;
        }
        if (end < 0) throw new CoordinateParseError(`Unterminated quoted mmCIF value at line ${lineIndex + 1}`);
        tokens.push({ value: line.slice(start, end), quoted: true });
        i = end + 1;
      } else {
        const start = i;
        while (i < line.length && !/\s/.test(line[i]) && line[i] !== '#') i += 1;
        tokens.push({ value: line.slice(start, i), quoted: false });
        if (line[i] === '#') break;
      }
    }
  }
  return tokens;
}

function isControl(token) {
  if (token.quoted) return false;
  const value = token.value.toLowerCase();
  return value === 'loop_' || value === 'stop_' || value === 'global_' || value.startsWith('data_') || value.startsWith('save_') || value.startsWith('_');
}

function parseCifLoops(tokens) {
  const loops = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].quoted || tokens[i].value.toLowerCase() !== 'loop_') continue;
    i += 1;
    const headers = [];
    while (i < tokens.length && !tokens[i].quoted && tokens[i].value.startsWith('_')) headers.push(tokens[i++].value.toLowerCase());
    if (!headers.length) continue;
    const rows = [];
    while (i < tokens.length && !isControl(tokens[i])) {
      if (i + headers.length > tokens.length) throw new CoordinateParseError(`Incomplete row in mmCIF loop beginning with ${headers[0]} near ${tokens.slice(i).map((token) => token.value).join(' ')}`);
      const row = tokens.slice(i, i + headers.length);
      if (row.some(isControl)) throw new CoordinateParseError(`Incomplete row in mmCIF loop beginning with ${headers[0]}`);
      rows.push(row.map((token) => token.value));
      i += headers.length;
    }
    loops.push({ headers, rows });
    i -= 1;
  }
  return loops;
}

function colIndex(headers, name) { return headers.indexOf(name.toLowerCase()); }
function cell(row, index) { return index < 0 ? '' : present(row[index]); }
function firstCell(row, headers, ...names) {
  for (const name of names) {
    const value = cell(row, colIndex(headers, name));
    if (value !== '') return value;
  }
  return '';
}

function atomSiteRows(loops) {
  const result = [];
  for (const loop of loops) {
    if (!loop.headers.some((header) => header.startsWith('_atom_site.'))) continue;
    const headers = loop.headers;
    const ix = Object.fromEntries([
      'group_PDB', 'id', 'type_symbol', 'label_atom_id', 'auth_atom_id', 'label_alt_id',
      'label_comp_id', 'auth_comp_id', 'label_asym_id', 'auth_asym_id', 'label_seq_id',
      'auth_seq_id', 'pdbx_PDB_ins_code', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'pdbx_PDB_model_num',
    ].map((name) => [name, colIndex(headers, `_atom_site.${name}`)]));
    for (let i = 0; i < loop.rows.length; i += 1) {
      const row = loop.rows[i];
      const record = cell(row, ix.group_PDB).toUpperCase();
      if (record !== 'ATOM' && record !== 'HETATM') continue;
      const labelAtomId = cell(row, ix.label_atom_id);
      const authAtomId = cell(row, ix.auth_atom_id);
      const name = authAtomId || labelAtomId;
      const labelChainId = cell(row, ix.label_asym_id);
      const authChainId = cell(row, ix.auth_asym_id);
      const residueName = firstCell(row, headers, '_atom_site.auth_comp_id', '_atom_site.label_comp_id');
      const x = cell(row, ix.Cartn_x), y = cell(row, ix.Cartn_y), z = cell(row, ix.Cartn_z);
      const context = `_atom_site row ${i + 1}`;
      result.push({
        record,
        serial: cell(row, ix.id),
        element: cell(row, ix.type_symbol).toUpperCase(),
        position: [coordinate(x, 'x', context), coordinate(y, 'y', context), coordinate(z, 'z', context)],
        name,
        authAtomId,
        labelAtomId,
        residueName,
        authChainId,
        labelChainId,
        authSeqId: cell(row, ix.auth_seq_id),
        labelSeqId: cell(row, ix.label_seq_id),
        insertionCode: cell(row, ix.pdbx_PDB_ins_code),
        altLoc: cell(row, ix.label_alt_id),
        modelId: cell(row, ix.pdbx_PDB_model_num),
      });
    }
  }
  return result;
}

function parseCifSecondaryStructure(loops) {
  const ranges = [];
  for (const loop of loops) {
    const category = loop.headers[0]?.split('.')[0];
    if (category !== '_struct_conf' && category !== '_struct_sheet_range') continue;
    const headers = loop.headers;
    for (const row of loop.rows) {
      const type = category === '_struct_sheet_range' ? 'sheet' : (/^HELX/i.test(cell(row, colIndex(headers, '_struct_conf.conf_type_id'))) ? 'helix' : '');
      if (!type) continue;
      const authStart = cell(row, colIndex(headers, category + '.beg_auth_seq_id'));
      const authEnd = cell(row, colIndex(headers, category + '.end_auth_seq_id'));
      const labelStart = cell(row, colIndex(headers, category + '.beg_label_seq_id'));
      const labelEnd = cell(row, colIndex(headers, category + '.end_label_seq_id'));
      const authChain = cell(row, colIndex(headers, category + '.beg_auth_asym_id'));
      const labelChain = cell(row, colIndex(headers, category + '.beg_label_asym_id'));
      const numbering = authStart && authEnd ? 'auth' : 'label';
      const from = numbering === 'auth' ? authStart : labelStart;
      const to = numbering === 'auth' ? authEnd : labelEnd;
      const chainId = numbering === 'auth' ? (authChain || labelChain) : (labelChain || authChain);
      if (chainId && from && to) ranges.push({ type, chainId, from, to, numbering });
    }
  }
  return ranges;
}

export function parseMmcif(text) {
  if (typeof text !== 'string' || !text.trim()) throw new CoordinateParseError('mmCIF input must be a non-empty string');
  const loops = parseCifLoops(cifTokens(text));
  return emptyResult('mmcif', atomSiteRows(loops), parseCifSecondaryStructure(loops));
}
