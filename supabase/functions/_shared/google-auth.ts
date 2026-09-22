// Verifies a Google Identity Services (GIS) ID token, for Edge Functions.
// Ports members.gs's verifyGoogleIdToken_, but verifies the RS256 signature
// locally against Google's published JWKS instead of round-tripping to
// Google's tokeninfo endpoint. tokeninfo works but Google's own docs mark it
// as intended for debugging (it's rate-limited), and every production
// client library (google-auth-library, etc.) verifies locally — this does
// the same, with no external dependency on the request path once the JWKS
// is cached.
//
// GOOGLE_CLIENT_ID is a public value by design (the same constant already
// hardcoded in shared/api.js for the frontend GIS button) — OAuth client
// IDs aren't secrets, so no Supabase secret is needed for this to work.

const GOOGLE_CLIENT_ID = "231967339479-m1fqbqk134sjtt2o4nloljfle7l7hk7b.apps.googleusercontent.com";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const JWKS_TTL_MS = 60 * 60 * 1000; // Google rotates signing keys every few hours at most.

export interface GoogleIdPayload {
  email: string;
  [key: string]: unknown;
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64urlDecodeJson(str: string): any {
  return JSON.parse(new TextDecoder().decode(base64urlDecode(str)));
}

interface CachedJwks { keys: any[]; fetchedAt: number }
let cachedJwks: CachedJwks | null = null;

async function fetchJwks(): Promise<any[]> {
  const resp = await fetch(JWKS_URL);
  if (!resp.ok) throw new Error("Failed to fetch Google JWKS: HTTP " + resp.status);
  const data = await resp.json();
  return Array.isArray(data.keys) ? data.keys : [];
}

// Cached per warm isolate; refetched once more on a kid miss in case Google
// rotated keys since the cache was populated (same "force one refetch"
// pattern the rest of this codebase uses for similar lookups).
async function getSigningKey(kid: string): Promise<CryptoKey | null> {
  if (!cachedJwks || Date.now() - cachedJwks.fetchedAt > JWKS_TTL_MS) {
    cachedJwks = { keys: await fetchJwks(), fetchedAt: Date.now() };
  }
  let jwk = cachedJwks.keys.find((k) => k.kid === kid);
  if (!jwk) {
    cachedJwks = { keys: await fetchJwks(), fetchedAt: Date.now() };
    jwk = cachedJwks.keys.find((k) => k.kid === kid);
  }
  if (!jwk) return null;
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

// Verifies a Google ID token: RS256 signature against Google's live JWKS,
// audience, issuer, expiry, and a verified email claim. Returns the decoded
// payload (with `email` normalized to lowercase/trimmed) on success, or
// null on ANY failure — malformed token, unknown kid, bad signature, wrong
// audience/issuer, expired, or an unverified email. Never throws for a bad
// token; only a genuine infra failure (JWKS fetch) can throw, same as the
// GAS version letting a fetch exception fall through to its catch → null.
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdPayload | null> {
  const token = String(idToken || "").trim();
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: any, payload: any;
  try {
    header = base64urlDecodeJson(headerB64);
    payload = base64urlDecodeJson(payloadB64);
  } catch {
    return null;
  }
  if (!header || header.alg !== "RS256" || !header.kid) return null;
  if (!payload || typeof payload !== "object") return null;

  let key: CryptoKey | null;
  try {
    key = await getSigningKey(String(header.kid));
  } catch {
    return null; // JWKS fetch failed — treat as an unverifiable token, not a 500.
  }
  if (!key) return null;

  const signature = base64urlDecode(sigB64);
  const signedInput = new TextEncoder().encode(headerB64 + "." + payloadB64);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signedInput);
  if (!valid) return null;

  if (String(payload.aud || "") !== GOOGLE_CLIENT_ID) return null;
  const iss = String(payload.iss || "");
  if (iss !== "accounts.google.com" && iss !== "https://accounts.google.com") return null;
  const exp = parseInt(payload.exp, 10);
  if (!exp || exp * 1000 < Date.now()) return null;
  if (!payload.email) return null;
  if (payload.email_verified !== true && String(payload.email_verified).toLowerCase() !== "true") return null;

  return { ...payload, email: String(payload.email).trim().toLowerCase() };
}
