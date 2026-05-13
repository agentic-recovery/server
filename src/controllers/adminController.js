/**
 * controllers/adminController.js
 * Full admin control: auth, stats, provider approval, user management.
 */

"use strict";

const Admin    = require("../models/Admin");
const Provider = require("../models/Provider");
const User     = require("../models/User");
const Request  = require("../models/Request");
const { generateToken }                    = require("../services/authService");
const { sendSuccess, sendError, buildPaginationMeta } = require("../utils/response");
const { setAdminCookie, clearAdminCookie } = require("../middleware/adminAuth");
const emailService                         = require("../services/emailService");

// ─────────────────────────────────────────────────────────────────────────────
//  Auth
// ─────────────────────────────────────────────────────────────────────────────

const registerAdmin = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    // Prevent registration if admins already exist (first-time setup only)
    // Remove this check after seeding your first admin, or only allow superAdmins to create new admins
    const existingCount = await Admin.countDocuments();
    if (existingCount > 0 && !req.admin?.isSuperAdmin) {
      return sendError(res, 403, "Admin registration is disabled. Contact a super admin.");
    }

    const existing = await Admin.findOne({ email: email.toLowerCase() });
    if (existing) return sendError(res, 409, "An admin account with this email already exists.");

    const admin = await Admin.create({
      name,
      email,
      password,
      isSuperAdmin: existingCount === 0, // First admin is always super admin
    });

    const token = generateToken({ id: admin._id, role: "admin" });
    setAdminCookie(res, token);

    console.log(`[admin] Admin registered: ${admin.email}`);
    return sendSuccess(res, 201, "Admin account created.", { token, admin: admin.toPublicJSON() });
  } catch (err) { next(err); }
};

const loginAdmin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email: email.toLowerCase() }).select("+password");
    if (!admin) return sendError(res, 401, "Invalid email or password.");

    const match = await admin.comparePassword(password);
    if (!match)  return sendError(res, 401, "Invalid email or password.");

    await Admin.findByIdAndUpdate(admin._id, { lastLogin: new Date() });
    const token = generateToken({ id: admin._id, role: "admin" });
    setAdminCookie(res, token);

    console.log(`[admin] Login: ${admin.email}`);
    return sendSuccess(res, 200, "Login successful.", { token, admin: admin.toPublicJSON() });
  } catch (err) { next(err); }
};

const logoutAdmin = (req, res) => {
  clearAdminCookie(res);
  return sendSuccess(res, 200, "Logged out successfully.");
};

const getMe = (req, res) => {
  return sendSuccess(res, 200, "Admin profile.", req.admin.toPublicJSON());
};

// ─────────────────────────────────────────────────────────────────────────────
//  Dashboard stats
// ─────────────────────────────────────────────────────────────────────────────

const getDashboardStats = async (req, res, next) => {
  try {
    const now        = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalProviders,
      activeProviders,
      blockedProviders,
      pendingApproval,
      approvedProviders,
      totalCustomers,
      activeCustomers,
      blockedCustomers,
      totalRequests,
      completedRequests,
      todayProviders,
      todayCustomers,
    ] = await Promise.all([
      Provider.countDocuments(),
      Provider.countDocuments({ isActive: true,  isBlocked: false }),
      Provider.countDocuments({ isBlocked: true }),
      Provider.countDocuments({ isApproved: false, isActive: true }),
      Provider.countDocuments({ isApproved: true }),
      User.countDocuments({ role: "user" }),
      User.countDocuments({ role: "user", isActive: true,  isBlocked: false }),
      User.countDocuments({ role: "user", isBlocked: true }),
      Request.countDocuments(),
      Request.countDocuments({ status: "completed" }),
      Provider.countDocuments({ createdAt: { $gte: startToday } }),
      User.countDocuments({ role: "user", createdAt: { $gte: startToday } }),
    ]);

    // Last 7 days signups
    const last7Days = await Promise.all(
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const end   = new Date(start); end.setDate(end.getDate() + 1);
        return Promise.all([
          Provider.countDocuments({ createdAt: { $gte: start, $lt: end } }),
          User.countDocuments({ role: "user", createdAt: { $gte: start, $lt: end } }),
        ]).then(([p, u]) => ({
          date:      start.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
          providers: p,
          customers: u,
        }));
      })
    );

    return sendSuccess(res, 200, "Dashboard stats.", {
      providers: { total: totalProviders, active: activeProviders, blocked: blockedProviders, pendingApproval, approved: approvedProviders, newToday: todayProviders },
      customers: { total: totalCustomers, active: activeCustomers, blocked: blockedCustomers, newToday: todayCustomers },
      requests:  { total: totalRequests, completed: completedRequests },
      signupChart: last7Days,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
//  Provider management
// ─────────────────────────────────────────────────────────────────────────────

const getProviders = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = {};
    if (search) {
      const re = new RegExp(search, "i");
      filter.$or = [{ companyName: re }, { email: re }, { contactNumber: re }];
    }
    if (status === "approved")  filter.isApproved = true;
    if (status === "pending")   { filter.isApproved = false; filter.isBlocked = false; }
    if (status === "blocked")   filter.isBlocked = true;

    const [providers, total] = await Promise.all([
      Provider.find(filter)
        .select("-password -__v")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Provider.countDocuments(filter),
    ]);

    return sendSuccess(res, 200, "Providers retrieved.", providers, buildPaginationMeta(page, limit, total));
  } catch (err) { next(err); }
};

const getProviderById = async (req, res, next) => {
  try {
    const provider = await Provider.findById(req.params.id).select("-password -__v");
    if (!provider) return sendError(res, 404, "Provider not found.");
    return sendSuccess(res, 200, "Provider retrieved.", provider);
  } catch (err) { next(err); }
};

const approveProvider = async (req, res, next) => {
  try {
    const provider = await Provider.findById(req.params.id);
    if (!provider) return sendError(res, 404, "Provider not found.");

    provider.isApproved         = true;
    provider.verificationStatus = "approved";
    await provider.save();

    emailService.sendProviderApproved(provider).catch((e) =>
      console.error("[admin email] approveProvider:", e.message)
    );

    console.log(`[admin] Provider approved: ${provider.email} by admin: ${req.admin.email}`);
    return sendSuccess(res, 200, "Provider approved.", provider.toPublicJSON());
  } catch (err) { next(err); }
};

const rejectProvider = async (req, res, next) => {
  try {
    const provider = await Provider.findById(req.params.id);
    if (!provider) return sendError(res, 404, "Provider not found.");

    const reason = (req.body.reason ?? "").trim() || "Does not meet verification requirements.";
    provider.isApproved         = false;
    provider.verificationStatus = "rejected";
    provider.verificationNotes  = reason;
    provider.isActive           = false;
    await provider.save();

    emailService.sendProviderRejected(provider, reason).catch((e) =>
      console.error("[admin email] rejectProvider:", e.message)
    );

    console.log(`[admin] Provider rejected: ${provider.email} reason="${reason}"`);
    return sendSuccess(res, 200, "Provider rejected.", provider.toPublicJSON());
  } catch (err) { next(err); }
};

const blockProvider = async (req, res, next) => {
  try {
    const provider = await Provider.findByIdAndUpdate(
      req.params.id,
      { isBlocked: true, isActive: false, "availability.isAvailable": false },
      { new: true }
    );
    if (!provider) return sendError(res, 404, "Provider not found.");

    emailService.sendAccountBlocked(provider.email, provider.companyName, "provider").catch((e) =>
      console.error("[admin email] blockProvider:", e.message)
    );

    console.log(`[admin] Provider blocked: ${provider.email}`);
    return sendSuccess(res, 200, "Provider blocked.", { id: provider._id, isBlocked: true });
  } catch (err) { next(err); }
};

const unblockProvider = async (req, res, next) => {
  try {
    const provider = await Provider.findByIdAndUpdate(
      req.params.id,
      { isBlocked: false, isActive: true },
      { new: true }
    );
    if (!provider) return sendError(res, 404, "Provider not found.");

    emailService.sendAccountUnblocked(provider.email, provider.companyName, "provider").catch((e) =>
      console.error("[admin email] unblockProvider:", e.message)
    );

    console.log(`[admin] Provider unblocked: ${provider.email}`);
    return sendSuccess(res, 200, "Provider unblocked.", { id: provider._id, isBlocked: false });
  } catch (err) { next(err); }
};

const deleteProvider = async (req, res, next) => {
  try {
    const provider = await Provider.findByIdAndDelete(req.params.id);
    if (!provider) return sendError(res, 404, "Provider not found.");
    console.log(`[admin] Provider deleted: ${provider.email}`);
    return sendSuccess(res, 200, "Provider deleted permanently.");
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
//  Customer management
// ─────────────────────────────────────────────────────────────────────────────

const getCustomers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    const skip   = (Number(page) - 1) * Number(limit);
    const filter = { role: "user" };
    if (search) {
      const re = new RegExp(search, "i");
      filter.$or = [{ name: re }, { email: re }];
    }
    if (status === "active")  { filter.isBlocked = false; filter.isActive = true; }
    if (status === "blocked") filter.isBlocked = true;

    const [customers, total] = await Promise.all([
      User.find(filter).select("-password -__v").sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      User.countDocuments(filter),
    ]);

    return sendSuccess(res, 200, "Customers retrieved.", customers, buildPaginationMeta(page, limit, total));
  } catch (err) { next(err); }
};

const getCustomerById = async (req, res, next) => {
  try {
    const customer = await User.findOne({ _id: req.params.id, role: "user" }).select("-password -__v");
    if (!customer) return sendError(res, 404, "Customer not found.");
    return sendSuccess(res, 200, "Customer retrieved.", customer);
  } catch (err) { next(err); }
};

const blockCustomer = async (req, res, next) => {
  try {
    const customer = await User.findByIdAndUpdate(
      req.params.id, { isBlocked: true, isActive: false }, { new: true }
    );
    if (!customer) return sendError(res, 404, "Customer not found.");

    emailService.sendAccountBlocked(customer.email, customer.name, "customer").catch((e) =>
      console.error("[admin email] blockCustomer:", e.message)
    );

    console.log(`[admin] Customer blocked: ${customer.email}`);
    return sendSuccess(res, 200, "Customer blocked.", { id: customer._id, isBlocked: true });
  } catch (err) { next(err); }
};

const unblockCustomer = async (req, res, next) => {
  try {
    const customer = await User.findByIdAndUpdate(
      req.params.id, { isBlocked: false, isActive: true }, { new: true }
    );
    if (!customer) return sendError(res, 404, "Customer not found.");

    emailService.sendAccountUnblocked(customer.email, customer.name, "customer").catch((e) =>
      console.error("[admin email] unblockCustomer:", e.message)
    );

    console.log(`[admin] Customer unblocked: ${customer.email}`);
    return sendSuccess(res, 200, "Customer unblocked.", { id: customer._id, isBlocked: false });
  } catch (err) { next(err); }
};

const deleteCustomer = async (req, res, next) => {
  try {
    const customer = await User.findOneAndDelete({ _id: req.params.id, role: "user" });
    if (!customer) return sendError(res, 404, "Customer not found.");
    console.log(`[admin] Customer deleted: ${customer.email}`);
    return sendSuccess(res, 200, "Customer deleted permanently.");
  } catch (err) { next(err); }
};

module.exports = {
  // Auth
  registerAdmin, loginAdmin, logoutAdmin, getMe,
  // Dashboard
  getDashboardStats,
  // Providers
  getProviders, getProviderById, approveProvider, rejectProvider,
  blockProvider, unblockProvider, deleteProvider,
  // Customers
  getCustomers, getCustomerById, blockCustomer, unblockCustomer, deleteCustomer,
};
