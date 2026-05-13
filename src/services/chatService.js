/**
 * services/chatService.js
 * FIXED VERSION — see inline comments for each bug fix
 */

const { extractEntities, generateResponse } = require("./llmService");
const { perceive, evaluate }                = require("./agentService");
const { geocodeLocation, isLocationVague }  = require("./geocodingService");
const Request                               = require("../models/Request");
const Provider                              = require("../models/Provider");
const Chat                                  = require("../models/Chat");

// ─── In-memory session store ──────────────────────────────────────────────────
const sessions       = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
//  BUG FIX #1 — Vehicle type mapping
//
//  The LLM extracts "Car", "Van", "HGV", "4x4" etc.
//  The Provider.vehicleTypes schema uses:
//    ["Flatbed", "Wheel Lift", "Heavy Duty", "Motorcycle", "Van Recovery", "4x4 Off-Road"]
//
//  The old perceive() query: vehicleTypes: requestData.vehicleType
//  was an EXACT match — "Car" never matched "Flatbed", so 0 results every time.
//
//  Fix: map chat type → array of provider types, query with $in.
// ─────────────────────────────────────────────────────────────────────────────

const VEHICLE_TO_PROVIDER_TYPES = {
  Car:        ["Flatbed", "Wheel Lift"],
  Motorcycle: ["Motorcycle"],
  Van:        ["Flatbed", "Van Recovery", "Wheel Lift"],
  HGV:        ["Heavy Duty", "Flatbed"],
  "4x4":      ["4x4 Off-Road", "Flatbed"],
  Other:      ["Flatbed", "Wheel Lift", "Heavy Duty"],
};

const mapVehicleTypeToProviderTypes = (chatVehicleType) => {
  if (!chatVehicleType) return ["Flatbed", "Wheel Lift"];
  return VEHICLE_TO_PROVIDER_TYPES[chatVehicleType] || ["Flatbed", "Wheel Lift", "Heavy Duty"];
};

// ─── Session helpers ──────────────────────────────────────────────────────────

const createSession = () => ({
  stage:         "collecting",
  language:      "en",
  location:      null,   // Raw text e.g. "M6 Junction 7, Birmingham"
  coords:        null,   // Resolved { lat, lng } — BUG FIX: stored AFTER geocoding, not as Promise
  vehicleType:   null,
  urgency:       null,
  matchResult:   null,
  history:       [],
  lastActivity:  Date.now(),
  geocodeFailed: false,
});

const getOrCreateSession = (sessionId) => {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, createSession());
    console.log(`[chatService] New session: ${sessionId}`);
  }
  const session = sessions.get(sessionId);
  session.lastActivity = Date.now();
  return session;
};

const pruneExpiredSessions = () => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
};

// ─── Confirmation detection ───────────────────────────────────────────────────

const CONFIRM_POSITIVE = /\b(yes|yeah|yep|yup|sure|ok|okay|confirm|book|proceed|go ahead|absolutely|affirmative|sí|si|oui|ja|sim|да|نعم|はい|好的|是的)\b/i;
const CONFIRM_NEGATIVE = /\b(no|nope|nah|cancel|stop|nevermind|never mind|non|nein|não|нет|لا|いいえ|不)\b/i;

const detectConfirmation = (message) => {
  const clean = message.trim();
  if (CONFIRM_POSITIVE.test(clean)) return "yes";
  if (CONFIRM_NEGATIVE.test(clean)) return "no";
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
//  BUG FIX #2 — getMissingFieldPrompt
//
//  Old version treated any non-null location as "resolved".
//  New version distinguishes:
//    A) No location at all → ask for location
//    B) Location is vague ("here", "near me") → ask for specific location
//    C) Geocoding previously failed → ask for clearer location
//    D) Location stored, coords not resolved yet → proceed to geocoding
// ─────────────────────────────────────────────────────────────────────────────

const getMissingFieldPrompt = (session) => {
  if (!session.location) {
    return (
      "Ask the user for their exact location. A UK postcode is ideal (e.g. B1 2JQ), " +
      "or a road name with town (e.g. M6 Junction 7, Birmingham)."
    );
  }

  if (isLocationVague(session.location)) {
    return (
      `The user said "${session.location}" which is too vague to find on the map. ` +
      "Ask them to share a postcode, road name with town, or motorway junction number."
    );
  }

  if (session.geocodeFailed) {
    return (
      `We couldn't find "${session.location}" on the map. ` +
      "Ask the user for a UK postcode or a more specific address including the town name."
    );
  }

  if (!session.vehicleType) {
    return "Ask the user what type of vehicle has broken down (e.g. car, van, motorcycle, lorry, 4x4).";
  }

  if (!session.urgency) {
    return "Ask the user how urgent their situation is — are they safe off the road, on a hard shoulder, or in immediate danger?";
  }

  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN — processMessage
// ─────────────────────────────────────────────────────────────────────────────

const processMessage = async (sessionId, userMessage, userId = null) => {
  pruneExpiredSessions();
  const session = getOrCreateSession(sessionId);

  if (session.stage === "confirmed") {
    const reply = await generateResponse(
      "Tell the user their booking is already confirmed and offer to help with anything else.",
      session.language,
      session.history
    );
    return { sessionId, message: reply, stage: "confirmed", data: {} };
  }

  session.history.push({ role: "user", content: userMessage });

  // ── awaiting_confirmation ─────────────────────────────────────────────────
  if (session.stage === "awaiting_confirmation") {
    const confirmation = detectConfirmation(userMessage);

    if (confirmation === "yes") {
      return await handleBookingConfirmation(session, sessionId, userId);
    }

    if (confirmation === "no") {
      session.stage = "cancelled";
      const reply = await generateResponse(
        "The user declined the booking. Acknowledge politely and let them know they can start a new request anytime.",
        session.language,
        session.history
      );
      session.history.push({ role: "assistant", content: reply });
      return { sessionId, message: reply, stage: "cancelled", data: {} };
    }

    const { winner } = session.matchResult;
    const reprompt = await generateResponse(
      `The user hasn't clearly confirmed or declined. Remind them: provider is ` +
      `${winner.distanceKm.toFixed(1)} km away, price £${winner.calculatedPrice}. ` +
      `Ask: confirm booking or cancel?`,
      session.language,
      session.history
    );
    session.history.push({ role: "assistant", content: reprompt });
    return {
      sessionId,
      message: reprompt,
      stage: "awaiting_confirmation",
      data: {
        provider: { companyName: winner.provider.companyName },
        price:    winner.calculatedPrice,
      },
    };
  }

  // ── collecting ────────────────────────────────────────────────────────────
  const extracted = await extractEntities(userMessage, session.history);

  session.language = extracted.language || session.language;
  if (extracted.vehicleType) session.vehicleType = extracted.vehicleType;
  if (extracted.urgency)     session.urgency     = extracted.urgency;

  // New or changed location → clear resolved coords so geocoding re-runs
  if (extracted.location && extracted.location !== session.location) {
    session.location      = extracted.location;
    session.coords        = null;
    session.geocodeFailed = false;
  }

  console.log("[chatService] Session state:", {
    sessionId,
    location:    session.location,
    coords:      session.coords,
    vehicleType: session.vehicleType,
    urgency:     session.urgency,
    stage:       session.stage,
  });

  const missingFieldPrompt = getMissingFieldPrompt(session);

  if (missingFieldPrompt) {
    const reply = await generateResponse(missingFieldPrompt, session.language, session.history);
    session.history.push({ role: "assistant", content: reply });
    return { sessionId, message: reply, stage: "collecting", data: {} };
  }

  return await handleProviderMatching(session, sessionId);
};

// ─────────────────────────────────────────────────────────────────────────────
//  handleProviderMatching
//
//  BUG FIXES:
//  1. geocodeLocation() is now properly AWAITED (critical — old code stored a
//     Promise object as coords, causing NaN in all distance calculations)
//  2. Vehicle type is mapped before querying (fixes 0-result bug)
//  3. Full debug logging of coordinates and distances
//  4. Retry with relaxed constraints before giving up
// ─────────────────────────────────────────────────────────────────────────────

const handleProviderMatching = async (session, sessionId) => {

  // ── Geocode if we don't have resolved coords yet ───────────────────────────
  if (!session.coords) {
    console.log(`[chatService] Geocoding "${session.location}"...`);

    // BUG FIX: geocodeLocation is async — must be awaited
    const geocoded = await geocodeLocation(session.location);

    if (!geocoded || isNaN(geocoded.lat) || isNaN(geocoded.lng)) {
      console.warn(`[chatService] Geocoding failed: "${session.location}"`);
      session.geocodeFailed = true;

      const reply = await generateResponse(
        `Couldn't locate "${session.location}" on the map. ` +
        "Ask the user for their UK postcode (e.g. B1 2JQ) or full address with town.",
        session.language,
        session.history
      );
      session.history.push({ role: "assistant", content: reply });
      return { sessionId, message: reply, stage: "collecting", data: {} };
    }

    session.coords        = { lat: geocoded.lat, lng: geocoded.lng };
    session.geocodeFailed = false;
    console.log(`[chatService] Resolved coords: (${geocoded.lat}, ${geocoded.lng}) via ${geocoded.source}`);
  }

  // ── Build request data with mapped vehicle types ───────────────────────────
  const providerVehicleTypes = mapVehicleTypeToProviderTypes(session.vehicleType);

  const requestData = {
    userLocation: {
      lat:     session.coords.lat,
      lng:     session.coords.lng,
      address: session.location,
    },
    vehicleType:   session.vehicleType,
    providerTypes: providerVehicleTypes,
    urgencyLevel:  session.urgency || "normal",
  };

  console.log(`[chatService] PERCEIVE — user at (${requestData.userLocation.lat.toFixed(4)}, ${requestData.userLocation.lng.toFixed(4)})`);
  console.log(`[chatService] Querying provider types: [${providerVehicleTypes.join(", ")}]`);

  // ── PERCEIVE ──────────────────────────────────────────────────────────────
  let candidates = await perceive(requestData);
  console.log(`[chatService] Candidates found: ${candidates.length}`);

  // ── Retry with relaxed constraints ────────────────────────────────────────
  if (candidates.length === 0) {
    console.log("[chatService] Retrying with relaxed constraints...");
    candidates = await perceiveRelaxed(requestData);
    console.log(`[chatService] Relaxed candidates: ${candidates.length}`);
  }

  if (candidates.length === 0) {
    const reply = await generateResponse(
      `No providers found near "${session.location}" for a ${session.vehicleType || "vehicle"}. ` +
      "Tell the user no providers are available right now. Suggest retrying shortly " +
      "or calling 999 if on a motorway hard shoulder.",
      session.language,
      session.history
    );
    session.history.push({ role: "assistant", content: reply });
    session.stage    = "collecting";
    session.location = null;
    session.coords   = null;
    return { sessionId, message: reply, stage: "collecting", data: {} };
  }

  // ── EVALUATE ──────────────────────────────────────────────────────────────
  const ranked = evaluate(candidates, requestData);
  const winner = ranked[0];

  console.log("[chatService] Ranked providers:");
  ranked.forEach((r, i) => {
    const [pLng, pLat] = r.provider.serviceArea.location.coordinates;
    console.log(
      `  ${i + 1}. ${r.provider.companyName.padEnd(28)} ` +
      `provCoords=(${pLat.toFixed(4)},${pLng.toFixed(4)}) ` +
      `dist=${r.distanceKm}km radius=${r.provider.serviceArea.radiusKm}km ` +
      `score=${r.totalScore.toFixed(3)} price=£${r.calculatedPrice}`
    );
  });

  session.matchResult = {
    winner,
    allScores: ranked.map((r) => ({
      providerId:  r.provider._id,
      companyName: r.provider.companyName,
      totalScore:  r.totalScore,
      distanceKm:  r.distanceKm,
      finalPrice:  r.calculatedPrice,
    })),
    candidateCount: candidates.length,
    requestData,
  };

  session.stage = "awaiting_confirmation";

  const etaMinutes = Math.max(5, Math.ceil((winner.distanceKm / 60) * 60));

  const offerMessage = await generateResponse(
    `Tell the user we found a provider ${winner.distanceKm.toFixed(1)} km away. ` +
    `Estimated price: £${winner.calculatedPrice}. Estimated arrival: ${etaMinutes} minutes. ` +
    `Ask if they'd like to confirm the booking.`,
    session.language,
    session.history
  );
  session.history.push({ role: "assistant", content: offerMessage });

  return {
    sessionId,
    message: offerMessage,
    stage:   "awaiting_confirmation",
    data: {
      provider: {
        companyName:   winner.provider.companyName,
        contactNumber: winner.provider.contactNumber,
        serviceArea:   { city: winner.provider.serviceArea.city },
        vehicleTypes:  winner.provider.vehicleTypes,
        rating:        winner.provider.stats?.averageRating,
      },
      price: winner.calculatedPrice,
      eta:   etaMinutes,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
//  perceiveRelaxed — fallback when normal perceive() returns nothing
// ─────────────────────────────────────────────────────────────────────────────

const perceiveRelaxed = async (requestData) => {
  const { calculateDistance } = require("../utils/distance");
  const { lat, lng } = requestData.userLocation;

  const all = await Provider.find({ isActive: true }).lean();

  return all.filter((p) => {
    if (!p.serviceArea?.location?.coordinates || p.serviceArea.location.coordinates.length < 2) {
      return false;
    }
    const [pLng, pLat] = p.serviceArea.location.coordinates;

    if (isNaN(pLat) || isNaN(pLng)) {
      console.warn(`[chatService] Provider "${p.companyName}" has invalid coordinates: [${pLng}, ${pLat}]`);
      return false;
    }

    const dist = calculateDistance(lat, lng, pLat, pLng);

    console.log(
      `[chatService] Relaxed: ${p.companyName} — ` +
      `user=(${lat.toFixed(4)},${lng.toFixed(4)}) ` +
      `prov=(${pLat.toFixed(4)},${pLng.toFixed(4)}) ` +
      `dist=${dist.toFixed(2)}km radius=${p.serviceArea.radiusKm}km ` +
      `match=${dist <= p.serviceArea.radiusKm}`
    );

    return dist <= p.serviceArea.radiusKm;
  });
};

// ─────────────────────────────────────────────────────────────────────────────
//  handleBookingConfirmation
// ─────────────────────────────────────────────────────────────────────────────

const handleBookingConfirmation = async (session, sessionId, userId) => {
  const { winner, allScores, requestData } = session.matchResult;

  const requestDoc = await Request.create({
    user:              userId || null,
    sessionId:         sessionId,      // Link request to chat session
    userLocation:      requestData.userLocation,
    vehicleType:       session.vehicleType,
    urgencyLevel:      session.urgency || "normal",
    preferredLanguage: session.language,
    status:            "matched",
    selectedProvider:  winner.provider._id,
    finalPrice:        winner.calculatedPrice,
    matchingMethod:    "agentic",
    scoringDetails:    allScores.map((s) => ({
      providerId:      s.providerId,
      companyName:     s.companyName,
      distanceKm:      s.distanceKm,
      totalScore:      s.totalScore,
      calculatedPrice: s.finalPrice,
    })),
    providerETA: Math.max(5, Math.ceil((winner.distanceKm / 60) * 60)),
    timeline: [{ status: "matched", timestamp: new Date(), note: "Matched via conversational AI chat" }],
  });

  await Provider.findByIdAndUpdate(winner.provider._id, {
    $inc: { "stats.totalJobs": 1 },
  });

  // Persist the full conversation + link to request
  try {
    await Chat.findOneAndUpdate(
      { sessionId },
      {
        $set: {
          userId:    userId || null,
          requestId: requestDoc._id,
          stage:     "confirmed",
          isActive:  true,
        },
        $push: {
          messages: {
            $each: session.history.map((m) => ({
              role:      m.role,
              content:   m.content,
              timestamp: new Date(),
            })),
          },
        },
      },
      { upsert: true, new: true }
    );
    console.log(`[chatService] Chat persisted for session ${sessionId}`);
  } catch (chatErr) {
    console.error("[chatService] Failed to persist chat:", chatErr.message);
  }

  console.log("[chatService] BOOKING CONFIRMED:", {
    requestId:  requestDoc._id,
    provider:   winner.provider.companyName,
    price:      `£${winner.calculatedPrice}`,
    location:   session.location,
    coords:     session.coords,
    vehicle:    session.vehicleType,
  });

  session.stage = "confirmed";

  const confirmMessage = await generateResponse(
    "Booking confirmed. Tell the user help is on the way. " +
    "Booking reference: " + requestDoc._id.toString().slice(-8).toUpperCase() + ". " +
    "Wish them well.",
    session.language,
    session.history
  );
  session.history.push({ role: "assistant", content: confirmMessage });

  return {
    sessionId,
    message: confirmMessage,
    stage:   "confirmed",
    data: {
      requestId: requestDoc._id,
      provider: {
        companyName:   winner.provider.companyName,
        contactNumber: winner.provider.contactNumber,
      },
      price: winner.calculatedPrice,
      eta:   requestDoc.providerETA,
    },
  };
};

// ─── Utility exports ──────────────────────────────────────────────────────────

const resetSession = (sessionId) => {
  sessions.delete(sessionId);
  console.log(`[chatService] Session reset: ${sessionId}`);
};

const getSessionSnapshot = (sessionId) => {
  const s = sessions.get(sessionId);
  if (!s) return null;
  return {
    stage:         s.stage,
    language:      s.language,
    location:      s.location,
    coords:        s.coords,
    vehicleType:   s.vehicleType,
    urgency:       s.urgency,
    geocodeFailed: s.geocodeFailed,
    turnCount:     s.history.length,
    lastActivity:  new Date(s.lastActivity).toISOString(),
  };
};

module.exports = { processMessage, resetSession, getSessionSnapshot };
