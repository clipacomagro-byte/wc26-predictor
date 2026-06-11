// Elo + Dixon-Coles bivariate Poisson — the match model behind https://cup26matches.com
// References: World Football Elo; Maher (1982); Dixon & Coles (1997).
export const K_FACTOR_WC = 60;

// Dixon-Coles ρ — corrects vanilla Poisson's under-count of 0-0 / 1-1 draws. ~ -0.13 empirically.
export const DC_RHO = -0.13;

function dcTau(a, b, lambda, mu, rho) {
  if (a === 0 && b === 0) return 1 - lambda * mu * rho;
  if (a === 0 && b === 1) return 1 + lambda * rho;
  if (a === 1 && b === 0) return 1 + mu * rho;
  if (a === 1 && b === 1) return 1 - rho;
  return 1;
}

// Elo win expectancy (logistic on rating difference).
export function expectedScore(ratingA, ratingB, homeBonusA = 0) {
  return 1 / (1 + Math.pow(10, (ratingB - (ratingA + homeBonusA)) / 400));
}

// Rating difference → expected goals (Poisson λ). Flat denominator keeps single-match variance
// near real football upset frequency.
export function expectedGoals(rating, opponent, homeBonus = 0) {
  const diff = (rating + homeBonus) - opponent;
  const lambda = 1.35 + diff / 400;
  return Math.max(0.3, Math.min(3.5, lambda));
}

export function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

export function poissonSample(lambda, rng = Math.random) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

// 1X2 probabilities via Dixon-Coles bivariate Poisson over 0–8 goals each side.
export function matchProb(ratingA, ratingB, homeBonusA = 0) {
  const lambda = expectedGoals(ratingA, ratingB, homeBonusA);
  const mu = expectedGoals(ratingB, ratingA, -homeBonusA / 2);
  let winA = 0, draw = 0, winB = 0;
  for (let a = 0; a <= 8; a++) {
    const pA = poissonPmf(a, lambda);
    for (let b = 0; b <= 8; b++) {
      const tau = dcTau(a, b, lambda, mu, DC_RHO);
      const p = pA * poissonPmf(b, mu) * tau;
      if (a > b) winA += p; else if (a < b) winB += p; else draw += p;
    }
  }
  const total = winA + draw + winB;
  return { winA: winA / total, draw: draw / total, winB: winB / total, expectedGoalsA: lambda, expectedGoalsB: mu };
}

// Sample a scoreline (for Monte Carlo). allowDraw=false → penalty shootout nudge toward higher Elo.
export function sampleMatch(ratingA, ratingB, homeBonusA = 0, allowDraw = true, rng = Math.random) {
  const eA = expectedGoals(ratingA, ratingB, homeBonusA);
  const eB = expectedGoals(ratingB, ratingA, -homeBonusA / 2);
  let goalsA = poissonSample(eA, rng);
  let goalsB = poissonSample(eB, rng);
  if (!allowDraw && goalsA === goalsB) {
    if (rng() < expectedScore(ratingA, ratingB, homeBonusA)) goalsA += 1; else goalsB += 1;
  }
  return { goalsA, goalsB };
}
