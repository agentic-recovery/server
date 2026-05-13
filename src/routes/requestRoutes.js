/**
 * routes/requestRoutes.js
 * Breakdown request lifecycle endpoints.
 *
 * Public (optional auth):
 *   POST /api/requests            — submit breakdown + trigger AI matching
 *
 * Private:
 *   GET  /api/requests            — list requests (provider sees own jobs)
 *   GET  /api/requests/:id        — single request detail
 *   PATCH /api/requests/:id/status — provider accepts/declines/completes
 */

const express       = require("express");
const { body, query } = require("express-validator");

const {
  createRequest,
  getRequestById,
  getRequests,
  updateRequestStatus,
  getMyRequests,
} = require("../controllers/requestController");

const { authenticate } = require("../middleware/auth");
const { validate }     = require("../middleware/validate");

const router = express.Router();

// ─── Validation chains ────────────────────────────────────────────────────────

const createRequestRules = [
  body("userLocation.lat")
    .isFloat({ min: -90, max: 90 })
    .withMessage("userLocation.lat must be a valid latitude (-90 to 90)"),

  body("userLocation.lng")
    .isFloat({ min: -180, max: 180 })
    .withMessage("userLocation.lng must be a valid longitude (-180 to 180)"),

  body("vehicleType")
    .isIn(["Car", "Motorcycle", "Van", "HGV", "4x4", "Other"])
    .withMessage("vehicleType must be one of: Car, Motorcycle, Van, HGV, 4x4, Other"),

  body("urgencyLevel")
    .optional()
    .isIn(["normal", "high", "critical"])
    .withMessage("urgencyLevel must be one of: normal, high, critical"),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("preferredLanguage")
    .optional()
    .trim()
    .isLength({ min: 2, max: 10 })
    .withMessage("preferredLanguage must be a valid language code (e.g. 'en')"),

  body("method")
    .optional()
    .isIn(["agentic", "baseline"])
    .withMessage("method must be 'agentic' or 'baseline'"),
];

const statusUpdateRules = [
  body("status")
    .isIn(["accepted", "declined", "in_progress", "on_the_way", "completed", "cancelled"])
    .withMessage("status must be one of: accepted, declined, in_progress, completed, cancelled"),

  body("note")
    .optional()
    .trim()
    .isLength({ max: 300 })
    .withMessage("Note cannot exceed 300 characters"),
];

const listQueryRules = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be 1–100"),
  query("status")
    .optional()
    .isIn(["pending", "processing", "matched", "accepted", "in_progress", "completed", "cancelled", "failed"])
    .withMessage("Invalid status filter"),
];

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * @route  POST /api/requests
 * @desc   Submit a breakdown request. Triggers Agentic AI matching immediately.
 *         Optionally attach user JWT for tracking; anonymous requests also supported.
 * @access Public (auth optional)
 *
 * Body:
 *   { userLocation: { lat, lng, address? }, vehicleType, urgencyLevel?,
 *     description?, preferredLanguage?, method? }
 *
 * Response includes matched provider, final price, and full scoring breakdown.
 */
router.post(
  "/",
  // Optional authentication — we use a custom inline handler so that
  // missing tokens are tolerated (anonymous requests are allowed).
  (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authenticate(req, res, next); // Validate token if provided
    }
    next(); // No token — continue anonymously
  },
  createRequestRules,
  validate,
  createRequest
);

/**
 * @route  GET /api/requests
 * @desc   List requests. Providers see only their matched jobs.
 *         Admins see all. Supports pagination and status filter.
 * @access Private
 */
router.get(
  "/",
  authenticate,
  listQueryRules,
  validate,
  getRequests
);


/**
 * @route  GET /api/requests/my
 * @desc   Get all requests submitted by the currently authenticated customer.
 *         Returns requests with provider details. Customers only.
 * @access Private (user role)
 */
router.get(
  "/my",
  authenticate,
  listQueryRules,
  validate,
  getMyRequests
);

/**
 * @route  GET /api/requests/:id
 * @desc   Get a single breakdown request with provider detail
 * @access Private
 */
router.get("/:id", authenticate, getRequestById);

/**
 * @route  PATCH /api/requests/:id/status
 * @desc   Update request status (provider accepts, declines, or completes job)
 * @access Private
 */
router.patch(
  "/:id/status",
  authenticate,
  statusUpdateRules,
  validate,
  updateRequestStatus
);

module.exports = router;
