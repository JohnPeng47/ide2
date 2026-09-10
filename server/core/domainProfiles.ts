import type { BuiltInDomainProfileId, DomainProfile } from "../../src/core/domainProfile";
import { BUILT_IN_DOMAIN_PROFILES } from "../../src/core/domainProfiles";

export { BUILT_IN_DOMAIN_PROFILES } from "../../src/core/domainProfiles";

export function isBuiltInDomainProfileId(value: unknown): value is BuiltInDomainProfileId {
  return value === "source-code" || value === "document";
}

export function builtInDomainProfile(id: BuiltInDomainProfileId): DomainProfile {
  return BUILT_IN_DOMAIN_PROFILES[id];
}
