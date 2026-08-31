import type { BuiltInDomainProfileId, DomainProfile } from "../src/domainProfile";
import { BUILT_IN_DOMAIN_PROFILES } from "../src/domainProfiles";

export { BUILT_IN_DOMAIN_PROFILES } from "../src/domainProfiles";

export function isBuiltInDomainProfileId(value: unknown): value is BuiltInDomainProfileId {
  return value === "source-code" || value === "document";
}

export function builtInDomainProfile(id: BuiltInDomainProfileId): DomainProfile {
  return BUILT_IN_DOMAIN_PROFILES[id];
}
