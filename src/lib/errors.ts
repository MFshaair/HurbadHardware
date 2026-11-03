export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL',
  'BOT_CHECK_FAILED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_LOCKED',
  'OTP_RESEND_TOO_SOON',
  'PHONE_INVALID',
  'PHONE_ALREADY_USED',
  'EMAIL_ALREADY_USED',
  'PRODUCT_UNAVAILABLE',
  'STOCK_INSUFFICIENT',
  'CART_EMPTY',
  'PRICE_CHANGED',
  'COMPARE_MIXED_CATEGORY',
  'COMPARE_LIMIT',
  'COUPON_NOT_FOUND',
  'COUPON_INACTIVE',
  'COUPON_EXPIRED',
  'COUPON_NOT_STARTED',
  'COUPON_MIN_SUBTOTAL',
  'COUPON_NOT_APPLICABLE',
  'COUPON_FIRST_ORDER_ONLY',
  'COUPON_USER_LIMIT',
  'COUPON_LIMIT_REACHED',
  'COUPON_REQUIRES_LOGIN',
  'LOYALTY_INSUFFICIENT',
  'LOYALTY_EXCEEDS_CAP',
  'DELIVERY_ZONE_UNAVAILABLE',
  'PICKUP_UNAVAILABLE',
  'ADDRESS_INVALID',
  'PAYMENT_METHOD_UNAVAILABLE',
  'PAYMENT_PHONE_INVALID_FOR_METHOD',
  'PAYMENT_OPEN_EXISTS',
  'PAYMENT_PROVIDER_REJECTED',
  'PAYMENT_PROVIDER_UNREACHABLE',
  'PAYMENT_NOT_FOUND',
  'AMOUNT_MISMATCH',
  'REFUND_EXCEEDS_PAID',
  'REFUND_UNSUPPORTED',
  'ORDER_NOT_FOUND',
  'ORDER_INVALID_TRANSITION',
  'ORDER_NOT_CANCELLABLE',
  'SERIALS_COUNT_MISMATCH',
  'SHIPMENT_REQUIRED',
  'REVIEW_NOT_ELIGIBLE',
  'REVIEW_ALREADY_EXISTS',
  'QUESTION_LIMIT',
  'UPLOAD_TYPE_INVALID',
  'UPLOAD_TOO_LARGE',
  'SELF_ROLE_CHANGE',
  'LAST_ADMIN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  COUPON_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  PAYMENT_PROVIDER_UNREACHABLE: 502,
};

export function errorStatus(code: ErrorCode): number {
  return STATUS_BY_CODE[code] ?? 400;
}

export class AppError extends Error {
  public readonly status: number;
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly meta?: Record<string, unknown>,
    status?: number,
  ) {
    super(message ?? code);
    this.name = 'AppError';
    this.status = status ?? errorStatus(code);
  }
}

export function isAppError(e: unknown): e is AppError {
  return (
    e instanceof AppError ||
    (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AppError')
  );
}

export interface ActionError {
  code: ErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
  meta?: Record<string, unknown>;
}
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}
export function fail<T = never>(error: ActionError): ActionResult<T> {
  return { ok: false, error };
}
