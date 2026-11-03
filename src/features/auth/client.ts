/** Client-safe public entry: action proxies only, never the Node OTP service. */
export { requestOtpAction, requestMagicLinkAction } from './actions';
