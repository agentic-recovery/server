/**
 * routes/providerRoutes.js
 * CRUD and availability management for Provider documents.
 *
 * Public:   GET  /api/providers          — list all active providers
 *           GET  /api/providers/:id      — single provider profile
 *
 * Private:  PUT  /api/providers/:id      — update own profile
 *           PATCH /api/providers/:id/availability — toggle online status
 *           GET  /api/providers/:id/stats         — own job statistics
 *           DELETE /api/providers/:id   — deactivate own account
 */

const express  = require("express");
const { body, query } = require("express-validator");

const {
  getAllProviders,
  getProviderById,
  updateProvider,
  updateAvailability,
  deleteProvider,
  getProviderStats,
  updateDocuments,
} = require("../controllers/providerController");

const {
  authenticate,
  requireProvider,
  requireOwnership,
} = require("../middleware/auth");

const { validate } = require("../middleware/validate");

const { uploadProviderDocs } = require("../middleware/upload");

const router = express.Router();

// ─── Validation chains ────────────────────────────────────────────────────────

const listQueryRules = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be 1–100"),
  query("available").optional().isBoolean().withMessage("available must be true or false"),
];

const updateRules = [
  body("pricing.basePrice").optional().isFloat({ min: 0 }).withMessage("basePrice must be ≥ 0"),
  body("pricing.minPrice").optional().isFloat({ min: 0 }).withMessage("minPrice must be ≥ 0"),
  body("pricing.maxPrice").optional().isFloat({ min: 0 }).withMessage("maxPrice must be ≥ 0"),
  body("pricing.pricePerKm").optional().isFloat({ min: 0 }).withMessage("pricePerKm must be ≥ 0"),
  body("negotiation.urgencyAdjustment")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage("urgencyAdjustment must be 0–100"),
  body("negotiation.nightSurcharge")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage("nightSurcharge must be 0–100"),
  body("negotiation.weekendPremium")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage("weekendPremium must be 0–100"),
];

const availabilityRules = [
  body("isAvailable").optional().isBoolean().withMessage("isAvailable must be a boolean"),
  body("emergencyMode").optional().isBoolean().withMessage("emergencyMode must be a boolean"),
  body("workingDays")
    .optional()
    .isArray()
    .withMessage("workingDays must be an array"),
  body("workingDays.*")
    .optional()
    .isIn(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
    .withMessage("Each workingDay must be Mon–Sun"),
];

// ─── Public routes ────────────────────────────────────────────────────────────

/**
 * @route  GET /api/providers
 * @desc   List all active providers (filterable, paginated)
 * @access Public
 * @query  page, limit, city, vehicleType, available, sortBy, order
 */
router.get("/", listQueryRules, validate, getAllProviders);

/**
 * @route  GET /api/providers/:id
 * @desc   Get a single provider's full profile
 * @access Public
 */
router.get("/:id", getProviderById);

// ─── Protected routes (provider must be authenticated and own the resource) ───

/**
 * @route  PUT /api/providers/:id
 * @desc   Update provider profile (pricing, negotiation, service area, etc.)
 * @access Private — provider owns :id
 */
router.put(
  "/:id",
  authenticate,
  requireProvider,
  requireOwnership,
  updateRules,
  validate,
  updateProvider
);

/**
 * @route  PATCH /api/providers/:id/availability
 * @desc   Toggle online/offline status or update working hours
 * @access Private — provider owns :id
 */
router.patch(
  "/:id/availability",
  authenticate,
  requireProvider,
  requireOwnership,
  availabilityRules,
  validate,
  updateAvailability
);

/**
 * @route  GET /api/providers/:id/stats
 * @desc   Get provider's job statistics (dashboard counters)
 * @access Private — provider owns :id
 */
router.get(
  "/:id/stats",
  authenticate,
  requireProvider,
  requireOwnership,
  getProviderStats
);

/**
 * @route  DELETE /api/providers/:id
 * @desc   Soft-delete (deactivate) provider account
 * @access Private — provider owns :id
 */
router.delete(
  "/:id",
  authenticate,
  requireProvider,
  requireOwnership,
  deleteProvider
);

/**
 * @route  PATCH /api/providers/:id/documents
 * @desc   Upload license image, insurance doc, and/or update text verification fields
 * @access Private (provider own account)
 */
router.patch(
  "/:id/documents",
  authenticate,
  requireProvider,
  requireOwnership,
  uploadProviderDocs,
  updateDocuments
);

module.exports = router;

