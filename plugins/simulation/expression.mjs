/**
 * A small, safe expression language for data-only kinetic models (no `eval`, no access to anything but the named numbers and a fixed list of functions).
 *
 *   numbers  1  0.25  1e-3        names  pmf  NADt  light      operators  + - * / ^ (power, right to left)  unary -  !
 *   compare  < <= > >= == !=      logic  && || (short circuit)  ternary  a ? b : c
 *   calls    exp log log10 sqrt abs min max pow floor ceil round clamp(x, lo, hi) sign
 *
 * Truth is a number: comparisons and `!` give 1 or 0, and any non-zero value is true, so a switch that is on is simply 1. The arithmetic is plain JavaScript
 * arithmetic in the order written, so a formula copied from the classic code gives the same digits (`^` is `**`).
 * `compileExpression(source, names, { functions })` checks the source once (every name must be in `names`) and returns a function of a scope object.
 * `functions` names tables of the work that can be called as `table(index)`; the scope then carries them under `$fn`.
 */
export const MAX_EXPRESSION = 1000;
const MAX_DEPTH = 40;
const FUNCTIONS = Object.freeze({
  exp: [1, Math.exp], log: [1, Math.log], log10: [1, Math.log10], sqrt: [1, Math.sqrt], abs: [1, Math.abs], floor: [1, Math.floor], ceil: [1, Math.ceil], round: [1, Math.round], sign: [1, Math.sign],
  min: [2, Math.min], max: [2, Math.max], pow: [2, Math.pow], clamp: [3, (x, lo, hi) => Math.min(hi, Math.max(lo, x))],
});
export const FUNCTION_NAMES = Object.freeze(Object.keys(FUNCTIONS));
export class ExpressionError extends Error {}

const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|&&|\|\||[-+*/^<>!?:(),]))/y;

function tokens(source) {
  const out = []; TOKEN.lastIndex = 0;
  let at = 0;
  while (at < source.length) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(source);
    if (!m) { if (/^\s*$/.test(source.slice(at))) break; throw new ExpressionError(`看不懂第 ${at + 1} 个字符附近：“${source.slice(at, at + 8).trim()}”`); }
    out.push(m[1] !== undefined ? { type: 'num', value: Number(m[1]) } : m[2] !== undefined ? { type: 'name', value: m[2] } : { type: 'op', value: m[3] });
    at = TOKEN.lastIndex;
  }
  return out;
}

/** Parses to a tree of closures; `names` is the set of names the expression may read. */
export function compileExpression(source, names, { functions = {} } = {}) {
  if (typeof source !== 'string' || !source.trim()) throw new ExpressionError('表达式不能为空');
  if (source.length > MAX_EXPRESSION) throw new ExpressionError(`表达式太长（最多 ${MAX_EXPRESSION} 个字符）`);
  const toks = tokens(source), allowed = names instanceof Set ? names : new Set(names), used = new Set(), allowedFn = new Set();
  let i = 0;
  const peek = () => toks[i], eat = (value) => { const t = toks[i]; if (t?.type === 'op' && t.value === value) { i++; return true; } return false; };
  const need = (value) => { if (!eat(value)) throw new ExpressionError(`这里应该有“${value}”`); };
  const binary = (next, ops, depth) => {
    let left = next(depth);
    for (;;) {
      const t = peek(); const op = t?.type === 'op' && ops.includes(t.value) ? t.value : null;
      if (!op) return left; i++;
      const right = next(depth), l = left;
      left = op === '+' ? (s) => l(s) + right(s) : op === '-' ? (s) => l(s) - right(s) : op === '*' ? (s) => l(s) * right(s) : op === '/' ? (s) => l(s) / right(s)
        : op === '<' ? (s) => +(l(s) < right(s)) : op === '<=' ? (s) => +(l(s) <= right(s)) : op === '>' ? (s) => +(l(s) > right(s)) : op === '>=' ? (s) => +(l(s) >= right(s))
          : op === '==' ? (s) => +(l(s) === right(s)) : (s) => +(l(s) !== right(s));
    }
  };
  const check = (depth) => { if (depth > MAX_DEPTH) throw new ExpressionError('表达式嵌套太深'); };
  const ternary = (depth) => {
    check(depth);
    const test = or(depth + 1);
    if (!eat('?')) return test;
    const yes = ternary(depth + 1); need(':'); const no = ternary(depth + 1);
    return (s) => (test(s) ? yes(s) : no(s));
  };
  const or = (depth) => { let left = and(depth); while (eat('||')) { const l = left, r = and(depth); left = (s) => +(l(s) || r(s) ? 1 : 0); } return left; };
  const and = (depth) => { let left = compare(depth); while (eat('&&')) { const l = left, r = compare(depth); left = (s) => +(l(s) && r(s) ? 1 : 0); } return left; };
  const compare = (depth) => binary((d) => sum(d), ['<', '<=', '>', '>=', '==', '!='], depth);
  const sum = (depth) => binary((d) => product(d), ['+', '-'], depth);
  const product = (depth) => binary((d) => unary(d), ['*', '/'], depth);
  const unary = (depth) => {
    check(depth);
    if (eat('-')) { const v = unary(depth + 1); return (s) => -v(s); }
    if (eat('!')) { const v = unary(depth + 1); return (s) => +!v(s); }
    return power(depth);
  };
  const power = (depth) => {
    const base = atom(depth + 1);
    if (!eat('^')) return base;
    const exponent = unary(depth + 1);   // right to left, and the exponent may be negative: 2 ^ -1
    return (s) => base(s) ** exponent(s);
  };
  const atom = (depth) => {
    check(depth);
    const t = toks[i++];
    if (!t) throw new ExpressionError('表达式没写完');
    if (t.type === 'num') return () => t.value;
    if (t.type === 'op' && t.value === '(') { const inner = ternary(depth + 1); need(')'); return inner; }
    if (t.type === 'name') {
      if (eat('(')) {
        if (Object.hasOwn(functions, t.value)) {   // a table of the work: name(index), looked up in the scope's `$fn` (not a name an expression can write)
          const arg = ternary(depth + 1); need(')');
          if (!allowedFn.has(t.value)) allowedFn.add(t.value);
          const name = t.value;
          return (s) => s.$fn[name](arg(s));
        }
        const fn = FUNCTIONS[t.value];
        if (!fn) throw new ExpressionError(`没有函数“${t.value}”（可用：${FUNCTION_NAMES.join('、')}）`);
        const args = [];
        if (!eat(')')) { do args.push(ternary(depth + 1)); while (eat(',')); need(')'); }
        if (args.length !== fn[0]) throw new ExpressionError(`函数 ${t.value} 需要 ${fn[0]} 个参数，写了 ${args.length} 个`);
        const f = fn[1];
        return args.length === 1 ? (s) => f(args[0](s)) : args.length === 2 ? (s) => f(args[0](s), args[1](s)) : (s) => f(args[0](s), args[1](s), args[2](s));
      }
      if (t.value === 'true') return () => 1;
      if (t.value === 'false') return () => 0;
      if (!allowed.has(t.value)) throw new ExpressionError(`没有定义“${t.value}”`);
      used.add(t.value);
      const name = t.value;
      return (s) => s[name];
    }
    throw new ExpressionError(`这里不该有“${t.value}”`);
  };
  const tree = ternary(0);
  if (i < toks.length) throw new ExpressionError(`多余的内容：“${toks[i].value}”`);
  const fn = (scope) => tree(scope);
  fn.names = used;
  fn.source = source;
  return fn;
}
