// Pure rules for the name voice feature (kept apart from the Convex functions so they can be unit tested).

export const MAX_NAME_CLIPS_PER_FAMILY = 24;   // distinct custom names a family can have clips for
export const MAX_GENERATIONS_PER_FAMILY_DAY = 15;   // includes retries with a respelling
export const MAX_GENERATIONS_PER_DAY_EVERYONE = 3000;   // overall spending cap; also switch the feature off with VOICE_DISABLED=1
export const DAY_MS = 24 * 3600_000;

// Same slug as nameSlug() in index.html and tools/add-names.mjs, so the app finds the clip by the same key.
export const nameSlug = (n: string) => String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const nameClipKey = (name: string) => "nm_" + nameSlug(name);

// A first name: letters (any language), spaces, apostrophes, hyphens and dots; 1 to 24 characters.
export function cleanName(raw: unknown): string | null {
  const n = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!n || n.length > 24) return null;
  if (!/^[\p{L}][\p{L}\p{M} '’.-]*$/u.test(n)) return null;
  if (!nameSlug(n)) return null;
  return n;
}

// "Say it like": how a parent spells the pronunciation, e.g. "Sho-VAWN". Letters, spaces, hyphens, apostrophes, commas and dots; up to 40.
export function cleanRespell(raw: unknown): string | null {
  const n = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!n) return null;
  if (n.length > 40 || !/^[\p{L}][\p{L}\p{M} '’.,-]*$/u.test(n)) return null;
  return n;
}

export type Decision = { ok: true } | { ok: false; reason: "off" | "family-limit" | "name-limit" | "everyone-limit" };

// Whether one more generation is allowed. `existing` = this family's clip count, `isNew` = the name has no clip yet.
export function allowGeneration(o: { disabled: boolean; existing: number; isNew: boolean; familyToday: number; everyoneToday: number }): Decision {
  if (o.disabled) return { ok: false, reason: "off" };
  if (o.isNew && o.existing >= MAX_NAME_CLIPS_PER_FAMILY) return { ok: false, reason: "name-limit" };
  if (o.familyToday >= MAX_GENERATIONS_PER_FAMILY_DAY) return { ok: false, reason: "family-limit" };
  if (o.everyoneToday >= MAX_GENERATIONS_PER_DAY_EVERYONE) return { ok: false, reason: "everyone-limit" };
  return { ok: true };
}

export const REASON_TEXT: Record<string, string> = {
  "off": "Name voices are switched off right now.",
  "name-limit": "This family already has the most custom names it can have. Remove one first.",
  "family-limit": "That is enough new name voices for today. Try again tomorrow.",
  "everyone-limit": "Name voices are very busy right now. Try again tomorrow.",
};
