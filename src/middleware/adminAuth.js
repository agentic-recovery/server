/**
 * middleware/adminAuth.js
 * Admin-specific auth — uses a separate "admin-token" cookie.
 * Completely isolated from provider/user auth.
 */

"use strict";

const { verifyToken } = require("../services/authService");
const Admin           = require("../models/Admin");
const { sendError }   = require("../utils/response");

const ADMIN_COOKIE      = "admin-token";
const ADMIN_COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
  maxAge:   8 * 60 * 60 * 1000, // 8 hours (shorter than provider sessions)
  path:     "/",
};

// ── Set / clear cookie helpers ────────────────────────────────────────────────

const setAdminCookie = (res, token) => res.cookie(ADMIN_COOKIE, token, ADMIN_COOKIE_OPTS);
const clearAdminCookie = (res) => res.clearCookie(ADMIN_COOKIE, { path: "/" });

// ── protectAdmin ─────────────────────────────────────────────────────────────
// Verifies the admin-token cookie and attaches req.admin

const protectAdmin = async (req, res, next) => {
  try {
    // Accept cookie first, then Authorization header (for API clients)
    const token =
      req.cookies?.[ADMIN_COOKIE] ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.split(" ")[1]
        : null);

    if (!token) return sendError(res, 401, "Admin authentication required.");

    const decoded = verifyToken(token);
    if (decoded.role !== "admin") return sendError(res, 403, "Admin access only.");

    const admin = await Admin.findById(decoded.id);
    if (!admin) return sendError(res, 401, "Admin account not found.");

    req.admin = admin;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") return sendError(res, 401, "Admin session expired. Please log in again.");
    if (err.name === "JsonWebTokenError")  return sendError(res, 401, "Invalid admin token.");
    next(err);
  }
};

// ── isAdmin ──────────────────────────────────────────────────────────────────
// Alias — confirms role is "admin" (used after protectAdmin)

const isAdmin = (req, res, next) => {
  if (!req.admin || req.admin.role !== "admin") {
    return sendError(res, 403, "Forbidden — admin role required.");
  }
  next();
};

module.exports = { protectAdmin, isAdmin, setAdminCookie, clearAdminCookie };
