/**
 * middleware/errorHandler.js
 * Global Express error handler.
 *
 * Must be registered LAST in the middleware chain (after all routes).
 * Catches any error passed to next(err) or thrown inside async handlers.
 *
 * Normalises common Mongoose/JWT errors into clean API responses.
 */

const { sendError } = require("../utils/response");

const errorHandler = (err, req, res, next) => {
  // Already responded — skip
  if (res.headersSent) return next(err);

  let statusCode = err.statusCode || 500;
  let message    = err.message    || "Internal server error";

  // ── Mongoose validation error ─────────────────────────────────────────────
  if (err.name === "ValidationError") {
    statusCode = 422;
    const errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    message = "Validation failed";
    return sendError(res, statusCode, message, errors);
  }

  // ── Mongoose duplicate key ────────────────────────────────────────────────
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue)[0];
    message = `An account with this ${field} already exists.`;
    return sendError(res, statusCode, message);
  }

  // ── Mongoose bad ObjectId ─────────────────────────────────────────────────
  if (err.name === "CastError" && err.kind === "ObjectId") {
    statusCode = 400;
    message = `Invalid ID format: ${err.value}`;
    return sendError(res, statusCode, message);
  }

  // ── JWT errors ────────────────────────────────────────────────────────────
  if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token.";
    return sendError(res, statusCode, message);
  }

  if (err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Token has expired.";
    return sendError(res, statusCode, message);
  }

  // ── Development vs production detail ─────────────────────────────────────
  if (process.env.NODE_ENV === "development") {
    console.error(`[ERROR] ${err.stack}`);
    return res.status(statusCode).json({
      success: false,
      message,
      stack: err.stack,
    });
  }

  // Production: never leak stack traces
  console.error(`[ERROR] ${statusCode} — ${message}`);
  return sendError(res, statusCode, message);
};

/**
 * 404 handler — register BEFORE errorHandler but AFTER all routes.
 */
const notFound = (req, res) => {
  sendError(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);
};

module.exports = { errorHandler, notFound };
