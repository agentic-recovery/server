/**
 * routes/authRoutes.js
 * Authentication endpoints for both providers and users.
 */

const express  = require("express");
const { body } = require("express-validator");

const {
  registerProvider,
  loginProvider,
  registerUser,
  loginUser,
  getMe,
  logout,
} = require("../controllers/authController");

const { authenticate }     = require("../middleware/auth");
const { validate }         = require("../middleware/validate");
const { uploadProviderDocs } = require("../middleware/upload");

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
//  Validation chains
//
//  IMPORTANT: Provider register accepts multipart/form-data.
//  Nested objects (serviceArea, pricing, etc.) arrive as JSON *strings*.
//  We validate only flat top-level fields here; nested objects are validated
//  inside the controller after JSON.parse().
// ─────────────────────────────────────────────────────────────────────────────

const providerRegisterRules = [
  body("companyName")
    .trim()
    .notEmpty().withMessage("Company name is required")
    .isLength({ max: 150 }).withMessage("Company name cannot exceed 150 characters"),

  body("email")
    .trim()
    .isEmail().withMessage("A valid email address is required")
    .normalizeEmail(),

  body("password")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),

  body("contactNumber")
    .trim()
    .notEmpty().withMessage("Contact number is required"),

  // NOTE: serviceArea, vehicleTypes, pricing arrive as JSON strings in FormData.
  // We validate their presence as non-empty strings only; the controller parses + validates values.
  body("serviceArea")
    .notEmpty().withMessage("Service area is required"),

  body("vehicleTypes")
    .custom((value, { req }) => {
      // In FormData, vehicleTypes may come as "vehicleTypes[]" repeated fields
      // multer puts them in req.body["vehicleTypes[]"] or req.body.vehicleTypes
      const v = req.body["vehicleTypes[]"] ?? req.body.vehicleTypes;
      if (!v) throw new Error("At least one vehicle type is required");
      const arr = Array.isArray(v) ? v : [v];
      if (arr.length === 0) throw new Error("At least one vehicle type is required");
      return true;
    }),

  body("pricing")
    .notEmpty().withMessage("Pricing information is required"),
];

const loginRules = [
  body("email")
    .trim()
    .isEmail().withMessage("A valid email address is required")
    .normalizeEmail(),

  body("password")
    .notEmpty().withMessage("Password is required"),
];

const userRegisterRules = [
  body("name")
    .trim()
    .notEmpty().withMessage("Name is required")
    .isLength({ max: 100 }).withMessage("Name cannot exceed 100 characters"),

  body("email")
    .trim()
    .isEmail().withMessage("A valid email address is required")
    .normalizeEmail(),

  body("password")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
];

// ─── Provider auth ────────────────────────────────────────────────────────────

/**
 * @route  POST /api/auth/provider/register
 * @desc   Register a new recovery provider (multipart/form-data)
 * @access Public
 */
router.post(
  "/provider/register",
  uploadProviderDocs,      // Parse multipart FIRST — populates req.body + req.files
  providerRegisterRules,   // Validate flat fields (after multer parses them)
  validate,
  registerProvider
);

/**
 * @route  POST /api/auth/provider/login
 * @desc   Authenticate provider and return JWT
 * @access Public
 */
router.post(
  "/provider/login",
  loginRules,
  validate,
  loginProvider
);

// ─── User auth ────────────────────────────────────────────────────────────────

/**
 * @route  POST /api/auth/user/register
 * @desc   Register a new customer account
 * @access Public
 */
router.post(
  "/user/register",
  userRegisterRules,
  validate,
  registerUser
);

/**
 * @route  POST /api/auth/user/login
 * @desc   Authenticate user and return JWT
 * @access Public
 */
router.post(
  "/user/login",
  loginRules,
  validate,
  loginUser
);

// ─── Shared ───────────────────────────────────────────────────────────────────

/**
 * @route  GET /api/auth/me
 * @desc   Return the currently authenticated entity's profile
 * @access Private
 */
router.get("/me", authenticate, getMe);

/**
 * @route  POST /api/auth/logout
 * @desc   Clear auth cookie and log out
 * @access Private
 */
router.post("/logout", authenticate, logout);

module.exports = router;
