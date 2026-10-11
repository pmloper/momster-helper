// Fixed-window counters used to limit how many sign-in emails can be sent.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { nextCounter } from "./throttleLogic";

// Returns true if the action is allowed (and counts it), false if the limit for this window is used up.
export const hit = internalMutation({
  args: { key: v.string(), limit: v.number(), windowMs: v.number() },
  handler: async (ctx, { key, limit, windowMs }) => {
    const row = await ctx.db.query("throttle").withIndex("by_key", q => q.eq("key", key)).first();
    const { allowed, next } = nextCounter(row, Date.now(), limit, windowMs);
    if (allowed) {
      if (row) await ctx.db.patch(row._id, next);
      else await ctx.db.insert("throttle", { key, ...next });
    }
    return allowed;
  },
});
