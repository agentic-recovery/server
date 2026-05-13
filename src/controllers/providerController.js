/**
 * controllers/providerController.js
 * CRUD operations for Provider documents.
 * Read endpoints are public; write endpoints require provider auth.
 */

"use strict";

const Provider = require("../models/Provider");
const { sendSuccess, sendError, buildPaginationMeta } = require("../utils/response");

// ── Upload helpers — MUST be imported here ────────────────────────────────────
// These were missing in the previous version, causing ReferenceError on every
// document update request.
const { getFileUrl, deleteFile, useCloudinary } = require("../middleware/upload");

const PRIVATE_FIELDS = "-password -__v";
const PUBLIC_FIELDS  = "-password -__v";

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/providers
// ─────────────────────────────────────────────────────────────────────────────

const getAllProviders = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, city, vehicleType, available, sortBy = "createdAt", order = "desc" } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter = { isActive: true };

    if (city)        filter["serviceArea.city"] = new RegExp(city, "i");
    if (vehicleType) filter.vehicleTypes = vehicleType;
    if (available !== undefined) filter["availability.isAvailable"] = available === "true";

    const sortOrder = order === "asc" ? 1 : -1;
    const sortField = ["createdAt", "companyName", "stats.averageRating"].includes(sortBy) ? sortBy : "createdAt";

    const [providers, total] = await Promise.all([
      Provider.find(filter).select(PUBLIC_FIELDS).sort({ [sortField]: sortOrder }).skip(skip).limit(Number(limit)).lean({ virtuals: true }),
      Provider.countDocuments(filter),
    ]);

    return sendSuccess(res, 200, "Providers retrieved.", providers, buildPaginationMeta(page, limit, total));
  } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/providers/:id
// ─────────────────────────────────────────────────────────────────────────────

const getProviderById = async (req, res, next) => {
  try {
    const provider = await Provider.findById(req.params.id).select(PRIVATE_FIELDS).lean({ virtuals: true });
    if (!provider) return sendError(res, 404, "Provider not found.");
    return sendSuccess(res, 200, "Provider retrieved.", provider);
  } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUT /api/providers/:id
//  Update profile, serviceArea, pricing, negotiation, availability.
//  Also accepts address/postcode/city/lat/lng for location updates.
// ─────────────────────────────────────────────────────────────────────────────

const updateProvider = async (req, res, next) => {
  try {
    // Strip fields that must not be updated via this endpoint
    const forbidden = ["password", "email", "_id", "stats", "isVerified", "verificationStatus",
                       "licenseImageUrl", "insuranceDocUrl"];
    forbidden.forEach((f) => delete req.body[f]);

    // Pricing sanity check
    if (req.body.pricing) {
      const { minPrice, maxPrice } = req.body.pricing;
      if (minPrice !== undefined && maxPrice !== undefined && Number(minPrice) > Number(maxPrice)) {
        return sendError(res, 422, "minPrice cannot exceed maxPrice.");
      }
    }

    // If lat + lng provided, also update serviceArea.location.coordinates
    const updates = { ...req.body };
    if (updates.lat != null && updates.lng != null) {
      const lat = parseFloat(updates.lat);
      const lng = parseFloat(updates.lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        if (!updates.serviceArea) updates.serviceArea = {};
        if (!updates.serviceArea.location) {
          updates.serviceArea.location = { type: "Point", coordinates: [lng, lat] };
        } else {
          updates.serviceArea.location.coordinates = [lng, lat];
        }
        // Also sync city into serviceArea
        if (updates.city) updates.serviceArea.city = updates.city;
      }
    }

    const provider = await Provider.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select(PRIVATE_FIELDS);

    if (!provider) return sendError(res, 404, "Provider not found.");

    console.log(`[provider] Profile updated: ${provider._id}`);
    return sendSuccess(res, 200, "Provider updated.", provider.toPublicJSON());
  } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH /api/providers/:id/documents
//  Update verification documents (files) and/or text identity fields.
//  Accepts multipart/form-data.
// ─────────────────────────────────────────────────────────────────────────────

const updateDocuments = async (req, res, next) => {
  try {
    const provider = await Provider.findById(req.params.id);
    if (!provider) return sendError(res, 404, "Provider not found.");

    const updates = {};
    const pid     = provider._id.toString();

    // ── Text / identity fields ────────────────────────────────────────────────
    if (req.body.licenseNumber   != null)
      updates.licenseNumber   = req.body.licenseNumber.trim()   || null;
    if (req.body.carRegistration != null)
      updates.carRegistration = req.body.carRegistration.trim().toUpperCase() || null;
    if (req.body.providerType    != null)
      updates.providerType    = req.body.providerType            || null;

    // ── Location fields (sent from profile address autocomplete) ─────────────
    if (req.body.address  != null) updates.address  = req.body.address.trim()           || null;
    if (req.body.postcode != null) updates.postcode = req.body.postcode.trim().toUpperCase() || null;
    if (req.body.city     != null) updates.city     = req.body.city.trim()               || null;

    const newLat = req.body.lat != null ? parseFloat(req.body.lat) : null;
    const newLng = req.body.lng != null ? parseFloat(req.body.lng) : null;
    if (newLat !== null && !isNaN(newLat)) updates.lat = newLat;
    if (newLng !== null && !isNaN(newLng)) updates.lng = newLng;

    // Keep serviceArea.location.coordinates in sync with lat/lng
    if (updates.lat != null && updates.lng != null) {
      updates["serviceArea.location.type"]        = "Point";
      updates["serviceArea.location.coordinates"] = [updates.lng, updates.lat];
      if (updates.city) updates["serviceArea.city"] = updates.city;
    }

    // ── File uploads ──────────────────────────────────────────────────────────
    if (req.files) {
      // licenseImage
      if (req.files.licenseImage?.[0]) {
        const file = req.files.licenseImage[0];

        // Delete the old file before saving the new URL
        await deleteFile(provider.licenseImageUrl);

        const url = getFileUrl(file, pid);
        if (!url) {
          console.error("[provider] getFileUrl returned null for licenseImage", file);
          return sendError(res, 500, "File upload failed — could not determine file URL.");
        }
        updates.licenseImageUrl = url;
        console.log(`[provider] licenseImage URL: ${url} (cloudinary=${useCloudinary})`);
      }

      // insuranceDoc
      if (req.files.insuranceDoc?.[0]) {
        const file = req.files.insuranceDoc[0];

        await deleteFile(provider.insuranceDocUrl);

        const url = getFileUrl(file, pid);
        if (!url) {
          console.error("[provider] getFileUrl returned null for insuranceDoc", file);
          return sendError(res, 500, "File upload failed — could not determine file URL.");
        }
        updates.insuranceDocUrl = url;
        console.log(`[provider] insuranceDoc URL: ${url} (cloudinary=${useCloudinary})`);
      }

      // Provider logo
      if (req.files.logo?.[0]) {
        const file = req.files.logo[0];

        await deleteFile(provider.logoUrl);

        const url = getFileUrl(file, pid);
        if (!url) {
          console.error("[provider] getFileUrl returned null for logo", file);
          return sendError(res, 500, "File upload failed — could not determine logo URL.");
        }
        updates.logoUrl = url;
        console.log(`[provider] logo URL: ${url} (cloudinary=${useCloudinary})`);
      }
    }

    if (Object.keys(updates).length === 0) {
      return sendError(res, 422, "No fields to update. Send at least one field or file.");
    }

    const updated = await Provider.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: false }
    );

    if (!updated) return sendError(res, 404, "Provider not found after update.");

    console.log(`[provider] Documents updated: ${pid} — fields: ${Object.keys(updates).join(", ")}`);
    return sendSuccess(res, 200, "Documents updated.", updated.toPublicJSON());
  } catch (error) {
    console.error("[provider] updateDocuments error:", error);
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH /api/providers/:id/availability
// ─────────────────────────────────────────────────────────────────────────────

const updateAvailability = async (req, res, next) => {
  try {
    const { isAvailable, emergencyMode, workingDays, workingHours } = req.body;
    const updateFields = {};
    if (isAvailable   !== undefined) updateFields["availability.isAvailable"]  = isAvailable;
    if (emergencyMode !== undefined) updateFields["availability.emergencyMode"] = emergencyMode;
    if (workingDays   !== undefined) updateFields["availability.workingDays"]   = workingDays;
    if (workingHours  !== undefined) updateFields["availability.workingHours"]  = workingHours;

    const provider = await Provider.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select(PRIVATE_FIELDS);

    if (!provider) return sendError(res, 404, "Provider not found.");
    return sendSuccess(res, 200, "Availability updated.", { availability: provider.availability });
  } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────────────────────
//  DELETE /api/providers/:id  (soft delete)
// ─────────────────────────────────────────────────────────────────────────────

const deleteProvider = async (req, res, next) => {
  try {
    const provider = await Provider.findByIdAndUpdate(
      req.params.id,
      { isActive: false, "availability.isAvailable": false },
      { new: true }
    );
    if (!provider) return sendError(res, 404, "Provider not found.");
    return sendSuccess(res, 200, "Provider account deactivated.");
  } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/providers/:id/stats
// ─────────────────────────────────────────────────────────────────────────────

const getProviderStats = async (req, res, next) => {
  try {
    const provider = await Provider.findById(req.params.id)
      .select("stats companyName completionRate")
      .lean({ virtuals: true });
    if (!provider) return sendError(res, 404, "Provider not found.");
    return sendSuccess(res, 200, "Stats retrieved.", {
      companyName:    provider.companyName,
      stats:          provider.stats,
      completionRate: provider.completionRate,
    });
  } catch (error) { next(error); }
};

module.exports = {
  getAllProviders,
  getProviderById,
  updateProvider,
  updateDocuments,
  updateAvailability,
  deleteProvider,
  getProviderStats,
};
