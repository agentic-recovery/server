/**
 * services/agentService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AGENTIC AI ENGINE — Perceive → Evaluate → Act
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This service implements the three-phase agentic decision cycle:
 *
 *  PERCEIVE  – Receive the breakdown request and retrieve all eligible
 *              providers from the database.
 *
 *  EVALUATE  – Score each provider across three weighted dimensions:
 *                Score = (0.4 × distanceScore)
 *                      + (0.3 × availabilityScore)
 *                      + (0.3 × priceScore)
 *              Then run negotiation logic to compute the final price.
 *
 *  ACT       – Select the highest-scoring provider, update the request
 *              document, and persist everything to MongoDB.
 */

const Provider = require("../models/Provider");
const Request  = require("../models/Request");
const { calculateDistance, isWithinServiceArea } = require("../utils/distance");
const { calculatePrice, isNightTime, isWeekend }  = require("../utils/pricing");

// ─── Scoring weights ──────────────────────────────────────────────────────────
const WEIGHTS = {
  distance:     0.4,
  availability: 0.3,
  price:        0.3,
};

// Maximum distance considered (km). Providers beyond this get score 0.
const MAX_DISTANCE_KM = 200;

// ─────────────────────────────────────────────────────────────────────────────
//  PHASE 1 — PERCEIVE
//  Fetch all active, available providers that support the requested vehicle
//  type. Pre-filtering here reduces the evaluation workload.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} requestData - The breakdown request (plain object or document)
 * @returns {Promise<Provider[]>} Candidate providers
 */
const perceive = async (requestData) => {
  const now = new Date();

  // Map JS day index → provider workingDay abbreviation
  const dayMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const todayAbbr = dayMap[now.getDay()];

  // BUG FIX: Use $in with mapped provider types array instead of exact match.
  // requestData.providerTypes is set by chatService (e.g. ["Flatbed","Wheel Lift"] for "Car").
  // requestData.vehicleType is the original chat value (e.g. "Car") — we fall back to
  // a permissive $exists:true if no mapping was provided (e.g. called from requestController).
  const vehicleTypeQuery = requestData.providerTypes && requestData.providerTypes.length > 0
    ? { vehicleTypes: { $in: requestData.providerTypes } }
    : {};  // No vehicle filter — match all (used by baseline/direct API calls)

  const query = {
    isActive: true,
    ...vehicleTypeQuery,
    $or: [
      // Normally available today within working hours
      {
        "availability.isAvailable": true,
        "availability.workingDays": todayAbbr,
      },
      // OR has emergency mode enabled
      {
        "availability.emergencyMode": true,
      },
    ],
  };

  const providers = await Provider.find(query).lean();

  console.log(`[agentService] PERCEIVE: ${providers.length} provider(s) passed availability/vehicleType filter`);
  console.log(`[agentService] User location: (${requestData.userLocation.lat}, ${requestData.userLocation.lng})`);

  // Further filter by service area — with coordinate validation and debug logging
  const inRange = providers.filter((p) => {
    // Validate provider coordinates before attempting distance calculation
    const coords = p.serviceArea?.location?.coordinates;
    if (!coords || coords.length < 2) {
      console.warn(`[agentService] Provider "${p.companyName}" missing coordinates — skipping`);
      return false;
    }
    const [pLng, pLat] = coords; // GeoJSON: [longitude, latitude]
    if (isNaN(pLat) || isNaN(pLng) || (pLat === 0 && pLng === 0)) {
      console.warn(`[agentService] Provider "${p.companyName}" has invalid coords [${pLng},${pLat}] — skipping`);
      return false;
    }

    const distance = calculateDistance(
      requestData.userLocation.lat,
      requestData.userLocation.lng,
      pLat,
      pLng
    );

    const within = distance <= p.serviceArea.radiusKm;
    console.log(
      `[agentService]   ${p.companyName.padEnd(28)} ` +
      `prov=(${pLat.toFixed(4)},${pLng.toFixed(4)}) ` +
      `dist=${distance.toFixed(2)}km radius=${p.serviceArea.radiusKm}km ` +
      `IN_RANGE=${within}`
    );

    return within;
  });

  console.log(`[agentService] PERCEIVE result: ${inRange.length} provider(s) in range`);

  return inRange;
};

// ─────────────────────────────────────────────────────────────────────────────
//  PHASE 2 — EVALUATE
//  Score and rank every candidate provider. Returns a sorted array of
//  { provider, score, distanceKm, calculatedPrice, priceBreakdown }.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise a value in [min, max] → [0, 1].
 * Returns 0 if range is zero (all values identical).
 */
const normalise = (value, min, max) => {
  if (max === min) return 1; // All providers equal on this dimension
  return (value - min) / (max - min);
};

/**
 * Score a single provider.
 *
 * @param {object} provider      - Provider plain object
 * @param {object} requestData   - Breakdown request
 * @param {object} priceRange    - { minCalcPrice, maxCalcPrice } across all candidates
 * @param {number} maxDist       - Maximum distance across all candidates (km)
 * @returns {{ distanceKm, distanceScore, availabilityScore, priceScore, totalScore, calculatedPrice, priceBreakdown }}
 */
const scoreProvider = (provider, requestData, priceRange, maxDist) => {
  const { lat: userLat, lng: userLng } = requestData.userLocation;
  const [provLng, provLat] = provider.serviceArea.location.coordinates;

  // ── Distance score (inverted: closer = higher score) ──────────────────────
  const distanceKm = calculateDistance(userLat, userLng, provLat, provLng);
  // Normalise distance: 0 km → score 1.0, MAX_DISTANCE_KM+ → score 0.0
  const distanceScore = Math.max(0, 1 - distanceKm / (maxDist || MAX_DISTANCE_KM));

  // ── Availability score ────────────────────────────────────────────────────
  const now = new Date();
  let availabilityScore = 0;

  if (provider.availability.isAvailable) {
    availabilityScore = 1.0;

    // Bonus deduction if outside working hours (unless emergency mode)
    const [startH, startM] = provider.availability.workingHours.start.split(":").map(Number);
    const [endH, endM]     = provider.availability.workingHours.end.split(":").map(Number);
    const nowMinutes        = now.getHours() * 60 + now.getMinutes();
    const startMinutes      = startH * 60 + startM;
    const endMinutes        = endH * 60 + endM;

    const insideHours = nowMinutes >= startMinutes && nowMinutes <= endMinutes;
    if (!insideHours && !provider.availability.emergencyMode) {
      availabilityScore = 0.5; // Partial score — technically available but outside hours
    }
  } else if (provider.availability.emergencyMode) {
    availabilityScore = 0.7; // Emergency only
  }

  // ── Price calculation & score ─────────────────────────────────────────────
  const { price: calculatedPrice, breakdown: priceBreakdown } = calculatePrice(
    provider,
    distanceKm,
    requestData.urgencyLevel,
    now
  );

  // Invert normalisation: lower price → higher score
  const { minCalcPrice, maxCalcPrice } = priceRange;
  const priceScore =
    maxCalcPrice === minCalcPrice
      ? 1
      : 1 - normalise(calculatedPrice, minCalcPrice, maxCalcPrice);

  // ── Weighted total ─────────────────────────────────────────────────────────
  const totalScore =
    WEIGHTS.distance     * distanceScore +
    WEIGHTS.availability * availabilityScore +
    WEIGHTS.price        * priceScore;

  return {
    distanceKm:       Math.round(distanceKm * 100) / 100,
    distanceScore:    Math.round(distanceScore * 1000) / 1000,
    availabilityScore:Math.round(availabilityScore * 1000) / 1000,
    priceScore:       Math.round(priceScore * 1000) / 1000,
    totalScore:       Math.round(totalScore * 1000) / 1000,
    calculatedPrice,
    priceBreakdown,
  };
};

/**
 * Evaluate all candidate providers and return them ranked best → worst.
 *
 * @param {object[]} providers  - Output of perceive()
 * @param {object}   requestData
 * @returns {Array} Sorted scored providers
 */
const evaluate = (providers, requestData) => {
  if (providers.length === 0) return [];

  // ── Pass 1: compute raw prices & distances ────────────────────────────────
  const now = new Date();
  const rawScores = providers.map((p) => {
    const [provLng, provLat] = p.serviceArea.location.coordinates;
    const distanceKm = calculateDistance(
      requestData.userLocation.lat,
      requestData.userLocation.lng,
      provLat,
      provLng
    );
    const { price } = calculatePrice(p, distanceKm, requestData.urgencyLevel, now);
    return { provider: p, distanceKm, calcPrice: price };
  });

  // Determine ranges for normalisation
  const distances  = rawScores.map((r) => r.distanceKm);
  const prices     = rawScores.map((r) => r.calcPrice);
  const maxDist    = Math.max(...distances, 1); // avoid divide-by-zero
  const priceRange = {
    minCalcPrice: Math.min(...prices),
    maxCalcPrice: Math.max(...prices),
  };

  // ── Pass 2: full scoring ──────────────────────────────────────────────────
  const scored = rawScores.map(({ provider }) => {
    const scores = scoreProvider(provider, requestData, priceRange, maxDist);
    return { provider, ...scores };
  });

  // Sort descending by totalScore
  scored.sort((a, b) => b.totalScore - a.totalScore);
  return scored;
};

// ─────────────────────────────────────────────────────────────────────────────
//  PHASE 3 — ACT
//  Select the winner, persist the result, return the enriched request.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object}   requestDoc - Mongoose Request document (must be saved already)
 * @param {object[]} ranked     - Output of evaluate()
 * @returns {Promise<Request>}  Updated request document
 */
const act = async (requestDoc, ranked) => {
  if (ranked.length === 0) {
    requestDoc.status = "failed";
    requestDoc.timeline.push({
      status: "failed",
      timestamp: new Date(),
      note: "No eligible providers found",
    });
    await requestDoc.save();
    return requestDoc;
  }

  const winner = ranked[0];

  // Build scoringDetails array for full transparency
  const scoringDetails = ranked.map((r) => ({
    providerId:        r.provider._id,
    companyName:       r.provider.companyName,
    distanceKm:        r.distanceKm,
    distanceScore:     r.distanceScore,
    availabilityScore: r.availabilityScore,
    priceScore:        r.priceScore,
    totalScore:        r.totalScore,
    calculatedPrice:   r.calculatedPrice,
  }));

  // Estimate ETA: (distanceKm / 60 km/h average) in minutes
  const etaMinutes = Math.ceil((winner.distanceKm / 60) * 60);

  requestDoc.status           = "matched";
  requestDoc.selectedProvider = winner.provider._id;
  requestDoc.finalPrice       = winner.calculatedPrice;
  requestDoc.matchingMethod   = "agentic";
  requestDoc.scoringDetails   = scoringDetails;
  requestDoc.providerETA      = etaMinutes;

  await requestDoc.save();

  // Increment provider job count
  await Provider.findByIdAndUpdate(winner.provider._id, {
    $inc: { "stats.totalJobs": 1 },
  });

  return requestDoc;
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC ENTRY POINT
//  Called from the request controller. Runs the full Perceive→Evaluate→Act
//  cycle and returns { request, winner, allScores }.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full agentic matching cycle for a breakdown request.
 *
 * @param {object} requestDoc  - Newly saved Mongoose Request document
 * @returns {Promise<{ request, winner: object|null, allScores: object[] }>}
 */
const runAgentCycle = async (requestDoc) => {
  // Mark as processing
  requestDoc.status = "processing";
  await requestDoc.save();

  // ── PERCEIVE ──────────────────────────────────────────────────────────────
  const candidates = await perceive(requestDoc);

  // ── EVALUATE ──────────────────────────────────────────────────────────────
  const ranked = evaluate(candidates, requestDoc);

  // ── ACT ───────────────────────────────────────────────────────────────────
  const updatedRequest = await act(requestDoc, ranked);

  const winner = ranked.length > 0 ? ranked[0] : null;

  return {
    request:   updatedRequest,
    winner:    winner ? {
      provider:        winner.provider,
      distanceKm:      winner.distanceKm,
      calculatedPrice: winner.calculatedPrice,
      priceBreakdown:  winner.priceBreakdown,
      scores: {
        distance:     winner.distanceScore,
        availability: winner.availabilityScore,
        price:        winner.priceScore,
        total:        winner.totalScore,
      },
    } : null,
    allScores: ranked.map((r) => ({
      providerId:   r.provider._id,
      companyName:  r.provider.companyName,
      totalScore:   r.totalScore,
      distanceKm:   r.distanceKm,
      finalPrice:   r.calculatedPrice,
    })),
    candidateCount: candidates.length,
  };
};

module.exports = { runAgentCycle, perceive, evaluate, scoreProvider };
