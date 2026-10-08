import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query, QueryCtx } from "./_generated/server";

const DEFAULT_TIMEZONE = "America/New_York";

async function membershipFor(ctx: QueryCtx, userId: any) {
  return await ctx.db.query("familyMembers").withIndex("by_user", q => q.eq("userId", userId)).first();
}

// Called after every verified sign-in; does nothing for users who already belong to a family.
export const linkUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    if (await membershipFor(ctx, userId)) return;
    const user = await ctx.db.get(userId);
    const email = user?.email?.trim().toLowerCase();
    if (email) {
      const allowed = await ctx.db.query("allowedEmails").withIndex("by_email", q => q.eq("email", email)).first();
      if (allowed) {
        await ctx.db.insert("familyMembers", { familyId: allowed.familyId, userId, role: "member" });
        return;
      }
    }
    const familyId = await ctx.db.insert("families", { ownerUserId: userId, timezone: DEFAULT_TIMEZONE, setupDone: false });
    await ctx.db.insert("familyMembers", { familyId, userId, role: "owner" });
  },
});

export const myFamily = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const member = await membershipFor(ctx, userId);
    if (!member) return null;
    const family = await ctx.db.get(member.familyId);
    if (!family) return null;
    const allowed = member.role === "owner"
      ? (await ctx.db.query("allowedEmails").withIndex("by_family", q => q.eq("familyId", family._id)).collect()).map(a => a.email)
      : [];
    return { familyId: family._id, role: member.role, timezone: family.timezone, setupDone: family.setupDone, allowedEmails: allowed };
  },
});

async function requireOwner(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in.");
  const member = await ctx.db.query("familyMembers").withIndex("by_user", (q: any) => q.eq("userId", userId)).first();
  if (!member || member.role !== "owner") throw new Error("Only the family owner can do that.");
  return member;
}

export const addAllowedEmail = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const owner = await requireOwner(ctx);
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("That does not look like an email address.");
    // An email can only belong to one family.
    const taken = await ctx.db.query("allowedEmails").withIndex("by_email", q => q.eq("email", e)).first();
    if (taken) { if (taken.familyId === owner.familyId) return; throw new Error("That email is already used by another family."); }
    await ctx.db.insert("allowedEmails", { familyId: owner.familyId, email: e });
  },
});

export const removeAllowedEmail = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const owner = await requireOwner(ctx);
    const e = email.trim().toLowerCase();
    const row = await ctx.db.query("allowedEmails").withIndex("by_email", q => q.eq("email", e)).first();
    if (row && row.familyId === owner.familyId) await ctx.db.delete(row._id);
  },
});
