/**
 * services/baselineService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * BASELINE MATCHING SERVICE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A simple, non-intelligent provider selection algorithm used as a performance
 * baseline to evaluate how much the Agentic AI improves match quality.
 *
 * Algorithm:
 *   1. Fetch all active, available providers that support the vehicle type.
 *   2. Select the FIRST result — no scoring, no negotiation.
 *   3. Use provider's raw basePrice (no adjustments).
 *
 * This mirrors what a naive "first available" dispatch system would do.
 */

const Provider = require("../models/Provider");
const Request  = require("../models/Request");
const { isWithinServiceArea } = require("../utils/distance");

/**
 * Run the baseline matching algorithm for a breakdown request.
 *
 * @param {object} requestDoc - Mongoose Request document
 * @returns {Promise<{ request, provider: object|null }>}
 */
const runBaselineCycle = async (requestDoc) => {
  requestDoc.status = "processing";
  await requestDoc.save();

  // ── Fetch candidates (same filter as agent, but no scoring) ───────────────
  const dayMap   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const todayAbbr = dayMap[new Date().getDay()];

  const candidates = await Provider.find({
    isActive: true,
    vehicleTypes: requestDoc.vehicleType,
    $or: [
      { "availability.isAvailable": true, "availability.workingDays": todayAbbr },
      { "availability.emergencyMode": true },
    ],
  }).lean();

  // Filter by service area
  const inRange = candidates.filter((p) =>
    isWithinServiceArea(requestDoc.userLocation, p.serviceArea)
  );

  // ── Select FIRST available — no ranking ───────────────────────────────────
  if (inRange.length === 0) {
    requestDoc.status = "failed";
    requestDoc.timeline.push({
      status: "failed",
      timestamp: new Date(),
      note: "Baseline: no eligible providers found",
    });
    await requestDoc.save();
    return { request: requestDoc, provider: null };
  }

  const selected = inRange[0];

  // ── No negotiation — use raw basePrice ────────────────────────────────────
  const finalPrice = selected.pricing.basePrice;

  requestDoc.status           = "matched";
  requestDoc.selectedProvider = selected._id;
  requestDoc.finalPrice       = finalPrice;
  requestDoc.matchingMethod   = "baseline";
  requestDoc.scoringDetails   = []; // Baseline keeps no scoring detail
  requestDoc.providerETA      = null;

  await requestDoc.save();

  await Provider.findByIdAndUpdate(selected._id, {
    $inc: { "stats.totalJobs": 1 },
  });

  return {
    request:  requestDoc,
    provider: selected,
    note: "Baseline: selected first available provider without scoring or negotiation",
  };
};

module.exports = { runBaselineCycle };
