# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-01-16

### Added
- Initial release of zodvex
- Core mapping functionality between Zod v4 and Convex validators
- Proper handling of optional vs nullable semantics
- Function wrappers for type-safe Convex functions (query, mutation, action)
- Codec system for encoding/decoding between Zod and Convex formats
- Table helper for defining Convex tables with Zod schemas
- CRUD helper for generating standard database operations
- Support for Date encoding/decoding
- Support for complex nested structures (arrays, objects, records)
- Integration with convex-helpers for ID handling

### Features
- `zodToConvex()` - Convert Zod schemas to Convex validators
- `zodToConvexFields()` - Convert Zod object shapes to Convex field validators
- `zQuery/zMutation/zAction` - Wrapped Convex functions with Zod validation
- `convexCodec()` - Create codecs for data transformation
- `zodTable()` - Define Convex tables using Zod schemas
- `zCrud()` - Generate CRUD operations from table definitions

[unreleased]: https://github.com/yourusername/zodvex/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yourusername/zodvex/releases/tag/v0.1.0