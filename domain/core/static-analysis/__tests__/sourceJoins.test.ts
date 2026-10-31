import { describe, expect, it } from 'vitest';
import { contractFixture } from './contractFixture';
import { joinSourceRange, partitionFromSourceJoins, type SourceJoinRequest } from '../sourceJoins';

function request(): SourceJoinRequest {
  return { id: 'join', diagramRevisionId: 'diagram:1', leafId: 'leaf:x', policy: 'fully-contained',
    range: structuredClone(contractFixture().entities[2].provenance.locations[0]), evidenceId: 'evidence:x', sourceRangeId: 'range:x' };
}
describe('diagram source joins', () => {
  it('joins source declarations without including their module or synthetic ancestors', () => {
    expect(joinSourceRange(contractFixture(), request())).toMatchObject({ status: 'matched', entityIds: ['binding:x'], evidenceId: 'evidence:x', sourceRangeId: 'range:x' });
  });
  it('does not match a stale file hash or a different snapshot', () => {
    for (const patch of [{ fileHash: 'b'.repeat(64) }, { snapshotId: 'old' }]) {
      const input = request(); Object.assign(input.range, patch);
      expect(joinSourceRange(contractFixture(), input)).toMatchObject({ status: 'stale', entityIds: [] });
    }
  });
  it('distinguishes full containment from intersection and uses half-open offsets', () => {
    const input = request(); input.range.end = { offset: 10, line: 1, column: 11 };
    expect(joinSourceRange(contractFixture(), input).status).toBe('unmapped');
    expect(joinSourceRange(contractFixture(), { ...input, policy: 'intersects' }).entityIds).toEqual(['binding:x']);
    input.range.start = { offset: 19, line: 1, column: 20 }; input.range.end = input.range.start;
    expect(joinSourceRange(contractFixture(), { ...input, policy: 'intersects' }).status).toBe('unmapped');
  });
  it('preserves overlap, uncovered members and deterministic primary membership', () => {
    const joins = [joinSourceRange(contractFixture(), request()), joinSourceRange(contractFixture(), { ...request(), id: 'other', diagramRevisionId: 'old' })];
    const partition = partitionFromSourceJoins({ id: 'concepts', universeEntityIds: ['uncovered', 'binding:x'], diagramRevisionId: 'diagram:1', joins,
      groups: [{ id: 'b', label: 'Second', leafIds: ['leaf:x'] }, { id: 'a', label: 'First', leafIds: ['leaf:x'] }] });
    expect(partition.memberships).toEqual([{ entityId: 'binding:x', groupIds: ['a', 'b'], primaryGroupId: 'a' }, { entityId: 'uncovered', groupIds: [], primaryGroupId: null }]);
    expect(partitionFromSourceJoins({ ...partition, diagramRevisionId: 'different', joins, groups: [{ id: 'a', label: 'First', leafIds: ['leaf:x'] }] })
      .memberships.every(member => member.primaryGroupId === null)).toBe(true);
  });
});
