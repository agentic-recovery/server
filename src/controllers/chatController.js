/**
 * controllers/chatController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin HTTP layer between Express and chatService.
 * Responsible only for:
 *   - Extracting and validating HTTP inputs
 *   - Calling chatService
 *   - Formatting the HTTP response
 *
 * All conversation logic lives in chatService.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { v4: uuidv4 }                   = require("uuid");
const { processMessage, resetSession, getSessionSnapshot } = require("../services/chatService");
const { sendSuccess, sendError }       = require("../utils/response");

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/chat
//  Main conversational endpoint. Accepts a message and optional sessionId.
//  Returns the assistant reply plus optional provider/price data.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  POST /api/chat
 * @desc   Send a user message and receive an AI-generated chat response.
 *         Handles the full conversation lifecycle: entity collection,
 *         provider matching, booking confirmation.
 * @access Public (auth optional — pass Bearer token to link booking to user)
 *
 * Body:
 *   {
 *     "message":   "I need a tow truck on the M6",
 *     "sessionId": "optional-uuid-from-previous-turn"
 *   }
 *
 * Response:
 *   {
 *     "success": true,
 *     "message": "OK",
 *     "data": {
 *       "sessionId": "uuid",
 *       "message":   "assistant reply in user's language",
 *       "stage":     "collecting|awaiting_confirmation|confirmed|cancelled",
 *       "data": {
 *         "provider": { ... },   // present at offer & confirmation stages
 *         "price":    95.50,     // present at offer & confirmation stages
 *         "eta":      12,        // minutes, present at offer & confirmation stages
 *         "requestId": "..."     // present only after confirmation
 *       }
 *     }
 *   }
 */
const handleChat = async (req, res, next) => {
  try {
    const { message, sessionId } = req.body;

    // ── Validate input ────────────────────────────────────────────────────
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return sendError(res, 422, "message is required and must be a non-empty string.");
    }

    if (message.trim().length > 1000) {
      return sendError(res, 422, "message cannot exceed 1000 characters.");
    }

    // ── Resolve session ID ────────────────────────────────────────────────
    // If client doesn't supply one, generate a new UUID.
    // Client must echo the returned sessionId in subsequent turns.
    const resolvedSessionId = (typeof sessionId === "string" && sessionId.trim())
      ? sessionId.trim()
      : uuidv4();

    // ── Resolve authenticated user ID (optional) ──────────────────────────
    // auth middleware attaches req.entity if a valid Bearer token was provided.
    // Anonymous chats are fully supported — userId will be null.
    const userId = req.entity ? req.entityId : null;

    // ── Delegate to chatService ───────────────────────────────────────────
    const result = await processMessage(resolvedSessionId, message.trim(), userId);

    return sendSuccess(res, 200, "OK", result);

  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  DELETE /api/chat/:sessionId
//  Reset / clear a conversation session.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  DELETE /api/chat/:sessionId
 * @desc   Clear a conversation session (start fresh)
 * @access Public
 */
const clearSession = (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return sendError(res, 422, "sessionId param is required.");
    }
    resetSession(sessionId);
    return sendSuccess(res, 200, "Session cleared. You can start a new conversation.");
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/chat/:sessionId/state
//  Debug endpoint — returns the current session state snapshot.
//  Useful for development and evaluation; should be disabled or guarded in prod.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  GET /api/chat/:sessionId/state
 * @desc   Return a read-only snapshot of the session state (dev/debug only)
 * @access Public (restrict in production)
 */
const getSessionState = (req, res, next) => {
  try {
    const snapshot = getSessionSnapshot(req.params.sessionId);
    if (!snapshot) {
      return sendError(res, 404, "Session not found or has expired.");
    }
    return sendSuccess(res, 200, "Session state retrieved.", snapshot);
  } catch (error) {
    next(error);
  }
};

module.exports = { handleChat, clearSession, getSessionState };
