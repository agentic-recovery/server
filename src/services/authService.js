/**
 * services/authService.js
 * JWT token generation and verification helpers.
 */

const jwt = require("jsonwebtoken");

const SECRET      = () => process.env.JWT_SECRET;
const EXPIRES_IN  = () => process.env.JWT_EXPIRES_IN || "7d";

/**
 * Generate a signed JWT for a provider or user.
 *
 * @param {object} payload - Data to encode (id, role)
 * @returns {string} Signed JWT
 */
const generateToken = (payload) => {
  if (!SECRET()) throw new Error("JWT_SECRET is not configured");
  return jwt.sign(payload, SECRET(), { expiresIn: EXPIRES_IN() });
};

/**
 * Verify and decode a JWT.
 *
 * @param {string} token
 * @returns {object} Decoded payload
 * @throws {JsonWebTokenError | TokenExpiredError}
 */
const verifyToken = (token) => {
  if (!SECRET()) throw new Error("JWT_SECRET is not configured");
  return jwt.verify(token, SECRET());
};

module.exports = { generateToken, verifyToken };
