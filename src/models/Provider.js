/**
 * models/Provider.js
 * Recovery truck company profile.
 * Stores all data the Agentic AI engine needs:
 *   - location for distance scoring
 *   - availability for availability scoring
 *   - pricing & negotiation rules for price scoring
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const serviceAreaSchema = new mongoose.Schema(
  {
    city: {
      type: String,
      required: [true, "Service city is required"],
      trim: true,
    },
    // GeoJSON point — enables MongoDB $nearSphere queries in future
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
        validate: {
          validator: (v) => v.length === 2,
          message: "Coordinates must be [longitude, latitude]",
        },
      },
    },
    radiusKm: {
      type: Number,
      required: [true, "Service radius is required"],
      min: [1, "Radius must be at least 1 km"],
      max: [500, "Radius cannot exceed 500 km"],
      default: 30,
    },
  },
  { _id: false }
);

const workingHoursSchema = new mongoose.Schema(
  {
    start: { type: String, default: "07:00" }, // "HH:MM" 24-hr format
    end: { type: String, default: "20:00" },
  },
  { _id: false }
);

const availabilitySchema = new mongoose.Schema(
  {
    isAvailable: { type: Boolean, default: true },
    emergencyMode: {
      type: Boolean,
      default: false,
      comment: "Accept calls outside working hours",
    },
    workingDays: {
      type: [String],
      enum: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      default: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    },
    workingHours: {
      type: workingHoursSchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

const pricingSchema = new mongoose.Schema(
  {
    basePrice: {
      type: Number,
      required: [true, "Base price is required"],
      min: [0, "Base price cannot be negative"],
      default: 80,
    },
    minPrice: {
      type: Number,
      required: [true, "Minimum price is required"],
      min: [0, "Minimum price cannot be negative"],
      default: 60,
    },
    maxPrice: {
      type: Number,
      required: [true, "Maximum price is required"],
      default: 250,
    },
    pricePerKm: {
      type: Number,
      required: [true, "Price per km is required"],
      min: [0, "Price per km cannot be negative"],
      default: 1.5,
    },
  },
  { _id: false }
);

const negotiationSchema = new mongoose.Schema(
  {
    // Percentage added for urgent requests (0–100)
    urgencyAdjustment: {
      type: Number,
      min: [0, "Cannot be negative"],
      max: [100, "Cannot exceed 100%"],
      default: 20,
    },
    // Percentage added for night-time requests (0–100)
    nightSurcharge: {
      type: Number,
      min: [0, "Cannot be negative"],
      max: [100, "Cannot exceed 100%"],
      default: 15,
    },
    // Weekend premium (0–100)
    weekendPremium: {
      type: Number,
      min: [0, "Cannot be negative"],
      max: [100, "Cannot exceed 100%"],
      default: 10,
    },
    // If false, always use basePrice (no AI negotiation)
    autoNegotiation: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

// ─── Main schema ──────────────────────────────────────────────────────────────

const providerSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      maxlength: [150, "Company name cannot exceed 150 characters"],
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },

    contactNumber: {
      type: String,
      required: [true, "Contact number is required"],
      trim: true,
    },

    // ── Full address — populated from address autocomplete ───────────────────
    postcode: { type: String, trim: true, uppercase: true, default: null },
    address:  { type: String, trim: true, default: null },
    city:     { type: String, trim: true, default: null },
    lat:      { type: Number, default: null },
    lng:      { type: Number, default: null },

    // ── Provider logo ─────────────────────────────────────────────────────────
    logoUrl: { type: String, default: null },

    vehicleTypes: {
      type: [String],
      enum: ["Flatbed", "Wheel Lift", "Heavy Duty", "Motorcycle", "Van Recovery", "4x4 Off-Road"],
      required: [true, "At least one vehicle type is required"],
      validate: {
        validator: (v) => v.length > 0,
        message: "At least one vehicle type must be selected",
      },
    },

    serviceArea: {
      type: serviceAreaSchema,
      required: true,
    },

    availability: {
      type: availabilitySchema,
      default: () => ({}),
    },

    pricing: {
      type: pricingSchema,
      required: true,
    },

    negotiation: {
      type: negotiationSchema,
      default: () => ({}),
    },

    // Aggregate stats updated as jobs complete
    stats: {
      totalJobs: { type: Number, default: 0 },
      completedJobs: { type: Number, default: 0 },
      averageRating: { type: Number, default: 0, min: 0, max: 5 },
      responseRate: { type: Number, default: 100, min: 0, max: 100 },
    },

    // ── Onboarding / verification ────────────────────────────────────────
    licenseNumber:    { type: String, trim: true, default: null },
    licenseImageUrl:  { type: String, default: null },
    carRegistration:  { type: String, trim: true, default: null },
    insuranceDocUrl:  { type: String, default: null },
    providerType: {
      type: String,
      enum: ["self_employed", "company", null],
      default: null,
    },
    verificationStatus: {
      type: String,
      enum: ["pending_verification", "approved", "rejected"],
      default: "pending_verification",
    },
    verificationNotes: { type: String, default: null },

    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isApproved: { type: Boolean, default: false },
    isBlocked: {type: Boolean, default: false},
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Index for geospatial queries ─────────────────────────────────────────────
providerSchema.index({ "serviceArea.location": "2dsphere" });
providerSchema.index({ "availability.isAvailable": 1 });
providerSchema.index({ email: 1 });

// ─── Virtual: completion rate ─────────────────────────────────────────────────
providerSchema.virtual("completionRate").get(function () {
  if (this.stats.totalJobs === 0) return 100;
  return Math.round((this.stats.completedJobs / this.stats.totalJobs) * 100);
});

// ─── Pre-save: hash password ──────────────────────────────────────────────────
providerSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  // Validate pricing constraints
  if (this.pricing.minPrice > this.pricing.maxPrice) {
    return next(new Error("minPrice cannot exceed maxPrice"));
  }

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ─── Instance method: compare password ───────────────────────────────────────
providerSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ─── Instance method: safe public profile ────────────────────────────────────
providerSchema.methods.toPublicJSON = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.password;
  return obj;
};

module.exports = mongoose.model("Provider", providerSchema);
