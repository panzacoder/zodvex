import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * End-to-end tests for top-level discriminated union tables.
 *
 * Validates the pattern from Discord thread #1313408550407634964:
 * - zodTable/defineZodModel accepts a discriminated union as the entire document shape
 * - Indexes on shared fields across variants work correctly
 * - Codec encoding (zx.date()) works through withIndex on union tables
 * - CRUD operations work across all variants
 *
 * NOTE: encodeIndexValue() currently only handles ZodObject schemas, not unions.
 * Index tests pass in convex-test because the in-memory engine is lenient, but
 * a real Convex backend would reject a Date value for a number-typed field.
 * See todo/union-index-encoding.md for the correct fix design.
 */
describe("top-level discriminated union table", () => {
  async function seedUser(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Alice",
        email: { value: "alice@test.com", tag: "test" },
        createdAt: Date.now(),
      });
    });
  }

  test("create and read different union variants", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);

    // Create one of each variant
    const emailId = await t.mutation(api.notifications.createEmail, {
      recipientId: userId,
      subject: "Welcome",
      body: "Hello!",
    });
    const pushId = await t.mutation(api.notifications.createPush, {
      recipientId: userId,
      title: "New message",
      badge: 3,
    });
    const inAppId = await t.mutation(api.notifications.createInApp, {
      recipientId: userId,
      message: "You have a new task",
    });

    // Read each back and verify variant-specific fields
    const email = await t.query(api.notifications.get, { id: emailId });
    expect(email).not.toBeNull();
    expect(email!.kind).toBe("email");
    expect(email!.subject).toBe("Welcome");
    expect(email!.body).toBe("Hello!");
    // createdAt should be wire format (number, not Date)
    expect(typeof email!.createdAt).toBe("number");

    const push = await t.query(api.notifications.get, { id: pushId });
    expect(push).not.toBeNull();
    expect(push!.kind).toBe("push");
    expect(push!.title).toBe("New message");
    expect(push!.badge).toBe(3);

    const inApp = await t.query(api.notifications.get, { id: inAppId });
    expect(inApp).not.toBeNull();
    expect(inApp!.kind).toBe("in_app");
    expect(inApp!.message).toBe("You have a new task");
    expect(inApp!.read).toBe(false);
  });

  test("index query on shared field: by_recipient", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);

    // Create multiple variants for the same recipient
    await t.mutation(api.notifications.createEmail, {
      recipientId: userId,
      subject: "Email 1",
      body: "Body 1",
    });
    await t.mutation(api.notifications.createPush, {
      recipientId: userId,
      title: "Push 1",
    });
    await t.mutation(api.notifications.createInApp, {
      recipientId: userId,
      message: "InApp 1",
    });

    // Query by shared field across all variants
    const results = await t.query(api.notifications.listByRecipient, {
      recipientId: userId,
    });

    expect(results).toHaveLength(3);
    // Should contain all three kinds
    const kinds = results.map((n: any) => n.kind).sort();
    expect(kinds).toEqual(["email", "in_app", "push"]);
  });

  test("index query on discriminator field: by_kind", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);

    await t.mutation(api.notifications.createEmail, {
      recipientId: userId,
      subject: "Email 1",
      body: "Body 1",
    });
    await t.mutation(api.notifications.createEmail, {
      recipientId: userId,
      subject: "Email 2",
      body: "Body 2",
    });
    await t.mutation(api.notifications.createPush, {
      recipientId: userId,
      title: "Push 1",
    });

    // Query by discriminator value
    const emails = await t.query(api.notifications.listByKind, {
      kind: "email",
    });
    expect(emails).toHaveLength(2);
    expect(emails.every((n: any) => n.kind === "email")).toBe(true);

    const pushes = await t.query(api.notifications.listByKind, {
      kind: "push",
    });
    expect(pushes).toHaveLength(1);
  });

  test("compound index on shared fields: by_recipient_and_kind", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);

    // Create a second user to verify isolation
    const userId2 = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Bob",
        email: { value: "bob@test.com", tag: "test" },
        createdAt: Date.now(),
      });
    });

    await t.mutation(api.notifications.createEmail, {
      recipientId: userId,
      subject: "Alice email",
      body: "For Alice",
    });
    await t.mutation(api.notifications.createPush, {
      recipientId: userId,
      title: "Alice push",
    });
    await t.mutation(api.notifications.createEmail, {
      recipientId: userId2,
      subject: "Bob email",
      body: "For Bob",
    });

    // Compound index: recipient + kind
    const aliceEmails = await t.query(
      api.notifications.listByRecipientAndKind,
      { recipientId: userId, kind: "email" }
    );
    expect(aliceEmails).toHaveLength(1);
    expect(aliceEmails[0].subject).toBe("Alice email");

    const alicePushes = await t.query(
      api.notifications.listByRecipientAndKind,
      { recipientId: userId, kind: "push" }
    );
    expect(alicePushes).toHaveLength(1);
  });

  test("index query with codec encoding: by_created with zx.date()", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);

    // Create notifications at different times
    await t.mutation(api.notifications.createEmail, {
      recipientId: userId,
      subject: "Old email",
      body: "Old",
    });
    await t.mutation(api.notifications.createInApp, {
      recipientId: userId,
      message: "Recent",
    });

    // Query by_created using wire format (number timestamp).
    // Inside the handler, zodvex decodes this to a Date, then the handler passes
    // the Date to .withIndex('by_created', q => q.gte('createdAt', after)).
    // The withIndex wrapper must encode the Date back to a number.
    const results = await t.query(api.notifications.listByCreated, {
      after: 0,
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    // createdAt should be wire format (number)
    expect(typeof results[0].createdAt).toBe("number");
    expect(results[0].createdAt).toBeGreaterThan(0);
  });
});
