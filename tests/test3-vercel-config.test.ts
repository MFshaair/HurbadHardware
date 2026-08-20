// Test 3: Vercel deployment succeeds for Kenya region; env vars injected
// correctly.
//
// A real `vercel --prod` deployment requires an authenticated Vercel
// account with a project linked (`vercel link`), which this automated test
// suite cannot perform. Instead this validates the deployment
// configuration that governs that deployment: vercel.json is well-formed
// and matches the multi-region plan, and the Kenya region env file defines
// the variables the running app depends on at request time.
//
// See README.md "Deployment" section for the manual `vercel link` / `vercel
// --prod` steps a human operator must run once per region project.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

describe("vercel.json", () => {
  const config = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));

  it("targets the Next.js framework", () => {
    expect(config.framework).toBe("nextjs");
  });

  it("auto-deploys on push to main", () => {
    expect(config.git?.deploymentEnabled?.main).toBe(true);
  });

  it("pins a function region matching eu-west-1 (Kenya primary / Somalia)", () => {
    // dub1 (Dublin) is Vercel's eu-west-1-equivalent region.
    expect(config.regions).toContain("dub1");
  });

  it("runs prisma generate before build so the client is available at build time", () => {
    expect(config.buildCommand).toContain("prisma generate");
  });
});

describe("Kenya region environment file", () => {
  const env = readFileSync(path.join(root, ".env.production.kenya"), "utf8");

  it("pins the region to KE", () => {
    expect(env).toMatch(/NEXT_PUBLIC_REGION="KE"/);
  });

  it("sets KES as the default currency", () => {
    expect(env).toMatch(/NEXT_PUBLIC_DEFAULT_CURRENCY="KES"/);
  });

  it("sets the 16% VAT rate", () => {
    expect(env).toMatch(/TAX_RATE="0\.16"/);
  });

  it("points AWS_REGION at eu-west-1 (primary RDS region)", () => {
    expect(env).toMatch(/AWS_REGION="eu-west-1"/);
  });
});
