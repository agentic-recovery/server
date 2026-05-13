/**
 * app.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Agentic AI Roadside Recovery System — Express application
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Startup order:
 *   1. Load environment variables
 *   2. Connect to MongoDB
 *   3. Configure Express middleware (security, logging, parsing)
 *   4. Mount API routes
 *   5. Attach 404 and global error handlers
 *   6. Start HTTP server
 */

require("dotenv").config();

const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const morgan      = require("morgan");
const rateLimit    = require("express-rate-limit");
const cookieParser  = require("cookie-parser");
const path          = require("path");

const connectDB   = require("./config/db");

const authRoutes     = require("./routes/authRoutes");
const providerRoutes = require("./routes/providerRoutes");
const requestRoutes  = require("./routes/requestRoutes");
const chatRoutes     = require("./routes/chatRoutes");
const adminRoutes    = require("./routes/adminRoutes");

const { errorHandler, notFound } = require("./middleware/errorHandler");

// ─── Connect to database ──────────────────────────────────────────────────────
connectDB();

// ─── Initialise app ───────────────────────────────────────────────────────────
const app = express();

// ─── Security headers (helmet) ────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, Postman)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS policy: origin '${origin}' not allowed.`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false }));

// ─── Cookie parser (required for HttpOnly cookie auth) ───────────────────────
app.use(cookieParser());

// ─── HTTP request logger ──────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

// ─── Global rate limiter ──────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max:      Number(process.env.RATE_LIMIT_MAX)        || 100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    message: "Too many requests from this IP. Please try again later.",
  },
});
app.use("/api", globalLimiter);

// Stricter limiter for auth endpoints (prevent brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: "Too many authentication attempts. Please wait 15 minutes.",
  },
});
app.use("/api/auth", authLimiter);

// ─── Static: serve uploaded provider docs ────────────────────────────────────
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Agentic AI Recovery API is running",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

// ─── API routes ───────────────────────────────────────────────────────────────
app.use("/api/auth",      authRoutes);
app.use("/api/providers", providerRoutes);
app.use("/api/requests",  requestRoutes);
app.use("/api/chat",      chatRoutes);
app.use("/api/admin",     adminRoutes);    // ← Admin management API     // ← NEW: conversational AI endpoint

// ─── Quick logout route ───────────────────────────────────────────────────────
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("auth-token", { path: "/" });
  res.json({ success: true, message: "Logged out." });
});

// ─── Root redirect ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Agentic AI Roadside Recovery API",
    version: "1.1.0",
    docs:    "/health",
    routes: {
      auth:      "/api/auth",
      providers: "/api/providers",
      requests:  "/api/requests",
      chat:      "/api/chat",
    },
  });
});

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use(notFound);

// ─── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`\n🚀 Server running in ${process.env.NODE_ENV || "development"} mode`);
  console.log(`📡 Listening on http://localhost:${PORT}`);
  console.log(`🤖 Agentic AI engine: ACTIVE\n`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// Catch unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  server.close(() => process.exit(1));
});

module.exports = app; // Export for testing
