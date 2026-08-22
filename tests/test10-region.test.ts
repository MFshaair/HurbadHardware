// Test 10 (M2-1, data layer): in-process unit tests for `resolveRegion`
// in src/lib/region.ts. Pure function, no server/DB dependency — no
// `next dev` spawn needed, same pattern as test9-address-validation.test.ts.
import { describe, expect, it } from "vitest";
import { resolveRegion, InvalidRegionError } from "../src/lib/region";

describe("resolveRegion", () => {
  it("defaults to KE when NEXT_PUBLIC_REGION is unset", () => {
    expect(resolveRegion({})).toBe("KE");
  });

  it("defaults to KE when NEXT_PUBLIC_REGION is an empty string", () => {
    expect(resolveRegion({ NEXT_PUBLIC_REGION: "" })).toBe("KE");
  });

  it.each(["KE", "ET", "SO"])("accepts a valid configured region: %s", (region) => {
    expect(resolveRegion({ NEXT_PUBLIC_REGION: region })).toBe(region);
  });

  it("rejects (throws) an invalid configured region rather than silently defaulting", () => {
    expect(() => resolveRegion({ NEXT_PUBLIC_REGION: "US" })).toThrow(InvalidRegionError);
  });

  it("rejects a lowercase/miscased valid-looking value (case-sensitive match)", () => {
    expect(() => resolveRegion({ NEXT_PUBLIC_REGION: "ke" })).toThrow(InvalidRegionError);
  });
});
