"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Region = "KE" | "ET" | "SO";

type Address = {
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

const emptyForm = {
  fullName: "",
  phone: "",
  region: "KE" as Region,
  city: "",
  postalCode: "",
  street: "",
  isDefault: false,
};

/**
 * Address CRUD (M1-3). Scoped server-side to the logged-in user's own
 * addresses — this component never sends a userId; every request rides
 * on the session cookie and the server independently re-derives the
 * owner. Does not wire into checkout (M3-3 scope, not this item).
 */
export default function AddressManager({ initialAddresses }: { initialAddresses: Address[] }) {
  const router = useRouter();
  const [addresses, setAddresses] = useState(initialAddresses);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function startEdit(address: Address) {
    setEditingId(address.id);
    setForm({
      fullName: address.fullName,
      phone: address.phone,
      region: address.region,
      city: address.city,
      postalCode: address.postalCode,
      street: address.street,
      isDefault: address.isDefault,
    });
    setError(null);
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  }

  async function refresh() {
    const res = await fetch("/api/addresses");
    if (res.ok) {
      const body = await res.json();
      setAddresses(body.addresses);
    }
    router.refresh();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(editingId ? `/api/addresses/${editingId}` : "/api/addresses", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(typeof body?.error === "string" ? body.error : "Unable to save address.");
        setLoading(false);
        return;
      }

      await refresh();
      resetForm();
      setLoading(false);
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/addresses/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(typeof body?.error === "string" ? body.error : "Unable to delete address.");
        setLoading(false);
        return;
      }
      await refresh();
      if (editingId === id) resetForm();
      setLoading(false);
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
      setLoading(false);
    }
  }

  async function handleSetDefault(id: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/addresses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(typeof body?.error === "string" ? body.error : "Unable to set default address.");
        setLoading(false);
        return;
      }
      await refresh();
      setLoading(false);
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Addresses</h2>

      <ul className="flex flex-col gap-3" aria-label="Saved addresses">
        {addresses.map((address) => (
          <li key={address.id} className="rounded border p-3">
            <p className="font-medium">
              {address.fullName} {address.isDefault && <span aria-label="default">(default)</span>}
            </p>
            <p className="text-sm">{address.phone}</p>
            <p className="text-sm">
              {address.street}, {address.city}, {address.region} {address.postalCode}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => startEdit(address)}
                disabled={loading}
                className="min-h-[44px] min-w-[44px] rounded border px-3 py-2"
              >
                Edit
              </button>
              {!address.isDefault && (
                <button
                  type="button"
                  onClick={() => handleSetDefault(address.id)}
                  disabled={loading}
                  className="min-h-[44px] min-w-[44px] rounded border px-3 py-2"
                >
                  Set default
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDelete(address.id)}
                disabled={loading}
                className="min-h-[44px] min-w-[44px] rounded border px-3 py-2 text-red-600"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
        {addresses.length === 0 && <p className="text-sm text-gray-600">No saved addresses yet.</p>}
      </ul>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded border p-4"
        aria-label={editingId ? "Edit address" : "Add address"}
      >
        <h3 className="font-medium">{editingId ? "Edit address" : "Add a new address"}</h3>

        <div className="flex flex-col gap-1">
          <label htmlFor="addr-fullName" className="text-sm font-medium">
            Full name
          </label>
          <input
            id="addr-fullName"
            name="fullName"
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            className="min-h-[44px] rounded border px-3 py-2"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="addr-phone" className="text-sm font-medium">
            Phone
          </label>
          <input
            id="addr-phone"
            name="phone"
            required
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="min-h-[44px] rounded border px-3 py-2"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="addr-region" className="text-sm font-medium">
            Region
          </label>
          <select
            id="addr-region"
            name="region"
            required
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value as Region })}
            className="min-h-[44px] rounded border px-3 py-2"
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="addr-city" className="text-sm font-medium">
            City
          </label>
          <input
            id="addr-city"
            name="city"
            required
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            className="min-h-[44px] rounded border px-3 py-2"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="addr-postalCode" className="text-sm font-medium">
            Postal code
          </label>
          <input
            id="addr-postalCode"
            name="postalCode"
            required
            value={form.postalCode}
            onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
            className="min-h-[44px] rounded border px-3 py-2"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="addr-street" className="text-sm font-medium">
            Street
          </label>
          <input
            id="addr-street"
            name="street"
            required
            value={form.street}
            onChange={(e) => setForm({ ...form, street: e.target.value })}
            className="min-h-[44px] rounded border px-3 py-2"
          />
        </div>

        <label className="flex min-h-[44px] items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
          />
          Set as default address
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading}
            className="min-h-[44px] min-w-[44px] rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            {editingId ? "Save changes" : "Add address"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              disabled={loading}
              className="min-h-[44px] min-w-[44px] rounded border px-4 py-2"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
