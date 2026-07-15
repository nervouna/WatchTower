import type { SearchCandidate, SourceKind } from "../domain/types";

function compareCandidates(a: SearchCandidate, b: SearchCandidate, sourceSizes: ReadonlyMap<SourceKind, number>): number {
  const aSize = sourceSizes.get(a.source) ?? 1;
  const bSize = sourceSizes.get(b.source) ?? 1;
  const aRank = 1 - (a.rank - 1) / Math.max(1, aSize - 1);
  const bRank = 1 - (b.rank - 1) / Math.max(1, bSize - 1);
  const aValue = aRank * 0.6 + a.score * 0.4;
  const bValue = bRank * 0.6 + b.score * 0.4;
  return bValue - aValue || a.rank - b.rank || a.canonicalKey.localeCompare(b.canonicalKey);
}

export function selectCandidates(input: readonly SearchCandidate[], limit = 30): SearchCandidate[] {
  const seen = new Set<string>();
  const unique = input
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .filter((candidate) => {
      const key = `${candidate.source}\u0000${candidate.canonicalKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const grouped = new Map<SourceKind, SearchCandidate[]>();
  for (const candidate of unique) {
    const group = grouped.get(candidate.source) ?? [];
    group.push(candidate);
    grouped.set(candidate.source, group);
  }
  const sourceSizes = new Map([...grouped].map(([source, values]) => [source, values.length]));
  const selected = [...grouped.values()].flatMap((values) => values.slice(0, 7));
  const selectedKeys = new Set(selected.map((candidate) => `${candidate.source}\u0000${candidate.canonicalKey}`));
  const remainder = unique
    .filter((candidate) => !selectedKeys.has(`${candidate.source}\u0000${candidate.canonicalKey}`))
    .sort((a, b) => compareCandidates(a, b, sourceSizes));
  return [...selected, ...remainder].slice(0, limit);
}
