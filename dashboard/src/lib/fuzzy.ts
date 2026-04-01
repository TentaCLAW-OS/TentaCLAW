// dashboard/src/lib/fuzzy.ts

interface FuzzyResult<T> {
  item: T;
  score: number;
  matches: number[]; // indices of matched characters
}

/**
 * Score-based fuzzy match. Higher score = better match.
 * Rewards: consecutive matches, match at word boundary, match at start.
 * Returns null if no match.
 */
export function fuzzyMatch(query: string, target: string): { score: number; matches: number[] } | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (q.length === 0) return { score: 1, matches: [] };
  if (q.length > t.length) return null;

  const matches: number[] = [];
  let score = 0;
  let qi = 0;
  let lastMatchIdx = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matches.push(ti);

      // Consecutive bonus
      if (ti === lastMatchIdx + 1) {
        score += 8;
      }

      // Word boundary bonus (after space, hyphen, underscore, or start)
      if (ti === 0 || ' -_'.includes(t[ti - 1])) {
        score += 10;
      }

      // Position bonus (earlier matches score higher)
      score += Math.max(0, 5 - ti * 0.5);

      lastMatchIdx = ti;
      qi++;
    }
  }

  // All query chars must match
  if (qi < q.length) return null;

  // Length penalty — prefer shorter targets for same match quality
  score -= t.length * 0.1;

  return { score, matches };
}

export function fuzzyFilter<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
): FuzzyResult<T>[] {
  if (!query) return items.map((item) => ({ item, score: 0, matches: [] }));

  const results: FuzzyResult<T>[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, getText(item));
    if (match) {
      results.push({ item, ...match });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
