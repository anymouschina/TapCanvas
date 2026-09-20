export type TemporalStateAnchor = Readonly<{
  seconds: number;
  state: string;
}>;

/** Only exact event boundaries establish a state at a timestamp. A sampling
 * interval inside an event cannot prove that its entry state still holds. */
export function uniqueTemporalStateAnchors(
  anchors: readonly TemporalStateAnchor[],
): TemporalStateAnchor[] {
  const seen = new Set<string>();
  return anchors.filter((anchor) => {
    const key = JSON.stringify([anchor.seconds, anchor.state]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.seconds - right.seconds);
}
