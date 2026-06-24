import { curriculumNodes } from "./curriculum.js";

// ── helpers ───────────────────────────────────────────────────────────────────
const P = (n, r) => { let v = 1; for (let i = 0; i < r; i++) v *= (n - i); return v; };
const fact = (n) => n <= 1 ? 1 : n * fact(n - 1);
const C = (n, r) => P(n, r) / fact(r);
const gcd = (a, b) => b === 0 ? Math.abs(a) : gcd(b, a % b);
const frac = (a, b) => { const d = gcd(a, b); return b / d === 1 ? String(a / d) : `${a / d}/${b / d}`; };
const sg = (v) => v === 0 ? "" : v > 0 ? `+ ${v}` : `- ${Math.abs(v)}`;
const hsh = (s) => { let h = 0; for (const c of s) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0; return Math.abs(h); };
const mc = (correct, wrongs, concept) => {
  const all = [correct, ...wrongs.slice(0, 4)];
  const shuffled = [...all].sort((a, b) => (hsh(String(a) + String(b)) % 3) - 1);
  return { answer: correct, choices: shuffled, concept };
};
const isMC = (n) => n % 5 === 1 || n % 5 === 4;
const T = (n, types) => (n - 1) % types;

export function getProblemsForSkill(skill) { return skill ? generateProblemsForSkill(skill) : []; }
export function generateProblemsForSkill(skill) {
  return Array.from({ length: 50 }, (_, i) => buildProblem(skill, i + 1));
}

function buildProblem(skill, n) {
  const builder = getBuilder(skill);
  const built = builder(skill, n);
  // 힌트·풀이 방향·개념 보기 텍스트는 실제로 그 문제를 열 때만 만들면 되므로
  // getter로 지연 생성한다. (시작 시 2100문제 × 3개 문자열을 미리 만들지 않아 첫 화면이 빨리 뜬다.)
  return {
    id: `p-${skill.id}-${String(n).padStart(2, "0")}`,
    nodeId: skill.id,
    gradeBand: skill.stage.startsWith("중") ? "middle" : "high",
    source: "built-in",
    sourceName: "내장 단원 문제은행",
    difficulty: Math.min(5, 1 + Math.floor((n - 1) / 12)),
    title: `${skill.title} ${n}`,
    ...built,
    get hint() { return hint(skill, built); },
    get nextStep() { return next(skill, built); },
    get conceptGuide() { return concept(skill, built); },
  };
}

function getBuilder(skill) {
  const map = {
    "m1-numbers": m1Numbers, "m1-expressions": m1Expr, "m1-equations": m1Eq,
    "m1-coordinates": m1Coord, "m1-geometry-basic": m1GeoBasic, "m1-plane-solid": m1Solid,
    "m1-statistics": m1Stat,
    "m2-rational": m2Rational, "m2-polynomial": m2Poly, "m2-linear-system": m2System,
    "m2-inequality": m2Ineq, "m2-functions": m2Func, "m2-geometry": m2Geo,
    "m2-similarity": m2Sim, "m2-probability": m2Prob,
    "m3-real-roots": m3Roots, "m3-polynomial": m3Poly, "m3-quadratic": m3Quad,
    "m3-quadratic-function": m3QFunc, "m3-pythagorean": m3Pyth, "m3-circle": m3Circle,
    "m3-statistics": m3Stat,
    "h-common-polynomial": h1Poly, "h-common-equations": h1Eq, "h-common-functions": h1Func,
    "h-common-geometry": h1Geo, "h-common-combinatorics": h1Comb,
    "h-math1-exponential-log": h2ExpLog, "h-math1-trigonometry": h2Trig,
    "h-math1-sequence": h2Seq, "h-math2-limits": h2Limit,
    "h-math2-differential": h2Diff, "h-math2-integral": h2Int,
    "h-calculus-sequence-limit": h3SeqLim, "h-calculus-differential": h3Diff,
    "h-calculus-integral": h3Int, "h-geometry-conic": h3Conic,
    "h-geometry-vector": h3Vec, "h-geometry-space": h3Space,
    "h-probability-counting": h3Count, "h-probability": h3Prob, "h-statistics": h3Stat,
  };
  return map[skill.id] || ((s, n) => ({ prompt: `${s.title} 계산 문제 ${n}`, answer: String(n), concept: s.title }));
}

// ══ 중1 ═══════════════════════════════════════════════════════════════════════

function m1Numbers(_, n) {
  const t = T(n, 5);
  const a = (n % 8) + 2, b = (n % 7) + 1, c = (n % 5) + 1;
  if (t === 0) {
    const ans = String(-a + b + c);
    return isMC(n)
      ? { prompt: `(-${a}) + ${b} - (-${c})의 값은?`, ...mc(ans, [String(-a+b+c+1), String(-a+b+c-1), String(a-b-c), String(-a-b+c)], "음수의 뺄셈은 덧셈으로 바꾼다.") }
      : { prompt: `(-${a}) + ${b} - (-${c})를 계산하시오.`, answer: ans, concept: "부호를 정리한 뒤 덧셈으로 바꾸어 계산한다." };
  }
  if (t === 1) {
    const x = (n % 9) - 4;
    return { prompt: `수직선에서 |${x}|의 값을 구하시오.`, answer: String(Math.abs(x)), concept: "절댓값은 수직선 위 원점까지의 거리이다." };
  }
  if (t === 2) {
    const p = (n % 7) + 1, q = (n % 5) + 2;
    const ans = frac(p * q + n % 3, p);
    return { prompt: `유리수 ${p}와 ${q} 사이에 있는 정수의 개수를 구하시오.`, answer: String(q - p - 1 > 0 ? q - p - 1 : 0), concept: "두 정수 사이 정수 개수 = 큰 수 - 작은 수 - 1" };
  }
  if (t === 3) {
    const vals = [-5, -3, -1, 0, 2, 4, 7];
    const v = vals[n % vals.length];
    const ans = v >= 0 ? "양수 또는 0" : "음수";
    return isMC(n)
      ? { prompt: `${v}는 어떤 수인가?`, ...mc(ans, ["양수", "음수", "0", "자연수"].filter(s => s !== ans), "음수, 0, 양수로 수를 분류한다.") }
      : { prompt: `${v}는 양수, 음수, 0 중 어느 것인가?`, answer: ans, concept: "음수 < 0 < 양수 순서로 수직선에 배열된다." };
  }
  // t === 4
  const nums = [-(a), b, -(c), (n % 4) + 1];
  const sorted = [...nums].sort((x, y) => x - y);
  return { prompt: `다음 수를 작은 것부터 순서대로 나열하시오. ${nums.join(", ")}`, answer: sorted.join(", "), concept: "음수는 절댓값이 클수록 더 작다." };
}

function m1Expr(_, n) {
  const t = T(n, 4);
  const a = (n % 5) + 2, b = (n % 7) + 1, c = (n % 4) + 1, x0 = (n % 5) + 1;
  if (t === 0) {
    const coef = a - c, con = a * b;
    const ans = coef === 0 ? String(con) : `${coef}x + ${con}`;
    return isMC(n)
      ? { prompt: `${a}(x + ${b}) - ${c}x를 간단히 하면?`, ...mc(ans, [`${a}x + ${con}`, `${coef + 1}x + ${con}`, `${coef}x + ${b}`, `${a}x + ${b}`], "분배법칙 적용 후 동류항 정리") }
      : { prompt: `${a}(x + ${b}) - ${c}x를 간단히 하시오.`, answer: ans, concept: "분배법칙을 적용한 뒤 동류항끼리 모은다." };
  }
  if (t === 1) {
    const val = a * x0 + b;
    return { prompt: `x = ${x0}일 때 ${a}x + ${b}의 값을 구하시오.`, answer: String(val), concept: "대입: 문자 자리에 주어진 수를 넣어 계산한다." };
  }
  if (t === 2) {
    const m = (n % 4) + 2, k = (n % 3) + 1;
    return isMC(n)
      ? { prompt: `단항식 ${m}a²b에서 차수는?`, ...mc("3", ["2", "1", "4", "5"], "단항식의 차수는 각 문자 지수의 합이다.") }
      : { prompt: `다항식 ${m}x² + ${k}x - ${a}에서 x²의 계수와 상수항의 합을 구하시오.`, answer: String(m - a), concept: "계수는 해당 항에서 문자를 제외한 수 부분이다." };
  }
  // t === 3
  const lhs = a * x0 + b, rhs = c * x0 - (n % 3);
  return { prompt: `${a}x + ${b}에서 x항과 상수항을 구분하시오.`, answer: `x항: ${a}x, 상수항: ${b}`, concept: "x를 포함한 항과 수만 있는 상수항을 구분한다." };
}

function m1Eq(_, n) {
  const t = T(n, 5);
  const a = (n % 6) + 2, x = (n % 7) + 1, b = (n % 9) + 2;
  if (t === 0) {
    const c = a * x - b;
    return isMC(n)
      ? { prompt: `${a}x - ${b} = ${c}를 풀면?`, ...mc(String(x), [String(x+1), String(x-1), String(x+2), String(-x)], "이항으로 변수를 한쪽으로 모은다.") }
      : { prompt: `${a}x - ${b} = ${c}를 풀면 x = ?`, answer: String(x), concept: "등식의 성질: 양변에 같은 수를 더하거나 나누어도 등식 유지." };
  }
  if (t === 1) {
    // 연령 문제
    const age = (n % 10) + 10;
    const older = age + (n % 6) + 3;
    return { prompt: `현재 ${age}살인 사람이 ${n % 6 + 3}년 후에는 몇 살이 되는가?`, answer: String(age + (n % 6) + 3), concept: "현재 나이 + 경과 년 수 = 미래 나이" };
  }
  if (t === 2) {
    // 거리 문제
    const speed = (n % 5) + 3, time = (n % 4) + 2;
    return { prompt: `시속 ${speed}km로 ${time}시간 달리면 몇 km를 가는가?`, answer: String(speed * time), concept: "거리 = 속력 × 시간" };
  }
  if (t === 3) {
    const m = (n % 4) + 2, k = (n % 6) + 1;
    const rhs = m * x + k;
    return isMC(n)
      ? { prompt: `${m}x + ${k} = ${rhs}의 해는?`, ...mc(String(0), [String(1), String(-1), String(k), String(m)], "이항하면 0 = 0 형태가 되는 방정식은 해가 특수하다.") }
      : { prompt: `방정식 ${m}(x + ${x}) = ${m}x + ${m * x + b}에서 b = ?`, answer: String(b), concept: "분배법칙 후 양변 정리로 상수 구하기." };
  }
  // t === 4: 가격 문제
  const price = (n % 6 + 2) * 100, qty = (n % 4) + 2;
  return { prompt: `한 개에 ${price}원인 물건을 ${qty}개 사면 총 얼마인가?`, answer: String(price * qty), concept: "총액 = 단가 × 개수" };
}

function m1Coord(_, n) {
  const t = T(n, 4);
  const x = ((n * 3) % 13) - 6, y = ((n * 7) % 11) - 5;
  if (t === 0) {
    const q = x > 0 ? (y > 0 ? "제1사분면" : "제4사분면") : (y > 0 ? "제2사분면" : "제3사분면");
    if (x === 0 || y === 0) return { prompt: `점 (${x === 0 ? 1 : x}, ${y === 0 ? 2 : y})는 몇 사분면?`, answer: "제1사분면", concept: "x>0, y>0이면 제1사분면" };
    return isMC(n)
      ? { prompt: `점 (${x}, ${y})는 몇 사분면인가?`, ...mc(q, ["제1사분면","제2사분면","제3사분면","제4사분면"].filter(s=>s!==q), "부호로 사분면을 결정한다.") }
      : { prompt: `점 (${x}, ${y})가 속하는 사분면을 쓰시오.`, answer: q, concept: "x, y의 부호로 사분면을 결정한다." };
  }
  if (t === 1) {
    return { prompt: `점 (${x}, ${y})를 x축 대칭이동한 점의 좌표는?`, answer: `(${x}, ${-y})`, concept: "x축 대칭: y좌표의 부호만 바꾼다." };
  }
  if (t === 2) {
    const x1 = (n % 5) + 1, y1 = (n % 4) + 1, x2 = x1 + (n % 4) + 2, y2 = y1 + (n % 3) + 1;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    return { prompt: `두 점 (${x1}, ${y1}), (${x2}, ${y2})의 중점 좌표를 구하시오.`, answer: `(${mx}, ${my})`, concept: "중점: 각 좌표의 평균" };
  }
  // t === 3
  return { prompt: `x > 0, y < 0인 점은 몇 사분면인가?`, answer: "제4사분면", concept: "x양수 y음수 → 제4사분면" };
}

function m1GeoBasic(_, n) {
  const t = T(n, 4);
  const ang = (n % 8) * 10 + 30;
  if (t === 0) {
    const supp = 180 - ang;
    return isMC(n)
      ? { prompt: `∠A = ${ang}°의 보각은?`, ...mc(String(supp), [String(supp+10), String(supp-10), String(90-ang<0?ang:90-ang), String(ang)], "보각: 합이 180°") }
      : { prompt: `∠A = ${ang}°일 때 보각의 크기를 구하시오.`, answer: String(supp), concept: "보각: 두 각의 합 = 180°" };
  }
  if (t === 1) {
    const comp = 90 - ang % 60;
    return { prompt: `∠B = ${ang % 60 + 10}°일 때 여각의 크기를 구하시오.`, answer: String(90 - (ang % 60 + 10)), concept: "여각: 두 각의 합 = 90°" };
  }
  if (t === 2) {
    const a = (n % 5) + 3;
    return isMC(n)
      ? { prompt: `직선 위의 두 점을 지나는 직선은 몇 개인가?`, ...mc("1개", ["2개","무수히 많다","0개","3개"], "두 점을 지나는 직선은 하나뿐이다.") }
      : { prompt: `반직선과 직선의 차이를 설명하시오.`, answer: "반직선은 한 점에서 시작해 한 방향으로 무한히 뻗고, 직선은 양쪽으로 무한히 뻗는다.", concept: "선분, 반직선, 직선의 정의를 구분한다." };
  }
  // t === 3
  const n1 = (n % 4) + 3;
  return { prompt: `평행한 두 직선에 한 직선이 교차할 때 동위각의 크기가 ${ang}°이면 엇각의 크기는?`, answer: String(ang), concept: "평행선에서 동위각 = 엇각" };
}

function m1Solid(_, n) {
  const t = T(n, 4);
  const r = (n % 6) + 2, h = (n % 5) + 3, s = (n % 4) + 2;
  if (t === 0) {
    return isMC(n)
      ? { prompt: `반지름 ${r}, 높이 ${h}인 원기둥의 부피는?`, ...mc(`${r*r*h}π`, [`${r*h}π`,`${2*r*h}π`,`${r*r*h*2}π`,`${(r+1)*r*h}π`], "원기둥 부피 = πr²h") }
      : { prompt: `반지름 ${r}cm, 높이 ${h}cm인 원기둥의 부피를 구하시오.`, answer: `${r*r*h}π cm³`, concept: "원기둥 부피 = πr²h" };
  }
  if (t === 1) {
    return { prompt: `한 변의 길이가 ${s}cm인 정육면체의 부피를 구하시오.`, answer: `${s**3} cm³`, concept: "정육면체 부피 = a³" };
  }
  if (t === 2) {
    return isMC(n)
      ? { prompt: `직육면체의 꼭짓점 수는?`, ...mc("8", ["6","12","4","10"], "직육면체는 꼭짓점 8, 모서리 12, 면 6") }
      : { prompt: `직육면체의 면, 꼭짓점, 모서리의 수를 각각 구하시오.`, answer: "면: 6, 꼭짓점: 8, 모서리: 12", concept: "오일러 공식: V - E + F = 2" };
  }
  return { prompt: `반지름 ${r}cm인 구의 부피를 구하시오.`, answer: `${Math.round(4/3*r**3)}π/3 cm³`, concept: "구의 부피 = (4/3)πr³" };
}

function m1Stat(_, n) {
  const t = T(n, 4);
  const data = [n+2, n+5, n+1, n+7, n+3, n+4, n+6].slice(0, 5).sort((a,b)=>a-b);
  const mean = data.reduce((s,v)=>s+v,0)/5;
  const med = data[2];
  if (t === 0) {
    return isMC(n)
      ? { prompt: `자료 ${data.join(", ")}의 중앙값은?`, ...mc(String(med), [String(med+1),String(med-1),String(data[1]),String(data[3])], "중앙값은 크기순 정렬 후 가운데 값") }
      : { prompt: `자료 ${data.join(", ")}의 중앙값을 구하시오.`, answer: String(med), concept: "홀수 개 자료의 중앙값: 크기순 정렬 후 가운데 값." };
  }
  if (t === 1) {
    return { prompt: `자료 ${data.join(", ")}의 평균을 구하시오.`, answer: String(mean % 1 === 0 ? mean : mean.toFixed(1)), concept: "평균 = 합계 ÷ 자료 수" };
  }
  if (t === 2) {
    const freq = [3, 5, 2, 4, 1];
    return isMC(n)
      ? { prompt: `도수분포표에서 도수의 합이 15일 때 상대도수의 합은?`, ...mc("1", ["0.5","15","0","1.5"], "상대도수의 합은 항상 1이다.") }
      : { prompt: `도수 ${freq.join(", ")}일 때 전체 도수를 구하시오.`, answer: String(freq.reduce((s,v)=>s+v,0)), concept: "전체 도수 = 각 도수의 합" };
  }
  const mode = data.reduce((a,b,_,arr)=>arr.filter(v=>v===a).length>=arr.filter(v=>v===b).length?a:b);
  return { prompt: `자료 ${[...data, data[2]].join(", ")}에서 최빈값을 구하시오.`, answer: String(data[2]), concept: "최빈값: 가장 자주 나타나는 값" };
}

// ══ 중2 ═══════════════════════════════════════════════════════════════════════

function m2Rational(_, n) {
  const t = T(n, 4);
  if (t === 0) {
    const p = (n%7)+2, q = (n%5)+3;
    return isMC(n)
      ? { prompt: `${p}/${q}는 어떤 수인가?`, ...mc("유리수", ["무리수","자연수","정수","복소수"], "분수로 나타낼 수 있으면 유리수") }
      : { prompt: `${p}/${q}를 소수로 나타낼 때 유한소수인지 무한소수인지 판별하시오.`, answer: p % q === 0 || (q / gcd(p,q)) % 10 === 0 ? "유한소수" : "무한소수", concept: "분모를 기약분수로 바꿔 2, 5 외의 소인수가 없으면 유한소수." };
  }
  if (t === 1) {
    const rep = ["0.333...", "0.142857...","0.1666..."][n%3];
    const ans = ["1/3","1/7","1/6"][n%3];
    return { prompt: `순환소수 ${rep}를 분수로 나타내시오.`, answer: ans, concept: "순환소수를 x로 놓고 10ⁿ배 하여 방정식으로 푼다." };
  }
  if (t === 2) {
    const a = (n%4)+2, b = (n%3)+1;
    return isMC(n)
      ? { prompt: `유리수 ${a}/${(a*b)}를 기약분수로 나타내면?`, ...mc(`1/${b}`, [`${a}/${(a*b)+1}`,`2/${b}`,`${a-1}/${a*b}`,`1/${b+1}`], "최대공약수로 분자·분모를 나누어 기약분수로 만든다.") }
      : { prompt: `${a * 3}/${a * b * 3}을 기약분수로 나타내시오.`, answer: `1/${b}`, concept: "분자와 분모의 GCD로 나누어 기약분수를 구한다." };
  }
  const a=(n%5)+2,b=(n%4)+1;
  return { prompt: `소수 0.${a}${b}를 분수로 나타내시오.`, answer: frac(a*10+b, 100), concept: "소수 자릿수만큼 10ⁿ을 분모로 하고 기약분수로 고친다." };
}

function m2Poly(_, n) {
  const t = T(n, 4);
  const a=(n%5)+2,b=(n%4)+1,c=(n%3)+1;
  if (t===0) {
    const ans=`${a*b}x² + ${a*c}x`;
    return isMC(n)
      ? { prompt:`${a}x(${b}x + ${c})를 전개하면?`, ...mc(ans,[`${a*b}x+${a*c}`,`${a*b}x²+${c}x`,`${b}x²+${a*c}x`,`${a}x²+${a*c}x`],"단항식×다항식은 분배법칙") }
      : { prompt:`${a}x(${b}x + ${c})를 전개하시오.`, answer:ans, concept:"단항식 × 다항식: 각 항에 단항식을 곱한다." };
  }
  if (t===1) {
    const m=(n%4)+2, k=(n%3)+1;
    return { prompt:`다항식 ${m}x²y³ ÷ ${k}xy를 간단히 하시오.`, answer:`${m/gcd(m,k)}xy²/${k/gcd(m,k)}`, concept:"단항식 나눗셈: 계수끼리, 지수끼리 나눈다." };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`(${a}x)² = ?`, ...mc(`${a*a}x²`,[`${a*2}x`,`${a*a}x`,`${a}x²`,`${a*a}x³`],"(ax)² = a²x²") }
      : { prompt:`(${a}x)³을 전개하시오.`, answer:`${a**3}x³`, concept:"(ax)ⁿ = aⁿxⁿ" };
  }
  const p=(n%3)+2, q=(n%4)+1;
  return { prompt:`${p}a²b × ${q}ab³을 간단히 하시오.`, answer:`${p*q}a³b⁴`, concept:"지수법칙: aᵐ × aⁿ = aᵐ⁺ⁿ" };
}

function m2System(_, n) {
  const t = T(n, 4);
  const x0=(n%5)+1, y0=(n%4)+1;
  const a1=(n%3)+1, b1=(n%4)+1, c1=a1*x0+b1*y0;
  const a2=(n%4)+2, b2=(n%3)+1, c2=a2*x0+b2*y0;
  if (t===0) {
    return isMC(n)
      ? { prompt:`{ ${a1}x+${b1}y=${c1}, ${a2}x+${b2}y=${c2} }의 해는?`, ...mc(`x=${x0}, y=${y0}`,[`x=${x0+1},y=${y0}`,`x=${x0},y=${y0+1}`,`x=${y0},y=${x0}`,`x=${x0-1},y=${y0+1}`],"가감법으로 한 미지수 소거") }
      : { prompt:`연립방정식 { ${a1}x+${b1}y=${c1}, ${a2}x+${b2}y=${c2} }를 푸시오.`, answer:`x=${x0}, y=${y0}`, concept:"가감법: 계수를 맞춰 두 식을 더하거나 빼서 한 미지수를 소거." };
  }
  if (t===1) {
    // 실용 문제
    const apples=(n%4)+3, oranges=(n%3)+2;
    const total=apples*150+oranges*200;
    return { prompt:`사과 한 개에 150원, 오렌지 한 개에 200원일 때 사과 ${apples}개와 오렌지 ${oranges}개의 합은?`, answer:`${total}원`, concept:"각 수량 × 단가를 합산한다." };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`연립방정식의 해가 무수히 많은 경우는?`, ...mc("두 방정식이 같을 때",["두 방정식이 모순일 때","한 방정식이 0일 때","계수가 같을 때","해가 정수일 때"],"두 식이 동치이면 해가 무수히 많다.") }
      : { prompt:`연립방정식 { x+y=5, 2x+2y=10 }의 해의 개수를 말하시오.`, answer:"무수히 많다 (두 식이 같다)", concept:"두 방정식이 동치이면 해가 무수히 많다." };
  }
  const s=(n%5)+2, d=(n%3)+1;
  return { prompt:`두 수의 합이 ${s+d}, 차가 ${Math.abs(s-d)}일 때 두 수를 구하시오.`, answer:`${Math.max(s,d)}, ${Math.min(s,d)}`, concept:"x+y=A, x-y=B를 연립방정식으로 풀기." };
}

function m2Ineq(_, n) {
  const t = T(n, 4);
  const a=(n%5)+2, x=(n%6)+1, b=(n%8)+3;
  if (t===0) {
    const c=a*x-b;
    return isMC(n)
      ? { prompt:`${a}x - ${b} < ${c}를 풀면?`, ...mc(`x < ${x}`,[`x > ${x}`,`x ≤ ${x}`,`x < ${x+1}`,`x > ${x-1}`],"음수 곱하면 부등호 방향 바뀐다") }
      : { prompt:`${a}x - ${b} < ${c}를 풀면 x < ?`, answer:String(x), concept:"부등식: 양변에 같은 양수를 나누어도 방향 유지." };
  }
  if (t===1) {
    const neg_a = (n%4)+2;
    const c2 = -(neg_a * x) + b;
    return { prompt:`-${neg_a}x + ${b} > ${c2}를 풀면 x < ?`, answer:String(x), concept:"음수로 나누면 부등호 방향이 바뀐다." };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`부등식 x - 3 ≥ 0의 해는?`, ...mc("x ≥ 3",["x ≤ 3","x > 3","x < 3","x = 3"],"이항하면 x ≥ 3") }
      : { prompt:`부등식 ${a}x + ${b} ≥ ${a*(x+1)+b}를 풀면 x ≥ ?`, answer:String(x+1), concept:"양변에서 상수를 빼고 계수로 나눈다." };
  }
  const lo=(n%3)+1, hi=lo+(n%4)+2;
  return { prompt:`${lo} ≤ x ≤ ${hi}를 만족하는 정수 x의 개수를 구하시오.`, answer:String(hi-lo+1), concept:"양 끝 포함 정수 개수 = 큰 수 - 작은 수 + 1" };
}

function m2Func(_, n) {
  const t = T(n, 5);
  const a=(n%5)+1, b=(n%7)-3, x1=(n%4)+1, x2=x1+(n%4)+2;
  if (t===0) {
    const dy=String(a*(x2-x1));
    return isMC(n)
      ? { prompt:`y=${a}x${sg(b)}에서 x: ${x1}→${x2} y증가량은?`, ...mc(dy,[String(a*(x2-x1)+1),String(a*(x2-x1)-1),String(a*x2),String(b*(x2-x1))], "y증가량 = 기울기×x증가량") }
      : { prompt:`y = ${a}x ${sg(b)}에서 x가 ${x1}에서 ${x2}로 증가할 때 y의 증가량을 구하시오.`, answer:dy, concept:"y의 증가량 = 기울기 × x의 증가량" };
  }
  if (t===1) {
    const px=(n%5)+1, py=a*px+b;
    return { prompt:`y = ${a}x ${sg(b)}에서 x = ${px}일 때 y의 값을 구하시오.`, answer:String(py), concept:"x 값을 식에 대입하여 y를 구한다." };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`y = ${a}x ${sg(b)}의 기울기는?`, ...mc(String(a),[String(a+1),String(a-1),String(b),String(-a)],"y=ax+b에서 a가 기울기") }
      : { prompt:`두 점 (${x1}, ${a*x1+b}), (${x2}, ${a*x2+b})를 지나는 직선의 기울기를 구하시오.`, answer:String(a), concept:"기울기 = (y₂-y₁)/(x₂-x₁)" };
  }
  if (t===3) {
    return { prompt:`일차함수 y = ${a}x ${sg(b)}의 y절편을 구하시오.`, answer:String(b), concept:"y절편: x=0을 대입하면 y = b" };
  }
  return { prompt:`일차함수 y = ${a}x ${sg(b)}의 그래프가 지나는 사분면을 구하시오.`, answer: a>0&&b>0 ? "제1,2,3사분면" : a>0&&b<0 ? "제1,3,4사분면" : a<0&&b>0 ? "제1,2,4사분면" : "제2,3,4사분면", concept:"기울기와 y절편의 부호로 그래프가 지나는 사분면 결정." };
}

function m2Geo(_, n) {
  const t = T(n, 4);
  const ang = (n%6)*10+30;
  if (t===0) {
    const third=180-2*ang;
    return isMC(n)
      ? { prompt:`이등변삼각형 밑각=${ang}°일 때 꼭지각은?`, ...mc(String(third),[String(third+5),String(third-5),String(ang),String(180-ang)],"세 내각의 합=180°") }
      : { prompt:`이등변삼각형의 밑각이 ${ang}°씩일 때 꼭지각을 구하시오.`, answer:String(180-2*ang), concept:"이등변삼각형 꼭지각 = 180° - 2×밑각" };
  }
  if (t===1) {
    return isMC(n)
      ? { prompt:`직사각형의 두 대각선에 대한 설명으로 옳은 것은?`, ...mc("서로 이등분한다",["수직으로 만난다","길이가 다르다","꼭짓점을 모두 지난다","평행하다"],"직사각형 대각선: 길이 같고 서로 이등분") }
      : { prompt:`평행사변형에서 한 쌍의 대각의 크기가 ${ang}°씩일 때 나머지 대각의 크기를 구하시오.`, answer:String(180-ang), concept:"평행사변형 이웃한 두 각의 합 = 180°" };
  }
  if (t===2) {
    const a=(n%5)+3, b=(n%4)+4;
    return { prompt:`직각삼각형에서 두 예각의 합을 구하시오.`, answer:"90°", concept:"직각삼각형: 직각(90°) + 두 예각 = 180°, 두 예각 합 = 90°" };
  }
  const r=(n%4)+3;
  return { prompt:`정삼각형의 한 내각의 크기를 구하시오.`, answer:"60°", concept:"정삼각형 세 내각은 모두 60°." };
}

function m2Sim(_, n) {
  const t = T(n, 4);
  const ratio=(n%4)+2, side=(n%6)+3;
  if (t===0) {
    return isMC(n)
      ? { prompt:`닮음비 1:${ratio}인 두 삼각형에서 작은 삼각형 변 ${side} → 큰 삼각형 대응 변?`, ...mc(String(side*ratio),[String(side*ratio+1),String(side+ratio),String(side*ratio-1),String(side*(ratio-1))],"닮음비=대응 변의 비") }
      : { prompt:`닮음비가 ${ratio}:1인 두 사각형에서 큰 사각형 변이 ${side*ratio}이면 작은 사각형의 대응 변은?`, answer:String(side), concept:"닮음비 m:n → 대응 변의 비도 m:n" };
  }
  if (t===1) {
    const ar=ratio*ratio;
    return isMC(n)
      ? { prompt:`닮음비 1:${ratio}인 두 도형의 넓이의 비는?`, ...mc(`1:${ar}`,[`1:${ratio}`,`1:${ar+1}`,`2:${ar}`,`1:${ratio*3}`],"닮음비 m:n → 넓이비 m²:n²") }
      : { prompt:`닮음비가 2:${ratio}인 두 삼각형의 넓이의 비를 구하시오.`, answer:`4:${ratio*ratio}`, concept:"넓이비 = 닮음비의 제곱" };
  }
  if (t===2) {
    const h=(n%5)+4, sh=(n%3)+2;
    return { prompt:`높이가 ${h}m인 나무 옆 ${sh}m 높이 막대의 그림자가 2m일 때 나무의 그림자는?`, answer:`${Math.round(h/sh*2)}m`, concept:"닮음 비례식으로 그림자 길이를 구한다." };
  }
  return { prompt:`AA 닮음이 성립하기 위한 조건을 서술하시오.`, answer:"두 쌍의 대응하는 각이 각각 같다", concept:"삼각형 닮음 조건: AA, SAS, SSS" };
}

function m2Prob(_, n) {
  const t = T(n, 4);
  const total=12+(n%9), div=(n%4)+2, cnt=Math.floor(total/div);
  if (t===0) {
    const ans=frac(cnt, total);
    return isMC(n)
      ? { prompt:`1~${total} 카드 중 ${div}의 배수 확률은?`, ...mc(ans,[frac(cnt+1,total),frac(Math.max(1,cnt-1),total),frac(div,total),frac(1,div)],"P=사건/전체") }
      : { prompt:`1부터 ${total}까지에서 ${div}의 배수가 나올 확률을 구하시오.`, answer:ans, concept:"확률 = 해당 경우의 수 ÷ 전체 경우의 수" };
  }
  if (t===1) {
    const p=(n%4)+1;
    return isMC(n)
      ? { prompt:`P(A) = ${p}/10이면 P(Aᶜ)는?`, ...mc(`${10-p}/10`,[`${p}/10`,`${p+1}/10`,`${10-p-1}/10`,`1`],"여사건 확률 = 1 - P(A)") }
      : { prompt:`어떤 사건의 확률이 ${p}/10이면 그 여사건의 확률은?`, answer:`${10-p}/10`, concept:"여사건 확률 = 1 - 해당 사건의 확률" };
  }
  if (t===2) {
    const r=(n%3)+2, b=total-r;
    return { prompt:`빨간 공 ${r}개, 파란 공 ${b}개 든 주머니에서 1개 꺼낼 때 빨간 공일 확률은?`, answer:frac(r,total), concept:"전체 공 수를 분모로 원하는 색 수를 분자로 한다." };
  }
  return { prompt:`동전 2개를 동시에 던질 때 모두 앞면이 나올 확률을 구하시오.`, answer:"1/4", concept:"각 동전 결과가 독립: 1/2 × 1/2 = 1/4" };
}

// ══ 중3 ═══════════════════════════════════════════════════════════════════════

function m3Roots(_, n) {
  const t = T(n, 4);
  const sqs=[4,9,16,25,36,49,64,81,100,121]; const sq=sqs[n%sqs.length]; const rt=Math.sqrt(sq);
  if (t===0) {
    return isMC(n)
      ? { prompt:`√${sq}의 값은?`, ...mc(String(rt),[String(rt+1),String(rt-1),String(rt*2),String(sq/2)],"완전제곱수의 제곱근은 정수") }
      : { prompt:`√${sq}를 계산하시오.`, answer:String(rt), concept:"완전제곱수 a²의 제곱근은 ±a" };
  }
  if (t===1) {
    const a=(n%5)+2;
    return { prompt:`√${a*a*sq} = ${a}√? 일 때 ?를 구하시오.`, answer:String(sq), concept:"√(a²b) = a√b (a>0)" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`√2 는 어떤 수인가?`, ...mc("무리수",["유리수","정수","자연수","허수"],"분수로 나타낼 수 없으면 무리수") }
      : { prompt:`√9, √5, √0.25 중 유리수를 모두 고르시오.`, answer:"√9, √0.25", concept:"제곱근이 정수나 유한소수면 유리수." };
  }
  const a=(n%4)+2, b=(n%3)+1;
  return { prompt:`${a}√${b} + ${b}√${b}를 간단히 하시오.`, answer:`${a+b}√${b}`, concept:"동류항 합산: m√k + n√k = (m+n)√k" };
}

function m3Poly(_, n) {
  const t = T(n, 4);
  const a=(n%5)+2, b=(n%4)+1;
  if (t===0) {
    const ans=`${a*a}x² - ${b*b}`;
    return isMC(n)
      ? { prompt:`(${a}x+${b})(${a}x-${b})를 전개하면?`, ...mc(ans,[`${a*a}x²+${b*b}`,`${a}x²-${b}`,`${a*2}x-${b*b}`,`${a*a}x-${b}`],"합차공식 (a+b)(a-b)=a²-b²") }
      : { prompt:`(${a}x + ${b})(${a}x - ${b})를 전개하시오.`, answer:ans, concept:"합차공식: (a+b)(a-b) = a² - b²" };
  }
  if (t===1) {
    const r1=(n%5)+1, r2=r1+(n%4)+1;
    return { prompt:`x² + ${r1+r2}x + ${r1*r2}를 인수분해하시오.`, answer:`(x + ${r1})(x + ${r2})`, concept:"합이 (r1+r2), 곱이 r1×r2인 두 수 찾기" };
  }
  if (t===2) {
    const sq2=(n%4)+2;
    return isMC(n)
      ? { prompt:`x² - ${sq2*sq2}를 인수분해하면?`, ...mc(`(x+${sq2})(x-${sq2})`,[`(x-${sq2})²`,`(x+${sq2})²`,`x(x-${sq2})`,`(x+${sq2+1})(x-${sq2-1})`],"a²-b²=(a+b)(a-b)") }
      : { prompt:`${a}x² + ${2*a*b}x + ${a*b*b}를 인수분해하시오.`, answer:`${a}(x + ${b})²`, concept:"완전제곱식: a(x+b)²" };
  }
  const p=(n%5)+2, q=(n%4)+1;
  return { prompt:`인수분해 공식 a² - 2ab + b² = ?를 완성하시오.`, answer:"(a - b)²", concept:"완전제곱식: (a-b)² = a² - 2ab + b²" };
}

function m3Quad(_, n) {
  const t = T(n, 4);
  const r1=(n%6)+1, r2=r1+(n%5)+1;
  if (t===0) {
    return isMC(n)
      ? { prompt:`x²-${r1+r2}x+${r1*r2}=0의 해는?`, ...mc(`x=${r1} 또는 x=${r2}`,[`x=${r1} 또는 x=${r2+1}`,`x=${r1+1} 또는 x=${r2}`,`x=±${r1}`,`x=${r1*r2}`],"인수분해법으로 이차방정식 풀기") }
      : { prompt:`x² - ${r1+r2}x + ${r1*r2} = 0을 풀면 x = ?, ? (오름차순)`, answer:`${r1}, ${r2}`, concept:"인수분해: (x-r1)(x-r2)=0 → x=r1 또는 x=r2" };
  }
  if (t===1) {
    const a=(n%3)+1, k=(n%5)+1;
    const disc=Math.sqrt(k);
    return { prompt:`${a}x² - ${a*k} = 0에서 x = ±?`, answer:`±√${k}`, concept:"x² = k → x = ±√k" };
  }
  if (t===2) {
    const b=(n%6)+2, c=(n%5)+1;
    const disc=b*b-4*c;
    return isMC(n)
      ? { prompt:`x²-${b}x+${c}=0의 판별식 D는?`, ...mc(String(disc),[String(disc+4),String(disc-4),String(b*b),String(b*b+4*c)],"D=b²-4ac") }
      : { prompt:`이차방정식 x² - ${b}x + ${c} = 0의 판별식 값을 구하시오.`, answer:String(disc), concept:"판별식 D = b² - 4ac, D>0: 두 실근, D=0: 중근, D<0: 허근" };
  }
  return { prompt:`이차방정식 x²-${r1+r2}x+${r1*r2}=0에서 두 근의 합과 곱을 구하시오.`, answer:`합: ${r1+r2}, 곱: ${r1*r2}`, concept:"근과 계수의 관계: 합=-b/a, 곱=c/a" };
}

function m3QFunc(_, n) {
  const t = T(n, 4);
  const a=(n%3)+1, h=(n%7)-3, k=(n%9)-4;
  if (t===0) {
    return isMC(n)
      ? { prompt:`y=${a}(x-${h})²${sg(k)}의 꼭짓점은?`, ...mc(`(${h}, ${k})`,[`(${h+1},${k})`,`(${-h},${k})`,`(${h},${k+1})`,`(${h},${-k})`],"꼭짓점=(h,k)") }
      : { prompt:`y = ${a}(x - ${h})² + ${k}의 꼭짓점 좌표를 구하시오.`, answer:`(${h}, ${k})`, concept:"y=a(x-h)²+k의 꼭짓점은 (h, k)." };
  }
  if (t===1) {
    return { prompt:`y = x² - ${2*Math.abs(h)}x + ${h*h+k}를 완전제곱식으로 변환하면?`, answer:`y = (x - ${Math.abs(h)})² ${sg(k)}`, concept:"완전제곱식 변환: x²-2ax+a²=(x-a)²" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`y = ${a}x²의 그래프에 대한 설명으로 옳은 것은?`, ...mc("꼭짓점이 원점이다",["아래로 볼록하다","y축 대칭이 아니다","기울기가 a이다","직선 그래프이다"],"y=ax²: 꼭짓점 원점, y축 대칭") }
      : { prompt:`y = -${a}x²의 그래프는 위로 볼록인가, 아래로 볼록인가?`, answer:"위로 볼록", concept:"a < 0이면 포물선이 위로 볼록" };
  }
  return { prompt:`y = x² - ${2*h}x + ${h*h+k}의 축의 방정식을 구하시오.`, answer:`x = ${h}`, concept:"y=a(x-h)²+k의 축: x=h" };
}

function m3Pyth(_, n) {
  const t = T(n, 4);
  const triples=[[3,4,5],[5,12,13],[8,15,17],[7,24,25],[9,40,41]];
  const [a,b,c]=triples[n%triples.length]; const s=(n%4)+1;
  if (t===0) {
    return isMC(n)
      ? { prompt:`직각삼각형 두 직각변 ${a*s}, ${b*s}→빗변?`, ...mc(String(c*s),[String(c*s+1),String((a+b)*s),String(c*s-1),String(c*s+s)],"a²+b²=c²") }
      : { prompt:`직각삼각형의 직각변이 ${a*s}, ${b*s}일 때 빗변의 길이를 구하시오.`, answer:String(c*s), concept:"피타고라스 정리: a² + b² = c²" };
  }
  if (t===1) {
    return { prompt:`직각삼각형에서 빗변이 ${c*s}, 한 직각변이 ${a*s}일 때 나머지 직각변의 길이를 구하시오.`, answer:String(b*s), concept:"b = √(c²-a²)" };
  }
  if (t===2) {
    const side=(n%5)+3;
    return isMC(n)
      ? { prompt:`정사각형 한 변 ${side}일 때 대각선 길이는?`, ...mc(`${side}√2`,[`${side*2}`,`${side}`,`${side}√3`,`${side*side}√2`],"정사각형 대각선=a√2") }
      : { prompt:`한 변의 길이가 ${side}인 정사각형의 대각선 길이를 구하시오.`, answer:`${side}√2`, concept:"정사각형 대각선 = 한 변 × √2" };
  }
  const h=(n%6)+4;
  return { prompt:`지면에서 ${a*s}m 높이의 나무 꼭대기에서 ${b*s}m 거리의 지점까지의 거리는?`, answer:`${c*s}m`, concept:"수직 높이와 수평 거리로 사선 거리 = √(높이²+거리²)" };
}

function m3Circle(_, n) {
  const t = T(n, 4);
  const r=(n%7)+3;
  if (t===0) {
    const ins=(n%4)*20+30, cen=ins*2>360?360-ins*2%360:ins*2;
    return isMC(n)
      ? { prompt:`원주각 ${ins}°에 대한 중심각은?`, ...mc(String(ins*2),[String(ins),String(ins*3),String(180-ins),String(360-ins*2)],"중심각=원주각×2") }
      : { prompt:`원주각이 ${ins}°일 때 이에 대한 중심각의 크기를 구하시오.`, answer:String(ins*2), concept:"중심각 = 원주각 × 2" };
  }
  if (t===1) {
    return { prompt:`반지름 ${r}인 원의 둘레를 구하시오.`, answer:`${2*r}π`, concept:"원의 둘레 = 2πr" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`원에서 같은 호에 대한 원주각은?`, ...mc("크기가 모두 같다",["중심각과 같다","크기가 다르다","90°이다","호의 길이에 반비례한다"],"같은 호에 대한 원주각은 모두 같다") }
      : { prompt:`반지름 ${r}인 원에서 중심각 90°에 해당하는 호의 길이를 구하시오.`, answer:`${r}π/2`, concept:"호의 길이 = (중심각/360°) × 2πr" };
  }
  return { prompt:`원의 접선은 접점에서 반지름과 어떤 각도를 이루는가?`, answer:"90° (수직)", concept:"원의 접선 ⊥ 그 점에서의 반지름" };
}

function m3Stat(_, n) {
  const t = T(n, 4);
  const data=Array.from({length:5},(_,i)=>(n+i*2+1));
  const mean=data.reduce((s,v)=>s+v,0)/5;
  const variance=data.reduce((s,v)=>s+(v-mean)**2,0)/5;
  if (t===0) {
    return isMC(n)
      ? { prompt:`자료 ${data.join(",")}의 평균은?`, ...mc(String(mean),[String(mean+1),String(mean-1),String(data[2]),String(mean+0.5)],"평균=합÷개수") }
      : { prompt:`자료 ${data.join(", ")}의 평균을 구하시오.`, answer:String(mean), concept:"평균 = 자료의 합 ÷ 자료의 수" };
  }
  if (t===1) {
    return { prompt:`자료 ${data.join(", ")}의 분산을 구하시오.`, answer:String(variance), concept:"분산 = 편차²의 평균 = Σ(자료-평균)²/n" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`표준편차는 분산과 어떤 관계인가?`, ...mc("분산의 양의 제곱근",["분산의 제곱","분산의 절반","분산과 동일","분산의 역수"],"표준편차=√분산") }
      : { prompt:`분산이 4일 때 표준편차를 구하시오.`, answer:"2", concept:"표준편차 = √분산" };
  }
  const dev=data.map(v=>v-mean);
  return { prompt:`자료 ${data.join(", ")}에서 편차의 합을 구하시오.`, answer:"0", concept:"편차의 합은 항상 0이다." };
}

// ══ 고1 공통수학 ═══════════════════════════════════════════════════════════════

function h1Poly(_, n) {
  const t = T(n, 4);
  const a=(n%5)+2, b=(n%4)+1;
  if (t===0) {
    const r1=(n%5)+1, r2=r1+(n%3)+1, r3=r2+(n%2)+1;
    return isMC(n)
      ? { prompt:`(x+${r1})(x+${r2})(x+${r3}) 전개 시 x²계수는?`, ...mc(String(r1+r2+r3),[String(r1+r2+r3+1),String(r1*r2+r3),String(r1+r2),String(r2+r3+1)],"x²계수=세 상수의 합") }
      : { prompt:`다항식 (x+${r1})(x+${r2})를 전개하면?`, answer:`x²+${r1+r2}x+${r1*r2}`, concept:"(x+a)(x+b) = x²+(a+b)x+ab" };
  }
  if (t===1) {
    return { prompt:`다항식 A = x³+${a}x²+${b}x+1을 (x+1)로 나눌 때 나머지를 구하시오.`, answer:String(1-a+b-1+1), concept:"나머지 정리: 다항식 P(x)를 (x-a)로 나눈 나머지는 P(a)" };
  }
  if (t===2) {
    const p=(n%5)+2;
    return isMC(n)
      ? { prompt:`P(x)를 (x-${p})로 나눈 나머지는?`, ...mc(`P(${p})`,[`P(0)`,`P(-${p})`,`P(${p+1})`,`P(1)`],"나머지 정리 P(a)") }
      : { prompt:`다항식 x³-${a}x+${b}를 (x-1)로 나눈 나머지를 구하시오.`, answer:String(1-a+b), concept:"x=1 대입: 나머지 = 1 - a + b" };
  }
  const r1=(n%4)+2, r2=(n%3)+1;
  return { prompt:`x³+${r1+r2}x²+${r1*r2}x를 인수분해하시오.`, answer:`x(x+${r1})(x+${r2})`, concept:"공통인수를 먼저 빼고 남은 이차식을 인수분해한다." };
}

function h1Eq(_, n) {
  const t = T(n, 4);
  const r1=(n%5)+1, r2=r1+(n%4)+1;
  if (t===0) {
    return isMC(n)
      ? { prompt:`x²-${r1+r2}x+${r1*r2}=0의 두 근의 합은?`, ...mc(String(r1+r2),[String(r1+r2+1),String(r1*r2),String(r1-r2),String(r2)],"근의 합=-b/a") }
      : { prompt:`x² - ${r1+r2}x + ${r1*r2} = 0에서 두 근의 합과 곱을 구하시오.`, answer:`합: ${r1+r2}, 곱: ${r1*r2}`, concept:"근과 계수의 관계: 합 = -b/a, 곱 = c/a" };
  }
  if (t===1) {
    const b=(n%6)+2, c=(n%5)+1, disc=b*b-4*c;
    return isMC(n)
      ? { prompt:`x²-${b}x+${c}=0의 근의 종류는?`, ...mc(disc>0?"서로 다른 두 실근":disc===0?"중근":"허근",["서로 다른 두 실근","중근","허근"],"D=b²-4ac") }
      : { prompt:`이차방정식 x²-${b}x+${c}=0의 판별식 D를 구하시오.`, answer:String(disc), concept:"D=b²-4ac: D>0 두 실근, D=0 중근, D<0 허근" };
  }
  if (t===2) {
    const a=(n%4)+2;
    return { prompt:`절댓값 방정식 |x-${a}|=3을 푸시오.`, answer:`x=${a+3} 또는 x=${a-3}`, concept:"|x-a|=b → x-a=±b → x=a±b" };
  }
  const a=(n%4)+2, b=(n%5)+1;
  return { prompt:`이차부등식 x²-${r1+r2}x+${r1*r2}<0의 해를 구하시오.`, answer:`${r1} < x < ${r2}`, concept:"이차부등식 (x-r1)(x-r2)<0 → r1<x<r2 (r1<r2)" };
}

function h1Func(_, n) {
  const t = T(n, 4);
  const a=(n%4)+1, b=(n%6)-2, x=(n%5)+1;
  if (t===0) {
    return isMC(n)
      ? { prompt:`f(x)=${a}x${sg(b)}일 때 f(${x})=?`, ...mc(String(a*x+b),[String(a*x+b+a),String(a*x),String(a*(x+1)+b),String(a*x+b-1)],"f(x)에 x값 대입") }
      : { prompt:`f(x) = ${a}x ${sg(b)}일 때 f(${x})의 값을 구하시오.`, answer:String(a*x+b), concept:"함수값: x 자리에 숫자를 대입한다." };
  }
  if (t===1) {
    const g_a=(n%3)+2;
    return { prompt:`f(x)=${a}x, g(x)=${g_a}x+1일 때 (f∘g)(${x})를 구하시오.`, answer:String(a*(g_a*x+1)), concept:"합성함수 f(g(x)): 안쪽 g부터 계산 후 f에 대입" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`f(x)=2x+3의 역함수는?`, ...mc(`f⁻¹(x)=(x-3)/2`,[`f⁻¹(x)=2x-3`,`f⁻¹(x)=(x+3)/2`,`f⁻¹(x)=x/2-3`,`f⁻¹(x)=-2x+3`],"역함수: y=f(x)를 x에 대해 풀기") }
      : { prompt:`f(x) = ${a}x ${sg(b)}의 역함수 f⁻¹(x)를 구하시오.`, answer:`f⁻¹(x) = (x ${sg(-b)}) / ${a}`, concept:"역함수: y=ax+b → x=(y-b)/a → f⁻¹(x)=(x-b)/a" };
  }
  return { prompt:`함수 f: {1,2,3}→{a,b,c}가 전단사함수가 되려면 어떤 조건이 필요한가?`, answer:"각 원소가 정확히 한 번씩 대응되어야 한다 (일대일 대응)", concept:"전단사함수: 단사함수(일대일) + 전사함수(위로의)" };
}

function h1Geo(_, n) {
  const t = T(n, 4);
  const x1=(n%5)+1, y1=(n%4)+1, x2=x1+(n%5)+2, y2=y1+(n%4)+2;
  if (t===0) {
    const d2=(x2-x1)**2+(y2-y1)**2;
    return isMC(n)
      ? { prompt:`두 점(${x1},${y1}),(${x2},${y2}) 거리는?`, ...mc(`√${d2}`,[`√${d2+1}`,String(d2),`${d2}²`,`√${(x2-x1)**2}`],"두 점 거리=√(△x²+△y²)") }
      : { prompt:`두 점 (${x1},${y1}), (${x2},${y2}) 사이의 거리를 구하시오.`, answer:`√${d2}`, concept:"두 점 사이 거리 = √[(x₂-x₁)²+(y₂-y₁)²]" };
  }
  if (t===1) {
    const cx=(n%5)+2, cy=(n%4)+1, r=(n%4)+2;
    return isMC(n)
      ? { prompt:`중심(${cx},${cy}) 반지름${r}인 원의 방정식은?`, ...mc(`(x-${cx})²+(y-${cy})²=${r*r}`,[`x²+y²=${r*r}`,`(x+${cx})²+(y+${cy})²=${r*r}`,`(x-${cx})²+(y-${cy})²=${r}`,`(x-${cx})+(y-${cy})=${r*r}`],"원의 방정식=(x-a)²+(y-b)²=r²") }
      : { prompt:`중심 (${cx}, ${cy}), 반지름 ${r}인 원의 방정식을 쓰시오.`, answer:`(x-${cx})²+(y-${cy})²=${r*r}`, concept:"(x-a)²+(y-b)²=r²" };
  }
  if (t===2) {
    const a=(n%4)+1, c_=(n%6)+2;
    return { prompt:`직선 y=${a}x+${c_}와 평행한 직선의 기울기를 구하시오.`, answer:String(a), concept:"평행한 두 직선의 기울기는 같다." };
  }
  const a=(n%3)+1, c_=(n%5)+2;
  return { prompt:`직선 y=${a}x+${c_}에 수직인 직선의 기울기를 구하시오.`, answer:`-1/${a}`, concept:"수직인 두 직선: 기울기의 곱 = -1" };
}

function h1Comb(_, n) {
  const t = T(n, 4);
  const total=(n%6)+5, r=(n%3)+2;
  if (t===0) {
    const perm=P(total, r);
    return isMC(n)
      ? { prompt:`${total}P${r}의 값은?`, ...mc(String(perm),[String(perm+1),String(C(total,r)),String(fact(r)),String(perm*2)],"nPr=n!/(n-r)!") }
      : { prompt: `서로 다른 ${total}개에서 ${r}개를 순서 있게 나열하는 방법의 수를 구하시오.`, answer:String(perm), concept:"순열 nPr = n!/(n-r)!" };
  }
  if (t===1) {
    const comb=Math.round(C(total,r));
    return isMC(n)
      ? { prompt:`${total}C${r}의 값은?`, ...mc(String(comb),[String(comb+1),String(P(total,r)),String(comb-1),String(comb*2)],"nCr=n!/(r!(n-r)!)") }
      : { prompt:`서로 다른 ${total}개에서 ${r}개를 선택하는 방법의 수를 구하시오.`, answer:String(comb), concept:"조합 nCr = n!/(r!(n-r)!)" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`5명 중 2명을 뽑아 줄 세우는 방법은?`, ...mc("20",["10","60","120","5"],"5P2=5×4=20") }
      : { prompt:`남학생 ${(n%3)+2}명과 여학생 ${(n%2)+2}명 중 2명 선택 시 방법의 수는?`, answer:String(Math.round(C((n%3)+2+(n%2)+2, 2))), concept:"nC2 = n(n-1)/2" };
  }
  return { prompt:`0, 1, 2, 3, 4에서 3자리 정수를 만드는 방법의 수는? (첫째 자리에 0 불가)`, answer:"48", concept:"첫째 자리: 4가지(0제외) × 나머지 2자리: 4×3=12 → 총 48" };
}

// ══ 고2 수학I, II ══════════════════════════════════════════════════════════════

function h2ExpLog(_, n) {
  const t = T(n, 4);
  const base=[2,3][n%2], exp=(n%5)+1;
  if (t===0) {
    return isMC(n)
      ? { prompt:`${base}^${exp}의 값은?`, ...mc(String(base**exp),[String(base**exp+1),String(base*exp),String(base**(exp-1)),String(base**(exp+1))],"지수법칙") }
      : { prompt:`log_${base} ${base**exp}의 값을 구하시오.`, answer:String(exp), concept:"log_a(aⁿ) = n" };
  }
  if (t===1) {
    const m=(n%4)+2, k=(n%3)+1;
    return { prompt:`log_${base} ${base**m} + log_${base} ${base**k}를 계산하시오.`, answer:String(m+k), concept:"로그의 합: log_a M + log_a N = log_a (MN)" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`${base}ˣ = ${base**(exp+1)}이면 x=?`, ...mc(String(exp+1),[String(exp),String(exp+2),String(base),String(exp*(base-1))],"지수방정식: 밑 같으면 지수 비교") }
      : { prompt:`log₂ 32의 값을 구하시오.`, answer:"5", concept:"32=2⁵ → log₂32=5" };
  }
  return { prompt:`지수함수 y=${base}ˣ의 정의역과 치역을 구하시오.`, answer:"정의역: 실수 전체, 치역: 양의 실수 전체 (y>0)", concept:"지수함수 y=aˣ(a>0, a≠1)의 정의역=ℝ, 치역=(0,∞)" };
}

function h2Trig(_, n) {
  const t = T(n, 4);
  const degs=[0,30,45,60,90,120,135,150,180];
  const deg=degs[n%degs.length];
  const sinV=["0","1/2","√2/2","√3/2","1","√3/2","√2/2","1/2","0"][n%degs.length];
  const cosV=["1","√3/2","√2/2","1/2","0","-1/2","-√2/2","-√3/2","-1"][n%degs.length];
  if (t===0) {
    return isMC(n)
      ? { prompt:`sin ${deg}°의 값은?`, ...mc(sinV,["0","1/2","√2/2","√3/2"].filter(v=>v!==sinV).concat(["1"]),"삼각함수 특수각") }
      : { prompt:`sin ${deg}°의 값을 구하시오.`, answer:sinV, concept:"특수각 sin 값: 0°→0, 30°→1/2, 45°→√2/2, 60°→√3/2, 90°→1" };
  }
  if (t===1) {
    return isMC(n)
      ? { prompt:`cos ${deg}°의 값은?`, ...mc(cosV,["0","1/2","√2/2","-1/2","√3/2"].filter(v=>v!==cosV).slice(0,4),"삼각함수 특수각") }
      : { prompt:`cos ${deg}°의 값을 구하시오.`, answer:cosV, concept:"특수각 cos 값: 0°→1, 60°→1/2, 90°→0, 120°→-1/2" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`sin²θ + cos²θ의 값은?`, ...mc("1",["0","2","sinθ","cosθ"],"피타고라스 항등식") }
      : { prompt:`sin θ = 3/5이고 θ가 제1사분면일 때 cos θ를 구하시오.`, answer:"4/5", concept:"sin²θ+cos²θ=1 → cosθ=√(1-sin²θ)" };
  }
  return { prompt:`tan 45°의 값을 구하시오.`, answer:"1", concept:"tan θ = sin θ / cos θ, tan 45° = (√2/2)/(√2/2) = 1" };
}

function h2Seq(_, n) {
  const t = T(n, 4);
  const a1=(n%6)+1, d=(n%5)+2, k=(n%8)+5;
  if (t===0) {
    return isMC(n)
      ? { prompt:`첫항${a1} 공차${d}인 등차수열의 제${k}항은?`, ...mc(String(a1+(k-1)*d),[String(a1+k*d),String(a1+(k-2)*d),String(a1*d+k),String(a1+(k+1)*d)],"aₙ=a₁+(n-1)d") }
      : { prompt:`첫째항 ${a1}, 공차 ${d}인 등차수열의 제${k}항을 구하시오.`, answer:String(a1+(k-1)*d), concept:"등차수열 일반항: aₙ = a₁ + (n-1)d" };
  }
  if (t===1) {
    const r=(n%4)+2, k2=(n%4)+3;
    return isMC(n)
      ? { prompt:`첫항${a1} 공비${r}인 등비수열의 제${k2}항은?`, ...mc(String(a1*r**(k2-1)),[String(a1*r**k2),String(a1*(r-1)**(k2-1)),String(a1+r*(k2-1)),String(a1*r**(k2-2))],"aₙ=a₁rⁿ⁻¹") }
      : { prompt:`첫째항 ${a1}, 공비 ${r}인 등비수열의 제${k2}항을 구하시오.`, answer:String(a1*r**(k2-1)), concept:"등비수열 일반항: aₙ = a₁ × rⁿ⁻¹" };
  }
  if (t===2) {
    const N=(n%5)+3;
    const sum=N*(a1+a1+(N-1)*d)/2;
    return { prompt:`첫항 ${a1}, 공차 ${d}인 등차수열의 처음 ${N}항의 합을 구하시오.`, answer:String(sum), concept:"등차수열의 합: Sₙ = n(a₁+aₙ)/2 = n(2a₁+(n-1)d)/2" };
  }
  return { prompt:`Σ(k=1 to ${k}) k 의 값을 구하시오.`, answer:String(k*(k+1)/2), concept:"Σk = n(n+1)/2" };
}

function h2Limit(_, n) {
  const t = T(n, 4);
  const a=(n%5)+2, b=(n%4)+1, x0=(n%6)+1;
  if (t===0) {
    const lim=a*x0+b;
    return isMC(n)
      ? { prompt:`lim(x→${x0})(${a}x+${b})=?`, ...mc(String(lim),[String(lim+a),String(lim-a),String(a+b),String(lim+1)],"다항함수는 직접 대입") }
      : { prompt:`lim(x→${x0}) (${a}x + ${b})의 값을 구하시오.`, answer:String(lim), concept:"다항함수의 극한은 x에 값을 직접 대입한다." };
  }
  if (t===1) {
    // (x²-a²)/(x-a) 형태
    const c=(n%5)+2;
    return isMC(n)
      ? { prompt:`lim(x→${c})(x²-${c*c})/(x-${c})=?`, ...mc(String(2*c),[String(c),String(c*c),String(2*c+1),String(c+1)],"(x²-a²)/(x-a)=x+a") }
      : { prompt:`lim(x→${c}) (x²-${c*c})/(x-${c})의 값을 구하시오.`, answer:String(2*c), concept:"인수분해 후 약분: (x²-a²)/(x-a)=x+a" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`f(x)가 x=a에서 연속이려면?`, ...mc("lim f(x) = f(a)",["f(a)가 존재","극한값이 존재","미분 가능","f(a)=0"],"연속 조건: 극한=함수값") }
      : { prompt:`lim(x→∞) (${a}x²+${b}x)/(${a}x²+1)을 구하시오.`, answer:"1", concept:"최고차항으로 나누면 동차이면 계수비로 극한" };
  }
  return { prompt:`lim(x→0)(sin x)/x의 값을 구하시오.`, answer:"1", concept:"중요 극한: lim(x→0)(sinx/x) = 1" };
}

function h2Diff(_, n) {
  const t = T(n, 4);
  const a=(n%4)+1, b=(n%5)+1, c=(n%6)-2, x=(n%5)+1;
  if (t===0) {
    const deriv=3*a*x*x+2*b*x+c;
    return isMC(n)
      ? { prompt:`f(x)=${a}x³+${b}x²${sg(c)}x일 때 f'(${x})=?`, ...mc(String(deriv),[String(deriv+a),String(deriv-b),String(2*b*x+c),String(3*a*x+2*b)],"f'(x)=3ax²+2bx+c") }
      : { prompt:`f(x) = ${a}x³ + ${b}x² ${sg(c)}x일 때 f'(${x})를 구하시오.`, answer:String(deriv), concept:"도함수: (xⁿ)' = nxⁿ⁻¹" };
  }
  if (t===1) {
    return { prompt:`f(x)=${a}x²+${b}x의 x=${x}에서의 접선의 기울기를 구하시오.`, answer:String(2*a*x+b), concept:"접선의 기울기 = f'(x₀)" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`f(x)=x³이면 f'(x)=?`, ...mc("3x²",["x²","3x","x³","3x³"],"(xⁿ)'=nxⁿ⁻¹") }
      : { prompt:`f(x) = ${a}x⁴ + ${b}x²의 도함수 f'(x)를 구하시오.`, answer:`${4*a}x³ + ${2*b}x`, concept:"각 항을 미분하여 합산한다." };
  }
  const x2=(n%4)+2;
  return { prompt:`f(x)=${a}x³-${b}x에서 f'(x)=0을 만족하는 x를 구하시오.`, answer:`±√(${b}/${3*a})`, concept:"f'(x)=0인 점은 극값(극대/극소)의 후보." };
}

function h2Int(_, n) {
  const t = T(n, 4);
  const a=(n%4)+1, b=(n%5)+1, lo=n%3, hi=lo+(n%4)+2;
  if (t===0) {
    const val=a*(hi**3-lo**3)/3+b*(hi**2-lo**2)/2;
    return isMC(n)
      ? { prompt:`∫(${lo}→${hi})(${a}x²+${b}x)dx=?`, ...mc(String(Math.round(val*10)/10),[String(Math.round(val*10)/10+a),String(Math.round(val*10)/10-b),String(a*hi+b),String(a*(hi-lo))],"정적분=원시함수 대입") }
      : { prompt:`∫(${lo}→${hi}) (${a}x² + ${b}x) dx를 계산하시오.`, answer:String(Math.round(val*10)/10), concept:"∫xⁿdx = xⁿ⁺¹/(n+1) + C, 정적분=[F(b)-F(a)]" };
  }
  if (t===1) {
    return { prompt:`∫(${a}x + ${b}) dx를 구하시오.`, answer:`${a}x²/2 + ${b}x + C`, concept:"부정적분: ∫(ax+b)dx = ax²/2 + bx + C" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`∫₀¹ x dx = ?`, ...mc("1/2",["1","0","2","1/3"],"∫₀¹ x dx = [x²/2]₀¹ = 1/2") }
      : { prompt:`∫(${lo}→${hi}) ${a} dx를 계산하시오.`, answer:String(a*(hi-lo)), concept:"상수 정적분: ∫(a→b) c dx = c(b-a)" };
  }
  return { prompt:`함수 y=f(x)의 그래프와 x축 사이 넓이는 어떻게 구하는가?`, answer:"∫(a→b)|f(x)|dx", concept:"넓이 = 정적분의 절댓값 (음수 구간 주의)" };
}

// ══ 고3 ═══════════════════════════════════════════════════════════════════════

function h3SeqLim(_, n) {
  const t = T(n, 4);
  const a=(n%5)+2, b=(n%4)+1;
  if (t===0) {
    return isMC(n)
      ? { prompt:`lim(n→∞)(${a}n+${b})/(${a}n+1)=?`, ...mc("1",[String(a),"0","∞","1/2"],"최고차항 비로 극한") }
      : { prompt:`lim(n→∞) (${a}n²+${b})/(${a}n²+n)의 값을 구하시오.`, answer:"1", concept:"최고차항으로 나누면 n→∞에서 나머지 소거" };
  }
  if (t===1) {
    const r=(n%4); // |r|<1
    return { prompt:`|r|<1일 때 등비급수 a/(1-r)에서 a=${a}, r=1/${a+1}일 때 합을 구하시오.`, answer:`${a*(a+1)}/a`, concept:"등비급수 합 = a/(1-r) (|r|<1)" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`수열 {aₙ}이 수렴하면 lim aₙ=?`, ...mc("일정한 값",["∞","0","발산","진동"],"수렴이면 극한값 존재") }
      : { prompt:`lim(n→∞) (${a}n)/(n+${b})의 값을 구하시오.`, answer:String(a), concept:"분자·분모를 최고차항 n으로 나누면 → a" };
  }
  return { prompt:`등비수열 1, 1/2, 1/4, 1/8, ...의 급수(무한등비급수)를 구하시오.`, answer:"2", concept:"a=1, r=1/2 → S=1/(1-1/2)=2" };
}

function h3Diff(_, n) {
  const t = T(n, 4);
  const a=(n%4)+1, b=(n%5)+1, x=(n%4)+1;
  if (t===0) {
    return { prompt:`f(x)=sin(${a}x)의 도함수 f'(x)를 구하시오.`, answer:`${a}cos(${a}x)`, concept:"(sin ax)' = a cos ax" };
  }
  if (t===1) {
    return isMC(n)
      ? { prompt:`f(x)=eˣ의 도함수는?`, ...mc("eˣ",["xeˣ⁻¹","eˣ⁺¹","1/eˣ","xeˣ"],"(eˣ)'=eˣ (자기 자신)") }
      : { prompt:`f(x) = ${a}eˣ + ${b}x의 도함수 f'(x)를 구하시오.`, answer:`${a}eˣ + ${b}`, concept:"(eˣ)' = eˣ" };
  }
  if (t===2) {
    return { prompt:`f(x)=ln x의 도함수 f'(x)를 구하시오.`, answer:"1/x", concept:"(ln x)' = 1/x" };
  }
  return { prompt:`f(x)=x·eˣ의 도함수를 구하시오.`, answer:"eˣ + xeˣ = (1+x)eˣ", concept:"곱의 미분법: (fg)' = f'g + fg'" };
}

function h3Int(_, n) {
  const t = T(n, 4);
  const a=(n%4)+1, b=(n%3)+1;
  if (t===0) {
    return { prompt:`∫ ${a}eˣ dx를 구하시오.`, answer:`${a}eˣ + C`, concept:"∫eˣdx = eˣ + C" };
  }
  if (t===1) {
    return isMC(n)
      ? { prompt:`∫ (1/x) dx = ?`, ...mc("ln|x|+C",["1/x²+C","x·ln x+C","-1/x+C","ln x²+C"],"∫(1/x)dx=ln|x|+C") }
      : { prompt:`∫ cos(${a}x) dx를 구하시오.`, answer:`(1/${a})sin(${a}x) + C`, concept:"∫cos(ax)dx = (1/a)sin(ax) + C" };
  }
  if (t===2) {
    return { prompt:`∫ sin x dx를 구하시오.`, answer:"-cos x + C", concept:"∫sin x dx = -cos x + C" };
  }
  return { prompt:`치환적분: ∫2x·(x²+1)⁴dx에서 t=x²+1로 치환하면?`, answer:"∫t⁴dt = t⁵/5+C = (x²+1)⁵/5+C", concept:"치환적분: dt=2x dx로 치환하여 단순화" };
}

function h3Conic(_, n) {
  const t = T(n, 4);
  const a=(n%5)+2, b=(n%4)+2;
  if (t===0) {
    return isMC(n)
      ? { prompt:`타원 x²/${a*a}+y²/${b*b}=1의 장축의 길이는? (a>b)`, ...mc(String(2*Math.max(a,b)),[String(2*Math.min(a,b)),String(Math.max(a,b)),String(a+b),String(a*b)],"장축=2×큰 반지름") }
      : { prompt:`타원 x²/${a*a}+y²/${b*b}=1의 두 꼭짓점 좌표를 쓰시오.`, answer:`(±${a}, 0), (0, ±${b})`, concept:"타원 x²/a²+y²/b²=1: x절편 ±a, y절편 ±b" };
  }
  if (t===1) {
    return { prompt:`포물선 y²=4·${a}·x의 초점을 구하시오.`, answer:`(${a}, 0)`, concept:"y²=4px의 초점=(p,0), 준선 x=-p" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`쌍곡선 x²/${a*a}-y²/${b*b}=1의 점근선은?`, ...mc(`y=±(${b}/${a})x`,[`y=±(${a}/${b})x`,`y=±${a}x`,`x=±${a}`,`y=±${b}`],"점근선 y=±(b/a)x") }
      : { prompt:`쌍곡선 x²/4-y²/9=1의 점근선의 방정식을 구하시오.`, answer:"y = ±(3/2)x", concept:"쌍곡선 점근선: y = ±(b/a)x" };
  }
  return { prompt:`원 x²+y²=${a*a}와 직선 y=${b}의 위치 관계를 판별하시오.`, answer: b<a?"두 점에서 만남":b===a?"접함":"만나지 않음", concept:"원 반지름과 직선까지의 거리 비교." };
}

function h3Vec(_, n) {
  const t = T(n, 4);
  const a=(n%5)+1, b=(n%4)+2, c=(n%3)+1, d=(n%4)+1;
  if (t===0) {
    return isMC(n)
      ? { prompt:`벡터 →a=(${a},${b})의 크기는?`, ...mc(`√${a*a+b*b}`,[String(a+b),`√${(a+1)**2+b**2}`,`${a*a+b*b}`,`√${a**2+b**2+1}`],"크기=√(x²+y²)") }
      : { prompt:`벡터 →a=(${a}, ${b})의 크기를 구하시오.`, answer:`√${a*a+b*b}`, concept:"|→a| = √(a₁²+a₂²)" };
  }
  if (t===1) {
    return { prompt:`→a=(${a},${b}), →b=(${c},${d})일 때 →a+→b를 구하시오.`, answer:`(${a+c}, ${b+d})`, concept:"벡터 덧셈: 성분끼리 더한다." };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`→a=(${a},${b}), →b=(${c},${d})의 내적은?`, ...mc(String(a*c+b*d),[String(a*d+b*c),String((a+c)*(b+d)),String(a*c),String(a*b+c*d)],"내적=a₁b₁+a₂b₂") }
      : { prompt:`→a=(${a},${b}), →b=(${c},${d})일 때 →a·→b를 구하시오.`, answer:String(a*c+b*d), concept:"내적: →a·→b = a₁b₁ + a₂b₂" };
  }
  return { prompt:`→a=(${a},${b})와 →b=(${-b},${a})의 내적을 구하시오.`, answer:"0", concept:"내적이 0이면 두 벡터는 수직." };
}

function h3Space(_, n) {
  const t = T(n, 4);
  const a=(n%5)+1, b=(n%4)+1, c=(n%3)+1;
  if (t===0) {
    return isMC(n)
      ? { prompt:`공간에서 두 직선이 만나지 않는 경우는?`, ...mc("평행 또는 꼬인 위치",["수직","교차","동일선상","수평"],"3차원: 평행·꼬인위치") }
      : { prompt:`정육면체에서 한 변과 꼬인 위치에 있는 변의 수를 구하시오.`, answer:"4", concept:"꼬인 위치: 평행도 교차도 아닌 두 직선" };
  }
  if (t===1) {
    return { prompt:`두 점 A(${a},${b},${c}), B(${a+2},${b+1},${c+3}) 사이의 거리를 구하시오.`, answer:`√${4+1+9}`, concept:"공간 두 점 거리 = √(△x²+△y²+△z²)" };
  }
  if (t===2) {
    return isMC(n)
      ? { prompt:`구 x²+y²+z²=${a*a}의 반지름은?`, ...mc(String(a),[String(a*a),String(a+1),String(a-1),String(2*a)],"x²+y²+z²=r²에서 r") }
      : { prompt:`구 x²+y²+z²=${a*a}의 겉넓이를 구하시오.`, answer:`${4*a*a}π`, concept:"구의 겉넓이 = 4πr²" };
  }
  return { prompt:`구 x²+y²+z²=${a*a}의 부피를 구하시오.`, answer:`${Math.round(4/3*a**3)}π/3`, concept:"구의 부피 = (4/3)πr³" };
}

function h3Count(_, n) {
  const t = T(n, 4);
  const total=(n%6)+5, r=(n%3)+2;
  if (t===0) {
    const perm=P(total,r);
    return isMC(n)
      ? { prompt:`${total}P${r}=?`, ...mc(String(perm),[String(perm+total),String(Math.round(C(total,r))),String(fact(r)),String(P(total,r-1))],"nPr=n!/(n-r)!") }
      : { prompt:`${total}P${r}의 값을 구하시오.`, answer:String(perm), concept:"순열: nPr = n!/(n-r)!" };
  }
  if (t===1) {
    const comb=Math.round(C(total,r));
    return isMC(n)
      ? { prompt:`${total}C${r}=?`, ...mc(String(comb),[String(comb+1),String(P(total,r)),String(comb-1),String(Math.round(C(total,r+1)))],"nCr=n!/(r!(n-r)!)") }
      : { prompt:`${total}C${r}의 값을 구하시오.`, answer:String(comb), concept:"조합: nCr = n!/(r!(n-r)!)" };
  }
  if (t===2) {
    return { prompt:`${total}명 중 대표 1명, 부대표 1명을 뽑는 방법의 수를 구하시오.`, answer:String(P(total,2)), concept:"순서가 있으면 순열: nP2 = n(n-1)" };
  }
  return { prompt:`이항정리에서 (1+x)ⁿ의 전개식의 항의 수는?`, answer:`n+1개`, concept:"(a+b)ⁿ 전개: n+1개의 항" };
}

function h3Prob(_, n) {
  const t = T(n, 4);
  const p=(n%7)+1, q=10;
  if (t===0) {
    return isMC(n)
      ? { prompt:`P(A)=${p}/10이면 P(Aᶜ)=?`, ...mc(`${q-p}/10`,[`${p}/10`,`${p+1}/10`,`${q-p-1}/10`,"1"],"P(Aᶜ)=1-P(A)") }
      : { prompt:`P(A) = ${p}/10이면 여사건의 확률을 구하시오.`, answer:`${q-p}/10`, concept:"P(Aᶜ) = 1 - P(A)" };
  }
  if (t===1) {
    const pa=(n%5)+1, pb=(n%4)+1;
    return { prompt:`P(A)=${pa}/10, P(B)=${pb}/10이고 A, B가 서로소일 때 P(A∪B)를 구하시오.`, answer:`${pa+pb}/10`, concept:"서로소: P(A∪B) = P(A) + P(B)" };
  }
  if (t===2) {
    const pa=(n%4)+2, pb=(n%3)+2;
    return isMC(n)
      ? { prompt:`P(A)=${pa}/10, P(B|A)=1/2일 때 P(A∩B)=?`, ...mc(`${pa}/20`,[`${pa}/10`,`${pa+1}/10`,`1/20`,`${pa}/30`],"P(A∩B)=P(A)P(B|A)") }
      : { prompt:`P(A)=2/5, P(B|A)=1/2일 때 P(A∩B)를 구하시오.`, answer:"1/5", concept:"곱셈법칙: P(A∩B) = P(A)·P(B|A)" };
  }
  return { prompt:`두 사건 A, B가 독립이면 P(A∩B)=?`, answer:"P(A)·P(B)", concept:"독립사건: P(A∩B) = P(A)×P(B)" };
}

function h3Stat(_, n) {
  const t = T(n, 4);
  const mu=(n%10)+60, sigma=(n%5)+5;
  if (t===0) {
    return isMC(n)
      ? { prompt:`정규분포 N(${mu},${sigma}²)에서 평균은?`, ...mc(String(mu),[String(mu+sigma),String(mu-sigma),String(sigma),String(mu*2)],"N(μ,σ²)에서 μ가 평균") }
      : { prompt:`정규분포 N(${mu}, ${sigma}²)의 평균과 표준편차를 구하시오.`, answer:`평균: ${mu}, 표준편차: ${sigma}`, concept:"N(μ, σ²): 평균=μ, 표준편차=σ" };
  }
  if (t===1) {
    return { prompt:`표준정규분포 N(0,1)에서 P(-1≤Z≤1)은 약 몇 %인가?`, answer:"약 68%", concept:"정규분포: μ±σ 구간에 약 68%, μ±2σ에 약 95%" };
  }
  if (t===2) {
    const n2=(n%5)+10, xbar=(n%5)+mu;
    return isMC(n)
      ? { prompt:`모집단 표준편차 ${sigma}, 표본크기 ${n2*n2}일 때 표본평균의 표준편차(표준오차)는?`, ...mc(`${sigma}/${n2}`,[String(sigma),`${sigma*n2}`,`${sigma}/${n2+1}`,`1/${n2}`],"표준오차=σ/√n") }
      : { prompt:`모집단 표준편차 ${sigma}, 표본크기 100일 때 표본평균의 표준편차를 구하시오.`, answer:`${sigma}/10`, concept:"표본평균의 표준편차(표준오차) = σ/√n" };
  }
  return { prompt:`신뢰도 95%의 모평균 신뢰구간을 구하는 공식은?`, answer:`x̄ ± 1.96 × σ/√n`, concept:"95% 신뢰구간: x̄ ± 1.96×(σ/√n)" };
}

// ── 공통 텍스트 ────────────────────────────────────────────────────────────────

// 단원별 핵심 용어 사전: [용어, 뜻] 쌍. 개념 보기의 "용어 정리" 섹션에 쓰인다.
const TERMS = {
  "m1-numbers": [
    ["정수", "0과 자연수, 그리고 자연수에 음의 부호(−)를 붙인 수"],
    ["유리수", "분모가 0이 아닌 분수로 나타낼 수 있는 수"],
    ["절댓값", "수직선에서 어떤 수가 원점에서 떨어진 거리(항상 0 이상)"],
    ["부호", "수의 양(+)·음(−)을 나타내는 기호"],
  ],
  "m1-expressions": [
    ["항", "수 또는 문자의 곱으로 이루어진 식의 한 덩어리"],
    ["계수", "항에서 문자에 곱해진 수"],
    ["차수", "항에 곱해진 문자의 개수(지수의 합)"],
    ["동류항", "문자와 차수가 같아 더하거나 뺄 수 있는 항"],
  ],
  "m1-equations": [
    ["방정식", "미지수의 값에 따라 참·거짓이 갈리는 등식"],
    ["해(근)", "방정식을 참으로 만드는 미지수의 값"],
    ["이항", "항의 부호를 바꿔 등호 반대편으로 옮기는 것"],
    ["등식의 성질", "양변에 같은 수를 더·빼·곱·나눠도 등식이 유지됨"],
  ],
  "m1-coordinates": [
    ["좌표평면", "가로축(x축)과 세로축(y축)으로 위치를 나타내는 평면"],
    ["좌표", "점의 위치를 (x, y)로 나타낸 순서쌍"],
    ["원점", "두 축이 만나는 점 (0, 0)"],
    ["사분면", "좌표평면을 네 부분으로 나눈 영역"],
  ],
  "m1-geometry-basic": [
    ["교점", "두 도형(선)이 만나는 점"],
    ["맞꼭지각", "두 직선이 만날 때 마주 보는 각(크기가 같다)"],
    ["수직이등분선", "선분을 수직으로 이등분하는 직선"],
    ["엇각·동위각", "평행선과 한 직선이 만들어 크기가 같아지는 각"],
  ],
  "m1-plane-solid": [
    ["다각형", "선분으로 둘러싸인 평면도형"],
    ["부채꼴", "원에서 두 반지름과 호로 둘러싸인 도형"],
    ["호", "원 위 두 점 사이의 곡선"],
    ["다면체", "다각형 면으로 둘러싸인 입체도형"],
  ],
  "m1-statistics": [
    ["변량", "자료를 수량으로 나타낸 값"],
    ["계급", "변량을 일정한 간격으로 나눈 구간"],
    ["도수", "각 계급에 속하는 자료의 개수"],
    ["상대도수", "전체 도수에 대한 각 계급 도수의 비율"],
  ],
  "m2-rational": [
    ["유한소수", "소수점 아래가 유한한 자리에서 끝나는 소수"],
    ["순환소수", "소수점 아래 일정한 숫자가 끝없이 반복되는 소수"],
    ["순환마디", "순환소수에서 반복되는 부분"],
  ],
  "m2-polynomial": [
    ["단항식", "항이 하나뿐인 식"],
    ["다항식", "단항식의 합으로 이루어진 식"],
    ["지수법칙", "거듭제곱의 곱·나눗셈을 지수의 합·차로 계산하는 규칙"],
  ],
  "m2-linear-system": [
    ["연립방정식", "두 개 이상의 방정식을 한 쌍으로 묶은 것"],
    ["대입법", "한 식을 다른 식에 넣어 미지수를 줄이는 방법"],
    ["가감법", "두 식을 더하거나 빼서 미지수를 없애는 방법"],
  ],
  "m2-inequality": [
    ["부등식", "두 수·식의 대소 관계를 부등호로 나타낸 식"],
    ["부등호", "<, >, ≤, ≥ 기호"],
    ["해", "부등식을 참으로 만드는 미지수 값의 범위"],
    ["부등호 방향", "음수를 곱하거나 나누면 방향이 바뀐다"],
  ],
  "m2-functions": [
    ["함수", "x값 하나에 y값 하나가 대응하는 관계"],
    ["기울기", "x 증가량에 대한 y 증가량의 비율"],
    ["y절편", "그래프가 y축과 만나는 점의 y좌표"],
    ["x절편", "그래프가 x축과 만나는 점의 x좌표"],
  ],
  "m2-geometry": [
    ["내심", "삼각형 내접원의 중심(세 내각 이등분선의 교점)"],
    ["외심", "삼각형 외접원의 중심(세 변 수직이등분선의 교점)"],
    ["평행사변형", "두 쌍의 대변이 각각 평행한 사각형"],
  ],
  "m2-similarity": [
    ["닮음", "모양이 같고 크기만 다른 도형 관계"],
    ["닮음비", "닮은 도형에서 대응변 길이의 비"],
    ["대응변·대응각", "닮음에서 서로 짝이 되는 변과 각"],
  ],
  "m2-probability": [
    ["경우의 수", "어떤 사건이 일어나는 가짓수"],
    ["확률", "(사건이 일어나는 경우의 수) ÷ (모든 경우의 수)"],
    ["여사건", "어떤 사건이 일어나지 않는 사건"],
  ],
  "m3-real-roots": [
    ["제곱근", "제곱하여 어떤 수가 되는 수 (√)"],
    ["무리수", "분수로 나타낼 수 없는 수(순환하지 않는 무한소수)"],
    ["실수", "유리수와 무리수를 합친 수"],
  ],
  "m3-polynomial": [
    ["인수", "곱해서 어떤 식을 이루는 각각의 식"],
    ["인수분해", "다항식을 두 개 이상의 인수의 곱으로 나타내는 것"],
    ["완전제곱식", "(a±b)² 꼴로 나타나는 식"],
  ],
  "m3-quadratic": [
    ["이차방정식", "최고차항이 2차인 방정식"],
    ["근의 공식", "ax²+bx+c=0의 해를 구하는 공식"],
    ["판별식", "b²−4ac, 근의 개수·종류를 판별하는 값"],
  ],
  "m3-quadratic-function": [
    ["포물선", "이차함수의 그래프 모양"],
    ["꼭짓점", "포물선의 가장 높거나 낮은 점"],
    ["축", "포물선을 좌우 대칭으로 나누는 직선"],
  ],
  "m3-pythagorean": [
    ["빗변", "직각삼각형에서 직각의 맞은편 변(가장 긴 변)"],
    ["피타고라스 정리", "직각삼각형에서 a²+b²=c²"],
  ],
  "m3-circle": [
    ["중심각", "원의 중심에서 두 반지름이 이루는 각"],
    ["원주각", "원 위 한 점에서 두 현이 이루는 각(중심각의 절반)"],
    ["현", "원 위 두 점을 잇는 선분"],
    ["접선", "원과 한 점에서만 만나는 직선"],
  ],
  "m3-statistics": [
    ["대푯값", "자료 전체를 대표하는 값(평균·중앙값·최빈값)"],
    ["평균", "자료의 합을 개수로 나눈 값"],
    ["분산", "편차(자료−평균)를 제곱한 값의 평균"],
    ["표준편차", "분산의 양의 제곱근"],
  ],
  "h-common-polynomial": [
    ["항등식", "문자에 어떤 값을 넣어도 항상 성립하는 등식"],
    ["나머지정리", "f(x)를 (x−a)로 나눈 나머지는 f(a)"],
    ["인수정리", "f(a)=0이면 (x−a)가 f(x)의 인수"],
  ],
  "h-common-equations": [
    ["복소수", "a+bi 꼴의 수 (i는 허수단위)"],
    ["허수단위 i", "제곱하면 −1이 되는 수 (i²=−1)"],
    ["판별식", "이차방정식 근의 종류(실근·허근)를 판별하는 값"],
  ],
  "h-common-functions": [
    ["정의역", "함수에서 x가 가질 수 있는 값의 집합"],
    ["치역", "x에 대응하는 y값 전체의 집합"],
    ["합성함수", "한 함수의 결과를 다른 함수에 넣은 함수 (f∘g)"],
    ["역함수", "x와 y의 대응을 거꾸로 한 함수 (f⁻¹)"],
  ],
  "h-common-geometry": [
    ["두 점 사이의 거리", "√((x₂−x₁)²+(y₂−y₁)²)"],
    ["내분점", "선분을 m:n으로 안쪽에서 나누는 점"],
    ["기울기", "직선의 경사 정도(Δy/Δx)"],
  ],
  "h-common-combinatorics": [
    ["합의 법칙", "동시에 일어나지 않는 사건의 경우의 수는 더한다"],
    ["곱의 법칙", "잇따라 일어나는 사건의 경우의 수는 곱한다"],
    ["순열", "순서를 고려한 배열"],
    ["조합", "순서를 고려하지 않은 선택"],
  ],
  "h-math1-exponential-log": [
    ["지수", "거듭제곱에서 밑을 곱한 횟수"],
    ["로그", "aˣ=b일 때 x=logₐb로 정의되는 수"],
    ["밑", "거듭제곱·로그의 기준이 되는 수"],
    ["진수", "로그 logₐb에서 b에 해당하는 값(b>0)"],
  ],
  "h-math1-trigonometry": [
    ["호도법", "각의 크기를 라디안으로 나타내는 방법"],
    ["삼각함수", "각에 사인·코사인·탄젠트를 대응시킨 함수"],
    ["주기", "함수값이 반복되는 최소 간격"],
  ],
  "h-math1-sequence": [
    ["수열", "일정한 규칙으로 나열한 수의 열"],
    ["등차수열", "이웃한 두 항의 차(공차)가 일정한 수열"],
    ["등비수열", "이웃한 두 항의 비(공비)가 일정한 수열"],
    ["시그마(Σ)", "여러 항의 합을 간단히 나타내는 기호"],
  ],
  "h-math2-limits": [
    ["극한", "x가 어떤 값에 한없이 가까워질 때 함수가 가까워지는 값"],
    ["수렴", "극한값이 일정한 값에 가까워짐"],
    ["발산", "극한이 일정한 값에 가까워지지 않음"],
    ["연속", "그래프가 끊김 없이 이어지는 상태"],
  ],
  "h-math2-differential": [
    ["미분계수", "한 점에서의 순간변화율(접선의 기울기)"],
    ["도함수", "각 점의 미분계수를 함수로 나타낸 것 f′(x)"],
    ["접선", "곡선에 한 점에서 닿는 직선"],
    ["극값", "함수가 극대·극소가 되는 값"],
  ],
  "h-math2-integral": [
    ["부정적분", "미분의 역연산(원시함수 구하기)"],
    ["정적분", "구간에서의 넓이를 나타내는 적분"],
    ["적분상수 C", "부정적분에서 더해지는 임의의 상수"],
  ],
  "h-calculus-sequence-limit": [
    ["수열의 극한", "항의 번호가 커질 때 항이 가까워지는 값"],
    ["무한급수", "수열의 모든 항을 끝없이 더한 것"],
    ["수렴·발산", "극한값이 존재하는지 여부"],
  ],
  "h-calculus-differential": [
    ["연쇄법칙", "합성함수를 미분하는 규칙"],
    ["음함수", "y가 x에 대해 명시적으로 풀리지 않은 함수"],
    ["매개변수", "두 변수를 잇는 제3의 변수 t"],
  ],
  "h-calculus-integral": [
    ["치환적분", "변수를 바꿔서 적분하는 방법"],
    ["부분적분", "곱으로 된 함수의 적분을 변형하는 방법"],
    ["정적분의 활용", "넓이·부피·속도 등을 구하는 데 사용"],
  ],
  "h-geometry-conic": [
    ["포물선", "한 점(초점)과 한 직선에서 같은 거리인 점들의 자취"],
    ["타원", "두 초점까지 거리의 합이 일정한 점들의 자취"],
    ["쌍곡선", "두 초점까지 거리의 차가 일정한 점들의 자취"],
    ["초점", "이차곡선을 정의하는 기준점"],
  ],
  "h-geometry-vector": [
    ["벡터", "크기와 방향을 함께 가진 양"],
    ["성분", "벡터를 x·y 방향으로 나눈 값"],
    ["내적", "두 벡터의 곱으로 정의되는 스칼라 값"],
  ],
  "h-geometry-space": [
    ["공간좌표", "(x, y, z)로 공간의 점을 나타낸 것"],
    ["정사영", "도형을 평면에 수직으로 비춘 그림자"],
    ["이면각", "두 평면이 이루는 각"],
  ],
  "h-probability-counting": [
    ["순열 ₙPᵣ", "서로 다른 n개에서 r개를 순서 있게 뽑는 경우의 수"],
    ["조합 ₙCᵣ", "서로 다른 n개에서 r개를 순서 없이 뽑는 경우의 수"],
    ["중복순열·중복조합", "같은 것을 다시 뽑을 수 있는 경우"],
  ],
  "h-probability": [
    ["조건부확률", "한 사건이 일어났을 때 다른 사건이 일어날 확률"],
    ["독립", "한 사건이 다른 사건의 확률에 영향을 주지 않음"],
    ["곱셈정리", "P(A∩B)=P(A)·P(B|A)"],
  ],
  "h-statistics": [
    ["확률변수", "확률에 따라 값이 정해지는 변수"],
    ["정규분포", "평균을 중심으로 종 모양을 이루는 연속확률분포"],
    ["모평균·표본평균", "모집단·표본에서 구한 평균"],
    ["신뢰구간", "모수가 들어 있을 것으로 추정되는 구간"],
  ],
};

function terms(skill) {
  const list = TERMS[skill.id];
  if (list && list.length) {
    return list.map(([term, def]) => `- **${term}** — ${def}`).join("\n");
  }
  return `- **${skill.title}** — ${skill.unit} 단원의 핵심 개념을 정확한 정의로 다시 확인하세요.`;
}

function problemGuideMeta(p) {
  const prompt = String(p.prompt || "");
  if (p.choices?.length) {
    return {
      type: "객관식",
      start: "선지를 먼저 고르지 말고, 노트에 직접 계산한 값을 만든 뒤 선지와 비교하세요.",
      check: "계산 결과와 같은 값이 선지에 있는지 보고, 비슷한 오답 선지와 헷갈리지 않았는지 확인하세요.",
      mistake: "선지를 보고 역으로 끼워 맞추면 부호나 조건을 놓치기 쉽습니다.",
    };
  }
  if (prompt.includes("수직선") || prompt.includes("거리") || prompt.includes("|")) {
    return {
      type: "개념 확인",
      start: "그림이나 수직선이 떠오르는 문제는 먼저 기준점과 방향을 표시하세요.",
      check: "값이 거리인지 위치인지 구분하고, 거리라면 음수가 나올 수 없는지 확인하세요.",
      mistake: "절댓값, 거리, 좌표를 같은 의미로 섞어 쓰는 실수를 조심하세요.",
    };
  }
  if (prompt.includes("나열") || prompt.includes("순서")) {
    return {
      type: "정렬/비교",
      start: "비교할 대상을 모두 같은 기준으로 바꾼 뒤 작은 값부터 표시하세요.",
      check: "음수는 절댓값이 클수록 실제 값은 더 작다는 점을 마지막에 다시 확인하세요.",
      mistake: "음수의 크기 비교를 양수처럼 처리하는 실수가 자주 나옵니다.",
    };
  }
  if (prompt.includes("방정식") || prompt.includes("x") || prompt.includes("=")) {
    return {
      type: "식 세우기",
      start: "미지수와 상수를 분리하고, 양변에 같은 연산을 적용한다는 원칙을 먼저 적으세요.",
      check: "구한 값을 원래 식에 대입했을 때 좌변과 우변이 같아지는지 검산하세요.",
      mistake: "이항할 때 부호가 바뀌는 부분, 양변을 나눌 때 모든 항에 적용하는 부분을 놓치기 쉽습니다.",
    };
  }
  if (prompt.includes("그래프") || prompt.includes("기울기") || prompt.includes("좌표")) {
    return {
      type: "그래프/좌표",
      start: "좌표, 변화량, 기준축을 먼저 분리해서 적고 필요한 값을 표로 정리하세요.",
      check: "x의 변화량과 y의 변화량을 뒤집지 않았는지, 좌표 순서를 바꾸지 않았는지 확인하세요.",
      mistake: "x좌표와 y좌표를 바꾸거나 증가량의 부호를 놓치는 실수가 많습니다.",
    };
  }
  return {
    type: "계산/적용",
    start: "문제의 조건을 한 줄 식으로 옮기고, 바로 계산하지 말고 먼저 구조를 정리하세요.",
    check: "중간식마다 바뀐 부분이 하나뿐인지 확인하고, 마지막 답의 형태가 문제 요구와 맞는지 보세요.",
    mistake: "괄호, 부호, 분모, 단위가 중간 계산에서 빠지는 경우가 많습니다.",
  };
}

function workedExample(skill, p, meta) {
  const sample = getConceptSample(p);
  const firstAction = p.choices?.length
    ? "직접 계산한 값을 먼저 만든 뒤, 같은 값을 가진 보기를 고릅니다."
    : "문제 문장을 식으로 옮기고 왼쪽에서 오른쪽으로 한 단계씩 정리합니다.";
  return [
    `- **예시 문제:** ${sample.prompt}`,
    `- **풀이 예시 1:** 주어진 조건과 구해야 할 값을 분리합니다.`,
    `  - 주어진 조건: \`${sample.given}\``,
    `  - 구해야 할 값: \`${sample.target}\``,
    `- **풀이 예시 2:** 사용할 개념을 표시합니다.`,
    `  - 적용 개념: \`${p.concept}\``,
    `- **풀이 예시 3:** ${firstAction}`,
    ...sample.steps.map((step) => `  - ${step}`),
    `- **풀이 예시 4:** 마지막 줄에 \`${sample.answerLine}\`처럼 결론을 분명히 씁니다.`,
    `- **검산:** ${meta.check}`,
  ].join("\n");
}

function getConceptSample(p) {
  const concept = String(p.concept || "");
  if (concept.includes("음수") || concept.includes("부호") || concept.includes("정수") || concept.includes("유리수")) {
    return {
      prompt: "(-4) + 7 - (-2)를 계산하시오.",
      given: "(-4) + 7 - (-2)",
      target: "식의 값",
      steps: ["빼기 음수는 더하기 양수로 바꿉니다: `(-4) + 7 + 2`", "왼쪽부터 계산합니다: `-4 + 7 = 3`", "남은 수를 더합니다: `3 + 2 = 5`"],
      answerLine: "따라서 답은 5",
    };
  }
  if (concept.includes("문자") || concept.includes("계수") || concept.includes("다항식") || concept.includes("식")) {
    return {
      prompt: "3x + 2x - 4에서 x의 계수를 구하시오.",
      given: "3x + 2x - 4",
      target: "x의 계수",
      steps: ["x가 붙은 항끼리 모읍니다: `3x + 2x`", "계수끼리 더합니다: `3 + 2 = 5`", "식은 `5x - 4`로 정리됩니다."],
      answerLine: "따라서 x의 계수는 5",
    };
  }
  if (concept.includes("방정식") || concept.includes("이항")) {
    return {
      prompt: "x + 5 = 12일 때 x의 값을 구하시오.",
      given: "x + 5 = 12",
      target: "x의 값",
      steps: ["상수 5를 오른쪽으로 옮깁니다: `x = 12 - 5`", "오른쪽을 계산합니다: `12 - 5 = 7`", "원래 식에 넣어 봅니다: `7 + 5 = 12`"],
      answerLine: "따라서 x = 7",
    };
  }
  if (concept.includes("그래프") || concept.includes("좌표") || concept.includes("기울기")) {
    return {
      prompt: "두 점 (1, 2), (3, 6)을 지나는 직선의 기울기를 구하시오.",
      given: "(1, 2), (3, 6)",
      target: "기울기",
      steps: ["x의 변화량을 구합니다: `3 - 1 = 2`", "y의 변화량을 구합니다: `6 - 2 = 4`", "기울기는 `y의 변화량 / x의 변화량 = 4 / 2 = 2`입니다."],
      answerLine: "따라서 기울기는 2",
    };
  }
  return {
    prompt: "한 변의 길이가 6인 정사각형의 둘레를 구하시오.",
    given: "한 변의 길이 6",
    target: "정사각형의 둘레",
    steps: ["정사각형의 둘레 공식은 `한 변 × 4`입니다.", "값을 대입합니다: `6 × 4`", "계산합니다: `6 × 4 = 24`"],
    answerLine: "따라서 둘레는 24",
  };
}

function hint(skill, p) {
  const meta = problemGuideMeta(p);
  return [
    `### 힌트`,
    `**${skill.stage} · ${skill.title} · ${meta.type}**`,
    ``,
    `- **핵심:** ${p.concept}`,
    `- **시작:** ${meta.start}`,
    `- **노트에 먼저 쓸 것:** 주어진 값, 구해야 할 값, 사용할 성질을 세 줄로 분리합니다.`,
    `- **계산 전 확인:** 부호, 괄호, 분수/소수 형태를 먼저 통일합니다.`,
    `- **중간 점검:** ${meta.check}`,
    `- **주의:** ${meta.mistake}`,
    ``,
    `답을 바로 맞히려 하지 말고, 첫 번째 중간식만 정확하게 만드는 데 집중하세요.`,
  ].join("\n");
}
function next(skill, p) {
  const meta = problemGuideMeta(p);
  return [
    `### 풀이 방향`,
    `**${skill.stage} · ${skill.title}**`,
    ``,
    `1. **문제 해석**: 문제 문장을 식, 조건, 요구값으로 나눕니다.`,
    `2. **개념 연결**: \`${p.concept}\`을 어디에 쓸지 표시합니다.`,
    `3. **첫 줄 작성**: ${meta.start}`,
    `4. **한 단계 계산**: 한 줄에서는 부호 정리, 대입, 이항, 약분 중 하나만 처리합니다.`,
    `5. **중간식 검토**: 이전 줄과 비교해서 바뀐 부분이 정확히 하나인지 봅니다.`,
    `6. **답 정리**: 문제에서 요구한 형태로 답을 정리합니다.`,
    `7. **검산**: ${meta.check}`,
    ``,
    `막히면 지금 쓴 줄에서 바로 다음 변형 하나만 고르세요. 답 전체를 한 번에 만들 필요는 없습니다.`,
  ].join("\n");
}
function concept(skill, p) {
  const meta = problemGuideMeta(p);
  return [
    `#### 핵심 개념`,
    `- ${p.concept}`,
    `- 이 문제 유형은 **${meta.type}** 문제입니다.`,
    ``,
    `#### 용어`,
    terms(skill),
    ``,
    `#### 적용 원리`,
    `- 이 단원은 *${skill.unit}* 흐름 안에서 위 개념을 사용합니다.`,
    `- 공식은 외운 뒤 바로 쓰기보다, 문제 조건이 공식의 어느 자리에 들어가는지 먼저 대응시키세요.`,
    `- ${meta.start}`,
    ``,
    `#### 예시 풀이`,
    workedExample(skill, p, meta),
    ``,
    `#### 실제 풀이 순서`,
    `1. 조건을 수식으로 옮긴다.`,
    `2. 필요한 정의나 공식을 고른다.`,
    `3. 한 줄에 한 변화만 적용한다.`,
    `4. 중간식과 원래 조건을 비교한다.`,
    `5. 답의 형태와 단위가 맞는지 확인한다.`,
    ``,
    `#### 자주 하는 실수`,
    `- ${meta.mistake}`,
    `- 부호 처리 실수`,
    `- 괄호 분배 누락`,
    `- 답의 형태 불일치`,
  ].join("\n");
}

// TERMS 등 모든 선언이 초기화된 뒤에 즉시 평가해야 하므로 파일 끝에서 생성한다.
// (top-level에서 생성하면 아래 const TERMS의 TDZ를 건드려 모듈 로드가 실패한다.)
export const generatedProblems = curriculumNodes.flatMap((skill) => generateProblemsForSkill(skill));
