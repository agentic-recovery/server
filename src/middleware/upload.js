/**
 * middleware/upload.js
 *
 * File storage with automatic Cloudinary / local-disk switching.
 *
 * Cloudinary (production):
 *   Set CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET
 *   Files are stored in ai-recovery/providers/<providerId>/
 *   Returns permanent https:// URLs.
 *
 * Local disk (development fallback):
 *   Files saved to  uploads/providers/<providerId>/
 *   Served via express.static("/uploads")
 */

"use strict";

const multer     = require("multer");
const path       = require("path");
const fs         = require("fs");
const cloudinary = require("cloudinary").v2;

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_MIME   = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ─── Cloudinary setup ─────────────────────────────────────────────────────────

const useCloudinary = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY    &&
  process.env.CLOUDINARY_API_SECRET
);

if (useCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure:     true,
  });
  console.log("[upload] Storage backend: Cloudinary ✓");
} else {
  console.log("[upload] Storage backend: Local disk (add CLOUDINARY_* env vars for production)");
}

// ─── File filter ──────────────────────────────────────────────────────────────

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}. Use JPG, PNG, WebP or PDF.`), false);
  }
};

// ─── Storage engine ───────────────────────────────────────────────────────────

let storage;

if (useCloudinary) {
  const { CloudinaryStorage } = require("multer-storage-cloudinary");

  storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
      // During registration req.params.id is undefined — use "temp" folder.
      // After registration the controller deletes the temp file and re-uploads
      // (or we just accept the temp URL and update it — simpler).
      const providerId  = req.params?.id ?? req.entityId?.toString() ?? "temp";
      const isPdf       = file.mimetype === "application/pdf";
      const publicId    = `${file.fieldname}-${Date.now()}`;

      return {
        folder:        `ai-recovery/providers/${providerId}`,
        public_id:     publicId,
        resource_type: isPdf ? "raw" : "image",
        // Images: compress and auto-format (WebP/AVIF for browsers that support it)
        transformation: isPdf ? undefined : [{ quality: "auto", fetch_format: "auto" }],
        // Preserve extension on raw uploads so "View" links work in browser
        ...(isPdf && { format: "pdf" }),
      };
    },
  });
} else {
  // ── Local disk ─────────────────────────────────────────────────────────────
  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(
        process.cwd(),
        "uploads",
        "providers",
        req.params?.id ?? "temp"
      );
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${file.fieldname}-${Date.now()}${ext}`);
    },
  });
}

// ─── Multer instance ──────────────────────────────────────────────────────────

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE_BYTES } });

const uploadProviderDocs = upload.fields([
  { name: "licenseImage", maxCount: 1 },
  { name: "insuranceDoc", maxCount: 1 },
  { name: "logo",         maxCount: 1 },
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the permanent URL for an uploaded file.
 *
 * multer-storage-cloudinary v4 sets:
 *   file.path     = secure_url  (the https:// URL)
 *   file.filename = public_id
 *
 * Local disk:
 *   file.filename = "licenseImage-1234567890.jpg"
 */
function getFileUrl(file, providerId) {
  if (!file) return null;

  // Cloudinary: file.path is the secure_url
  if (useCloudinary) {
    if (file.path && file.path.startsWith("https://")) return file.path;
    // Fallback: reconstruct from public_id
    if (file.filename) {
      const isPdf = file.mimetype === "application/pdf";
      return cloudinary.url(file.filename, {
        secure:        true,
        resource_type: isPdf ? "raw" : "image",
      });
    }
  }

  // Local disk
  const filename = file.filename ?? path.basename(file.path ?? "");
  return `/uploads/providers/${providerId}/${filename}`;
}

/**
 * Delete an uploaded file by its stored URL.
 * Safe to call with null/undefined (no-op).
 */
async function deleteFile(storedUrl) {
  if (!storedUrl) return;

  try {
    if (useCloudinary && storedUrl.startsWith("https://res.cloudinary.com")) {
      // Derive public_id and resource_type from the URL.
      // Cloudinary URLs: https://res.cloudinary.com/<cloud>/<resource_type>/upload/v<ver>/<public_id>.<ext>
      const urlPath = new URL(storedUrl).pathname; // /<cloud>/image/upload/v.../folder/name.jpg
      const parts   = urlPath.split("/");

      // parts[2] = resource_type (image | raw | video)
      const resourceType = parts[2] === "raw" ? "raw" : "image";

      // public_id is everything after "upload/v<version>/" without extension
      const uploadIdx = parts.indexOf("upload");
      if (uploadIdx !== -1) {
        const afterUpload = parts.slice(uploadIdx + 2).join("/"); // skip "upload" and "v<ver>"
        const publicId    = afterUpload.replace(/\.[^.]+$/, "");  // strip extension

        await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        console.log(`[upload] Cloudinary deleted: ${publicId}`);
      }
    } else if (!storedUrl.startsWith("http")) {
      // Local disk path
      const localPath = path.join(process.cwd(), storedUrl.replace(/^\//, ""));
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        console.log(`[upload] Local deleted: ${localPath}`);
      }
    }
  } catch (err) {
    // Non-fatal — log and continue
    console.error("[upload] deleteFile warning:", err.message);
  }
}

module.exports = { uploadProviderDocs, upload, getFileUrl, deleteFile, useCloudinary };
