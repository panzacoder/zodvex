import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("withIndex codec encoding", () => {
  test("query tasks by createdAt using Date (top-level codec field)", async () => {
    const t = convexTest(schema, modules);

    // Seed a user via raw Convex DB (bypasses zodvex codec wrapper).
    // users.create has an impedance mismatch: its args take email as z.string()
    // but the model stores email as tagged(z.string()) — the codec rejects a plain string.
    // Using t.run() avoids that issue and keeps the test focused on withIndex encoding.
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
    // convex-test returns wire format — createdAt is a number, not a Date.
    const task = await t.query(api.tasks.get, { id: taskId });
    expect(task).not.toBeNull();
    expect(typeof task!.createdAt).toBe("number");
    expect(task!.createdAt).toBeGreaterThan(0);

    // Query by createdAt using the by_created index.
    // Args are wire format (number) because convex-test validates against Convex validators.
    // Inside the handler, zodvex decodes the number to a Date, then the handler passes
    // that Date to .withIndex('by_created', q => q.gte('createdAt', after)).
    //
    // WITHOUT withIndex encoding: passes Date to Convex (which expects number) — FAILS.
    // WITH withIndex encoding (Task 1): encodes Date → number before Convex sees it — works.
    const results = await t.query(api.tasks.listByCreated, {
      after: 0, // wire format: epoch timestamp (number)
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    // Results are wire format — createdAt is a number
    expect(typeof results[0].createdAt).toBe("number");
    expect(results[0].createdAt).toBeGreaterThan(0);
  });

  test("query users by email.value (dot-path into codec, pass-through)", async () => {
    const t = convexTest(schema, modules);

    // Seed a user via raw Convex DB with properly structured tagged email.
    // The wire format for tagged(z.string()) is { value, tag }.
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Bob",
        email: { value: "bob@example.com", tag: "work" },
        createdAt: Date.now(),
      });
    });

    // Query by email.value — dot-path into a codec field.
    // Args are wire format because convex-test validates against Convex validators.
    // tagged(z.string()) wire format is { value: string, tag: string } — no displayValue.
    //
    // The getByEmail query uses .withIndex("by_email", q => q.eq("email.value", email.value))
    // where email.value is a plain string. Dot-paths should pass through unchanged
    // since they reference sub-fields of the wire format, not the codec's runtime type.
    const user = await t.query(api.users.getByEmail, {
      email: { value: "bob@example.com", tag: "work" },
    });

    expect(user).not.toBeNull();
    expect(user!.name).toBe("Bob");
  });
});
