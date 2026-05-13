/**
 * controllers/requestController.js
 * Lifecycle status transitions with chat system messages + emails.
 */

const Request              = require("../models/Request");
const Provider             = require("../models/Provider");
const User                 = require("../models/User");
const Chat                 = require("../models/Chat");
const { runAgentCycle }    = require("../services/agentService");
const { runBaselineCycle } = require("../services/baselineService");
const {
  sendSuccess, sendError, buildPaginationMeta,
} = require("../utils/response");
const {
  sendBookingConfirmedUser,
  sendNewJobProvider,
  sendStatusUpdateUser,
  sendStatusUpdateProvider,
} = require("../services/emailService");

// ─── Status transition rules ──────────────────────────────────────────────────
// Defines valid transitions to enforce a strict lifecycle.
const VALID_TRANSITIONS = {
  pending:     ["matched", "cancelled"],
  processing:  ["matched", "failed", "cancelled"],
  matched:     ["accepted", "declined", "cancelled"],
  accepted:    ["on_the_way", "cancelled"],
  on_the_way:  ["completed", "cancelled"],
  completed:   [],
  cancelled:   [],
  failed:      [],
  declined:    [],
};

// ─── System chat messages per lifecycle event ─────────────────────────────────
const SYSTEM_MESSAGES = {
  matched:    "🔍 We've matched you with a recovery provider. Awaiting their confirmation.",
  accepted:   "✅ Your recovery provider has accepted the job and will contact you shortly.",
  on_the_way: (eta) => `🚗 Your driver is on the way. Estimated arrival: ${eta || "—"} minutes.`,
  completed:  "🎉 Your recovery has been completed. We hope everything went smoothly!",
  cancelled:  "❌ This request has been cancelled. Start a new chat if you still need help.",
  declined:   "⚠️ The provider was unable to take this job. Please start a new request.",
};

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/requests
// ─────────────────────────────────────────────────────────────────────────────

const createRequest = async (req, res, next) => {
  try {
    const {
      userLocation, vehicleType,
      urgencyLevel = "normal",
      description,
      preferredLanguage = "en",
      method = "agentic",
    } = req.body;

    const userId = req.entity && req.entityType === "user" ? req.entity._id : null;

    const requestDoc = await Request.create({
      user: userId, userLocation, vehicleType, urgencyLevel, description,
      preferredLanguage, status: "pending",
      matchingMethod: method === "baseline" ? "baseline" : "agentic",
    });

    let result;
    if (method === "baseline") {
      result = await runBaselineCycle(requestDoc);
      if (result.provider) {
        return sendSuccess(res, 201, "Baseline match found.", { request: result.request, provider: { id: result.provider._id, companyName: result.provider.companyName, contactNumber: result.provider.contactNumber }, method: "baseline", note: result.note });
      }
    } else {
      result = await runAgentCycle(requestDoc);
      if (result.winner) {
        const populated = await Request.findById(result.request._id).populate("selectedProvider", "-password -__v");
        return sendSuccess(res, 201, "Agentic AI matched a provider.", { request: populated, winner: result.winner, allScores: result.allScores, candidateCount: result.candidateCount, method: "agentic" });
      }
    }

    return sendError(res, 404, "No eligible recovery providers found in your area.");
  } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH /api/requests/:id/status  — with full lifecycle integration
// ─────────────────────────────────────────────────────────────────────────────

const updateRequestStatus = async (req, res, next) => {
  try {
    const { status, note } = req.body;

    const allowed = Object.values(VALID_TRANSITIONS).flat().filter((v, i, a) => a.indexOf(v) === i);
    const allStatuses = ["accepted", "declined", "on_the_way", "completed", "cancelled"];
    if (!allStatuses.includes(status)) {
      return sendError(res, 422, `Invalid status. Allowed: ${allStatuses.join(", ")}`);
    }

    const request = await Request.findById(req.params.id);
    if (!request) return sendError(res, 404, "Request not found.");

    // Ownership check
    if (req.entityType === "provider" && request.selectedProvider?.toString() !== req.entityId.toString()) {
      return sendError(res, 403, "You are not assigned to this request.");
    }

    // Validate transition
    const validNext = VALID_TRANSITIONS[request.status] || [];
    if (!validNext.includes(status)) {
      return sendError(res, 422, `Cannot transition from "${request.status}" to "${status}".`);
    }

    request.status = status;
    if (note) request.timeline.push({ status, timestamp: new Date(), note });
    if (status === "completed") {
      request.completedAt = new Date();
      await Provider.findByIdAndUpdate(request.selectedProvider, { $inc: { "stats.completedJobs": 1 } });
    }
    await request.save();

    console.log(`[request] Status updated: ${request._id} → ${status} by ${req.entityType}:${req.entityId}`);

    // ── Lifecycle integrations (fire in background) ────────────────────────
    setImmediate(() => handleLifecycleEffects(request, status));

    return sendSuccess(res, 200, `Request status updated to "${status}".`, request);
  } catch (error) { next(error); }
};

/**
 * Handle all side effects of a status change:
 *   1. Inject system message into the linked chat
 *   2. Send lifecycle emails to user and provider
 */
const handleLifecycleEffects = async (request, newStatus) => {
  try {
    // ── 1. Chat system message ─────────────────────────────────────────────
    if (request.sessionId) {
      const chat = await Chat.findOne({ sessionId: request.sessionId });
      if (chat) {
        const msgFn = SYSTEM_MESSAGES[newStatus];
        const content = typeof msgFn === "function" ? msgFn(request.providerETA) : msgFn;
        if (content) {
          await chat.addSystemMessage(newStatus, content);
          console.log(`[lifecycle] System message injected into chat ${request.sessionId}: ${newStatus}`);
        }
      }
    }

    // ── 2. Load related user and provider for emails ───────────────────────
    const [user, provider] = await Promise.all([
      request.user    ? User.findById(request.user)                 : null,
      request.selectedProvider ? Provider.findById(request.selectedProvider) : null,
    ]);

    // ── 3. Emails ──────────────────────────────────────────────────────────
    if (newStatus === "matched") {
      if (provider) sendNewJobProvider(provider, request).catch((e) => console.error("[email]", e.message));
      if (user)     sendBookingConfirmedUser(user, request, provider).catch((e) => console.error("[email]", e.message));
    } else if (["accepted", "on_the_way", "completed", "cancelled"].includes(newStatus)) {
      if (user)     sendStatusUpdateUser(user, request, newStatus).catch((e) => console.error("[email]", e.message));
      if (provider) sendStatusUpdateProvider(provider, request, newStatus).catch((e) => console.error("[email]", e.message));
    }
  } catch (err) {
    console.error("[lifecycle] handleLifecycleEffects error:", err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET endpoints
// ─────────────────────────────────────────────────────────────────────────────

const getRequestById = async (req, res, next) => {
  try {
    const request = await Request.findById(req.params.id)
      .populate("selectedProvider", "-password -__v")
      .populate("user", "name email");
    if (!request) return sendError(res, 404, "Request not found.");
    return sendSuccess(res, 200, "Request retrieved.", request);
  } catch (error) { next(error); }
};

const getRequests = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip   = (Number(page) - 1) * Number(limit);
    const filter = {};
    if (req.entityType === "provider") filter.selectedProvider = req.entityId;
    if (req.entityType === "user")     filter.user = req.entityId;
    if (status) filter.status = status;

    const [requests, total] = await Promise.all([
      Request.find(filter)
        .populate("selectedProvider", "companyName contactNumber")
        .populate("user", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Request.countDocuments(filter),
    ]);

    return sendSuccess(res, 200, "Requests retrieved.", requests, buildPaginationMeta(page, limit, total));
  } catch (error) { next(error); }
};


// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/requests/my  — customer's own requests
// ─────────────────────────────────────────────────────────────────────────────

const getMyRequests = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip   = (Number(page) - 1) * Number(limit);

    // Must be authenticated as a user
    if (req.entityType !== "user") {
      return sendError(res, 403, "Only customers can access their own requests.");
    }

    const filter = { user: req.entityId };
    if (status) filter.status = status;

    const [requests, total] = await Promise.all([
      Request.find(filter)
        .populate("selectedProvider", "companyName contactNumber serviceArea.city stats.averageRating")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Request.countDocuments(filter),
    ]);

    console.log(`[request] getMyRequests: user=${req.entityId} found=${requests.length}`);

    return sendSuccess(res, 200, "Your requests retrieved.", requests, buildPaginationMeta(page, limit, total));
  } catch (error) { next(error); }
};

module.exports = { createRequest, getRequestById, getRequests, updateRequestStatus, getMyRequests };
