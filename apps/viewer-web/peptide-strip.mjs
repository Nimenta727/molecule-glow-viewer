/**
 * The peptide strip of a translation run: one cell per residue of the template (and the stop), the residues already added (errors in red), the A site (blue frame).
 * Built once per run, only classes change. Shared by the stochastic-process panel and the composition panel. Text only.
 */
export function createPeptideStrip(box) {
  let letters = [], description = null;
  return {
    /** `strip` = { sequence } of a translation run, or nothing (the strip is hidden). */
    build(strip) {
      box.replaceChildren(); letters = []; description = strip ?? null; box.hidden = !strip;
      if (!strip) return;
      for (const [i, aa] of [...strip.sequence].entries()) { const span = document.createElement('span'); span.textContent = aa; span.dataset.index = i; letters.push(span); }
      const stop = document.createElement('span'); stop.textContent = '■'; stop.title = '终止密码子'; letters.push(stop);
      box.append(...letters);
    },
    /** Colour the cells for the run at time `t` whose state there is `s`. */
    draw(run, t, s) {
      if (!description || !letters.length) return;
      const n = description.sequence.length, start = run.lastEvent('init', t) ?? 0, peps = run.eventsBetween(start, t, ['pep']);
      const chainOver = ['term', 'init'].includes(s.vars.st), a = chainOver ? n : s.nums.k;   // the A site is at k while a chain is being built
      letters.forEach((span, i) => {
        const error = i >= 1 && i <= peps.length && peps[i - 1].branch === 0;
        span.className = i === 0 || (i >= 1 && i <= peps.length) ? (error ? 'error' : 'done') : 'pending';
        if (i === a && !chainOver) span.classList.add('current');
        span.title = error ? `第 ${i + 1} 个残基：近同源 tRNA 掺入了错误的氨基酸（应为 ${description.sequence[i]}）` : i === n ? '终止密码子' : `第 ${i + 1} 个残基 ${span.textContent}`;
      });
      box.setAttribute('aria-label', `肽链：已加入 ${Math.min(peps.length + 1, n)} / ${n} 个残基，其中 ${peps.filter((e) => e.branch === 0).length} 处错误`);
    },
    clear() { box.replaceChildren(); letters = []; description = null; box.hidden = true; },
  };
}
