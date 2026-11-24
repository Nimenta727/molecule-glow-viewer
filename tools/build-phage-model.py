#!/usr/bin/env python3
"""Builds the structure file of the T7 phage ILLUSTRATIVE MODEL (one static composite in one frame; every placement below is an assumption, none is a measurement).
Chains: T* = portal-tail complex, C* = core, H01..H12 = head shell, G1/G2 = genome.

  (part 1) machinery            the portal-tail complex of the mature virion (PDB 9JYZ) and the internal core proteins gp14/gp15/gp16/gp6.7 (PDB 9JYY), all atoms, in ONE frame:
                                the tail axis is z, the tail tip points to +z. The two entries are separate reconstructions: the core is moved along z by -204 A and turned 5 degrees about z, the
                                position with the most contacts and no clashes (< 2.4 A) against the portal-tail complex (found by scanning, see CORE_* below). Not a measured relative position.
  (part 2) shell and genome     the head shell and the genome:
                                shell  = 415 copies of the major capsid protein gp10A (C-alpha only) as 60 hexons (chains X01-X60) and 11 pentons (P01-P11), made from the 7-chain asymmetric unit of PDB 3J7X (mature head, 3.6 A; 3J7W is the capsid-II packaging intermediate, not used) with the 60 icosahedral
                                         operators of its assembly 1; the 5 subunits of the vertex on the +z axis are left out (the portal vertex), as in the real head (415 = 420 - 5).
                                         Chains H01..H12 are the 12 vertex regions (H01 = the portal vertex); residue number = 1000 x (subunit in the region) + residue number of gp10A.
                                         The shell centre is put at z = -371 A so that the portal vertex points at the tail.
                                genome = a double-helical trace (one phosphorus per nucleotide, 39 937 bp, chains G1/G2) wound as a coaxial spool around the core, 21 A between turns. The WINDING is an
                                         illustration (cryo-EM shows an averaged density, not atoms); the sequence is not represented (residues are DN).
Usage: python3 tools/build-phage-model.py <out-dir> [cache-dir]    (also writes entities.json into the cache dir)    (downloads 9JYZ, 9JYY, 3J7X and 4A0T from RCSB into the cache dir when they are missing)
"""
import math, os, re, sys, urllib.request, collections
import numpy as np

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
CACHE = sys.argv[2] if len(sys.argv) > 2 else OUT
CORE_DZ, CORE_TURN_DEG = -204.0, 5.0      # found by scanning the core against the portal-tail complex (most contacts, no clashes)
SHELL_CENTRE_Z = -371.0                    # the portal vertex tip (R = 331 A) ends at z = -40 A, near where the portal leaves the shell
GENOME_BP, PITCH, R_MIN, STRAND_R, RISE = 39937, 21.0, 105.0, 9.0, 3.4


def fetch(entry):
    path = os.path.join(CACHE, f'{entry}.cif')
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        urllib.request.urlretrieve(f'https://files.rcsb.org/download/{entry}.cif', path)
    return path


def atoms_of(path):
    names, rows = [], []
    with open(path) as f:
        for line in f:
            if line.startswith('_atom_site.'): names.append(line.strip().split('.')[1]); continue
            if names and line.startswith(('ATOM', 'HETATM')): rows.append(line.split())
            elif names and rows and line.startswith(('#', 'loop_')): break
    ix = {n: i for i, n in enumerate(names)}
    return ix, rows


def entities_of(path):
    """entity id -> description, asym id -> entity id (from the entry's own tables)."""
    lines = open(path).read().split('\n'); desc, asym = {}, {}
    def loop(prefix):
        for i, l in enumerate(lines):
            if l.strip() == 'loop_' and lines[i + 1].startswith(prefix):
                cols, j = [], i + 1
                while lines[j].startswith(prefix): cols.append(lines[j].strip().split('.')[1]); j += 1
                while j < len(lines) and not lines[j].startswith(('#', 'loop_')):
                    t = re.findall(r"'[^']*'|\"[^\"]*\"|\S+", lines[j])
                    if len(t) >= len(cols): yield dict(zip(cols, t))
                    j += 1
                return
    for d in loop('_entity.'): desc[d['id']] = d.get('pdbx_description', '?').strip("'\"")
    for d in loop('_struct_asym.'): asym[d['id']] = d['entity_id']
    return desc, asym


def operators(path):
    txt = open(path).read(); i = txt.index('_pdbx_struct_oper_list.id'); body = txt[i:].split('\n#')[0].split('\n')
    cols = [l.strip().split('.')[1] for l in body if l.startswith('_pdbx_struct_oper_list.')]
    toks = re.findall(r"'[^']*'|\S+", ' '.join(l for l in body if not l.startswith('_'))); ops = {}
    for k in range(0, len(toks), len(cols)):
        rec = dict(zip(cols, toks[k:k + len(cols)]))
        ops[rec['id']] = (np.array([[float(rec[f'matrix[{r}][{c}]']) for c in (1, 2, 3)] for r in (1, 2, 3)]), np.array([float(rec[f'vector[{r}]']) for r in (1, 2, 3)]))
    return ops


class Writer:
    """A minimal mmCIF: entity and asym tables (so the parts have names) and one atom_site loop."""
    def __init__(self, title): self.title, self.entities, self.asyms, self.lines, self.n = title, {}, {}, [], 0
    def entity(self, eid, description): self.entities[eid] = description.replace("'", '')
    def asym(self, aid, eid): self.asyms[aid] = eid
    def atom(self, group, element, name, comp, asym, eid, seq, xyz, b=0.0):
        self.n += 1
        self.lines.append(f'{group} {self.n} {element} {name} . {comp} {asym} {eid} {seq} ? {xyz[0]:.2f} {xyz[1]:.2f} {xyz[2]:.2f} {b:.1f} 1')
    def save(self, path):
        head = [f'data_{os.path.basename(path).split(".")[0]}', '#', f"_struct.title '{self.title}'", '#', 'loop_', '_entity.id', '_entity.type', '_entity.pdbx_description']
        head += [f"{e} polymer '{d}'" for e, d in self.entities.items()] + ['#', 'loop_', '_struct_asym.id', '_struct_asym.entity_id'] + [f'{a} {e}' for a, e in self.asyms.items()]
        head += ['#', 'loop_', '_atom_site.group_PDB', '_atom_site.id', '_atom_site.type_symbol', '_atom_site.label_atom_id', '_atom_site.label_alt_id', '_atom_site.label_comp_id', '_atom_site.label_asym_id',
                 '_atom_site.label_entity_id', '_atom_site.label_seq_id', '_atom_site.pdbx_PDB_ins_code', '_atom_site.Cartn_x', '_atom_site.Cartn_y', '_atom_site.Cartn_z',
                 '_atom_site.B_iso_or_equiv', '_atom_site.pdbx_PDB_model_num']
        with open(path, 'w') as f: f.write('\n'.join(head + self.lines) + '\n#\n')
        print(os.path.basename(path), self.n, 'atoms', round(os.path.getsize(path) / 1e6, 1), 'MB')


def rotz(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg)); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def machinery(w):
    for entry, prefix, move in (('9JYZ', 'T', lambda p: p), ('9JYY', 'C', lambda p: p @ rotz(CORE_TURN_DEG).T + [0, 0, CORE_DZ])):
        path = fetch(entry); ix, rows = atoms_of(path); desc, asym = entities_of(path)
        for e, d in desc.items():
            if any(r[ix['label_entity_id']] == e for r in rows): w.entity(f'{prefix}{e}', f'{d} [{entry}]')
        for a, e in asym.items():
            if any(r[ix['label_asym_id']] == a and r[ix['label_entity_id']] == e for r in rows[:1]) or True: pass
        used = {(r[ix['label_asym_id']], r[ix['label_entity_id']]) for r in rows}
        for a, e in sorted(used): w.asym(f'{prefix}{a}', f'{prefix}{e}')
        coords = move(np.array([[float(r[ix['Cartn_x']]), float(r[ix['Cartn_y']]), float(r[ix['Cartn_z']])] for r in rows]))
        for r, p in zip(rows, coords):
            seq = r[ix['label_seq_id']] if r[ix['label_seq_id']] not in ('.', '?') else r[ix['auth_seq_id']]
            w.atom(r[ix['group_PDB']], r[ix['type_symbol']], r[ix['label_atom_id']].strip('"'), r[ix['label_comp_id']], f"{prefix}{r[ix['label_asym_id']]}", f"{prefix}{r[ix['label_entity_id']]}", seq, p, float(r[ix['B_iso_or_equiv']]))


def shell_points():
    path = fetch('3J7X'); ix, rows = atoms_of(path); ops = operators(path)
    ca = [r for r in rows if r[ix['label_atom_id']] == 'CA']
    chains = collections.OrderedDict()
    for r in ca: chains.setdefault(r[ix['label_asym_id']], []).append((int(r[ix['label_seq_id']]), r[ix['label_comp_id']], [float(r[ix['Cartn_x']]), float(r[ix['Cartn_y']]), float(r[ix['Cartn_z']])]))
    # the penton subunit is the chain closest to the 5-fold axis (z); its 5 copies at the +z vertex are the portal vertex and are left out
    penton = min(chains, key=lambda c: math.hypot(np.mean([p[2][0] for p in chains[c]]), np.mean([p[2][1] for p in chains[c]])))
    vertices = []
    for k in range(1, 61):
        v = ops[str(k)][0] @ np.array([0, 0, 1.0])
        if not any(np.dot(v, u) > 0.99 for u in vertices): vertices.append(v)
    vertices.sort(key=lambda v: -v[2]); assert len(vertices) == 12 and vertices[0][2] > 0.99
    # capsomers: in the asymmetric unit of 3J7X the six non-penton chains form one hexamer ring (their centres lie on a ring about 35 A across), so each of the 60 symmetry copies
    # of those six chains is one hexon; the penton chain's copies are grouped by the 5-fold vertex they sit at (5 each), and the vertex at +z is the portal vertex (left out)
    hexons, pentons = [], collections.defaultdict(list)
    for k in range(1, 61):
        M, t = ops[str(k)]
        ring = [(residues, np.array([p[2] for p in residues]) @ M.T + t) for c, residues in chains.items() if c != penton]
        hexons.append(ring)
        pts = np.array([p[2] for p in chains[penton]]) @ M.T + t
        region = int(np.argmax([np.dot(v, pts.mean(axis=0)) for v in vertices]))
        if region != 0: pentons[region].append((chains[penton], pts))
    assert all(len(v) == 5 for v in pentons.values()) and len(pentons) == 11, 'every vertex but the portal vertex has a pentamer'
    return hexons, [pentons[r] for r in sorted(pentons)], penton


def shell_and_genome(w):
    hexons, pentons, penton = shell_points()
    w.entity('S', 'Major capsid protein gp10A, hexon subunit [3J7X, C-alpha only]'); w.entity('Q', 'Major capsid protein gp10A, penton subunit [3J7X, C-alpha only]')
    for i in range(len(hexons)): w.asym(f'X{i + 1:02d}', 'S')
    for i in range(len(pentons)): w.asym(f'P{i + 1:02d}', 'Q')
    for i, ring in enumerate(hexons):          # one chain per hexon (6 subunits, numbered 1001.., 2001.., ...)
        for unit, (residues, pts) in enumerate(ring, start=1):
            for (seq, comp, _), p in zip(residues, pts): w.atom('ATOM', 'C', 'CA', comp, f'X{i + 1:02d}', 'S', unit * 1000 + seq, p + [0, 0, SHELL_CENTRE_Z])
    for i, five in enumerate(pentons):         # one chain per penton (5 subunits)
        for unit, (residues, pts) in enumerate(five, start=1):
            for (seq, comp, _), p in zip(residues, pts): w.atom('ATOM', 'C', 'CA', comp, f'P{i + 1:02d}', 'Q', unit * 1000 + seq, p + [0, 0, SHELL_CENTRE_Z])
    print('shell: %d hexons and %d pentons = %d subunits; penton chain of the asymmetric unit: %s; the portal vertex has no penton' % (len(hexons), len(pentons), 6 * len(hexons) + 5 * len(pentons), penton))
    # genome spool
    inner = 266.0 - 4.0
    path, layer, r = [], 0, R_MIN
    zc = SHELL_CENTRE_Z
    while r <= inner - 10:
        h = math.sqrt(inner ** 2 - r ** 2); turns = 2 * h / PITCH; n = max(int(turns * 120), 2); direction = 1 if layer % 2 == 0 else -1
        t = np.linspace(0, 1, n); theta = 2 * math.pi * turns * t; z = zc + direction * (-h + 2 * h * t)
        path.append(np.stack([r * np.cos(theta), r * np.sin(theta), z], axis=1))
        r_next = r + PITCH                       # one turn at the end of the layer moves the DNA to the next layer
        if r_next <= inner - 10:
            m = 120; tt = np.linspace(0, 1, m); th = theta[-1] + 2 * math.pi * tt; rr = r + (r_next - r) * tt
            path.append(np.stack([rr * np.cos(th), rr * np.sin(th), np.full(m, path[-1][-1, 2])], axis=1))
        layer += 1; r = r_next
    line = np.concatenate(path); seg = np.linalg.norm(np.diff(line, axis=0), axis=1); s = np.concatenate([[0], np.cumsum(seg)])
    capacity_bp = int(s[-1] / RISE); print('spool: %d layers, length %.2f um, room for %d bp (genome %d bp)' % (layer, s[-1] / 1e4, capacity_bp, GENOME_BP))
    bp = min(GENOME_BP, capacity_bp); sample = np.arange(bp) * RISE
    centre = np.stack([np.interp(sample, s, line[:, i]) for i in range(3)], axis=1)
    tangent = np.gradient(centre, axis=0); tangent /= np.linalg.norm(tangent, axis=1, keepdims=True) + 1e-9
    radial = np.stack([centre[:, 0], centre[:, 1], np.zeros(bp)], axis=1); radial /= np.linalg.norm(radial, axis=1, keepdims=True) + 1e-9
    normal = radial - (radial * tangent).sum(axis=1, keepdims=True) * tangent; normal /= np.linalg.norm(normal, axis=1, keepdims=True) + 1e-9
    binormal = np.cross(tangent, normal); phase = 2 * math.pi * np.arange(bp) / 10.4   # 10.4 bp per turn
    for strand, offset in (('G1', 0.0), ('G2', math.pi)):
        w.entity(strand, f'Genome DNA, strand {strand[1]} (backbone trace, one point per nucleotide; winding is an illustration)'); w.asym(strand, strand)
        pos = centre + STRAND_R * (np.cos(phase + offset)[:, None] * normal + np.sin(phase + offset)[:, None] * binormal)
        for i, p in enumerate(pos): w.atom('ATOM', 'P', 'P', 'DN', strand, strand, i + 1, p)
    return bp


THREE = {'A': 'ALA', 'R': 'ARG', 'N': 'ASN', 'D': 'ASP', 'C': 'CYS', 'Q': 'GLN', 'E': 'GLU', 'G': 'GLY', 'H': 'HIS', 'I': 'ILE', 'L': 'LEU', 'K': 'LYS', 'M': 'MET', 'F': 'PHE', 'P': 'PRO', 'S': 'SER',
         'T': 'THR', 'W': 'TRP', 'Y': 'TYR', 'V': 'VAL'}
SHAFT_PROXIMAL, SHAFT_DISTAL, STRAND_RADIUS = 140.0, 45.0, 5.5   # lengths of the two halves of the drawn shaft (A) and how far apart its three strands run


def unit(v): v = np.asarray(v, float); return v / (np.linalg.norm(v) + 1e-12)


def align(a, b):
    """The rotation that turns direction a onto direction b (Rodrigues)."""
    a, b = unit(a), unit(b); v = np.cross(a, b); c = float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-9: return np.eye(3) if c > 0 else -np.eye(3)
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]]); return np.eye(3) + k + k @ k * ((1 - c) / np.linalg.norm(v) ** 2)


def fibres(w):
    """The six tail fibres made whole. 9JYZ resolves only the N-terminal part of gp17 (residues ~3-143, already in the model); the C-terminal tip (residues 371-553) is the crystal
    structure 4A0T (a trimer), and residues 144-370 have no experimental or predicted structure (AlphaFold DB does not hold viral proteins and no prediction could be run here), so they are
    DRAWN: three Ca strands along a path that leaves the resolved part in its own direction, then bends back toward the head as the fibres of a mature T7 particle lie folded along the capsid.
    The path, the bend and the tip's turn about its axis are illustrations."""
    path = fetch('9JYZ'); ix, rows = atoms_of(path); desc, asym = entities_of(path)
    fibre_entity = next(e for e, d in desc.items() if 'fiber' in d.lower())
    by_chain = collections.defaultdict(list)
    for r in rows:
        if r[ix['label_entity_id']] == fibre_entity and r[ix['label_atom_id']] == 'CA': by_chain[r[ix['label_asym_id']]].append((int(r[ix['label_seq_id']]), np.array([float(r[ix['Cartn_x']]), float(r[ix['Cartn_y']]), float(r[ix['Cartn_z']])])))
    ends = {}
    for c, cas in by_chain.items():
        cas.sort(key=lambda t: t[0]); last = cas[-1][1]; before = cas[max(0, len(cas) - 11)][1]
        ends[c] = (last, unit(last - before), cas[-1][0])
    # the 18 chains are six trimers: group the chain ends that lie together
    left, groups = set(ends), []
    while left:
        c = left.pop(); near = sorted(left, key=lambda d: np.linalg.norm(ends[d][0] - ends[c][0]))[:2]
        for d in near: left.discard(d)
        groups.append([c] + near)
    assert len(groups) == 6 and all(len(g) == 3 for g in groups), groups
    seq = re.search(r"FIBER_BPT7 P03748 \? \d+ \n;(.*?)\n;", open(path).read(), re.S).group(1).replace('\n', '')
    tip_path = fetch('4A0T'); tix, trows = atoms_of(tip_path)
    tip = [(r[tix['label_asym_id']], r) for r in trows if r[tix['group_PDB']] == 'ATOM']
    tca = {}
    for c, r in tip:
        if r[tix['label_atom_id']] == 'CA': tca.setdefault(c, []).append((int(r[tix['auth_seq_id']]), np.array([float(r[tix['Cartn_x']]), float(r[tix['Cartn_y']]), float(r[tix['Cartn_z']])])))
    allca = [p for v in tca.values() for _, p in v]; nums = [n for v in tca.values() for n, _ in v]
    n_end = np.mean([p for v in tca.values() for n, p in v if n <= min(nums) + 15], axis=0); c_end = np.mean([p for v in tca.values() for n, p in v if n >= max(nums) - 15], axis=0)
    tip_axis = unit(c_end - n_end)
    w.entity('F', 'Tail fiber protein gp17, residues 144-370: DRAWN (no experimental or predicted structure; Ca strands along an illustrative path)')
    w.entity('K', 'Tail fiber protein gp17, C-terminal tip residues 371-553 [4A0T, crystal structure; placement illustrative]')
    shaft_residues = list(range(144, 371)); n_prox = int(len(shaft_residues) * SHAFT_PROXIMAL / (SHAFT_PROXIMAL + SHAFT_DISTAL))
    for t, group in enumerate(groups, start=1):
        E = np.mean([ends[c][0] for c in group], axis=0); D = unit(np.mean([ends[c][1] for c in group], axis=0))
        radial = unit([E[0], E[1], 0.0]); D = unit(radial + np.array([0, 0, 0.25]))   # out from the tail, a little toward its tip (+z)
        D2 = unit(radial * 0.6 + np.array([0, 0, -1.0]) * 0.8)   # then folded back toward the head (-z), outside the capsid
        K = E + D * SHAFT_PROXIMAL; K2 = K + D2 * SHAFT_DISTAL
        def point(i):   # the path point of shaft residue index i, and its direction
            if i < n_prox: f = i / max(n_prox - 1, 1); return E + D * SHAFT_PROXIMAL * f, D
            f = (i - n_prox + 1) / (len(shaft_residues) - n_prox); return K + D2 * SHAFT_DISTAL * f, D2
        for s, c in enumerate(group):
            chain = f'S{t}{s + 1}'; w.asym(chain, 'F')
            start = ends[c][0]
            for i, resno in enumerate(shaft_residues):
                centre, direction = point(i); u = unit(np.cross(direction, [0, 0, 1.0]) if abs(direction[2]) < 0.95 else np.cross(direction, [1.0, 0, 0])); v = np.cross(direction, u)
                along = i * (SHAFT_PROXIMAL + SHAFT_DISTAL) / len(shaft_residues); angle = 2 * math.pi * s / 3 + along * 0.04
                p = centre + STRAND_RADIUS * (math.cos(angle) * u + math.sin(angle) * v)
                if i < 6: p = start + (p - start) * (i + 1) / 7   # leave the resolved end smoothly
                w.atom('ATOM', 'C', 'CA', THREE.get(seq[resno - 1], 'GLY'), chain, 'F', resno, p)
        R = align(tip_axis, D2)
        for k, (c, r) in enumerate(tip):
            chain = f'K{t}{c}'
            if chain not in w.asyms: w.asym(chain, 'K')
            p = (np.array([float(r[tix['Cartn_x']]), float(r[tix['Cartn_y']]), float(r[tix['Cartn_z']])]) - n_end) @ R.T + K2
            w.atom('ATOM', r[tix['type_symbol']], r[tix['label_atom_id']].strip('"'), r[tix['label_comp_id']], chain, 'K', r[tix['auth_seq_id']], p, float(r[tix['B_iso_or_equiv']]))
    inside = 0
    for line in w.lines:
        t = line.split()
        if t[6][0] in 'SK' and len(t[6]) == 3:
            x, y, z = float(t[10]), float(t[11]), float(t[12])
            if math.hypot(x, y, z - SHELL_CENTRE_Z) < 335: inside += 1
    print('fibres: 6 trimers made whole (drawn shaft 144-370 + 4A0T tip 371-553); fibre atoms inside the capsid radius:', inside)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    w = Writer('Bacteriophage T7 virion, illustrative composite: portal-tail (9JYZ) + core (9JYY) + head shell (3J7X) + genome spool; placements are assumptions')
    machinery(w); fibres(w); bp = shell_and_genome(w); print('genome nucleotides drawn per strand:', bp)
    w.save(os.path.join(OUT, 't7-virion-model.cif'))
    # part name -> chains of the composite, so a work can colour and name the parts (tools/make-phage-works.cjs)
    import json
    parts = collections.OrderedDict()
    for aid, eid in w.asyms.items(): parts.setdefault(w.entities[eid], []).append(aid)
    json.dump(parts, open(os.path.join(OUT, 't7-virion-parts.json'), 'w'), ensure_ascii=False, indent=1)
    # protein name -> chain names (as the Studio importer names them: author chain ids) for the two tail/core entries, used by tools/make-phage-works.cjs to colour the parts
    import json
    groups = {}
    for entry in ('9JYZ', '9JYY'):
        path = fetch(entry); desc, asym = entities_of(path); ix, rows = atoms_of(path); auth = {}
        for r in rows: auth.setdefault(r[ix['label_asym_id']], r[ix['auth_asym_id']])
        g = {}
        for a, e in asym.items():
            if a in auth: g.setdefault(desc.get(e, e), set()).add(auth[a])
        groups[entry] = {k: sorted(v) for k, v in g.items()}
    json.dump(groups, open(os.path.join(CACHE, 'entities.json'), 'w'), ensure_ascii=False)
