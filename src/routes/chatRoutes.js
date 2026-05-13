/**
 * routes/chatRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Chat / conversational AI endpoints.
 *
 *  POST   /api/chat                  — send a message, receive a reply
 *  DELETE /api/chat/:sessionId       — reset a session
 *  GET    /api/chat/:sessionId/state — inspect session state (debug)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express    = require("express");
const { body }   = require("express-validator");

const { handleChat, clearSession, getSessionState } = require("../controllers/chatController");
const { authenticate, optionalAuth }               = require("../middleware/auth");
const { validate }                                  = require("../middleware/validate");

const router = express.Router();

// ─── Validation ───────────────────────────────────────────────────────────────

const chatRules = [
  body("message")
    .trim()
    .notEmpty().withMessage("message is required")
    .isLength({ max: 1000 }).withMessage("message cannot exceed 1000 characters"),

  body("sessionId")
    .optional()
    .trim()
    .isString().withMessage("sessionId must be a string"),
];

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * @route  POST /api/chat
 * @desc   Main conversational endpoint.
 *         Auth is OPTIONAL — include a Bearer token to link bookings to a user.
 *         Anonymous requests are fully supported.
 * @access Public (auth optional)
 *
 * @example Request body:
 *   { "message": "I need a tow truck on the M6", "sessionId": "optional-uuid" }
 *
 * @example Response:
 *   {
 *     "success": true,
 *     "message": "OK",
 *     "data": {
 *       "sessionId": "3f4a1b2c-...",
 *       "message":   "I found a provider 3.2 km away. Estimated price: £95. Shall I confirm?",
 *       "stage":     "awaiting_confirmation",
 *       "data": { "provider": { "companyName": "Swift Recovery" }, "price": 95, "eta": 8 }
 *     }
 *   }
 */
router.post(
  "/",
  optionalAuth,  // Attaches req.entity if cookie or Bearer token is valid
  chatRules,
  validate,
  handleChat
);

/**
 * @route  DELETE /api/chat/:sessionId
 * @desc   Clear a conversation and start fresh
 * @access Public
 */
router.delete("/:sessionId", clearSession);

/**
 * @route  GET /api/chat/:sessionId/state
 * @desc   Return a read-only snapshot of the session state (for debugging/evaluation)
 * @access Public — restrict to admin in production
 */
router.get("/:sessionId/state", getSessionState);

module.exports = router;
