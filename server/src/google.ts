import { createPublicKey, verify, type webcrypto } from 'node:crypto'

export type JsonWebKey = webcrypto.JsonWebKey & { kid?: string }

/*
 * Google sign-in: the credential Google's button gives the page is a JSON Web Token signed by Google. It is checked
 * here by its signature against Google's published keys, its audience against this game's client id, its issuer and
 * its time, and only a verified email address is taken from it. Nothing is sent to Google but the fetch of its keys.
 */

export const GOOGLE_KEYS = 'https://www.googleapis.com/oauth2/v3/certs'

type Keys = () => Promise<JsonWebKey[]>

/** Google's keys, fetched when first needed and kept for as long as Google says they may be. */
export function googleKeys(url = GOOGLE_KEYS): Keys {
  let kept: { keys: JsonWebKey[]; until: number } | null = null
  return async () => {
    if (kept && Date.now() < kept.until) return kept.keys
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Google's keys could not be fetched (${response.status}).`)
    const age = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600)
    kept = { keys: ((await response.json()) as { keys: JsonWebKey[] }).keys, until: Date.now() + age * 1000 }
    return kept.keys
  }
}

const part = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<string, unknown>

/** The verified email address in a Google credential, or null if the credential is not good. */
export async function googleEmail(credential: unknown, clientId: string, keys: Keys, now: number): Promise<string | null> {
  if (typeof credential !== 'string' || credential.length > 8192) return null
  const pieces = credential.split('.')
  if (pieces.length !== 3) return null
  const [head, body, sig] = pieces as [string, string, string]
  let header: Record<string, unknown>
  let claims: Record<string, unknown>
  try {
    header = part(head)
    claims = part(body)
  } catch {
    return null
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null
  const jwk = (await keys()).find((k) => k.kid === header.kid)
  if (!jwk) return null
  const good = verify('RSA-SHA256', Buffer.from(`${head}.${body}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'))
  if (!good) return null
  if (claims.aud !== clientId) return null
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') return null
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null
  if (claims.email_verified !== true || typeof claims.email !== 'string') return null
  return claims.email.toLowerCase()
}
