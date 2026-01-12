const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Use timestamp + original name to avoid conflicts
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// File filter and limits
const fileFilter = (req, file, cb) => {
    const allowedExtensions = [
        '.pdf', '.doc', '.docx', '.ppt', '.pptx',
        '.xls', '.xlsx', '.bmp', '.jpg', '.jpeg',
        '.gif', '.png', '.txt'
    ];

    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
        return cb(new Error('File type not allowed'), false);
    }
    cb(null, true);
};

// We need a custom wrapper to handle dynamic limits based on file type
// Standard multer limits apply to all files in the request.
// However, since we are doing single file uploads or need specific checks,
// we can implement a check inside the fileFilter or as a middleware wrap.
// For simplicity and robustness with multer, we'll set the high limit (100MB) globally
// and then validate specific types in the fileFilter or immediately after upload.
// A cleaner way for "Different limits for different types" in Multer is tricky without custom creation.
// Let's use the max limit (100MB) and checking size manually if needed, 
// BUT Multer `limits` checks `content-length` before stream. 
// So we set limit to 1024 * 1024 * 100 (100MB).
// We will enforce the 20MB limit for non-PDFs in the controller.

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100 MB max for Multer
    }
});

module.exports = upload;
