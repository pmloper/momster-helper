// Sends the one-time sign-in code. Swappable: only this file knows how the email leaves the system.
//
// Environment variables (set in the Convex dashboard, never in the repo):
//   AUTH_EMAIL_WEBHOOK_URL     GoHighLevel inbound webhook that sends the email. If unset, the code is only logged (dev).
//   AUTH_EMAIL_WEBHOOK_SECRET  Optional shared secret sent as the x-webhook-secret header.
import { Email } from "@convex-dev/auth/providers/Email";

const CODE_MINUTES = 10;

// 6 digits from a cryptographically secure source (no modulo bias).
async function generateCode(): Promise<string> {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  let n: number;
  do { crypto.getRandomValues(buf); n = buf[0]; } while (n >= limit);
  return String(n % 1_000_000).padStart(6, "0");
}

export async function sendAuthEmail(email: string, code: string): Promise<void> {
  const url = process.env.AUTH_EMAIL_WEBHOOK_URL;
  if (!url) {
    console.log(`[auth email disabled] sign-in code for ${email}: ${code}`);
    return;
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.AUTH_EMAIL_WEBHOOK_SECRET) headers["x-webhook-secret"] = process.env.AUTH_EMAIL_WEBHOOK_SECRET;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, code, expiresInMinutes: CODE_MINUTES, app: "Momster Helper" }),
  });
  if (!res.ok) throw new Error(`Could not send the sign-in email (webhook returned ${res.status}).`);
}

export const EmailCode = Email({
  id: "email-code",
  maxAge: CODE_MINUTES * 60,
  generateVerificationToken: generateCode,
  normalizeIdentifier: (email: string) => email.trim().toLowerCase(),
  // The default check compares the typed email with the stored one exactly; compare them normalized instead.
  authorize: async (params, account) => {
    if (typeof params.email !== "string" || params.email.trim().toLowerCase() !== account.providerAccountId) {
      throw new Error("The email must match the one the code was sent to.");
    }
  },
  async sendVerificationRequest({ identifier: email, token }) {
    await sendAuthEmail(email, token);
  },
});
