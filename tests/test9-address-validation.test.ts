// Test 9 (M1-3 security fix, F1): in-process unit tests for
// `validateAddressBody` in src/lib/addressValidation.ts.
//
// Unlike tests/test8-profile-addresses.test.ts, this file imports the
// validation function directly and calls it in-process — no `next dev`
// spawn needed, since this module is a pure function with no server/
// framework dependency (only imports the `Region` enum from
// @prisma/client). See vitest.config.mts's coverage-exclude comment for
// why this file is no longer excluded from coverage.
import { describe, expect, it } from "vitest";
import { validateAddressBody, type AddressInput } from "../src/lib/addressValidation";

const validFull: AddressInput = {
  fullName: "Jane Doe",
  phone: "+254700000000",
  region: "KE",
  city: "Nairobi",
  postalCode: "00100",
  street: "1 Test St",
};

describe("validateAddressBody — region", () => {
  it("rejects an invalid/unlisted region value", () => {
    const result = validateAddressBody({ ...validFull, region: "US" });
    expect("error" in result).toBe(true);
  });

  it.each(["KE", "ET", "SO"])("accepts a valid region value: %s", (region) => {
    const result = validateAddressBody({ ...validFull, region });
    expect("error" in result).toBe(false);
    if ("data" in result) {
      expect(result.data.region).toBe(region);
    }
  });
});

describe("validateAddressBody — partial updates", () => {
  it("skips omitted fields rather than requiring them when partial:true", () => {
    const result = validateAddressBody({ city: "Mombasa" }, { partial: true });
    expect("error" in result).toBe(false);
    if ("data" in result) {
      expect(result.data).toEqual({ city: "Mombasa" });
      expect(result.data.fullName).toBeUndefined();
      expect(result.data.phone).toBeUndefined();
      expect(result.data.region).toBeUndefined();
      expect(result.data.postalCode).toBeUndefined();
      expect(result.data.street).toBeUndefined();
      expect(result.data.isDefault).toBeUndefined();
    }
  });

  it("still requires all fields when partial is false/omitted", () => {
    const { fullName, ...rest } = validFull;
    void fullName;
    const result = validateAddressBody(rest as AddressInput);
    expect("error" in result).toBe(true);
  });
});

describe("validateAddressBody — isDefault", () => {
  it("rejects a non-boolean isDefault value", () => {
    const result = validateAddressBody({ ...validFull, isDefault: "true" });
    expect("error" in result).toBe(true);
  });

  it("defaults isDefault to false when omitted on a full (non-partial) body", () => {
    const result = validateAddressBody(validFull);
    expect("error" in result).toBe(false);
    if ("data" in result) {
      expect(result.data.isDefault).toBe(false);
    }
  });

  it("leaves isDefault untouched (absent from data) when omitted on a partial update", () => {
    const result = validateAddressBody({ city: "Kisumu" }, { partial: true });
    expect("error" in result).toBe(false);
    if ("data" in result) {
      expect("isDefault" in result.data).toBe(false);
    }
  });

  it("accepts a valid boolean isDefault", () => {
    const result = validateAddressBody({ ...validFull, isDefault: true });
    expect("error" in result).toBe(false);
    if ("data" in result) {
      expect(result.data.isDefault).toBe(true);
    }
  });
});

describe("validateAddressBody — no client-trusted userId", () => {
  it("drops an injected userId key from the validated output", () => {
    const withInjectedUserId = { ...validFull, userId: "attacker-controlled-user-id" } as AddressInput & {
      userId: string;
    };
    const result = validateAddressBody(withInjectedUserId);
    expect("error" in result).toBe(false);
    if ("data" in result) {
      expect(result.data).not.toHaveProperty("userId");
      expect(Object.keys(result.data)).not.toContain("userId");
    }
  });

  it("drops an injected userId key on a partial update too", () => {
    const result = validateAddressBody(
      { city: "Eldoret", userId: "attacker-controlled-user-id" } as AddressInput & { userId: string },
      { partial: true },
    );
    expect("error" in result).toBe(false);
    if ("data" in result) {
      expect(result.data).not.toHaveProperty("userId");
    }
  });
});
