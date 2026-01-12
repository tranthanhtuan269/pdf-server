const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const upload = require('./uploadConfig');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.post('/api/upload', upload.single('file'), (req, file, next) => {
    // Middleware error handling for Multer
    // This callback doesn't catch Multer errors directly if passed as strictly middleware above.
    // But we wrapped it? No, we used it directly.
    // Let's rely on global error handler or wrap it in controller if we need fine-grained control.
    next();
}, (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded or file type not allowed' });
    }

    const file = req.file;
    const ext = path.extname(file.originalname).toLowerCase();
    const size = file.size; // bytes

    // Post-upload size check for non-PDF files (Max 20MB)
    if (ext !== '.pdf') {
        const limit20MB = 20 * 1024 * 1024;
        if (size > limit20MB) {
            // Delete the file
            fs.unlink(file.path, (err) => {
                if (err) console.error('Error removing large file:', err);
            });
            return res.status(400).json({ error: `File too large for type ${ext}. Max 20MB allowed.` });
        }
    }

    // Success
    res.json({
        message: 'File uploaded successfully',
        file: {
            filename: file.filename,
            originalname: file.originalname,
            path: file.path,
            url: `http://localhost:${PORT}/uploads/${file.filename}`,
            type: ext === '.pdf' ? 'pdf' : 'other'
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
    } else if (err) {
        return res.status(500).json({ error: err.message });
    }
    next();
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
