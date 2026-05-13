/**
 * models/Admin.js
 * Separate admin accounts — completely isolated from providers and users.
 * Admins cannot book jobs or register as providers.
 */

"use strict";

const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const adminSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: [true, "Name is required"],
      trim:     true,
      maxlength: 100,
    },
    email: {
      type:      String,
      required:  [true, "Email is required"],
      unique:    true,
      lowercase: true,
      trim:      true,
      match:     [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type:      String,
      required:  [true, "Password is required"],
      minlength: [10, "Admin password must be at least 10 characters"],
      select:    false,
    },
    role: {
      type:    String,
      default: "admin",
      immutable: true,
    },
    isSuperAdmin: {
      type:    Boolean,
      default: false,
    },
    lastLogin: {
      type:    Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

adminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt    = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

adminSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

adminSchema.methods.toPublicJSON = function () {
  return {
    id:           this._id,
    name:         this.name,
    email:        this.email,
    role:         this.role,
    isSuperAdmin: this.isSuperAdmin,
    lastLogin:    this.lastLogin,
    createdAt:    this.createdAt,
  };
};

module.exports = mongoose.model("Admin", adminSchema);
