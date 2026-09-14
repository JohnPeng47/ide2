import type { BuiltInDomainProfileId, DomainProfile } from "../../../domain/core/profiles/domainProfile";
import { BUILT_IN_DOMAIN_PROFILES } from "../../../domain/core/profiles/domainProfiles";

export { BUILT_IN_DOMAIN_PROFILES } from "../../../domain/core/profiles/domainProfiles";

export function isBuiltInDomainProfileId(value: unknown): value is BuiltInDomainProfileId {
  return value === "source-code" || value === "document";
}

export function builtInDomainProfile(id: BuiltInDomainProfileId): DomainProfile {
  return BUILT_IN_DOMAIN_PROFILES[id];
}
