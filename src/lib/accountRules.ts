// The rules of an account's ID, password and e-mail address, shared by the screen (to tell the user early) and the
// server (which is the one that decides).

export type LoginIdProblem = 'loginIdFormat'
export type PasswordProblem = 'passwordLength' | 'passwordSameAsId'
export type EmailProblem = 'emailFormat'

/** The ID as it is stored and compared: without surrounding spaces, in lower case. */
export const normalizeLoginId = (raw: string): string => raw.trim().toLowerCase()

/** Why the (normalized) ID is refused, or null. */
export function loginIdProblem(id: string): LoginIdProblem | null {
  return /^[a-z0-9_-]{3,32}$/.test(id) ? null : 'loginIdFormat'
}

/** Why the password is refused, or null: 10 to 128 characters, and not the ID itself. */
export function passwordProblem(password: string, loginId: string): PasswordProblem | null {
  const length = [...password].length
  if (length < 10 || length > 128) return 'passwordLength'
  return password.toLowerCase() === normalizeLoginId(loginId) ? 'passwordSameAsId' : null
}

/** The address as it is stored and compared: without surrounding spaces, in lower case. */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase()

/** Why the (normalized) address is refused, or null. */
export function emailProblem(email: string): EmailProblem | null {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : 'emailFormat'
}
