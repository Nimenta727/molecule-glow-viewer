#!/usr/bin/env python3
"""Builds the structure file of the T7 phage ILLUSTRATIVE MODEL (one static composite in one frame; every placement below is an assumption, none is a measurement).
Chains: T* = portal-tail complex, C* = core, H01..H12 = head shell, G1/G2 = genome.

  (part 1) machinery            the portal-tail complex of the mature virion (PDB 9JYZ) and the internal core proteins gp14/gp15/gp16/gp6.7 (PDB 9JYY), all atoms, in ONE frame:
                                the tail axis is z, the tail tip points to +z. The two entries are separate reconstructions: the core is moved along z by -204 A and turned 5 degrees about z, the
                                position with the most contacts and no clashes (< 2.4 A) against the portal-tail complex (found by scanning, see CORE_* below). Not a measured relative position.
  (part 2) shell and genome     the head shell and the genome:
                                shell  = 415 copies of the major capsid protein gp10A (C-alpha only), made from the 7-chain asymmetric unit of PDB 3J7W (mature head, 3.5 A) with the 60 icosahedral
                                         operators of its assembly 1; the 5 subunits of the vertex on the +z axis are left out (the portal vertex), as in the real head (415 = 420 - 5).
                                         Chains H01..H12 are the 12 vertex regions (H01 = the portal vertex); residue number = 1000 x (subunit in the region) + residue number of gp10A.
                                         The shell centre is put at z = -371 A so that the portal vertex points at the tail.
                                genome = a double-helical trace (one phosphorus per nucleotide, 39 937 bp, chains G1/G2) wound as a coaxial spool around the core, 21 A between turns. The WINDING is an
                                         illustration (cryo-EM shows an averaged density, not atoms); the sequence is not represented (residues are DN).
Usage: python3 tools/build-phage-model.py <out-dir> [cache-dir]    (downloads 9JYZ, 9JYY and 3J7W from RCSB into the cache dir when they are missing)
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
    path = fetch('3J7W'); ix, rows = atoms_of(path); ops = operators(path)
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
    subunits = []
    for k in range(1, 61):
        M, t = ops[str(k)]
        for c, residues in chains.items():
            if c == penton and k <= 5: continue
            pts = np.array([p[2] for p in residues]) @ M.T + t
            centre = pts.mean(axis=0); region = int(np.argmax([np.dot(v, centre) for v in vertices]))
            subunits.append((region, residues, pts))
    return subunits, penton


def shell_and_genome(w):
    subunits, penton = shell_points(); count = collections.Counter(); w.entity('S', 'Major capsid protein gp10A [3J7W, C-alpha only]')
    for region in range(12): w.asym(f'H{region + 1:02d}', 'S')
    for region, residues, pts in sorted(subunits, key=lambda s: s[0]):
        count[region] += 1; unit = count[region]; chain = f'H{region + 1:02d}'
        for (seq, comp, _), p in zip(residues, pts): w.atom('ATOM', 'C', 'CA', comp, chain, 'S', unit * 1000 + seq, p + [0, 0, SHELL_CENTRE_Z])
    print('shell subunits', sum(count.values()), 'penton chain left out at the portal vertex:', penton)
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


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    w = Writer('Bacteriophage T7 virion, illustrative composite: portal-tail (9JYZ) + core (9JYY) + head shell (3J7W) + genome spool; placements are assumptions')
    machinery(w); bp = shell_and_genome(w); print('genome nucleotides drawn per strand:', bp)
    w.save(os.path.join(OUT, 't7-virion-model.cif'))
