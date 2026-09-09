import { pathToFileURL } from "node:url";
import { schemaCensus } from "./census.mjs";

// Parent captures/discards stdout and stderr: application logging is never a report.
const heap = () => {
	globalThis.gc();
	globalThis.gc();
	const { heapUsed, external, arrayBuffers } = process.memoryUsage();
	return { heapUsed, external, arrayBuffers };
};
try {
	if (typeof globalThis.gc !== "function") throw new Error("GC unavailable");
	const before = heap();
	const module = await import(pathToFileURL(process.argv[2]).href);
	const after = heap();
	// Census is after measurement so walking shape definitions cannot inflate it.
	const census = schemaCensus(module.default);
	process.send({ ok: true, census, before, after });
} catch {
	process.send({ ok: false });
} finally {
	process.disconnect();
	process.exit(0);
}
