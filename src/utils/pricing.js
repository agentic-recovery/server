/**
 * utils/pricing.js
 * Price calculation helpers used by both the Agentic AI and Baseline services.
 */

/**
 * Determine if the given timestamp falls in night-time hours (22:00–06:00).
 *
 * @param {Date} [date] - Defaults to now
 * @returns {boolean}
 */
const isNightTime = (date = new Date()) => {
  const hour = date.getHours();
  return hour >= 22 || hour < 6;
};

/**
 * Determine if the given timestamp falls on a weekend (Sat/Sun).
 *
 * @param {Date} [date] - Defaults to now
 * @returns {boolean}
 */
const isWeekend = (date = new Date()) => {
  const day = date.getDay(); // 0 = Sun, 6 = Sat
  return day === 0 || day === 6;
};

/**
 * Calculate the final negotiated price for a job.
 *
 * Formula:
 *   price = basePrice + (distanceKm × pricePerKm)
 *   + urgency adjustment (if high/critical)
 *   + night surcharge (if night-time)
 *   + weekend premium (if weekend)
 *   clamped to [minPrice, maxPrice]
 *
 * If autoNegotiation is false, returns basePrice clamped to bounds.
 *
 * @param {object} provider       - Provider document (or plain object)
 * @param {number} distanceKm     - Distance from provider to user in km
 * @param {string} urgencyLevel   - "normal" | "high" | "critical"
 * @param {Date}   [requestTime]  - When the request was made (default: now)
 * @returns {{ price: number, breakdown: object }}
 */
const calculatePrice = (provider, distanceKm, urgencyLevel, requestTime = new Date()) => {
  const { pricing, negotiation } = provider;

  // No auto-negotiation → return base price clamped to min/max
  if (!negotiation.autoNegotiation) {
    const price = Math.min(Math.max(pricing.basePrice, pricing.minPrice), pricing.maxPrice);
    return {
      price,
      breakdown: { basePrice: pricing.basePrice, distanceCost: 0, adjustments: {}, finalPrice: price },
    };
  }

  // 1. Distance cost
  const distanceCost = Math.round(distanceKm * pricing.pricePerKm * 100) / 100;

  // 2. Raw price before adjustments
  let price = pricing.basePrice + distanceCost;

  const adjustments = {};

  // 3. Urgency adjustment
  if (urgencyLevel === "high") {
    const adj = Math.round(price * (negotiation.urgencyAdjustment / 100) * 100) / 100;
    price += adj;
    adjustments.urgency = `+${negotiation.urgencyAdjustment}% (£${adj})`;
  } else if (urgencyLevel === "critical") {
    // Critical gets 1.5× the urgency multiplier
    const adj = Math.round(price * (negotiation.urgencyAdjustment * 1.5) / 100 * 100) / 100;
    price += adj;
    adjustments.urgency = `+${negotiation.urgencyAdjustment * 1.5}% critical (£${adj})`;
  }

  // 4. Night surcharge
  if (isNightTime(requestTime) && negotiation.nightSurcharge > 0) {
    const adj = Math.round(price * (negotiation.nightSurcharge / 100) * 100) / 100;
    price += adj;
    adjustments.nightSurcharge = `+${negotiation.nightSurcharge}% (£${adj})`;
  }

  // 5. Weekend premium
  if (isWeekend(requestTime) && negotiation.weekendPremium > 0) {
    const adj = Math.round(price * (negotiation.weekendPremium / 100) * 100) / 100;
    price += adj;
    adjustments.weekendPremium = `+${negotiation.weekendPremium}% (£${adj})`;
  }

  // 6. Clamp to [minPrice, maxPrice]
  const clampedPrice = Math.min(Math.max(Math.round(price * 100) / 100, pricing.minPrice), pricing.maxPrice);

  return {
    price: clampedPrice,
    breakdown: {
      basePrice: pricing.basePrice,
      distanceCost,
      adjustments,
      subtotal: Math.round(price * 100) / 100,
      finalPrice: clampedPrice,
      clamped: clampedPrice !== Math.round(price * 100) / 100,
    },
  };
};

module.exports = { calculatePrice, isNightTime, isWeekend };
