# Boundary contract during remediation

Date: 2026-09-07

Status: working decision; describes the supported implementation and explicitly identified limitations, not a new universal validation promise.

## Decision

Preserve existing schema behavior while repairing correctness and type safety. The query-hook and watch-cache fixes intentionally change failure handling: invalid arguments surface instead of appearing to load forever, and failed decodes cannot expose stale cached values. Treat the experimental pagination restriction as a separate, reviewable behavior change.

Do not decide future validation placement from synthetic capacity numbers. PR #80's proposal to retain codec paths while relaxing ordinary modeled-read validation remains a proposal. Decide it after a reproducible Zod 4.5 baseline and a representative consumer exercise that measures both behavior and relevant Convex costs. This record makes no dependency on an offline/local-first graph architecture.

## What the checks mean

[The mapping layer](../../packages/zodvex/src/internal/mapping/core.ts) constructs Convex validators for representable wire structure: types, fields, unions, literals, and optional/null distinctions. It selects a codec's wire side. This does not make arbitrary Zod refinements executable by Convex, nor does a mapped optional/default field mean Convex supplies the Zod default.

Zod parsing and encoding are distinct operations. Parsing can apply defaults, forward transforms, refinements and codec decoding according to the actual schema. Encoding runs Zod's reverse operation; it is not a promise that every forward transform has an inverse or that defaults are filled in identically. Current wrappers use synchronous Zod operations: this record does not promise async refinement/transform support.

## Supported paths and their limits

| Path | Current behavior | Limits and failure behavior |
| --- | --- | --- |
| Registered function arguments | Direct wrappers parse their normalized argument schema before the handler. Custom builders parse declared consumer arguments; Zod-declared customization arguments are parsed before customization input runs. | Registered Convex validators check representable wire shape separately. Customization can add/override arguments after consumer parsing. Zod errors are formatted into `ConvexError` with `args` context; other thrown values propagate. |
| Registered function returns | When a return schema exists, finalization tries Zod encoding, then strips undefined values. The explicit unidirectional-transform fallback parses instead. | That fallback is implementation behavior, not general bidirectional transform support. Without a return schema, there is no Zod return validation. Customization `onSuccess` runs before final return validation. Return Zod errors become `ConvexError` with `returns` context. |
| Modeled database reads | `get` and query terminals (`first`, `unique`, `collect`, `take`, `paginate`, async iteration) parse returned modeled documents using the registered document schema. | These are full document parses, not codec-only walks. Null remains null. Tables absent from the table map pass through; system access is native. Zod failures throw, without the client warn-and-return fallback. Pagination decodes each document while preserving Convex's page metadata. |
| Modeled insert/replace | Encode through the model's insert schema before delegating to Convex; strip undefined stored values. | Encoding can reject runtime values. Native Convex still handles storage constraints. Unknown/unresolved tables pass through. This is not a claim that every raw database access goes through zodvex. |
| Modeled patch | Object schemas are rebuilt with optional fields and encoded; top-level undefined is preserved for field deletion, nested undefined is removed. | This does not fetch/merge/validate the resulting whole document and does not retain outer object refinements. Non-object schemas, including unions, fall back to full encoding and can require more than the supplied patch. Preserve these limits in performance comparisons. |
| Registry-backed outbound calls | `runQuery`/`runMutation` overrides encode arguments and decode results. Scheduler `runAfter`/`runAt` encode arguments and return Convex's scheduled-function ID unchanged. | Overrides require a registry and applicable context members. `initZodvex` installs them for actions/mutations; `runAction` is not wrapped here. Missing registry entries/schemas pass through. These helpers share the client decode policy; server-side placement does not imply strict decoding. |
| Client query/mutation/action/subscription | Registry argument schemas encode outgoing values; return schemas parse incoming values. | Missing schemas pass through. Default decode policy warns and returns raw wire data: runtime codec types are **not guaranteed after a decode failure**. `onDecodeError: 'throw'` raises `ZodvexDecodeError` for failed schema parses. Argument encoding errors propagate. Exceptions thrown directly by user codec code can also propagate. |
| React query hook and watch | Explicit `'skip'` avoids encoding; loading `undefined` passes through. After remediation, failed argument encoding calls the inner hook with skip, then rethrows for React error handling. Watches memoize completed decode results by wire identity. | An encoding failure is not a loading state. Strict decode failures are retried on later reads rather than poisoning the cache. Default warn-mode raw results still follow the configured policy. |

Implementation: [function contracts](../../packages/zodvex/src/internal/functionContracts.ts), [direct wrappers](../../packages/zodvex/src/internal/wrappers.ts), [custom builders](../../packages/zodvex/src/internal/custom.ts), [server errors/returns](../../packages/zodvex/src/internal/serverUtils.ts), [document codecs](../../packages/zodvex/src/internal/codec.ts), [database wrappers](../../packages/zodvex/src/internal/db.ts), [outbound context helpers](../../packages/zodvex/src/internal/actionCtx.ts), [initialization](../../packages/zodvex/src/internal/init.ts), [registry boundary helpers](../../packages/zodvex/src/internal/boundaryHelpers.ts), [React hooks](../../packages/zodvex/src/public/react/hooks.ts), [watch cache](../../packages/zodvex/src/public/react/zodvexReactClient.ts).

`skipConvexValidation` on custom builders changes generated Convex validation, not the Zod argument/return work described above. It must not be represented as an equivalent benchmark configuration without naming the changed structural checks. See [its tests](../../packages/zodvex/__tests__/skip-convex-validation.test.ts).

## Rules, audit and explicit bypasses

[Rules and audit](../../packages/zodvex/src/internal/rules.ts) compose around the database wrapper. Read rules see decoded documents and can allow, hide or transform them; transformed read output is not automatically reparsed afterward. Paginated read rules filter the returned page, which may shrink. Write rules can transform supplied values before the inner encoder; patch/replace/delete rule paths also consult the existing readable document. Missing rules allow by default; `defaultPolicy: 'deny'` changes that behavior. Counting restrictions depend on the rule-bearing query path and configuration.

Audit callbacks are awaited after their corresponding inner operation. Composition order determines what they observe; an audit layer outside rules sees rules-processed results. They are not a durable external audit log or another schema-validation pass, and callback exceptions can fail the caller.

`unwrap()` deliberately returns the native database handle and bypasses codecs, rules and audit. `wrapDb: false` also opts out of database wrapping. Neither is evidence that the wrapped path preserves fewer guarantees. Tests: [rules/audit composition](../../packages/zodvex/__tests__/rules.test.ts), [underlying database](../../packages/zodvex/__tests__/underlying-db.test.ts), [initialization](../../packages/zodvex/__tests__/init.test.ts).

## Separate experimental pagination limitation

The installed Convex 1.32.0 experimental client subscription dispatches aggregate `{ results, status, loadMore }` values, despite its callback type declaring a pagination envelope. The previous zodvex wrapper expected `.page` and attempted to decode each item with the complete function return schema. That is not a supported codec contract.

The separate remediation makes `onPaginatedUpdate_experimental` fail before subscribing with an actionable diagnostic. Supported alternatives are `query`, `subscribe`, or `ZodvexReactClient.watchQuery` with explicit `paginationOpts`, which retain the complete return envelope. A future aggregate adapter must define argument encoding, item decoding, outer-schema limitations and current-value access; it must not fabricate cursors to claim complete-page validation.

Implementation and tests: [client](../../packages/zodvex/src/public/client/zodvexClient.ts), [client regressions](../../packages/zodvex/__tests__/zodvex-client.test.ts). Apply the restriction only with its separate implementation change; this document alone does not change the API.

## Evidence and next decision gate

Focused local verification passed 376 tests in 16 test-file runs for [wrappers](../../packages/zodvex/__tests__/wrappers.test.ts), [document codecs](../../packages/zodvex/__tests__/codec-doc.test.ts), [encoding pipeline](../../packages/zodvex/__tests__/codec-encode-pipeline.test.ts), [outbound context](../../packages/zodvex/__tests__/action-ctx.test.ts), [database](../../packages/zodvex/__tests__/db.test.ts), rules, underlying database, and skipped Convex validation. Client remediation passed another 166 tests in six file runs, including [hook failures](../../packages/zodvex/__tests__/react-hooks.test.ts), [watch failures/recovery](../../packages/zodvex/__tests__/zodvex-react-client.test.ts), and full/mini explicit pagination. These are local checks, not a deployment or platform-capacity claim.

Before changing validation placement, compare representative valid and invalid values at the affected boundary: codec failures, ordinary refinements, defaults, unions and patches. Report missing coverage explicitly. Separate deployment-analysis success, handler latency, client cost and diagnostic memory measurements. Choose the future contract based on consumer requirements and measured platform constraints; current behavior is the compatibility reference, not a requirement to preserve every existing implementation cost forever.
