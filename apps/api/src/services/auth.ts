export { hashPassword, verifyPassword } from "./auth/password";
export {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashToken,
  newSessionToken,
  createSession,
  verifySessionToken,
  revokeSession,
  revokeOtherSessions,
  revokeAllForAccount,
} from "./auth/session";
export type { SessionRecord } from "./auth/session";
export {
  SEED_USERNAME,
  SEED_ALIAS,
  SEED_PASSWORD,
  SEED_DISPLAY,
  ensureSeedAccount,
  findAccountByIdentifier,
  checkLoginRateLimit,
  clearLoginRateLimit,
  loginWithPassword,
  changePassword,
} from "./auth/account";
export type { AuthAccount } from "./auth/account";
export type { Logger } from "../lib/logger";
