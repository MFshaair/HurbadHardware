import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Runs on Node (not edge) — this route uses Prisma via `auth`.
export const { GET, POST } = toNextJsHandler(auth);
