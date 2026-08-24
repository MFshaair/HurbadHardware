"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useCheckoutDraft } from "../CheckoutDraftContext";
import type { NewAddressDraft } from "@/lib/checkoutDraft";

type Region = "KE" | "ET" | "SO";

// Narrow, client-safe shape — never the raw Prisma Address row (no
// userId/createdAt/updatedAt), same discipline as
// src/app/profile/AddressManager.tsx's own `Address` type.
type SavedAddress = {
  id: string;
  fullName: string;
  phone: string;
  region: Region;
  city: string;
  postalCode: string;
  street: string;
  isDefault: boolean;
};

const REGIONS: Region[] = ["KE", "ET", "SO"];

const emptyForm: NewAddressDraft = {
  fullName: "",
  phone: "",
  region: "KE",
  city: "",
  postalCode: "",
  street: "",
};

/**
 * `/checkout/address` (M3-3a). Authenticated users see their saved
 * `Address` rows (already scoped server-side by the page) and can pick
 * one, or fill in a new one; guests only ever see the create-new form.
 *
 * `POST /api/addresses` is called ONLY when the user is authenticated AND
 * explicitly checks "Save this address for next time" — never
 * automatically, and never at all for a guest (ADR Decision 8 / this
 * item's own test requirement).
 */
export default function AddressStep({
  isAuthenticated,
  initialAddresses,
}: {
  isAuthenticated: boolean;
  initialAddresses: SavedAddress[];
}) {
  const router = useRouter();
  const { draft, isHydrated, selectSavedAddress, setNewAddress } = useCheckoutDraft();

  const [addresses] = useState(initialAddresses);
  const [mode, setMode] = useState<"saved" | "new">(
    isAuthenticated && initialAddresses.length > 0 ? "saved" : "new",
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initialAddresses.find((a) => a.isDefault)?.id ?? initialAddresses[0]?.id ?? null,
  );
  const [form, setForm] = useState<NewAddressDraft>(emptyForm);
  const [saveNewAddress, setSaveNewAddress] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Rehydrate the local form/mode from a previously-persisted draft once
  // the provider has hydrated (ADR Decision 5 — never read storage during
  // render; this effect only runs client-side, after `isHydrated` flips).
  useEffect(() => {
    if (!isHydrated) return;
    if (draft.addressMode === "saved" && draft.savedAddressId) {
      setMode("saved");
      setSelectedId(draft.savedAddressId);
    } else if (draft.addressMode === "new" && draft.newAddress) {
      setMode("new");
      setForm(draft.newAddress);
      setSaveNewAddress(draft.saveNewAddress);
    }
    // Only on the initial hydration flip — the user's own subsequent
    // edits are the source of truth after that, not another effect run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]);

  function handleSelectSaved(id: string) {
    setMode("saved");
    setSelectedId(id);
  }

  async function handleContinue(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);

    if (mode === "saved") {
      if (!selectedId) {
        setSaveError("Select an address to continue.");
        return;
      }
      selectSavedAddress(selectedId);
      router.push("/checkout/payment");
      return;
    }

    // New/guest address: validate the same required fields the server
    // enforces (src/lib/addressValidation.ts), then store it in the draft.
    // A price/region/tax value is NEVER derived from this form.
    const requiredFilled = Object.values(form).every((v) => v.trim().length > 0);
    if (!requiredFilled) {
      setSaveError("Please fill in all address fields.");
      return;
    }

    if (isAuthenticated && saveNewAddress) {
      setSaving(true);
      try {
        const res = await fetch("/api/addresses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, isDefault: false }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setSaveError(typeof body?.error === "string" ? body.error : "Unable to save address.");
          setSaving(false);
          return;
        }
      } catch {
        setSaveError("Network error — could not save address. Please try again.");
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    setNewAddress(form, isAuthenticated && saveNewAddress);
    router.push("/checkout/payment");
  }

  if (!isHydrated) {
    // Neutral pending state — never render a "no selection" flash before
    // the draft has had a chance to rehydrate (ADR Decision 5).
    return <p className="mt-6 text-sm text-gray-500">Loading…</p>;
  }

  return (
    <form onSubmit={handleContinue} className="mt-6 flex flex-col gap-6">
      {isAuthenticated && addresses.length > 0 && (
        <fieldset className="flex flex-col gap-3 rounded border border-gray-200 p-4">
          <legend className="px-1 text-sm font-medium">Saved addresses</legend>
          <ul className="flex flex-col gap-3" aria-label="Saved addresses">
            {addresses.map((address) => (
              <li key={address.id}>
                <label
                  className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded border border-gray-200 p-3 text-sm has-[:checked]:border-black"
                  data-testid="saved-address-option"
                >
                  <input
                    type="radio"
                    name="saved-address"
                    className="mt-1 h-5 w-5"
                    checked={mode === "saved" && selectedId === address.id}
                    onChange={() => handleSelectSaved(address.id)}
                  />
                  <span>
                    <span className="block font-medium">
                      {address.fullName} {address.isDefault && "(default)"}
                    </span>
                    <span className="block text-gray-600">
                      {address.street}, {address.city}, {address.region} {address.postalCode}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setMode("new")}
            className="min-h-[44px] self-start text-sm font-medium underline"
            data-testid="use-new-address"
          >
            Use a different address
          </button>
        </fieldset>
      )}

      {mode === "new" && (
        <fieldset className="flex flex-col gap-3 rounded border border-gray-200 p-4">
          <legend className="px-1 text-sm font-medium">
            {isAuthenticated && addresses.length > 0 ? "New address" : "Delivery address"}
          </legend>

          <div className="flex flex-col gap-1">
            <label htmlFor="co-fullName" className="text-sm font-medium">
              Full name
            </label>
            <input
              id="co-fullName"
              required
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="min-h-[44px] rounded border border-gray-300 px-3 py-2"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="co-phone" className="text-sm font-medium">
              Phone
            </label>
            <input
              id="co-phone"
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="min-h-[44px] rounded border border-gray-300 px-3 py-2"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="co-region" className="text-sm font-medium">
              Region
            </label>
            <select
              id="co-region"
              required
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value as Region })}
              className="min-h-[44px] rounded border border-gray-300 px-3 py-2"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="co-city" className="text-sm font-medium">
              City
            </label>
            <input
              id="co-city"
              required
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              className="min-h-[44px] rounded border border-gray-300 px-3 py-2"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="co-postalCode" className="text-sm font-medium">
              Postal code
            </label>
            <input
              id="co-postalCode"
              required
              value={form.postalCode}
              onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
              className="min-h-[44px] rounded border border-gray-300 px-3 py-2"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="co-street" className="text-sm font-medium">
              Street
            </label>
            <input
              id="co-street"
              required
              value={form.street}
              onChange={(e) => setForm({ ...form, street: e.target.value })}
              className="min-h-[44px] rounded border border-gray-300 px-3 py-2"
            />
          </div>

          {isAuthenticated && (
            <label className="flex min-h-[44px] items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={saveNewAddress}
                onChange={(e) => setSaveNewAddress(e.target.checked)}
                data-testid="save-address-checkbox"
              />
              Save this address for next time
            </label>
          )}
        </fieldset>
      )}

      {saveError && (
        <p role="alert" className="text-sm text-red-700" data-testid="address-error">
          {saveError}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        data-testid="address-continue"
        className="min-h-[44px] rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Continue to payment"}
      </button>
    </form>
  );
}
