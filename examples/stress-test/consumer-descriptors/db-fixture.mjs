import { ZodvexDatabaseWriter } from "zodvex/server";
import { SecretText } from "./codecs.mjs";

export function memoryDatabase(seed = []) {
  const documents = new Map(seed.map(doc => [doc._id, doc]));
  const calls = [];
  const idFrom = args => args.length === 2 ? args[1] : args[0];
  const database = {
    normalizeId(table, id) { return String(id).startsWith(`${table}:`) ? id : null; },
    async get(...args) { calls.push("get"); return documents.get(idFrom(args)) ?? null; },
    query(table) {
      return { async take(count) {
        calls.push("take");
        return [...documents.values()].filter(d => d._id.startsWith(`${table}:`)).slice(0, count);
      } };
    },
    async insert(table, value) {
      calls.push("insert");
      const id = `${table}:${documents.size + 1}`;
      documents.set(id, { ...value, _id: id, _creationTime: 100 });
      return id;
    },
    async patch(...args) {
      calls.push("patch");
      const id = args.at(-2), update = args.at(-1);
      const document = { ...documents.get(id), ...update };
      for (const [key, value] of Object.entries(update)) if (value === undefined) delete document[key];
      documents.set(id, document);
    },
    async replace(...args) {
      calls.push("replace");
      const id = args.at(-2), previous = documents.get(id);
      documents.set(id, { ...args.at(-1), _id: id, _creationTime: previous._creationTime });
    },
  };
  return { database, calls, documents };
}

export const TS = 1700000000000;
export function runtimeValue() {
  return { name: "before", createdAt: new Date(TS), secret: new SecretText("value"),
    nested: { history: [new Date(TS + 1)], note: "preserved" } };
}

export async function exercise(tableMap) {
  const raw = memoryDatabase();
  const db = new ZodvexDatabaseWriter(raw.database, tableMap);
  const id = await db.insert("probe", runtimeValue());
  const first = await db.get("probe", id);
  const wire = raw.documents.get(id);
  await db.patch("probe", id, { updatedAt: new Date(TS + 2), name: "patched" });
  const patched = await db.get("probe", id);
  await db.patch("probe", id, { updatedAt: undefined });
  const unset = await db.get("probe", id);
  await db.replace("probe", id, { ...runtimeValue(), name: "replaced" });
  const [last] = await db.query("probe").take(1);
  return {
    wireEncoded: wire.createdAt === TS && wire.secret === "value" && wire.nested.history[0] === TS + 1,
    decoded: first.createdAt.getTime() === TS && first.secret.reveal() === "value" && first.nested.history[0].getTime() === TS + 1,
    codecPatch: patched.updatedAt.getTime() === TS + 2,
    ordinaryPatch: patched.name === "patched",
    unset: !("updatedAt" in unset),
    replaceAndQuery: last.name === "replaced" && last.secret.reveal() === "value",
    calls: raw.calls,
  };
}
