const SEVERITY_RANK = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Computes overall risk in code:
 * - any high severity -> 'red'
 * - else any medium -> 'yellow'
 * - else -> 'green'
 *
 * @param {Array<Object>} flags
 * @returns {'green' | 'yellow' | 'red'}
 */
function calculateRisk(flags) {
  if (!Array.isArray(flags) || flags.length === 0) {
    return 'green';
  }

  const hasHigh = flags.some((f) => f && f.severity === 'high');
  if (hasHigh) {
    return 'red';
  }

  const hasMedium = flags.some((f) => f && f.severity === 'medium');
  if (hasMedium) {
    return 'yellow';
  }

  return 'green';
}

/**
 * Sorts flags by severity (high first, then medium, then low)
 * and limits the result to at most `maxCount` (default 3).
 *
 * @param {Array<Object>} flags
 * @param {number} [maxCount=3]
 * @returns {Array<Object>}
 */
function sortAndFilterFlags(flags, maxCount = 3) {
  if (!Array.isArray(flags)) {
    return [];
  }

  const sorted = [...flags].sort((a, b) => {
    const rankA = SEVERITY_RANK[a.severity] || 0;
    const rankB = SEVERITY_RANK[b.severity] || 0;
    return rankB - rankA;
  });

  return sorted.slice(0, maxCount);
}

module.exports = {
  calculateRisk,
  sortAndFilterFlags,
  SEVERITY_RANK,
};
