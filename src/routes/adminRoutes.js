/**
 * routes/adminRoutes.js
 * All /api/admin/* endpoints.
 * Auth endpoints are rate-limited; management endpoints require protectAdmin.
 */

"use strict";

const express  = require("express");
const { body } = require("express-validator");
const { protectAdmin, isAdmin } = require("../middleware/adminAuth");
const { validate }              = require("../middleware/validate");
const {
  registerAdmin, loginAdmin, logoutAdmin, getMe,
  getDashboardStats,
  getProviders, getProviderById, approveProvider, rejectProvider,
  blockProvider, unblockProvider, deleteProvider,
  getCustomers, getCustomerById, blockCustomer, unblockCustomer, deleteCustomer,
} = require("../controllers/adminController");

const router = express.Router();

// ── Validation rules ──────────────────────────────────────────────────────────

const registerRules = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
  body("password").isLength({ min: 10 }).withMessage("Password must be at least 10 characters"),
];

const loginRules = [
  body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
  body("password").notEmpty().withMessage("Password is required"),
];

// ── Auth (public — no middleware) ─────────────────────────────────────────────
router.post("/register", registerRules, validate, registerAdmin);
router.post("/login",    loginRules,    validate, loginAdmin);
router.post("/logout",   protectAdmin,  logoutAdmin);
router.get ("/me",       protectAdmin,  getMe);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/stats", protectAdmin, isAdmin, getDashboardStats);

// ── Provider management ───────────────────────────────────────────────────────
router.get   ("/providers",          protectAdmin, isAdmin, getProviders);
router.get   ("/providers/:id",      protectAdmin, isAdmin, getProviderById);
router.patch ("/providers/:id/approve",  protectAdmin, isAdmin, approveProvider);
router.patch ("/providers/:id/reject",   protectAdmin, isAdmin,
  [body("reason").optional().isString()], validate, rejectProvider);
router.patch ("/providers/:id/block",    protectAdmin, isAdmin, blockProvider);
router.patch ("/providers/:id/unblock",  protectAdmin, isAdmin, unblockProvider);
router.delete("/providers/:id",          protectAdmin, isAdmin, deleteProvider);

// ── Customer management ───────────────────────────────────────────────────────
router.get   ("/customers",         protectAdmin, isAdmin, getCustomers);
router.get   ("/customers/:id",     protectAdmin, isAdmin, getCustomerById);
router.patch ("/customers/:id/block",   protectAdmin, isAdmin, blockCustomer);
router.patch ("/customers/:id/unblock", protectAdmin, isAdmin, unblockCustomer);
router.delete("/customers/:id",         protectAdmin, isAdmin, deleteCustomer);

module.exports = router;
