// DRAFT Convex schema for Momster Helper. Not wired into the app yet and not yet checked
// against the Convex CLI (run `npx convex dev` to validate). See convex/README.md for how each
// table maps to today's localStorage keys.
import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

// Day-keyed records use "YYYY-MM-DD" strings; weeks are keyed by their Monday ("YYYY-MM-DD").
const dayList = v.record(v.string(), v.array(v.string()));

export default defineSchema({
  ...authTables, // users, sessions, accounts (email code sign-in)

  // One household. The first parent to sign up creates it and is the owner.
  families: defineTable({
    name: v.optional(v.string()),
    ownerUserId: v.id("users"),
    timezone: v.string(), // IANA name; the server decides week boundaries (Monday) from this
    setupDone: v.boolean(),
    // Family-edited lists (today FAMILY.jobs / helper / prizes / picks in localStorage).
    jobs: v.optional(v.any()),    // { am: Job[], pm: Job[], bt: Job[] }
    helper: v.optional(v.any()),  // Job[]
    prizes: v.optional(v.any()),  // Prize[]
    picks: v.optional(v.any()),   // special-mission list
  }).index("by_owner", ["ownerUserId"]),

  // Which signed-in users belong to which family. One family per user in version one.
  familyMembers: defineTable({
    familyId: v.id("families"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("member")),
  })
    .index("by_user", ["userId"])
    .index("by_family", ["familyId"]),

  // Emails the owner has pre-approved. Signing in with one of these joins the family.
  allowedEmails: defineTable({
    familyId: v.id("families"),
    email: v.string(), // stored lowercased
  })
    .index("by_email", ["email"])
    .index("by_family", ["familyId"]),

  kids: defineTable({
    familyId: v.id("families"),
    name: v.string(),
    avatar: v.string(),
    color: v.string(),
    order: v.number(),
  }).index("by_family", ["familyId", "order"]),

  // Grown-ups PIN: a salted hash only, checked inside a Convex function. Never sent to clients.
  pins: defineTable({
    familyId: v.id("families"),
    hash: v.string(),
    salt: v.string(),
  }).index("by_family", ["familyId"]),

  // One row per kid per week (localStorage: starjobs_w_<WEEK>_<kidId>).
  weeks: defineTable({
    familyId: v.id("families"),
    kidId: v.id("kids"),
    weekStart: v.string(),
    done: dayList,                                   // day -> completed job ids
    bonus: v.number(),
    reward: v.optional(v.string()),
    reward2: v.optional(v.string()),
    rewardGiven: v.boolean(),
    extra: v.record(v.string(), v.array(v.any())),   // day -> bonus jobs asked for / approved
    race: v.record(v.string(), v.boolean()),         // day -> beat the clock
    pick: v.optional(v.object({ day: v.string(), id: v.string() })),
  }).index("by_kid_week", ["kidId", "weekStart"])
    .index("by_family_week", ["familyId", "weekStart"]),

  // Hero helper, coins and collections (localStorage: starjobs_buddy_<kidId>).
  buddies: defineTable({
    familyId: v.id("families"),
    kidId: v.id("kids"),
    made: v.boolean(),
    look: v.record(v.string(), v.string()),
    wear: v.record(v.string(), v.string()),
    owned: v.array(v.string()),
    spent: v.number(),
    bonusCoins: v.number(),
    monsters: v.array(v.string()),     // weeks whose villain this kid helped bust
    stickers: v.array(v.string()),
    stickersInit: v.boolean(),
    dances: v.number(),
    eggs: v.record(v.string(), v.string()),
    base: v.optional(v.any()),
  }).index("by_kid", ["kidId"]),

  // Family-wide settings (localStorage: starjobs_settings), without the PIN.
  settings: defineTable({
    familyId: v.id("families"),
    goal: v.number(),
    kidVoice: v.record(v.string(), v.string()),      // kid id -> voice folder
    heroStyle: v.record(v.string(), v.string()),
    avatars: v.record(v.string(), v.string()),
    bonusJobs: v.optional(v.array(v.any())),
    teamPrize: v.optional(v.object({ e: v.string(), t: v.string() })),
    event: v.optional(v.any()),                      // active surprise mission
    toots: v.boolean(),
    raceOff: v.boolean(),                            // absent/false = Morning Race on
    // Leave-by times; per-kid overrides fall back to the family values.
    walkEnd: v.optional(v.string()),
    busEnd: v.optional(v.string()),
    driveEnd: v.optional(v.string()),
    raceEnd: v.optional(v.string()),
    kidEnds: v.optional(v.record(v.string(), v.record(v.string(), v.string()))),
    rideMode: v.optional(v.string()),
    rideDate: v.optional(v.string()),
    driveDate: v.optional(v.string()),
    launched: v.optional(v.string()),
  }).index("by_family", ["familyId"]),

  // Weekly team prize handed out (localStorage: not persisted today).
  teamWeeks: defineTable({
    familyId: v.id("families"),
    weekStart: v.string(),
    given: v.boolean(),
  }).index("by_family_week", ["familyId", "weekStart"]),

  // Small shared flags and counters that are currently separate localStorage keys:
  // streaks, mystery egg uses, toots, rankSeen, "intro shown this week", "mission dismissed today"...
  // Per-device preferences (volume, voice level, read mode) stay in localStorage.
  familyFlags: defineTable({
    familyId: v.id("families"),
    key: v.string(),
    value: v.any(),
  }).index("by_family_key", ["familyId", "key"]),

  // Generic document store used by the app's existing sync layer (paths like "weeks/2026-10-05_k1", "buddies/k1",
  // "settings/main", "family/main", "teams/2026-10-05", "voices/<key>"). The typed tables above are the later,
  // stricter model; this keeps the first release small and lets the app's data shapes evolve without migrations.
  docs: defineTable({
    familyId: v.id("families"),
    path: v.string(),
    data: v.any(),
    updatedAt: v.number(),
  }).index("by_family_path", ["familyId", "path"]),

  // Counters for abuse limits (sign-in emails per address, and overall).
  throttle: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  // Generated clips for text a family wrote (custom jobs, prizes, missions) and for kid names that are not in the shipped list.
  // `key` is textKey(text) from index.html (or nm_<slug> for a name), so the app finds the clip by the same name as the shipped ones.
  voiceClips: defineTable({
    familyId: v.id("families"),
    key: v.string(),
    voice: v.string(),
    text: v.string(),
    respell: v.optional(v.string()),   // how it was said, if the parent gave a pronunciation
    storageId: v.id("_storage"),
    createdAt: v.optional(v.number()),
  }).index("by_family_key", ["familyId", "key", "voice"]).index("by_family", ["familyId"]),

  // One row per attempt to generate a voice clip: who, what, how many characters, and whether it worked (spending ledger).
  voiceUsage: defineTable({
    familyId: v.id("families"),
    kind: v.string(),            // "name"
    chars: v.number(),
    at: v.number(),
    ok: v.boolean(),
    note: v.optional(v.string()),
  }).index("by_family_at", ["familyId", "at"]).index("by_at", ["at"]),
});
