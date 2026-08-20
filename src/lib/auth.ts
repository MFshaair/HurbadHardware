/**
 * better-auth configuration (AHD8 — do not hand-design an authentication
 * schema). This file exists at this stage only so `@better-auth/cli
 * generate` has something to introspect and produce the session/account/
 * verification Prisma models from. Full route wiring, email/password UI,
 * and middleware are U3/M1 scope (docs/agents/run-state.md), not part of
 * the v1->v3 schema rewrite this file supports.
 *
 * User.id is the shared join key between better-auth's generated tables
 * and this app's own `User` model (prisma/schema.prisma) — see AHD8.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    modelName: "User",
    fields: {
      name: "name",
      email: "email",
      emailVerified: "emailVerified",
      image: "avatar",
    },
    // Deliberately no additionalFields here: `phone` and `role` already
    // exist on the app-owned User model in prisma/schema.prisma (role as
    // a proper Prisma enum) — declaring them again here would make
    // better-auth try to manage columns this app's schema already owns
    // with a different, incompatible type.
  },
});
