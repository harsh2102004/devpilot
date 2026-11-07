/**
 * DevPilot Secure File Upload Middleware (Multer)
 *
 * Security Controls (Task 5):
 * 1. Storage Location: Files stored in `uploads/avatars` strictly outside `public/`
 *    preventing unauthorized public indexing or direct file execution.
 * 2. MIME & Extension Filter: Restricts accepted files to image/png, image/jpeg, image/webp.
 *    Rejects .html, .js, .exe, .sh, etc. with HTTP 400.
 * 3. File Size Limit: Capped at 5MB per upload.
 * 4. Magic Bytes Signature Verification: Inspects binary header of uploaded file to prevent
 *    MIME-spoofing attacks (e.g. HTML files disguised with a .png extension).
 */

import multer from "multer";
import path from "path";
import fs from "fs";
import { ApiError } from "../utils/ApiError.js";

const UPLOAD_DIR = "./uploads/avatars";

// Guarantee private upload destination exists
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `avatar-${uniqueSuffix}${ext}`);
    },
});

const ALLOWED_MIMES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const ALLOWED_EXTS = [".png", ".jpg", ".jpeg", ".webp"];

/**
 * Validates file extension and reported MIME type
 */
const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();

    if (!ALLOWED_EXTS.includes(ext) || !ALLOWED_MIMES.includes(mime)) {
        return cb(
            new ApiError(
                400,
                `Unsupported file type "${ext || mime}". Only image files (PNG, JPEG, WebP) are allowed.`
            ),
            false
        );
    }

    cb(null, true);
};

export const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter,
});

/**
 * Validates real binary magic bytes of an uploaded image file on disk.
 * Detects MIME spoofing (e.g. HTML file renamed to .png).
 *
 * @param {string} filePath
 * @returns {boolean} True if file has legitimate image magic bytes
 */
export const verifyImageMagicBytes = (filePath) => {
    if (!filePath || !fs.existsSync(filePath)) {
        return false;
    }

    try {
        const buffer = Buffer.alloc(12);
        const fd = fs.openSync(filePath, "r");
        fs.readSync(fd, buffer, 0, 12, 0);
        fs.closeSync(fd);

        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
            return true;
        }

        // JPEG: FF D8 FF
        if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
            return true;
        }

        // WebP: RIFF (bytes 0-3) and WEBP (bytes 8-11)
        if (
            buffer.toString("ascii", 0, 4) === "RIFF" &&
            buffer.toString("ascii", 8, 12) === "WEBP"
        ) {
            return true;
        }

        return false;
    } catch {
        return false;
    }
};

/**
 * Express middleware wrapper for avatar upload handling with clean HTTP 400 errors
 */
export const uploadAvatarMiddleware = (req, res, next) => {
    const uploader = upload.fields([{ name: "avatar", maxCount: 1 }]);

    uploader(req, res, (err) => {
        if (err) {
            if (err instanceof ApiError) {
                return next(err);
            }
            if (err instanceof multer.MulterError) {
                return next(new ApiError(400, `Upload error: ${err.message}`));
            }
            return next(new ApiError(400, err.message || "Invalid file upload"));
        }
        next();
    });
};

export default {
    upload,
    verifyImageMagicBytes,
    uploadAvatarMiddleware,
};
