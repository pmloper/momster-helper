// Delete a family's online data and sign-in accounts. Only the owner can do this.
// Call repeatedly until it returns { done: true } (large families are deleted in chunks).
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation } from "./_generated/server";

const CHUNK = 300;

export const deleteFamily = mutation({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in.");
    const me = await ctx.db.query("familyMembers").withIndex("by_user", q => q.eq("userId", userId)).first();
    if (!me) return { done: true };
    if (me.role !== "owner") throw new Error("Only the family owner can delete the family's data.");
    const familyId = me.familyId;

    // 1. Family data, a chunk per table. If anything was deleted we stop and ask to be called again.
    let removed = 0;
    const drop = async (rows: { _id: any }[]) => { for (const r of rows) { await ctx.db.delete(r._id); removed++; } };
    await drop(await ctx.db.query("docs").withIndex("by_family_path", q => q.eq("familyId", familyId)).take(CHUNK));
    for (const t of ["kids", "pins", "weeks", "buddies", "settings", "teamWeeks", "familyFlags"] as const) {
      const idx = t === "kids" ? "by_family" : t === "pins" ? "by_family" : t === "settings" ? "by_family" : t === "familyFlags" ? "by_family_key" : t === "teamWeeks" ? "by_family_week" : t === "weeks" ? "by_family_week" : "by_kid";
      if (t === "buddies") { // indexed by kid, not family: walk the family's kids
        const kids = await ctx.db.query("kids").withIndex("by_family", q => q.eq("familyId", familyId)).collect();
        for (const k of kids) await drop(await ctx.db.query("buddies").withIndex("by_kid", q => q.eq("kidId", k._id)).take(CHUNK));
      } else {
        await drop(await (ctx.db.query(t) as any).withIndex(idx, (q: any) => q.eq("familyId", familyId)).take(CHUNK));
      }
    }
    for (const c of await ctx.db.query("voiceClips").withIndex("by_family_key", q => q.eq("familyId", familyId)).take(CHUNK)) {
      await ctx.storage.delete(c.storageId); await ctx.db.delete(c._id); removed++;
    }
    await drop(await ctx.db.query("allowedEmails").withIndex("by_family", q => q.eq("familyId", familyId)).take(CHUNK));
    if (removed > 0) return { done: false };

    // 2. Everyone in the family: sessions, tokens, sign-in accounts and the user record.
    const members = await ctx.db.query("familyMembers").withIndex("by_family", q => q.eq("familyId", familyId)).collect();
    for (const m of members) {
      const sessions = await ctx.db.query("authSessions").withIndex("userId", q => q.eq("userId", m.userId)).collect();
      for (const s of sessions) {
        for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", q => q.eq("sessionId", s._id)).collect()) await ctx.db.delete(t._id);
        await ctx.db.delete(s._id);
      }
      const accounts = await ctx.db.query("authAccounts").withIndex("userIdAndProvider", q => q.eq("userId", m.userId)).collect();
      for (const a of accounts) {
        for (const c of await ctx.db.query("authVerificationCodes").withIndex("accountId", q => q.eq("accountId", a._id)).collect()) await ctx.db.delete(c._id);
        await ctx.db.delete(a._id);
      }
      await ctx.db.delete(m._id);
      await ctx.db.delete(m.userId);
    }
    await ctx.db.delete(familyId);
    return { done: true };
  },
});
