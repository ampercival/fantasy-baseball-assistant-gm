// Port of backend/app/league_value.py — fits a salary-vs-rank value curve via Nelder-Mead.
// NOTE: this is iterative floating-point optimization, so the fitted parameters are functionally
// equivalent to the Python version but NOT byte-identical (libm differences compound across
// iterations). Fit quality (rmse) tracks the Python result; the frontend uses the parameters to
// compute scoring values, which are robust to tiny parameter differences.

const PARAMETER_NAMES = ["c", "A", "m", "s", "g", "D", "k"] as const;
type Params = Record<string, number>;
type Point = [number, number]; // [rank, salary]
type Vec = number[];

const round = (x: number, d: number) => {
  const m = 10 ** d;
  return Math.round(x * m) / m;
};

function safeExp(value: number): number {
  if (value > 50) return Math.exp(50);
  if (value < -50) return Math.exp(-50);
  return Math.exp(value);
}

function pstdev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const ss = values.reduce((a, v) => a + (v - mean) * (v - mean), 0);
  return Math.sqrt(ss / values.length);
}

function parametersToVector(p: Params): Vec {
  const c = Math.max(p.c, 1e-9);
  const height = Math.max(p.A - c, 1e-9);
  return [
    Math.log(c),
    Math.log(height),
    Math.log(Math.max(p.m, 1e-9)),
    Math.log(Math.max(p.s, 1e-9)),
    Math.log(Math.max(p.g, 1e-9)),
    Math.log(Math.max(p.D, 1e-9)),
    Math.log(Math.max(p.k, 1e-9)),
  ];
}

function vectorToParameters(v: Vec): Params {
  const c = safeExp(v[0]);
  const height = safeExp(v[1]);
  return { c, A: c + height, m: safeExp(v[2]), s: safeExp(v[3]), g: safeExp(v[4]), D: safeExp(v[5]), k: safeExp(v[6]) };
}

export function fittedValue(rank: number, p: Params): number {
  const mainCurve = p.c + (p.A - p.c) / (1 + (rank / p.m) ** p.s) ** p.g;
  const eliteBump = p.D * Math.exp(-p.k * (rank - 1));
  return mainCurve + eliteBump;
}

function salaryRankPoints(rows: Record<string, any>[]): Point[] {
  const filtered = rows.filter((r) => r.salary !== null && r.salary !== undefined);
  filtered.sort((a, b) => {
    const sa = -Number(a.salary);
    const sb = -Number(b.salary);
    if (sa !== sb) return sa - sb;
    const ta = String(a.team_name ?? "");
    const tb = String(b.team_name ?? "");
    if (ta !== tb) return ta < tb ? -1 : 1;
    const pa = String(a.player_name ?? "");
    const pb = String(b.player_name ?? "");
    if (pa !== pb) return pa < pb ? -1 : 1;
    const ka = String(a.player_key ?? "");
    const kb = String(b.player_key ?? "");
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return filtered.map((r, i) => [i + 1, Number(r.salary)]);
}

function parameterPenalty(p: Params, n: number, minSalary: number, maxSalary: number): number {
  if (!Object.values(p).every((v) => Number.isFinite(v))) return 1e12;
  const floor = Math.max(0.001, minSalary > 0 ? minSalary : 0.001);
  if (!(floor <= p.c && p.c <= Math.max(5.0, maxSalary * 2.0))) return 1e11 + Math.abs(p.c) * 1e6;
  if (!(p.c <= p.A && p.A <= maxSalary * 4.0 + 20)) return 1e11 + Math.abs(p.A) * 1e6;
  if (!(0.5 <= p.m && p.m <= n * 6.0)) return 1e11 + Math.abs(p.m) * 1e6;
  if (!(0.05 <= p.s && p.s <= 12.0)) return 1e11 + Math.abs(p.s) * 1e6;
  if (!(0.05 <= p.g && p.g <= 12.0)) return 1e11 + Math.abs(p.g) * 1e6;
  if (!(0.0 <= p.D && p.D <= maxSalary * 4.0 + 20)) return 1e11 + Math.abs(p.D) * 1e6;
  if (!(0.0001 <= p.k && p.k <= 3.0)) return 1e11 + Math.abs(p.k) * 1e6;
  return 0.0;
}

function objective(vector: Vec, points: Point[], n: number, minSalary: number, maxSalary: number): number {
  const p = vectorToParameters(vector);
  const penalty = parameterPenalty(p, n, minSalary, maxSalary);
  if (penalty) return penalty;
  let sum = 0;
  for (const [rank, salary] of points) {
    const err = fittedValue(rank, p) - salary;
    if (!Number.isFinite(err)) return 1e12;
    sum += err * err;
  }
  return sum / points.length;
}

function initialVectors(salaries: number[]): Vec[] {
  const n = salaries.length;
  const minSalary = Math.min(...salaries);
  const maxSalary = Math.max(...salaries);
  const c = Math.max(0.25, minSalary);
  const p10 = salaries[Math.min(n - 1, Math.max(0, Math.trunc(n * 0.1) - 1))];
  const p25 = salaries[Math.min(n - 1, Math.max(0, Math.trunc(n * 0.25) - 1))];
  const eliteBump = Math.max(0.25, maxSalary - p10);
  const starts: Vec[] = [];
  for (const [mScale, steepness, tailShape, bumpScale, decay] of [
    [0.18, 1.2, 1.0, 0.7, 0.045],
    [0.28, 1.7, 1.0, 1.0, 0.07],
    [0.4, 2.2, 0.8, 0.5, 0.035],
    [0.55, 1.4, 1.4, 1.4, 0.095],
  ]) {
    const m = Math.max(1.0, n * mScale);
    const d = Math.max(0.1, eliteBump * bumpScale);
    let a = Math.max(c + 0.25, maxSalary - d);
    if (a < p25) a = p25;
    starts.push(parametersToVector({ c, A: a, m, s: steepness, g: tailShape, D: d, k: decay }));
  }
  return starts;
}

function nelderMead(func: (v: Vec) => number, start: Vec, step: number[], maxIter: number, tolerance = 1e-7): [Vec, number] {
  const dim = start.length;
  let simplex: Vec[] = [start];
  for (let i = 0; i < dim; i++) {
    const candidate = [...start];
    candidate[i] += step[i];
    simplex.push(candidate);
  }
  let values = simplex.map(func);

  for (let iter = 0; iter < maxIter; iter++) {
    const order = [...Array(simplex.length).keys()].sort((a, b) => values[a] - values[b]);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);
    if (pstdev(values) < tolerance) break;

    const centroid = Array.from({ length: dim }, (_, axis) =>
      simplex.slice(0, -1).reduce((acc, vertex) => acc + vertex[axis], 0) / dim,
    );
    const worst = simplex[simplex.length - 1];
    const reflected = centroid.map((cx, axis) => cx + (cx - worst[axis]));
    const reflectedValue = func(reflected);

    if (values[0] <= reflectedValue && reflectedValue < values[values.length - 2]) {
      simplex[simplex.length - 1] = reflected;
      values[values.length - 1] = reflectedValue;
      continue;
    }
    if (reflectedValue < values[0]) {
      const expanded = centroid.map((cx, axis) => cx + 2.0 * (reflected[axis] - cx));
      const expandedValue = func(expanded);
      if (expandedValue < reflectedValue) {
        simplex[simplex.length - 1] = expanded;
        values[values.length - 1] = expandedValue;
      } else {
        simplex[simplex.length - 1] = reflected;
        values[values.length - 1] = reflectedValue;
      }
      continue;
    }
    const contracted = centroid.map((cx, axis) => cx + 0.5 * (worst[axis] - cx));
    const contractedValue = func(contracted);
    if (contractedValue < values[values.length - 1]) {
      simplex[simplex.length - 1] = contracted;
      values[values.length - 1] = contractedValue;
      continue;
    }
    const best = simplex[0];
    simplex = [best, ...simplex.slice(1).map((vertex) => best.map((bx, axis) => bx + 0.5 * (vertex[axis] - bx)))];
    values = simplex.map(func);
  }

  let bestIndex = 0;
  for (let i = 1; i < simplex.length; i++) if (values[i] < values[bestIndex]) bestIndex = i;
  return [simplex[bestIndex], values[bestIndex]];
}

function fitValueCurve(points: Point[]): Params {
  const n = points.length;
  const salaries = points.map(([, salary]) => salary);
  const minSalary = Math.min(...salaries);
  const maxSalary = Math.max(...salaries);
  const starts = initialVectors(salaries);
  const step = [0.18, 0.35, 0.45, 0.28, 0.28, 0.55, 0.45];
  let bestVector = starts[0];
  let bestScore = Infinity;
  for (const start of starts) {
    const [vector, score] = nelderMead((c) => objective(c, points, n, minSalary, maxSalary), start, step, 650);
    if (score < bestScore) {
      bestVector = vector;
      bestScore = score;
    }
  }
  return vectorToParameters(bestVector);
}

export function buildLeagueValueCurve(rosterRows: Record<string, any>[]): Record<string, any> | null {
  const points = salaryRankPoints(rosterRows);
  if (points.length < 8) return null;
  const parameters = fitValueCurve(points);
  const errors = points.map(([rank, salary]) => fittedValue(rank, parameters) - salary);
  const rmse = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
  const rounded: Params = {};
  for (const name of PARAMETER_NAMES) rounded[name] = round(parameters[name], 6);
  return { parameters: rounded, player_count: points.length, rmse: round(rmse, 4) };
}
