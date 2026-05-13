/**
 * models/Request.js
 * A breakdown assistance request submitted by a driver.
 * The Agentic AI processes this and populates selectedProvider + finalPrice.
 */

const mongoose = require("mongoose");

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const locationSchema = new mongoose.Schema(
  {
    lat: {
      type: Number,
      required: [true, "Latitude is required"],
      min: -90,
      max: 90,
    },
    lng: {
      type: Number,
      required: [true, "Longitude is required"],
      min: -180,
      max: 180,
    },
    address: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

// Scoring details saved for transparency / evaluation
const scoringDetailSchema = new mongoose.Schema(
  {
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: "Provider" },
    companyName: String,
    distanceKm: Number,
    distanceScore: Number,
    availabilityScore: Number,
    priceScore: Number,
    totalScore: Number,
    calculatedPrice: Number,
  },
  { _id: false }
);

// ─── Main schema ──────────────────────────────────────────────────────────────

const requestSchema = new mongoose.Schema(
  {
    // Chat session that created this request (links back to Chat document)
    sessionId: {
      type: String,
      default: null,
      index: true,
    },

    // Who submitted (optional — can be anonymous guest)
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    userLocation: {
      type: locationSchema,
      required: [true, "User location is required"],
    },

    vehicleType: {
      type: String,
      required: [true, "Vehicle type is required"],
      enum: ["Car", "Motorcycle", "Van", "HGV", "4x4", "Other"],
    },

    urgencyLevel: {
      type: String,
      required: [true, "Urgency level is required"],
      enum: ["normal", "high", "critical"],
      default: "normal",
    },

    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },

    preferredLanguage: {
      type: String,
      default: "en",
      trim: true,
      lowercase: true,
    },

    // Populated by Agentic AI after processing
    status: {
      type: String,
      enum: ["pending", "processing", "matched", "accepted", "in_progress", "on_the_way", "completed", "cancelled", "failed", "declined"],
      default: "pending",
    },

    selectedProvider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      default: null,
    },

    finalPrice: {
      type: Number,
      default: null,
      min: [0, "Final price cannot be negative"],
    },

    // Which engine was used (agentic vs baseline)
    matchingMethod: {
      type: String,
      enum: ["agentic", "baseline"],
      default: "agentic",
    },

    // Full scoring breakdown — stored for analytics & explainability
    scoringDetails: [scoringDetailSchema],

    // Provider-side metadata
    providerETA: {
      type: Number, // minutes
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    // Simple audit trail
    timeline: [
      {
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String,
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
requestSchema.index({ status: 1 });
requestSchema.index({ selectedProvider: 1 });
requestSchema.index({ user: 1 });
requestSchema.index({ createdAt: -1 });

// ─── Pre-save: auto-append timeline entry ─────────────────────────────────────
requestSchema.pre("save", function (next) {
  if (this.isModified("status")) {
    this.timeline.push({ status: this.status, timestamp: new Date() });
  }
  next();
});

module.exports = mongoose.model("Request", requestSchema);
