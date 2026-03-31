import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("filter codec encoding", () => {
  test("filter by createdAt using Date (codec field encodes to timestamp)", async () => {
    const t = convexTest(schema, modules);

    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Alice",
        email: { value: "alice@example.com", tag: "personal" },
        createdAt: now - 10000,
      });
      await ctx.db.insert("users", {
        name: "Bob",
        email: { value: "bob@example.com", tag: "work" },
        createdAt: now + 10000,
      });
    });

    // Query using .filter() with a Date value through the zodvex query chain.
    // WITHOUT filter encoding: Date compared against number — silent mismatch.
    // WITH filter encoding: Date → number before Convex sees it — correct.
    //
    // t.run() can't return decoded docs (Date is not a Convex Value), so we
    // return only the names to verify the filter selected the right documents.
    const names = await t.run(async (ctx) => {
      const { createZodDbReader } = await import("zodvex/server");
      const db = createZodDbReader(ctx.db, schema);

      const results = await db
        .query("users")
        .filter((q: any) => q.gte(q.field("createdAt"), new Date(now)))
        .collect();

      return results.map((r: any) => r.name);
    });

    expect(names).toEqual(["Bob"]);
  });

  test("filter by name (non-codec field passes through unchanged)", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Alice",
        email: { value: "alice@example.com", tag: "personal" },
        createdAt: Date.now(),
      });
      await ctx.db.insert("users", {
        name: "Bob",
        email: { value: "bob@example.com", tag: "work" },
        createdAt: Date.now(),
      });
    });

    const names = await t.run(async (ctx) => {
      const { createZodDbReader } = await import("zodvex/server");
      const db = createZodDbReader(ctx.db, schema);

      const results = await db
        .query("users")
        .filter((q: any) => q.eq(q.field("name"), "Alice"))
        .collect();

      return results.map((r: any) => r.name);
    });

    expect(names).toEqual(["Alice"]);
  });

  test("chained filters — non-codec then codec field", async () => {
    const t = convexTest(schema, modules);

    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Alice",
        email: { value: "alice@example.com", tag: "personal" },
        createdAt: now - 10000,
      });
      await ctx.db.insert("users", {
        name: "Bob",
        email: { value: "bob@example.com", tag: "work" },
        createdAt: now + 10000,
      });
      await ctx.db.insert("users", {
        name: "",
        email: { value: "anon@example.com", tag: "personal" },
        createdAt: now + 20000,
      });
    });

    const names = await t.run(async (ctx) => {
      const { createZodDbReader } = await import("zodvex/server");
      const db = createZodDbReader(ctx.db, schema);

      const results = await db
        .query("users")
        .filter((q: any) => q.neq(q.field("name"), ""))
        .filter((q: any) => q.gte(q.field("createdAt"), new Date(now)))
        .collect();

      return results.map((r: any) => r.name);
    });

    expect(names).toEqual(["Bob"]);
  });
});
