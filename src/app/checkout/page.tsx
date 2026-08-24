import { redirect } from "next/navigation";

// Bare `/checkout` (the existing target of the cart page's "Proceed to
// Checkout" link, src/app/cart/CartLineItems.tsx) has no content of its
// own — checkout always starts at the address step.
export default function CheckoutIndexPage() {
  redirect("/checkout/address");
}
