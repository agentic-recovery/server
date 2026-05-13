/**
 * middleware/auth.js
 * Supports both cookie-based auth (primary) and Bearer token auth (fallback).
 * Cookie name: auth-token (HttpOnly, Secure in production)
 */

const { verifyToken } = require("../services/authService");
const Provider        = require("../models/Provider");
const User            = require("../models/User");
const { sendError }   = require("../utils/response");

/**
 * Extract JWT from HttpOnly cookie first, then Authorization header.
 */
const extractToken = (req) => {
  // 1. Cookie-based (preferred — HttpOnly, not accessible to JS)
  if (req.cookies && req.cookies["auth-token"]) {
    return req.cookies["auth-token"];
  }
  // 2. Bearer token fallback (for API clients / mobile)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }
  return null;
};

const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return sendError(res, 401, "Authentication required.");
    }

    const decoded = verifyToken(token);

    if (decoded.role === "provider") {
      const provider = await Provider.findById(decoded.id).select("-password");
      if (!provider || !provider.isActive) {
        return sendError(res, 401, "Provider account not found or deactivated.");
      }
      req.entity     = provider;
      req.entityType = "provider";
      req.entityId   = provider._id;
    } else {
      const user = await User.findById(decoded.id).select("-password");
      if (!user || !user.isActive) {
        return sendError(res, 401, "User account not found or deactivated.");
      }
      req.entity     = user;
      req.entityType = "user";
      req.entityId   = user._id;
    }

    req.tokenPayload = decoded;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") return sendError(res, 401, "Token has expired. Please log in again.");
    if (error.name === "JsonWebTokenError") return sendError(res, 401, "Invalid token. Please log in again.");
    next(error);
  }
};

/** Optional auth — attaches entity if token present but never rejects */
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return next();

    const decoded = verifyToken(token);
    if (decoded.role === "provider") {
      const provider = await Provider.findById(decoded.id).select("-password");
      if (provider && provider.isActive) {
        req.entity = provider; req.entityType = "provider"; req.entityId = provider._id;
      }
    } else {
      const user = await User.findById(decoded.id).select("-password");
      if (user && user.isActive) {
        req.entity = user; req.entityType = "user"; req.entityId = user._id;
      }
    }
    req.tokenPayload = decoded;
  } catch { /* ignore auth errors for optional routes */ }
  next();
};

const requireProvider = (req, res, next) => {
  if (req.entityType !== "provider") return sendError(res, 403, "Access restricted to providers.");
  next();
};

const requireUser = (req, res, next) => {
  if (req.entityType !== "user") return sendError(res, 403, "Access restricted to users.");
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.entityType !== "user" || req.entity.role !== "admin") return sendError(res, 403, "Admin access required.");
  next();
};

const requireOwnership = (req, res, next) => {
  if (req.entityType === "user" && req.entity.role === "admin") return next();
  if (req.entityId.toString() !== req.params.id) return sendError(res, 403, "Not authorised to modify this resource.");
  next();
};

// ── Cookie helpers ────────────────────────────────────────────────────────────

const COOKIE_NAME    = "auth-token";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
  maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days in ms
  path:     "/",
};

const setAuthCookie = (res, token) => {
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
};

const clearAuthCookie = (res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
};

module.exports = {
  authenticate,
  optionalAuth,
  requireProvider,
  requireUser,
  requireAdmin,
  requireOwnership,
  setAuthCookie,
  clearAuthCookie,
};
