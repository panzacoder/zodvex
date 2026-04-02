import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { z } from "zod";
import { zx } from "zodvex/core";
import { api } from "./_generated/api";
import schema from "./schema";
import { tagged } from "./tagged";

const modules = import.meta.glob("./**/*.ts");

describe("withIndex codec encoding", () => {
  test("query tasks by createdAt using Date (top-level codec field)", async () => {
    const t = convexTest(schema, modules);

    // Seed a user via raw Convex DB (bypasses zodvex codec wrapper).
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Alice",
        email: { value: "alice@example.com", tag: "personal" },
        createdAt: Date.now(),
      });
    });

    // Create a task via zodvex mutation.
    // The handler sets createdAt = new Date(), which the DB writer encodes to a number.
    const taskId = await t.mutation(api.tasks.create, {
      title: "Test task",
      ownerId: userId,
    });

    // Verify the task was created.
    const task = await t.query(api.tasks.get, { id: taskId });
    expect(task).not.toBeNull();
    expect(typeof task!.createdAt).toBe("number");
    expect(task!.createdAt).toBeGreaterThan(0);

    // Encode args the same way a real client would: build the runtime value,
    // then z.encode() it to wire format before sending.
    // zx.date() wire format is a number (timestamp), so z.encode produces 0.
    const argsSchema = z.object({ after: zx.date() });
    const wireArgs = z.encode(argsSchema, { after: new Date(0) });

    // Inside the handler, zodvex decodes the timestamp back to a Date, then
    // the handler passes that Date to .withIndex('by_created', q => q.gte(...)).
    // The withIndex wrapper must re-encode Date → number for Convex's index.
    const results = await t.query(api.tasks.listByCreated, wireArgs);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(typeof results[0].createdAt).toBe("number");
    expect(results[0].createdAt).toBeGreaterThan(0);
  });

  test("query users by email.value (dot-path into codec, pass-through)", async () => {
    const t = convexTest(schema, modules);

    // Seed a user via raw Convex DB with properly structured tagged email.
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Bob",
        email: { value: "bob@example.com", tag: "work" },
        createdAt: Date.now(),
      });
    });

    // Encode args the same way a real client would: build the runtime value
    // (which includes displayValue from the codec's decode), then z.encode()
    // strips it back to wire format { value, tag }.
    const argsSchema = z.object({ email: tagged(z.string()) });
    const wireArgs = z.encode(argsSchema, {
      email: { value: "bob@example.com", tag: "work", displayValue: "[work] bob@example.com" },
    });

    // Inside the handler, zodvex decodes wire → runtime (adding displayValue),
    // then the handler uses email.value in a dot-path index query.
    // Dot-paths reference wire-format sub-fields, so they pass through unchanged.
    const user = await t.query(api.users.getByEmail, wireArgs);

    expect(user).not.toBeNull();
    expect(user!.name).toBe("Bob");
  });
});
