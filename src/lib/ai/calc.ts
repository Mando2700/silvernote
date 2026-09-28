/**
 * A small, safe arithmetic evaluator for Grok's `calculate` tool: numbers, + - * / ^ %, parentheses,
 * scientific notation and a handful of functions. No identifiers other than those below, no code.
 */
const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  exp: Math.exp,
  abs: Math.abs,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  round: (value, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits,
  sum: (...values) => values.reduce((total, value) => total + value, 0),
  avg: (...values) => values.reduce((total, value) => total + value, 0) / values.length,
  /** Compound annual growth: cagr(start, end, years). */
  cagr: (start, end, years) => (end / start) ** (1 / years) - 1,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export function evaluate(expression: string): number {
  const source = expression.replace(/[\s_]+/g, '');
  let index = 0;

  const peek = () => source[index];
  const fail = (message: string): never => {
    throw new Error(`${message} at position ${index} in "${expression}"`);
  };
  const expect = (char: string) => {
    if (source[index] !== char) fail(`expected "${char}"`);
    index += 1;
  };

  function primary(): number {
    const char = peek();
    if (char === '(') {
      index += 1;
      const value = additive();
      expect(')');
      return value;
    }
    const number = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(source.slice(index));
    if (number) {
      index += number[0].length;
      return Number(number[0]);
    }
    const name = /^[a-z_][a-z0-9_]*/i.exec(source.slice(index));
    if (name) {
      const key = name[0].toLowerCase();
      index += name[0].length;
      if (key in CONSTANTS && peek() !== '(') return CONSTANTS[key];
      const fn = FUNCTIONS[key];
      if (!fn) fail(`unknown name "${name[0]}"`);
      expect('(');
      const args: number[] = [];
      if (peek() !== ')') {
        args.push(additive());
        while (peek() === ',') {
          index += 1;
          args.push(additive());
        }
      }
      expect(')');
      return fn(...args);
    }
    return fail('unexpected input');
  }

  function postfix(): number {
    let value = primary();
    while (peek() === '%') {
      index += 1;
      value /= 100;
    }
    return value;
  }

  function unary(): number {
    if (peek() === '-') {
      index += 1;
      return -unary();
    }
    if (peek() === '+') {
      index += 1;
      return unary();
    }
    return power();
  }

  function power(): number {
    const base = postfix();
    if (peek() === '^' || source.startsWith('**', index)) {
      index += peek() === '^' ? 1 : 2;
      return base ** unary();
    }
    return base;
  }

  function multiplicative(): number {
    let value = unary();
    while (peek() === '*' || peek() === '/') {
      const op = peek();
      index += 1;
      const right = unary();
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }

  function additive(): number {
    let value = multiplicative();
    while (peek() === '+' || peek() === '-') {
      const op = peek();
      index += 1;
      const right = multiplicative();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  if (!source) fail('empty expression');
  const result = additive();
  if (index < source.length) fail('unexpected input');
  return result;
}
