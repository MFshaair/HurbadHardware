import { Region } from "@prisma/client";

const VALID_REGIONS = new Set(Object.values(Region));

export type AddressInput = {
  fullName?: unknown;
  phone?: unknown;
  region?: unknown;
  city?: unknown;
  postalCode?: unknown;
  street?: unknown;
  isDefault?: unknown;
};

export type ValidatedAddress = {
  fullName: string;
  phone: string;
  region: Region;
  city: string;
  postalCode: string;
  street: string;
  isDefault: boolean;
};

/**
 * Shared address-body validation for POST /api/addresses (all fields
 * required) and PATCH /api/addresses/[id] (all fields optional, only
 * supplied fields are validated/returned).
 */
export function validateAddressBody(
  body: AddressInput,
  { partial = false }: { partial?: boolean } = {},
): { error: string } | { data: Partial<ValidatedAddress> } {
  const { fullName, phone, region, city, postalCode, street, isDefault } = body;
  const data: Partial<ValidatedAddress> = {};

  if (fullName !== undefined || !partial) {
    if (typeof fullName !== "string" || fullName.trim().length === 0) {
      return { error: "fullName is required" };
    }
    data.fullName = fullName.trim();
  }

  if (phone !== undefined || !partial) {
    if (typeof phone !== "string" || phone.trim().length === 0) {
      return { error: "phone is required" };
    }
    data.phone = phone.trim();
  }

  if (region !== undefined || !partial) {
    if (typeof region !== "string" || !VALID_REGIONS.has(region as Region)) {
      return { error: `region must be one of: ${Array.from(VALID_REGIONS).join(", ")}` };
    }
    data.region = region as Region;
  }

  if (city !== undefined || !partial) {
    if (typeof city !== "string" || city.trim().length === 0) {
      return { error: "city is required" };
    }
    data.city = city.trim();
  }

  if (postalCode !== undefined || !partial) {
    if (typeof postalCode !== "string" || postalCode.trim().length === 0) {
      return { error: "postalCode is required" };
    }
    data.postalCode = postalCode.trim();
  }

  if (street !== undefined || !partial) {
    if (typeof street !== "string" || street.trim().length === 0) {
      return { error: "street is required" };
    }
    data.street = street.trim();
  }

  if (isDefault !== undefined) {
    if (typeof isDefault !== "boolean") {
      return { error: "isDefault must be a boolean" };
    }
    data.isDefault = isDefault;
  } else if (!partial) {
    data.isDefault = false;
  }

  return { data };
}
