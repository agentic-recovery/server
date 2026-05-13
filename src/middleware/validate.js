/**
 * middleware/validate.js
 * express-validator helper — runs validation chains and returns
 * a structured 422 if any fail.
 */

const { validationResult } = require("express-validator");
const { sendError }        = require("../utils/response");

/**
 * Run after express-validator check() chains.
 * If errors exist, return 422 with field-level detail.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formatted = errors.array().map((e) => ({
      field:   e.path,
      message: e.msg,
    }));
    return sendError(res, 422, "Validation failed", formatted);
  }
  next();
};

module.exports = { validate };
