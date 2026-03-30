/**
 * Spike: Function Path Lookup from FunctionReference
 * ===================================================
 *
 * Goal: Determine how to extract a string key (e.g., "tasks:list") from a
 * Convex FunctionReference object, on both server and client.
 *
 * Three consumers need this:
 *   1. React hooks (useZodQuery)            — CLIENT-SIDE
 *   2. Vanilla JS client (ZodvexClient)     — CLIENT-SIDE
 *   3. Server action ctx (createZodvexActionCtx) — SERVER-SIDE
 *
 * The registry maps string paths like "tasks:list" to { args, returns } Zod
 * schemas. We need: api.tasks.list  -->  "tasks:list"
 */

// ============================================================================
// Finding 1: getFunctionName() — Where It Lives & What It Does
// ============================================================================
//
// SOURCE: convex/src/server/api.ts (lines 78-109)
//
// getFunctionName(functionReference) extracts a string name from a
// FunctionReference. The name format is "path/to/module:exportName", or just
// "path/to/module" if the export is "default".
//
// IMPLEMENTATION:
//   1. Calls getFunctionAddress(functionReference) to validate
//   2. If typeof functionReference === "string", returns it directly (legacy)
//   3. Otherwise reads functionReference[Symbol.for("functionName")]
//   4. Throws if the symbol property is falsy
//
// EXPORTED FROM: "convex/server" (convex/src/server/index.ts line 157)
//   export { getFunctionName } from "./api.js";
//
// NOT RE-EXPORTED FROM: "convex/react", "convex/browser"
//
// HOWEVER — this is the critical finding — Convex's own client-side code
// (react, browser) IMPORTS it directly from the internal module path:
//
//   import { getFunctionName } from "../server/api.js";
//
// This import works because:
//   - getFunctionName has NO server-side dependencies (no Node.js APIs, no
//     Convex runtime syscalls)
//   - It's pure JavaScript: reads a Symbol property from an object
//   - The only dependency is getFunctionAddress (also pure JS) and the
//     functionName Symbol
//
// EVIDENCE that Convex uses getFunctionName on the client:
//   - convex/src/react/client.ts: useQuery (line 859), useMutation (line 935),
//     useAction (line 1004), watchQuery (line 468), mutation (line 626)
//   - convex/src/browser/simple_client.ts: onUpdate (line 197), mutation (494),
//     action (line 510), query (line 526)
//   - convex/src/browser/http_client.ts: query (line 283), mutation (346),
//     action (458)
//   - convex/src/react/queries_observer.ts: multiple places
//
// CONCLUSION: getFunctionName is technically defined in "convex/server" but
// is used extensively on the client. It is safe to import from "convex/server"
// in browser bundles — bundlers (webpack, vite, esbuild) will tree-shake and
// only pull in the function + its pure-JS dependencies.

// ============================================================================
// Finding 2: FunctionReference at Runtime — The Symbol Protocol
// ============================================================================
//
// SOURCE: convex/src/server/functionName.ts
//
//   export const functionName = Symbol.for("functionName");
//
// FunctionReference objects at runtime are Proxy objects created by createApi()
// (convex/src/server/api.ts line 145). The Proxy's get trap handles:
//
//   - String props: returns a new Proxy with the path part appended
//   - Symbol.for("functionName"): joins path parts as "dir/module:exportName"
//   - Symbol.toStringTag: returns "FunctionReference"
//
// For makeFunctionReference(name), it returns:
//   { [Symbol.for("functionName")]: name }
//
// So at runtime, there are TWO shapes:
//   1. api.tasks.list  -->  Proxy that responds to Symbol.for("functionName")
//   2. makeFunctionReference("tasks:list")  -->  plain object with the Symbol
//
// There is NO "_name" or "__name" string property. The only runtime accessor
// is the well-known Symbol: Symbol.for("functionName").
//
// IMPORTANT: Since Symbol.for() returns a globally-shared symbol, any code
// can access it without importing the functionName constant:
//
//   const name = (ref as any)[Symbol.for("functionName")];
//
// This is exactly what getFunctionName does internally.

// ============================================================================
// Finding 3: How Convex's useQuery Resolves Function References
// ============================================================================
//
// SOURCE: convex/src/react/client.ts (lines 847-878)
//
// useQuery does:
//   1. If query is a string, wraps it with makeFunctionReference
//   2. Calls getFunctionName(queryReference) to get the string path
//   3. Passes that string to useQueries / the subscription layer
//
// The ConvexReactClient.watchQuery method (line 463-522) also calls
// getFunctionName(query) and passes the string to this.sync.subscribe().
//
// ConvexClient (simple_client.ts) does the same in onUpdate, mutation,
// action, and query methods.
//
// The browser/http_client.ts (ConvexHttpClient) also uses getFunctionName
// for all its query/mutation/action calls.
//
// ALL Convex client code goes through getFunctionName. There is no
// alternative internal mechanism.

// ============================================================================
// Finding 4: Recommended Approach for zodvex
// ============================================================================
//
// RECOMMENDATION: Use getFunctionName from "convex/server" directly.
//
// Rationale:
//
// 1. It's what Convex itself uses on the client. The "convex/server" module
//    path is misleading — getFunctionName has zero server dependencies. Convex's
//    own React hooks, browser client, and HTTP client all import it from
//    "../server/api.js" and run it in the browser.
//
// 2. Tree-shaking works. When zodvex/react or zodvex/client imports
//    { getFunctionName } from "convex/server", bundlers (Vite, webpack, esbuild)
//    only include getFunctionName + getFunctionAddress + the functionName Symbol.
//    No server-side code leaks into the client bundle.
//
// 3. It's the public, documented API. Using the Symbol directly
//    (ref[Symbol.for("functionName")]) would work but bypasses the validation
//    that getFunctionName provides (handling strings, function handles,
//    component references, missing refs).
//
// 4. No reimplementation needed. We get Convex's validation and error
//    messages for free.
//
// FALLBACK (if we ever need to avoid importing "convex/server"):
//
//   const functionNameSymbol = Symbol.for("functionName");
//   function getFunctionPath(ref: AnyFunctionReference): string {
//     if (typeof ref === "string") return ref;
//     const name = (ref as any)[functionNameSymbol];
//     if (!name) throw new Error(`Not a FunctionReference: ${ref}`);
//     return name;
//   }
//
// This is a 5-line reimplementation that covers the common cases. But there
// is no reason to prefer this over the official API.
//
// CAVEATS:
//
// - Component references (from defineComponent) use a DIFFERENT symbol
//   (Symbol.for("toReferencePath")) and getFunctionName will throw for those.
//   This is correct behavior for zodvex — we only support direct function
//   references in the current component, not cross-component references.
//
// - Function handles (strings starting with "function://") are also rejected
//   by getFunctionName. Again, correct for our use case.
//
// - The string format is "module:export" with "/" as the directory separator.
//   For "default" exports, it's just "module" (no colon). Our registry keys
//   must match this format exactly.

// ============================================================================
// Implementation Helper
// ============================================================================

import type { AnyFunctionReference } from "convex/server";
import { getFunctionName } from "convex/server";

/**
 * Extract the function path string from a FunctionReference.
 *
 * This is a thin wrapper over Convex's getFunctionName that serves as
 * zodvex's single point of function-path resolution. If we ever need to
 * change the resolution strategy, we change it here.
 *
 * @example
 *   functionPath(api.tasks.list)    // "tasks:list"
 *   functionPath(api.tasks.default) // "tasks" (default export)
 *   functionPath(api.dir.mod.fn)    // "dir/mod:fn"
 */
export function functionPath(ref: AnyFunctionReference): string {
  return getFunctionName(ref);
}

// ============================================================================
// Usage in zodvex consumers
// ============================================================================
//
// 1. React hooks (zodvex/react):
//    function useZodQuery(query, args) {
//      const path = functionPath(query);
//      const entry = registry[path]; // { args: z.ZodType, returns: z.ZodType }
//      // ... validate args with entry.args, decode result with entry.returns
//    }
//
// 2. Vanilla client (zodvex/client):
//    class ZodvexClient {
//      query(ref, args) {
//        const path = functionPath(ref);
//        const entry = registry[path];
//        // ... encode args, decode result
//      }
//    }
//
// 3. Server action ctx (zodvex/server):
//    function createZodvexActionCtx(ctx, schema) {
//      return {
//        ...ctx,
//        runQuery: async (ref, args) => {
//          const path = functionPath(ref);
//          const entry = registry[path];
//          const result = await ctx.runQuery(ref, entry.args.parse(args));
//          return entry.returns.parse(result);
//        },
//      };
//    }
