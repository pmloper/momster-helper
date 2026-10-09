// Name voices: a kid's name that is not in the shipped list is generated in Momster's voice when the family enters it.
// The app stitches the clip between the shipped lead-in and tail (see "Kid names" in audio/README.md).
//
// Environment variables (set in the Convex dashboard, never committed):
//   ELEVENLABS_API_KEY     required; a restricted key with only text-to-speech access and a monthly credit cap
//   ELEVENLABS_VOICE_ID    optional; defaults to the voice the shipped clips use
//   ELEVENLABS_MODEL_ID    optional; defaults to eleven_v4
//   VOICE_DISABLED=1       optional kill switch
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { REASON_TEXT, allowGeneration, cleanName, cleanRespell, nameClipKey, DAY_MS } from "./voiceLogic";

const DEFAULT_VOICE_ID = "iukn3a1vSSNFmdi5NZS4";   // the Momster voice (same one tools/generate-clips.mjs uses)
const VOICE = "momster";

async function familyIdFor(ctx: any): Promise<any | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const member = await ctx.db.query("familyMembers").withIndex("by_user", (q: any) => q.eq("userId", userId)).first();
  return member ? member.familyId : null;
}

// The signed-in family's generated name clips, with a link to each file.
export const myNameClips = query({
  args: {},
  handler: async ctx => {
    const familyId = await familyIdFor(ctx);
    if (!familyId) return [];
    const rows = await ctx.db.query("voiceClips").withIndex("by_family", (q: any) => q.eq("familyId", familyId)).collect();
    const out = [];
    for (const r of rows) {
      if (!r.key.startsWith("nm_")) continue;
      const url = await ctx.storage.getUrl(r.storageId);
      if (url) out.push({ key: r.key, text: r.text, respell: r.respell ?? null, url });
    }
    return out;
  },
});

// Checks the limits and, if allowed, records the attempt before any money is spent. Returns what the action needs.
export const reserve = internalMutation({
  args: { userId: v.id("users"), key: v.string(), chars: v.number() },
  handler: async (ctx, { userId, key, chars }) => {
    const member = await ctx.db.query("familyMembers").withIndex("by_user", q => q.eq("userId", userId)).first();
    if (!member) return { ok: false as const, reason: "no-family" };
    const familyId = member.familyId;
    const clips = await ctx.db.query("voiceClips").withIndex("by_family", q => q.eq("familyId", familyId)).collect();
    const nameClips = clips.filter(c => c.key.startsWith("nm_"));
    const since = Date.now() - DAY_MS;
    const familyToday = (await ctx.db.query("voiceUsage").withIndex("by_family_at", q => q.eq("familyId", familyId).gte("at", since)).collect()).length;
    const everyoneToday = (await ctx.db.query("voiceUsage").withIndex("by_at", q => q.gte("at", since)).take(5000)).length;
    const d = allowGeneration({ disabled: process.env.VOICE_DISABLED === "1", existing: nameClips.length, isNew: !nameClips.some(c => c.key === key), familyToday, everyoneToday });
    if (!d.ok) return { ok: false as const, reason: d.reason };
    const usageId = await ctx.db.insert("voiceUsage", { familyId, kind: "name", chars, at: Date.now(), ok: false });
    return { ok: true as const, familyId, usageId };
  },
});

export const finish = internalMutation({
  args: { familyId: v.id("families"), usageId: v.id("voiceUsage"), key: v.string(), text: v.string(), respell: v.optional(v.string()), storageId: v.id("_storage") },
  handler: async (ctx, a) => {
    const old = await ctx.db.query("voiceClips").withIndex("by_family_key", q => q.eq("familyId", a.familyId).eq("key", a.key).eq("voice", VOICE)).first();
    if (old) { await ctx.storage.delete(old.storageId); await ctx.db.delete(old._id); }
    await ctx.db.insert("voiceClips", { familyId: a.familyId, key: a.key, voice: VOICE, text: a.text, respell: a.respell, storageId: a.storageId, createdAt: Date.now() });
    await ctx.db.patch(a.usageId, { ok: true });
    return await ctx.storage.getUrl(a.storageId);
  },
});

export const failed = internalMutation({
  args: { usageId: v.id("voiceUsage"), note: v.string() },
  handler: async (ctx, { usageId, note }) => { await ctx.db.patch(usageId, { note: note.slice(0, 200) }); },
});

export const existing = internalQuery({
  args: { userId: v.id("users"), key: v.string() },
  handler: async (ctx, { userId, key }) => {
    const member = await ctx.db.query("familyMembers").withIndex("by_user", q => q.eq("userId", userId)).first();
    if (!member) return null;
    const row = await ctx.db.query("voiceClips").withIndex("by_family_key", q => q.eq("familyId", member.familyId).eq("key", key).eq("voice", VOICE)).first();
    return row ? { text: row.text, respell: row.respell ?? null, url: await ctx.storage.getUrl(row.storageId) } : null;
  },
});

// Make (or remake) the clip for one kid name. `respell` is how a parent wants it said ("Sho-VAWN").
// Returns { ok: true, key, url } or { ok: false, error } with a message that is safe to show.
export const requestName = action({
  args: { name: v.string(), respell: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: true; key: string; url: string | null } | { ok: false; error: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { ok: false, error: "Sign in first." };
    const name = cleanName(args.name);
    if (!name) return { ok: false, error: "That name has characters we cannot say. Use letters only." };
    const respell = args.respell === undefined || args.respell.trim() === "" ? undefined : cleanRespell(args.respell) ?? null;
    if (respell === null) return { ok: false, error: "Spell how it sounds with letters, spaces and hyphens only." };
    const key = nameClipKey(name);
    const have = await ctx.runQuery(internal.voice.existing, { userId, key });
    if (have && have.url && (have.respell ?? undefined) === respell && have.text === name) return { ok: true, key, url: have.url };
    const say = respell ?? name;
    const r = await ctx.runMutation(internal.voice.reserve, { userId, key, chars: say.length });
    if (!r.ok) return { ok: false, error: REASON_TEXT[r.reason] || "Name voices are not available right now." };
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) { await ctx.runMutation(internal.voice.failed, { usageId: r.usageId, note: "no key" }); return { ok: false, error: "Name voices are not set up yet." }; }
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ text: say, model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_v4", voice_settings: { stability: 0.32 } }),
      });
      if (!res.ok) { await ctx.runMutation(internal.voice.failed, { usageId: r.usageId, note: "http " + res.status }); return { ok: false, error: "The voice service said no. Try again in a bit." }; }
      const audio = await res.arrayBuffer();
      if (audio.byteLength < 500) { await ctx.runMutation(internal.voice.failed, { usageId: r.usageId, note: "tiny audio" }); return { ok: false, error: "That did not come out. Try again." }; }
      const storageId = await ctx.storage.store(new Blob([audio], { type: "audio/mpeg" }));
      const url = await ctx.runMutation(internal.voice.finish, { familyId: r.familyId, usageId: r.usageId, key, text: name, respell: respell ?? undefined, storageId });
      return { ok: true, key, url };
    } catch (e) {
      await ctx.runMutation(internal.voice.failed, { usageId: r.usageId, note: "network" });
      return { ok: false, error: "Could not reach the voice service. Try again in a bit." };
    }
  },
});

// Drop a name clip (a kid was removed or renamed). Anyone in the family can do this.
export const removeName = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const familyId = await familyIdFor(ctx);
    if (!familyId) return;
    const key = nameClipKey(name);
    const row = await ctx.db.query("voiceClips").withIndex("by_family_key", q => q.eq("familyId", familyId).eq("key", key).eq("voice", VOICE)).first();
    if (row) { await ctx.storage.delete(row.storageId); await ctx.db.delete(row._id); }
  },
});

// Setup check you can run from a terminal: `npx convex run voice:selfTest`. Says one short word and reports whether the key and voice work.
export const selfTest = internalAction({
  args: {},
  handler: async () => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return { keySet: false };
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID}?output_format=mp3_22050_32`, {
      method: "POST", headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ text: "Hi", model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_v4", voice_settings: { stability: 0.32 } }) });
    const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
    return { keySet: true, status: res.status, audioBytes: bytes, disabled: process.env.VOICE_DISABLED === "1" };
  },
});
