/**
 * Key Service Resolver
 *
 * Resolves usr_xxx API keys to Perplexity credentials via the centralized
 * mcp-key-service. Includes a short-lived cache with in-flight deduplication
 * to avoid hitting the key service on every MCP request.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const KEY_SERVICE_URL = process.env.KEY_SERVICE_URL || '';
const KEY_SERVICE_TOKEN = process.env.KEY_SERVICE_TOKEN || '';

const CACHE_TTL_MS = 60_000;          // 60 seconds
const CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 minutes
const REQUEST_TIMEOUT_MS = 5_000;      // 5 seconds

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedCredentials {
  apiKey: string; // The Perplexity API key (pplx-xxxx)
}

export type ResolveResult =
  | { ok: true; credentials: ResolvedCredentials }
  | { ok: false; reason: 'invalid_key' | 'service_unavailable' | 'malformed_response' };

interface CacheEntry {
  credentials: ResolvedCredentials;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<ResolveResult>>();

// Periodic cache eviction
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}, CLEANUP_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Returns true when both KEY_SERVICE_URL and KEY_SERVICE_TOKEN are set. */
export function isKeyServiceEnabled(): boolean {
  return !!(KEY_SERVICE_URL && KEY_SERVICE_TOKEN);
}

/**
 * Masks a secret value for safe logging.
 * Short values only expose a generic prefix so they cannot be reconstructed.
 */
export function maskSecret(
  value: string | undefined | null,
  visiblePrefix = 4,
  visibleSuffix = 4,
): string {
  if (!value) return 'missing';
  if (value.length <= visiblePrefix + visibleSuffix + 4) {
    return `${value.substring(0, Math.min(visiblePrefix, value.length))}...`;
  }
  return `${value.substring(0, visiblePrefix)}...${value.substring(value.length - visibleSuffix)}`;
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a usr_xxx key to Perplexity credentials via the key service.
 *
 * - Returns cached result when available (60 s TTL).
 * - Deduplicates concurrent requests for the same key.
 * - Returns a discriminated union so callers can branch on ok/reason.
 */
export async function resolveKeyCredentials(
  apiKey: string,
): Promise<ResolveResult> {
  // Fast-path: cache hit
  const cached = cache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, credentials: cached.credentials };
  }

  // Deduplicate in-flight requests for the same key
  const inflight = pending.get(apiKey);
  if (inflight) return inflight;

  const promise = doResolve(apiKey);
  pending.set(apiKey, promise);

  try {
    return await promise;
  } finally {
    pending.delete(apiKey);
  }
}

// ---------------------------------------------------------------------------
// Internal resolver
// ---------------------------------------------------------------------------

async function doResolve(apiKey: string): Promise<ResolveResult> {
  let response: globalThis.Response;

  try {
    response = await fetch(KEY_SERVICE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEY_SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: apiKey }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'service_unavailable' };
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!response.ok) {
    if (!isJson) {
      return { ok: false, reason: 'malformed_response' };
    }

    if (response.status === 403 || response.status === 404) {
      try {
        const data = await response.json() as { valid?: boolean };
        return data.valid === false
          ? { ok: false, reason: 'invalid_key' }
          : { ok: false, reason: 'service_unavailable' };
      } catch {
        return { ok: false, reason: 'malformed_response' };
      }
    }

    return { ok: false, reason: 'service_unavailable' };
  }

  let data: Record<string, unknown>;
  try {
    if (!isJson) {
      return { ok: false, reason: 'malformed_response' };
    }
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'malformed_response' };
  }

  if (data.valid === false) {
    return { ok: false, reason: 'invalid_key' };
  }

  // Extract the Perplexity API key from the credentials object.
  // The perplexity connector has field name "apiKey".
  const creds = data.credentials as Record<string, unknown> | undefined;
  const resolvedKey =
    (creds?.apiKey as string) ??
    (creds?.perplexity_api_key as string) ??
    (creds?.perplexityApiKey as string) ??
    undefined;

  if (!resolvedKey || typeof resolvedKey !== 'string') {
    return { ok: false, reason: 'malformed_response' };
  }

  const credentials: ResolvedCredentials = { apiKey: resolvedKey };

  // Cache the result
  cache.set(apiKey, {
    credentials,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return { ok: true, credentials };
}
