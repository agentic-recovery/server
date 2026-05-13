/**
 * utils/response.js
 * Standardised API response helpers.
 * All endpoints use these to ensure a consistent response envelope.
 *
 * Success envelope:
 *   { success: true, message, data, meta }
 *
 * Error envelope:
 *   { success: false, message, errors?, stack? }
 */

/**
 * Send a successful response.
 *
 * @param {object} res         - Express response object
 * @param {number} statusCode  - HTTP status code (default 200)
 * @param {string} message     - Human-readable message
 * @param {*}      data        - Response payload
 * @param {object} [meta]      - Optional pagination / extra metadata
 */
const sendSuccess = (res, statusCode = 200, message = "Success", data = null, meta = null) => {
  const payload = { success: true, message };
  if (data !== null) payload.data = data;
  if (meta !== null) payload.meta = meta;
  return res.status(statusCode).json(payload);
};

/**
 * Send an error response.
 *
 * @param {object} res         - Express response object
 * @param {number} statusCode  - HTTP status code (default 500)
 * @param {string} message     - Human-readable error message
 * @param {Array}  [errors]    - Field-level validation errors
 */
const sendError = (res, statusCode = 500, message = "Internal server error", errors = null) => {
  const payload = { success: false, message };
  if (errors) payload.errors = errors;
  if (process.env.NODE_ENV === "development" && errors?.stack) {
    payload.stack = errors.stack;
  }
  return res.status(statusCode).json(payload);
};

/**
 * Build pagination meta from query params + total count.
 *
 * @param {number} page  - Current page (1-based)
 * @param {number} limit - Items per page
 * @param {number} total - Total matching documents
 * @returns {object}
 */
const buildPaginationMeta = (page, limit, total) => ({
  page: Number(page),
  limit: Number(limit),
  total,
  totalPages: Math.ceil(total / limit),
  hasNextPage: page * limit < total,
  hasPrevPage: page > 1,
});

module.exports = { sendSuccess, sendError, buildPaginationMeta };
