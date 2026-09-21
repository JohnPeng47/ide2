import { expect, it } from 'vitest';
import { isBuiltInDomainProfileId, representationKindForArtifact } from '../domainProfiles';
it('recognizes source and document corpus identities', () => {
  expect(isBuiltInDomainProfileId('source-code')).toBe(true);
  expect(isBuiltInDomainProfileId('document')).toBe(true);
  expect(isBuiltInDomainProfileId('future-profile')).toBe(false);
});
it('reads explicit kinds and legacy catalog metadata', () => {
  expect(representationKindForArtifact({representationKind:'tree',viewKind:'diagram'})).toBe('tree');
  expect(representationKindForArtifact({viewKind:'call-graph'})).toBe('tree');
  expect(representationKindForArtifact({viewKind:'diagram'})).toBe('diagram');
});
