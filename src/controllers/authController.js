/**
 * controllers/authController.js
 * Cookie-based auth for providers and users.
 * registerProvider accepts multipart/form-data (for file uploads).
 */

const fs   = require("fs");
const path = require("path");

const Provider          = require("../models/Provider");
const User              = require("../models/User");
const { generateToken } = require("../services/authService");
const { sendSuccess, sendError } = require("../utils/response");
const { setAuthCookie, clearAuthCookie } = require("../middleware/auth");
const { sendWelcomeUser, sendWelcomeProvider } = require("../services/emailService");
const { getFileUrl, deleteFile }                = require("../middleware/upload");

// ─── Helper: safely parse a field that may be a JSON string or already parsed ──

function parseJson(value, fieldName) {
  if (value == null) return null;
  if (typeof value === "object") return value;  // already parsed (JSON body)
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      console.warn(`[auth] Could not parse field "${fieldName}" as JSON:`, value.slice(0, 100));
      return null;
    }
  }
  return null;
}

// ─── Helper: resolve vehicleTypes from FormData (may appear as array or repeated field) ──

function resolveVehicleTypes(body) {
  // multer puts repeated foo[] fields under body["vehicleTypes[]"]
  // Single value comes under body.vehicleTypes as a string
  const raw = body["vehicleTypes[]"] ?? body.vehicleTypes;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string") return [raw].filter(Boolean);
  return [];
}

// ─── Helper: move uploaded file from temp dir to provider dir ──────────────────

function moveFile(srcDir, destDir, filename) {
  const src = path.join(srcDir, filename);
  const dst = path.join(destDir, filename);
  if (fs.existsSync(src)) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(src, dst);
    return true;
  }
  return false;
}

// ─── Provider auth ────────────────────────────────────────────────────────────

const registerProvider = async (req, res, next) => {
  try {
    const body = req.body;

    console.log("[auth] registerProvider body keys:", Object.keys(body));
    console.log("[auth] registerProvider files:", req.files ? Object.keys(req.files) : "none");

    // ── Parse all fields ──────────────────────────────────────────────────────

    const companyName    = (body.companyName ?? "").trim();
    const email          = (body.email ?? "").trim().toLowerCase();
    const password       = body.password ?? "";
    const contactNumber  = (body.contactNumber ?? "").trim();
    const postcode       = (body.postcode ?? "").trim().toUpperCase() || null;
    const address        = (body.address ?? "").trim() || null;
    const licenseNumber  = (body.licenseNumber  ?? "").trim() || null;
    const carRegistration= (body.carRegistration ?? "").trim().toUpperCase() || null;
    const providerType   = body.providerType ?? null;

    const serviceArea  = parseJson(body.serviceArea,  "serviceArea");
    const pricing      = parseJson(body.pricing,      "pricing");
    const availability = parseJson(body.availability, "availability");
    const negotiation  = parseJson(body.negotiation,  "negotiation");
    const vehicleTypes = resolveVehicleTypes(body);

    // Extract lat/lng from serviceArea.location.coordinates if present
    // GeoJSON format: coordinates = [lng, lat]
    let lat = parseFloat(body.lat ?? "0") || null;
    let lng = parseFloat(body.lng ?? "0") || null;
    if (!lat && serviceArea?.location?.coordinates?.length === 2) {
      lng = serviceArea.location.coordinates[0] || null;
      lat = serviceArea.location.coordinates[1] || null;
    }
    const city = (body.city ?? serviceArea?.city ?? "").trim() || null;

    // ── Validate required fields ──────────────────────────────────────────────

    const missing = [];
    if (!companyName)            missing.push("companyName");
    if (!email)                  missing.push("email");
    if (!password)               missing.push("password");
    if (!contactNumber)          missing.push("contactNumber");
    if (!serviceArea)            missing.push("serviceArea");
    if (!serviceArea?.city)      missing.push("serviceArea.city");
    if (vehicleTypes.length < 1) missing.push("vehicleTypes");
    if (!pricing)                missing.push("pricing");
    if (!pricing?.basePrice)     missing.push("pricing.basePrice");
    if (!pricing?.minPrice && pricing?.minPrice !== 0) missing.push("pricing.minPrice");
    if (!pricing?.maxPrice)      missing.push("pricing.maxPrice");
    if (!pricing?.pricePerKm && pricing?.pricePerKm !== 0) missing.push("pricing.pricePerKm");

    if (missing.length > 0) {
      console.warn("[auth] registerProvider missing fields:", missing);
      return sendError(res, 422, `Missing required fields: ${missing.join(", ")}`);
    }

    // ── Duplicate check ───────────────────────────────────────────────────────

    const existing = await Provider.findOne({ email });
    if (existing) return sendError(res, 409, "A provider account with this email already exists.");

    // ── Ensure serviceArea has valid GeoJSON coordinates ──────────────────────
    // If coordinates weren't provided (e.g. postcode not geocoded), default to [0,0]
    if (!serviceArea.location) {
      serviceArea.location = { type: "Point", coordinates: [0, 0] };
    }
    if (!serviceArea.location.coordinates || serviceArea.location.coordinates.length < 2) {
      serviceArea.location.coordinates = [0, 0];
    }

    // ── File upload: temp paths (renamed after we have provider ID) ───────────
    const tempDir = path.join(process.cwd(), "uploads", "providers", "temp");
    let licenseImageUrl = null;
    let insuranceDocUrl = null;

    if (req.files?.licenseImage?.[0]) {
      licenseImageUrl = `/uploads/providers/temp/${req.files.licenseImage[0].filename}`;
    }
    if (req.files?.insuranceDoc?.[0]) {
      insuranceDocUrl = `/uploads/providers/temp/${req.files.insuranceDoc[0].filename}`;
    }

    // ── Create provider document ──────────────────────────────────────────────

    // Ensure serviceArea.location.coordinates are set from lat/lng
    if (serviceArea && lat && lng) {
      if (!serviceArea.location) serviceArea.location = { type: "Point", coordinates: [0, 0] };
      serviceArea.location.coordinates = [lng, lat]; // GeoJSON: [lng, lat]
    }

    const provider = await Provider.create({
      companyName,
      email,
      password,
      contactNumber,
      postcode,
      address,
      city,
      lat,
      lng,
      serviceArea,
      vehicleTypes,
      pricing,
      licenseNumber,
      licenseImageUrl,
      carRegistration,
      insuranceDocUrl,
      providerType,
      ...(availability && { availability }),
      ...(negotiation  && { negotiation }),
    });

    // ── For LOCAL disk: move files from temp/ → provider dir ──────────────────
    // For Cloudinary: URLs are already permanent — nothing to move.
    const { useCloudinary } = require("../middleware/upload");
    if (req.files && !useCloudinary) {
      const tempDir     = path.join(process.cwd(), "uploads", "providers", "temp");
      const providerDir = path.join(process.cwd(), "uploads", "providers", provider._id.toString());
      let dirty = false;

      if (req.files.licenseImage?.[0]) {
        const filename = req.files.licenseImage[0].filename;
        if (moveFile(tempDir, providerDir, filename)) {
          provider.licenseImageUrl = `/uploads/providers/${provider._id}/${filename}`;
          dirty = true;
        }
      }
      if (req.files.insuranceDoc?.[0]) {
        const filename = req.files.insuranceDoc[0].filename;
        if (moveFile(tempDir, providerDir, filename)) {
          provider.insuranceDocUrl = `/uploads/providers/${provider._id}/${filename}`;
          dirty = true;
        }
      }
      if (dirty) await provider.save();
    }

    // ── Auth cookie + response ─────────────────────────────────────────────────

    const token = generateToken({ id: provider._id, role: "provider" });
    setAuthCookie(res, token);

    sendWelcomeProvider(provider).catch((e) =>
      console.error("[email] welcomeProvider failed:", e.message)
    );

    console.log(`[auth] Provider registered: ${provider.email} id=${provider._id}`);
    return sendSuccess(res, 201, "Provider registered successfully.", {
      token,
      provider: provider.toPublicJSON(),
    });
  } catch (error) {
    console.error("[auth] registerProvider error:", error);
    next(error);
  }
};

const loginProvider = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const provider = await Provider.findOne({ email: email.toLowerCase(), isActive: true }).select("+password");
    if (!provider) return sendError(res, 401, "Invalid email or password.");

    const isMatch = await provider.comparePassword(password);
    if (!isMatch) return sendError(res, 401, "Invalid email or password.");

    const token = generateToken({ id: provider._id, role: "provider" });
    setAuthCookie(res, token);

    console.log(`[auth] Provider login: ${provider.email}`);
    return sendSuccess(res, 200, "Login successful.", { token, provider: provider.toPublicJSON() });
  } catch (error) { next(error); }
};

// ─── User auth ────────────────────────────────────────────────────────────────

const registerUser = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return sendError(res, 409, "A user account with this email already exists.");

    const user  = await User.create({ name, email, password, role: "user" });
    const token = generateToken({ id: user._id, role: "user" });
    setAuthCookie(res, token);

    sendWelcomeUser(user).catch((e) =>
      console.error("[email] welcomeUser failed:", e.message)
    );

    console.log(`[auth] User registered: ${user.email}`);
    return sendSuccess(res, 201, "User registered successfully.", { token, user: user.toPublicJSON() });
  } catch (error) { next(error); }
};

const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase(), isActive: true }).select("+password");
    if (!user) return sendError(res, 401, "Invalid email or password.");

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return sendError(res, 401, "Invalid email or password.");

    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });
    const token = generateToken({ id: user._id, role: "user" });
    setAuthCookie(res, token);

    console.log(`[auth] User login: ${user.email}`);
    return sendSuccess(res, 200, "Login successful.", { token, user: user.toPublicJSON() });
  } catch (error) { next(error); }
};

// ─── Logout ───────────────────────────────────────────────────────────────────

const logout = (req, res) => {
  clearAuthCookie(res);
  console.log(`[auth] Logout: ${req.entity?.email || "unknown"}`);
  return sendSuccess(res, 200, "Logged out successfully.");
};

// ─── Get current user ─────────────────────────────────────────────────────────

const getMe = async (req, res, next) => {
  try {
    const data = req.entityType === "provider"
      ? { entityType: "provider", profile: req.entity.toPublicJSON() }
      : { entityType: "user",     profile: req.entity.toPublicJSON() };
    return sendSuccess(res, 200, "Profile retrieved.", data);
  } catch (error) { next(error); }
};

module.exports = { registerProvider, loginProvider, registerUser, loginUser, logout, getMe };
