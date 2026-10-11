import { convexAuth } from "@convex-dev/auth/server";
import { EmailCode } from "./authEmail";
import { internal } from "./_generated/api";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [EmailCode],
  signIn: { maxFailedAttempsPerHour: 5 },
  callbacks: {
    // First verified sign-in: join the family that pre-approved this email, otherwise start a new family.
    async afterUserCreatedOrUpdated(ctx, { userId }) {
      await ctx.runMutation(internal.families.linkUser, { userId });
    },
  },
});
