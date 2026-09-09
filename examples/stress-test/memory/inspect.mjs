// Source-checkout bridge to the same implementation shipped by the CLI.
import { inspectSchema } from "../../../packages/zodvex/src/public/cli/inspect-schema/inspect.mjs";

await inspectSchema(process.argv.slice(2));
