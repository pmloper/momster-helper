// Generic per-family document store behind the app's sync layer.
// Paths look like "weeks/2026-10-05_k1", "buddies/k1", "settings/main", "family/main", "teams/2026-10-05".
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, QueryCtx } from "./_generated/server";

const MAX_BATCH = 100;

async function familyIdFor(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const member = await ctx.db.query("familyMembers").withIndex("by_user", q => q.eq("userId", userId)).first();
  return member ? member.familyId : null;
}

function checkPath(path: string) {
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(path)) throw new Error("Bad document path.");
}

// Everything except recorded voice clips (those can be large and are listed separately).
export const list = query({
  args: {},
  handler: async ctx => {
    const familyId = await familyIdFor(ctx);
    if (!familyId) return null; // null = not signed in or no family yet
    const rows = await ctx.db.query("docs").withIndex("by_family_path", q => q.eq("familyId", familyId)).collect();
    return rows.filter(r => !r.path.startsWith("voices/")).map(r => ({ path: r.path, data: r.data, updatedAt: r.updatedAt }));
  },
});

export const listVoices = query({
  args: {},
  handler: async ctx => {
    const familyId = await familyIdFor(ctx);
    if (!familyId) return null;
    const rows = await ctx.db.query("docs").withIndex("by_family_path", q => q.eq("familyId", familyId)).collect();
    return rows.filter(r => r.path.startsWith("voices/")).map(r => ({ path: r.path, data: r.data, updatedAt: r.updatedAt }));
  },
});

export const set = mutation({
  args: { path: v.string(), data: v.any() },
  handler: async (ctx, { path, data }) => {
    checkPath(path);
    const familyId = await familyIdFor(ctx);
    if (!familyId) throw new Error("Not signed in.");
    const existing = await ctx.db.query("docs").withIndex("by_family_path", q => q.eq("familyId", familyId).eq("path", path)).first();
    const updatedAt = Date.now();
    if (existing) await ctx.db.patch(existing._id, { data, updatedAt });
    else await ctx.db.insert("docs", { familyId, path, data, updatedAt });
  },
});

// Several documents in one round trip (used for the first upload of a family's existing data).
export const setMany = mutation({
  args: { items: v.array(v.object({ path: v.string(), data: v.any() })) },
  handler: async (ctx, { items }) => {
    if (items.length > MAX_BATCH) throw new Error("Too many documents in one batch.");
    const familyId = await familyIdFor(ctx);
    if (!familyId) throw new Error("Not signed in.");
    for (const { path, data } of items) {
      checkPath(path);
      const existing = await ctx.db.query("docs").withIndex("by_family_path", q => q.eq("familyId", familyId).eq("path", path)).first();
      const updatedAt = Date.now();
      if (existing) await ctx.db.patch(existing._id, { data, updatedAt });
      else await ctx.db.insert("docs", { familyId, path, data, updatedAt });
    }
  },
});

export const remove = mutation({
  args: { path: v.string() },
  handler: async (ctx, { path }) => {
    checkPath(path);
    const familyId = await familyIdFor(ctx);
    if (!familyId) throw new Error("Not signed in.");
    const existing = await ctx.db.query("docs").withIndex("by_family_path", q => q.eq("familyId", familyId).eq("path", path)).first();
    if (existing) await ctx.db.delete(existing._id);
  },
});
