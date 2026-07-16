// schedule.ts
// courtesy of Claude ai

type Interval = [start: number, end: number];

/** Distance-minimizing candidate start within [s, e) for `duration`, or -1 if it doesn't fit. */
function fitWithin(s: number, e: number, preferredStart: number, duration: number): number {
  if (e - s < duration) return -1;
  if (preferredStart <= s) return s;
  if (preferredStart + duration <= e) return preferredStart;
  const clamped = e - duration;
  return clamped >= s ? clamped : -1;
}

/**
 * Locates the interval (by index) offering the start time nearest `preferredStart`
 * that fits `duration`. Ties broken toward the earlier start.
 * Assumes `times` sorted ascending by start, non-overlapping.
 */
function locateSlot(
  times: Interval[],
  preferredStart: number,
  duration: number
): { index: number; start: number } | null {
  if (duration <= 0 || times.length === 0) return null;

  // binary search: first interval with start >= preferredStart
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    // eslint-disable-next-line no-bitwise
    const mid = (lo + hi) >>> 1;
    if (times[mid][0] >= preferredStart) hi = mid;
    else lo = mid + 1;
  }

  let right = lo;
  let left = lo - 1;
  let rightDone = right >= times.length;
  let leftDone = left < 0;

  let bestIndex = -1;
  let bestStart = -1;
  let bestDist = Infinity;

  while (!rightDone || !leftDone) {
    if (!rightDone) {
      const [s, e] = times[right];
      if (s - preferredStart > bestDist) {
        rightDone = true;
      } else {
        const cand = fitWithin(s, e, preferredStart, duration);
        if (cand !== -1) {
          const dist = cand - preferredStart; // always >= 0 on this side
          if (dist < bestDist) {
            bestDist = dist;
            bestStart = cand;
            bestIndex = right;
          }
        }
        right++;
        if (right >= times.length) rightDone = true;
      }
    }
    if (!leftDone) {
      const [s, e] = times[left];
      const lowerBound = Math.max(0, preferredStart - e);
      if (lowerBound > bestDist) {
        leftDone = true;
      } else {
        const cand = fitWithin(s, e, preferredStart, duration);
        if (cand !== -1) {
          const dist = preferredStart - cand;
          if (dist < bestDist || (dist === bestDist && cand < bestStart)) {
            bestDist = dist;
            bestStart = cand;
            bestIndex = left;
          }
        }
        left--;
        if (left < 0) leftDone = true;
      }
    }
  }

  return bestIndex === -1 ? null : { index: bestIndex, start: bestStart };
}

/** Best available start time nearest `preferredStart` fitting `duration`, or -1. */
export function findBestSlot(times: Interval[], preferredStart: number, duration: number): number {
  return locateSlot(times, preferredStart, duration)?.start ?? -1;
}

/** Reserves the best-fit slot in place, splitting/removing the consumed interval. */
export function reserveSlot(times: Interval[], preferredStart: number, duration: number): number {
  const slot = locateSlot(times, preferredStart, duration);
  if (!slot) return -1;

  const { index, start } = slot;
  const [s, e] = times[index];
  const pieces: Interval[] = [];
  if (start > s) pieces.push([s, start]);
  if (start + duration < e) pieces.push([start + duration, e]);
  times.splice(index, 1, ...pieces);

  return start;
}
