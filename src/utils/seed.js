/**
 * utils/seed.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Database seeder — populates MongoDB with realistic test data.
 *
 * Usage:
 *   npm run seed              # seed providers + a test user
 *   npm run seed -- --clear   # wipe all collections first, then seed
 *
 * After seeding you can immediately POST /api/requests to watch the
 * Agentic AI score and select from these providers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");
const connectDB = require("../config/db");

const Provider = require("../models/Provider");
const User     = require("../models/User");
const Request  = require("../models/Request");

// ─── Seed data ────────────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    companyName:   "Swift Recovery Ltd",
    email:         "swift@recovery.test",
    password:      "Password123!",
    contactNumber: "+44 7700 900001",
    vehicleTypes:  ["Flatbed", "Wheel Lift", "4x4 Off-Road"],
    serviceArea: {
      city: "Birmingham",
      location: { type: "Point", coordinates: [-1.8904, 52.4862] }, // [lng, lat]
      radiusKm: 40,
    },
    availability: {
      isAvailable:  true,
      emergencyMode: false,
      workingDays:  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      workingHours: { start: "07:00", end: "22:00" },
    },
    pricing: {
      basePrice:  80,
      minPrice:   60,
      maxPrice:   250,
      pricePerKm: 1.8,
    },
    negotiation: {
      urgencyAdjustment: 20,
      nightSurcharge:    15,
      weekendPremium:    10,
      autoNegotiation:   true,
    },
    stats: { totalJobs: 312, completedJobs: 295, averageRating: 4.7, responseRate: 96 },
    isVerified: true,
  },
  {
    companyName:   "Midland Rescue Services",
    email:         "midland@recovery.test",
    password:      "Password123!",
    contactNumber: "+44 7700 900002",
    vehicleTypes:  ["Flatbed", "Heavy Duty", "Van Recovery"],
    serviceArea: {
      city: "Coventry",
      location: { type: "Point", coordinates: [-1.5197, 52.4068] },
      radiusKm: 35,
    },
    availability: {
      isAvailable:  true,
      emergencyMode: true,
      workingDays:  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      workingHours: { start: "00:00", end: "23:59" },
    },
    pricing: {
      basePrice:  95,
      minPrice:   70,
      maxPrice:   300,
      pricePerKm: 2.0,
    },
    negotiation: {
      urgencyAdjustment: 25,
      nightSurcharge:    20,
      weekendPremium:    15,
      autoNegotiation:   true,
    },
    stats: { totalJobs: 548, completedJobs: 521, averageRating: 4.9, responseRate: 98 },
    isVerified: true,
  },
  {
    companyName:   "M6 Motorway Assist",
    email:         "m6assist@recovery.test",
    password:      "Password123!",
    contactNumber: "+44 7700 900003",
    vehicleTypes:  ["Flatbed", "Wheel Lift", "Motorcycle"],
    serviceArea: {
      city: "Wolverhampton",
      location: { type: "Point", coordinates: [-2.1294, 52.5851] },
      radiusKm: 50,
    },
    availability: {
      isAvailable:  true,
      emergencyMode: false,
      workingDays:  ["Mon", "Tue", "Wed", "Thu", "Fri"],
      workingHours: { start: "06:00", end: "20:00" },
    },
    pricing: {
      basePrice:  75,
      minPrice:   55,
      maxPrice:   200,
      pricePerKm: 1.5,
    },
    negotiation: {
      urgencyAdjustment: 15,
      nightSurcharge:    10,
      weekendPremium:    5,
      autoNegotiation:   true,
    },
    stats: { totalJobs: 189, completedJobs: 175, averageRating: 4.5, responseRate: 91 },
    isVerified: true,
  },
  {
    companyName:   "BudgetBreakdown UK",
    email:         "budget@recovery.test",
    password:      "Password123!",
    contactNumber: "+44 7700 900004",
    vehicleTypes:  ["Car", "Flatbed", "Van Recovery"],
    serviceArea: {
      city: "Leicester",
      location: { type: "Point", coordinates: [-1.1318, 52.6369] },
      radiusKm: 25,
    },
    availability: {
      isAvailable:  true,
      emergencyMode: false,
      workingDays:  ["Mon", "Tue", "Wed", "Thu", "Fri"],
      workingHours: { start: "08:00", end: "18:00" },
    },
    pricing: {
      basePrice:  60,
      minPrice:   45,
      maxPrice:   150,
      pricePerKm: 1.2,
    },
    negotiation: {
      urgencyAdjustment: 10,
      nightSurcharge:    5,
      weekendPremium:    5,
      autoNegotiation:   false, // Fixed pricing — no AI negotiation
    },
    stats: { totalJobs: 87, completedJobs: 80, averageRating: 4.1, responseRate: 88 },
    isVerified: false,
  },
  {
    companyName:   "HeavyHaul Pro",
    email:         "heavyhaul@recovery.test",
    password:      "Password123!",
    contactNumber: "+44 7700 900005",
    vehicleTypes:  ["Heavy Duty", "HGV", "4x4 Off-Road"],
    serviceArea: {
      city: "Nottingham",
      location: { type: "Point", coordinates: [-1.1581, 52.9548] },
      radiusKm: 60,
    },
    availability: {
      isAvailable:  true,
      emergencyMode: true,
      workingDays:  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      workingHours: { start: "05:00", end: "23:00" },
    },
    pricing: {
      basePrice:  150,
      minPrice:   120,
      maxPrice:   500,
      pricePerKm: 3.0,
    },
    negotiation: {
      urgencyAdjustment: 30,
      nightSurcharge:    25,
      weekendPremium:    20,
      autoNegotiation:   true,
    },
    stats: { totalJobs: 203, completedJobs: 199, averageRating: 4.8, responseRate: 99 },
    isVerified: true,
  },
  {
    companyName:   "NightOwl Recovery",
    email:         "nightowl@recovery.test",
    password:      "Password123!",
    contactNumber: "+44 7700 900006",
    vehicleTypes:  ["Flatbed", "Wheel Lift", "Motorcycle", "Van Recovery"],
    serviceArea: {
      city: "Derby",
      location: { type: "Point", coordinates: [-1.4750, 52.9225] },
      radiusKm: 45,
    },
    availability: {
      isAvailable:  true,
      emergencyMode: true,
      workingDays:  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      workingHours: { start: "18:00", end: "06:00" },
    },
    pricing: {
      basePrice:  90,
      minPrice:   65,
      maxPrice:   280,
      pricePerKm: 1.9,
    },
    negotiation: {
      urgencyAdjustment: 20,
      nightSurcharge:    0,   // Night is their specialty — no extra surcharge
      weekendPremium:    10,
      autoNegotiation:   true,
    },
    stats: { totalJobs: 421, completedJobs: 410, averageRating: 4.6, responseRate: 97 },
    isVerified: true,
  },
  // Offline provider — should never be matched
  {
    companyName:   "Inactive Towing Co",
    email:         "inactive@recovery.test",
    password:      "Password123!",
    contactNumber: "+44 7700 900099",
    vehicleTypes:  ["Flatbed", "Wheel Lift"],
    serviceArea: {
      city: "Birmingham",
      location: { type: "Point", coordinates: [-1.8904, 52.4862] },
      radiusKm: 30,
    },
    availability: {
      isAvailable:  false,
      emergencyMode: false,
      workingDays:  ["Mon", "Tue", "Wed", "Thu", "Fri"],
      workingHours: { start: "09:00", end: "17:00" },
    },
    pricing: {
      basePrice:  70,
      minPrice:   50,
      maxPrice:   180,
      pricePerKm: 1.6,
    },
    negotiation: {
      urgencyAdjustment: 15,
      nightSurcharge:    10,
      weekendPremium:    5,
      autoNegotiation:   true,
    },
    isVerified: false,
  },
];

const USERS = [
  {
    name:     "Alice Driver",
    email:    "alice@user.test",
    password: "Password123!",
    role:     "user",
  },
  {
    name:     "Bob Motorist",
    email:    "bob@user.test",
    password: "Password123!",
    role:     "user",
  },
];

// ─── Seeder function ──────────────────────────────────────────────────────────

const seed = async () => {
  try {
    await connectDB();

    const args     = process.argv.slice(2);
    const doClear  = args.includes("--clear");

    if (doClear) {
      console.log("🗑  Clearing collections...");
      await Promise.all([
        Provider.deleteMany({}),
        User.deleteMany({}),
        Request.deleteMany({}),
      ]);
      console.log("   ✓ Collections cleared.\n");
    }

    // ── Seed providers ────────────────────────────────────────────────────
    console.log("🏗  Seeding providers...");
    const providerResults = [];

    for (const p of PROVIDERS) {
      // Check if already exists
      const existing = await Provider.findOne({ email: p.email });
      if (existing) {
        console.log(`   ⚠  Provider '${p.companyName}' already exists — skipping.`);
        providerResults.push(existing);
        continue;
      }

      // Password hashing is handled by the pre-save hook
      const doc = await Provider.create(p);
      providerResults.push(doc);
      const [sLng, sLat] = doc.serviceArea.location.coordinates;
      console.log(`   ✓ ${doc.companyName.padEnd(30)} (${doc.email}) @ (${sLat.toFixed(4)},${sLng.toFixed(4)}) r=${doc.serviceArea.radiusKm}km`);
    }

    // ── Seed users ────────────────────────────────────────────────────────
    console.log("\n👤 Seeding users...");
    for (const u of USERS) {
      const existing = await User.findOne({ email: u.email });
      if (existing) {
        console.log(`   ⚠  User '${u.name}' already exists — skipping.`);
        continue;
      }
      const doc = await User.create(u);
      console.log(`   ✓ ${doc.name} (${doc.email})`);
    }

    // ── Summary ───────────────────────────────────────────────────────────
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ Seeding complete!\n");
    console.log("🔑 Provider login credentials:");
    PROVIDERS.forEach((p) => {
      console.log(`   ${p.companyName.padEnd(26)} ${p.email} / Password123!`);
    });
    console.log("\n👤 User login credentials:");
    USERS.forEach((u) => {
      console.log(`   ${u.name.padEnd(20)} ${u.email} / Password123!`);
    });
    console.log("\n📌 Test request body (POST /api/requests):");
    console.log(JSON.stringify({
      userLocation: { lat: 52.4862, lng: -1.8904, address: "Birmingham City Centre" },
      vehicleType: "Car",
      urgencyLevel: "high",
      description: "Broken down on ring road, need urgent recovery",
      preferredLanguage: "en",
      method: "agentic",
    }, null, 2));
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Seed failed:", error.message);
    process.exit(1);
  }
};

seed();
