/** A phase focus keeps the surrounding overview visible; `phase` remains a filter. */
export function experimentPhaseUrl(experimentId: string, phaseId: string): string {
  return `?${new URLSearchParams({ experiment: experimentId, focusPhase: phaseId })}`;
}
