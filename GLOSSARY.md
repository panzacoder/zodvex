# zodvex

zodvex uses Zod schemas to describe data shared between a Convex application and its consumers.

## Language

**Schema reference**:
A reference to an existing schema or codec available from a client-safe module, rather than a reconstructed copy of its shape.
_Avoid_: Schema copy

**Codec provenance brand**:
An author-declared name identifying a cohort of interchangeable codecs. Sharing a brand asserts interchangeability even when the codecs are different instances.
_Avoid_: Fingerprint, inferred identity

**Codec fingerprint**:
An inferred description of a codec's schema structure and transforms used to find a corresponding codec when a direct or branded reference is unavailable. Matching fingerprints are an approximation of interchangeability, not proof of equivalent behavior.
_Avoid_: Provenance brand, exact identity
