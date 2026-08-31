// Order confirmation email template (M5-1a, HRH-52). Plain template-literal
// HTML + text — deliberately no react-email/`.tsx` dependency (that form is
// HRH-63's). `renderOrderConfirmationEmail(data) => RenderedEmail` is the
// stable seam HRH-63 swaps the body behind, with zero caller changes.
//
// Binding design: docs/agents/arch-decisions/M5-1a-order-confirmation-email.md
// Decision 9. Minimum content only: order number, each line item's
// `ProductVariant.name`, quantity, unit price, line total, and the full
// subtotal/tax/shipping/total breakdown in `Order.currency`. Explicitly out
// of scope: variant images, attributes rendering, shipping address block,
// tracking, branding beyond a plain header.
//
// Security: every interpolated value is HTML-escaped — variant `name` is
// admin-supplied free text (M5-2 adds product CRUD) and an unescaped name
// is a stored-XSS vector in a webmail client. Money is rendered from
// `Decimal.toFixed(2)` STRINGS, passed in already formatted by the caller
// (orderNotificationService.ts) — never re-derived from a `Number` here.
import type { RenderedEmail } from "@/lib/emailService";

export interface OrderConfirmationEmailItem {
  name: string;
  quantity: number;
  unitPrice: string; // Decimal.toFixed(2) string, e.g. "1000.00"
  totalPrice: string; // Decimal.toFixed(2) string
}

export interface OrderConfirmationEmailData {
  orderNumber: string;
  currency: string; // Order.currency
  placedAt: Date;
  items: OrderConfirmationEmailItem[];
  subtotalAmount: string;
  taxAmount: string;
  shippingAmount: string;
  totalAmount: string;
}

/** HTML-escapes a string for safe interpolation into the HTML body. Never
 * skip this for any admin/customer-supplied string (variant name, order
 * number is system-generated but escaped anyway — defense in depth). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(currency: string, amount: string): string {
  return `${escapeHtml(currency)} ${escapeHtml(amount)}`;
}

export function renderOrderConfirmationEmail(data: OrderConfirmationEmailData): RenderedEmail {
  const subject = `Order confirmed — ${data.orderNumber}`;

  const itemRowsHtml = data.items
    .map(
      (item) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e5e5;">${escapeHtml(item.name)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e5e5;text-align:center;">${item.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e5e5;text-align:right;">${formatMoney(
          data.currency,
          item.unitPrice,
        )}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e5e5;text-align:right;">${formatMoney(
          data.currency,
          item.totalPrice,
        )}</td>
      </tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="font-family:sans-serif;color:#111;">
    <h1>Order confirmed</h1>
    <p>Thanks for your order. Your order number is <strong>${escapeHtml(
      data.orderNumber,
    )}</strong>, placed on ${escapeHtml(data.placedAt.toISOString())}.</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #111;">Item</th>
          <th style="text-align:center;padding:8px;border-bottom:2px solid #111;">Qty</th>
          <th style="text-align:right;padding:8px;border-bottom:2px solid #111;">Unit price</th>
          <th style="text-align:right;padding:8px;border-bottom:2px solid #111;">Line total</th>
        </tr>
      </thead>
      <tbody>${itemRowsHtml}</tbody>
    </table>
    <table style="width:100%;margin-top:16px;">
      <tr><td>Subtotal</td><td style="text-align:right;">${formatMoney(data.currency, data.subtotalAmount)}</td></tr>
      <tr><td>Tax</td><td style="text-align:right;">${formatMoney(data.currency, data.taxAmount)}</td></tr>
      <tr><td>Shipping</td><td style="text-align:right;">${formatMoney(data.currency, data.shippingAmount)}</td></tr>
      <tr><td><strong>Total</strong></td><td style="text-align:right;"><strong>${formatMoney(
        data.currency,
        data.totalAmount,
      )}</strong></td></tr>
    </table>
  </body>
</html>`;

  const itemLinesText = data.items
    .map(
      (item) =>
        `  - ${item.name} x${item.quantity} @ ${data.currency} ${item.unitPrice} = ${data.currency} ${item.totalPrice}`,
    )
    .join("\n");

  const text = `Order confirmed — ${data.orderNumber}

Thanks for your order. Your order number is ${data.orderNumber}, placed on ${data.placedAt.toISOString()}.

Items:
${itemLinesText}

Subtotal: ${data.currency} ${data.subtotalAmount}
Tax: ${data.currency} ${data.taxAmount}
Shipping: ${data.currency} ${data.shippingAmount}
Total: ${data.currency} ${data.totalAmount}
`;

  return { subject, html, text };
}
