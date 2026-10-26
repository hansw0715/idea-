/** 제외해 둔 기존 팀원은 유지하고, 새로 참가한 팀원만 자동 선택한다. */
export function reconcileParticipants(
  selected: number[] | null,
  previousMembers: readonly number[],
  currentMembers: readonly number[],
): number[] {
  if (selected === null) return [...currentMembers];
  const previous = new Set(previousMembers);
  const active = new Set(selected);
  return currentMembers.filter((id) => active.has(id) || !previous.has(id));
}
