/**
 * config/db.js
 * MongoDB connection using Mongoose.
 * Connects once at startup; all models share this connection.
 */

const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // Mongoose 8.x has these on by default, listed for clarity
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log(`✅ MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

// Graceful shutdown hooks
mongoose.connection.on("disconnected", () => {
  console.warn("⚠️  MongoDB disconnected");
});

process.on("SIGINT", async () => {
  await mongoose.connection.close();
  console.log("MongoDB connection closed (SIGINT)");
  process.exit(0);
});

module.exports = connectDB;
