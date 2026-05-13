/**
 * services/geocodingService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Real geocoding using OpenStreetMap Nominatim API.
 *
 * Why Nominatim:
 *   - Free, no API key required
 *   - Excellent UK postcode + road/junction coverage
 *   - Returns structured results we can validate
 *
 * Strategy:
 *   1. UK postcode detected → hit postcodes.io first (most accurate for UK)
 *   2. Everything else → Nominatim with UK countrycodes bias
 *   3. In-memory LRU cache (max 500 entries, 1 hour TTL) to avoid hammering API
 *   4. Validate result is within reasonable UK bounding box
 *   5. On failure → return null (never silently fall back to fake coords)
 *
 * Rate limits:
 *   Nominatim: max 1 req/second per ToS. We add a 1.1s debounce guard.
 *   postcodes.io: no limit for reasonable use.
 */

// ─── In-memory geocode cache ──────────────────────────────────────────────────
// Key: normalised location string  Value: { lat, lng, display, cachedAt }
const geocodeCache = new Map();
const CACHE_TTL_MS  = 60 * 60 * 1000; // 1 hour
const CACHE_MAX     = 500;

// Rough bounding box for Great Britain + Northern Ireland + nearby
const UK_BOUNDS = {
  latMin: 49.5,
  latMax: 61.0,
  lngMin: -8.7,
  lngMax:  2.1,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise a location string for cache key. */
const cacheKey = (str) => str.toLowerCase().replace(/\s+/g, " ").trim();

/** Return a cached result if still fresh. */
const fromCache = (key) => {
  const entry = geocodeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    geocodeCache.delete(key);
    return null;
  }
  return entry;
};

/** Store in cache, evicting oldest entry if at capacity. */
const toCache = (key, value) => {
  if (geocodeCache.size >= CACHE_MAX) {
    // Evict the first (oldest) entry
    geocodeCache.delete(geocodeCache.keys().next().value);
  }
  geocodeCache.set(key, { ...value, cachedAt: Date.now() });
};

/**
 * Validate that coordinates look like a real UK location.
 * Rejects [0,0], swapped lat/lng, and out-of-bounds results.
 */
const isValidUKCoord = (lat, lng) => {
  if (lat == null || lng == null) return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return (
    lat >= UK_BOUNDS.latMin && lat <= UK_BOUNDS.latMax &&
    lng >= UK_BOUNDS.lngMin && lng <= UK_BOUNDS.lngMax
  );
};

/** Detect if the string looks like a UK postcode (full or partial). */
const UK_POSTCODE_RE = /^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i;
const isUKPostcode = (str) => UK_POSTCODE_RE.test(str.trim());

/**
 * Detect vague/unusable location strings that cannot be geocoded.
 * Returns true if the string is too vague to geocode.
 */
const VAGUE_PATTERNS = [
  /^(here|near\s*me|my\s*location|this\s*road|the\s*road|somewhere|nearby|around\s*here|not\s*sure|don'?t\s*know)$/i,
  /^[a-z\s]{0,8}$/i, // Very short non-specific strings
];

const isVagueLocation = (str) => {
  if (!str || str.trim().length < 3) return true;
  return VAGUE_PATTERNS.some((re) => re.test(str.trim()));
};

// ─────────────────────────────────────────────────────────────────────────────
//  Strategy 1 — postcodes.io (UK postcodes only, most accurate)
// ─────────────────────────────────────────────────────────────────────────────

const geocodeViaPostcodesIo = async (postcode) => {
  const normalised = postcode.replace(/\s+/g, "").toUpperCase();
  const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(normalised)}`;

  console.log(`[geocoding] postcodes.io lookup: ${normalised}`);

  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: { "User-Agent": "AIRecoverySystem/1.0" },
  });

  if (!res.ok) {
    console.warn(`[geocoding] postcodes.io HTTP ${res.status} for ${normalised}`);
    return null;
  }

  const data = await res.json();
  if (data.status !== 200 || !data.result) return null;

  const { latitude: lat, longitude: lng, postcode: displayPostcode } = data.result;

  if (!isValidUKCoord(lat, lng)) {
    console.warn(`[geocoding] postcodes.io returned invalid coords for ${normalised}: ${lat}, ${lng}`);
    return null;
  }

  return { lat, lng, display: displayPostcode, source: "postcodes.io" };
};

// ─────────────────────────────────────────────────────────────────────────────
//  Strategy 2 — OpenStreetMap Nominatim (general UK geocoding)
// ─────────────────────────────────────────────────────────────────────────────

// Simple rate-limit guard — Nominatim ToS: max 1 req/second
let lastNominatimCall = 0;
const NOMINATIM_MIN_INTERVAL_MS = 1100;

const geocodeViaNominatim = async (locationString) => {
  // Enforce rate limit
  const now     = Date.now();
  const elapsed = now - lastNominatimCall;
  if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, NOMINATIM_MIN_INTERVAL_MS - elapsed));
  }
  lastNominatimCall = Date.now();

  // Append UK hint if not already present to bias results toward Britain
  const queryStr = /\buk\b|\bengland\b|\bscotland\b|\bwales\b|\bbritain\b/i.test(locationString)
    ? locationString
    : `${locationString}, UK`;

  const params = new URLSearchParams({
    q:              queryStr,
    format:         "json",
    limit:          "3",         // Get top 3 — pick most relevant
    countrycodes:   "gb",        // Restrict to Great Britain
    addressdetails: "1",
  });

  const url = `https://nominatim.openstreetmap.org/search?${params}`;

  console.log(`[geocoding] Nominatim lookup: "${queryStr}"`);

  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      "User-Agent":   "AIRecoverySystem/1.0 (roadside-recovery-app)",
      "Accept":       "application/json",
      "Accept-Language": "en-GB,en",
    },
  });

  if (!res.ok) {
    console.warn(`[geocoding] Nominatim HTTP ${res.status}`);
    return null;
  }

  const results = await res.json();

  if (!Array.isArray(results) || results.length === 0) {
    console.warn(`[geocoding] Nominatim: no results for "${queryStr}"`);
    return null;
  }

  // Pick first result with valid UK coordinates
  for (const result of results) {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);

    if (isValidUKCoord(lat, lng)) {
      console.log(`[geocoding] Nominatim matched: "${result.display_name}" → (${lat}, ${lng})`);
      return {
        lat,
        lng,
        display: result.display_name,
        source:  "nominatim",
      };
    }
  }

  console.warn(`[geocoding] Nominatim: no valid UK coords in ${results.length} results for "${queryStr}"`);
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API — geocodeLocation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a location string to { lat, lng, display, source }.
 *
 * Returns null if:
 *   - The string is too vague (caller should ask the user for clarification)
 *   - All geocoding strategies fail
 *   - Result is outside the UK bounding box
 *
 * Never returns fake/hardcoded coordinates.
 *
 * @param {string} locationString - Free-text location from user
 * @returns {Promise<{ lat: number, lng: number, display: string, source: string } | null>}
 */
const geocodeLocation = async (locationString) => {
  if (!locationString || typeof locationString !== "string") return null;

  const normalised = locationString.trim();
  if (normalised.length < 3) return null;

  // Check vagueness before hitting external APIs
  if (isVagueLocation(normalised)) {
    console.log(`[geocoding] Vague location rejected: "${normalised}"`);
    return null;
  }

  const key = cacheKey(normalised);
  const cached = fromCache(key);
  if (cached) {
    console.log(`[geocoding] Cache hit for "${normalised}"`);
    return cached;
  }

  try {
    let result = null;

    // UK postcode → use postcodes.io (fastest + most accurate)
    if (isUKPostcode(normalised)) {
      result = await geocodeViaPostcodesIo(normalised);
    }

    // Fall through to Nominatim for any input (including postcodes that failed above)
    if (!result) {
      result = await geocodeViaNominatim(normalised);
    }

    if (result) {
      toCache(key, result);
      console.log(`[geocoding] ✓ "${normalised}" → (${result.lat}, ${result.lng}) via ${result.source}`);
    } else {
      console.warn(`[geocoding] ✗ Failed to geocode: "${normalised}"`);
    }

    return result;
  } catch (err) {
    console.error(`[geocoding] Error geocoding "${normalised}":`, err.message);
    return null;
  }
};

/**
 * Expose vagueness check so chatService can detect it before geocoding.
 * @param {string} locationString
 * @returns {boolean}
 */
const isLocationVague = (locationString) => {
  if (!locationString) return true;
  return isVagueLocation(locationString.trim());
};

/**
 * Return cache stats (for monitoring/debugging endpoints).
 */
const getCacheStats = () => ({
  size:    geocodeCache.size,
  maxSize: CACHE_MAX,
  ttlMs:   CACHE_TTL_MS,
});

module.exports = { geocodeLocation, isLocationVague, getCacheStats };
