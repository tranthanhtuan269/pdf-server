const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer'); // Added multer import
const muhammara = require('muhammara'); // Added muhammara import
const upload = require('./uploadConfig'); // Original upload configuration for disk storage

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Simple logging middleware
app.use((req, res, next) => {
    const logMessage = `${new Date().toISOString()} - ${req.method} ${req.url}\n`;
    console.log(logMessage.trim());
    fs.appendFile(path.join(__dirname, 'server.log'), logMessage, (err) => {
        if (err) console.error("Failed to write to log file:", err);
    });
    next();
});

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer setup for memory storage, specifically for the /api/process-pdf route
const uploadMemory = multer({ storage: multer.memoryStorage() });

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

// Endpoint to process (encrypt) PDF
app.post('/api/process-pdf', uploadMemory.single('file'), (req, res) => {
    console.log("Received encryption request");

    if (!req.file || !req.body.password) {
        return res.status(400).send("Missing file or password");
    }

    const password = req.body.password;
    const inputPath = path.join(__dirname, `temp_in_${Date.now()}.pdf`);
    const outputPath = path.join(__dirname, `temp_out_${Date.now()}.pdf`);

    try {
        // Write buffer to temp file
        fs.writeFileSync(inputPath, req.file.buffer);

        // Encrypt by creating a NEW PDF with encryption and copying pages
        // This is the reliable way to "add password" using raw muhammara/hummus
        const pdfWriter = muhammara.createWriter(outputPath, {
            userPassword: password,
            ownerPassword: password,
            userProtectionFlag: 4
        });

        // Copy all pages from the input PDF
        const copyingContext = pdfWriter.createPDFCopyingContext(inputPath);
        const pdfReader = muhammara.createReader(inputPath);
        const pageCount = pdfReader.getPagesCount();

        for (let i = 0; i < pageCount; i++) {
            copyingContext.appendPDFPageFromPDF(i);
        }

        // Finalize
        pdfWriter.end();

        // Send back the encrypted file
        res.download(outputPath, 'encrypted.pdf', (err) => {
            // Cleanup temp files with a slight delay to avoid EBUSY on Windows
            setTimeout(() => {
                if (fs.existsSync(inputPath)) {
                    try { fs.unlinkSync(inputPath); } catch (e) { console.error("Could not delete input temp:", e.message); }
                }
                if (fs.existsSync(outputPath)) {
                    try { fs.unlinkSync(outputPath); } catch (e) { console.error("Could not delete output temp:", e.message); }
                }
            }, 1000);

            if (err) console.error("Error sending file:", err);
        });

    } catch (err) {
        console.error("Encryption error:", err);
        // Cleanup on error (also delayed)
        setTimeout(() => {
            if (fs.existsSync(inputPath)) try { fs.unlinkSync(inputPath); } catch (e) { }
            if (fs.existsSync(outputPath)) try { fs.unlinkSync(outputPath); } catch (e) { }
        }, 1000);

        if (!res.headersSent) {
            res.status(500).send("Encryption failed: " + err.message);
        }
    }
});

// Endpoint to compress (optimize) PDF
app.post('/api/compress-pdf', uploadMemory.single('file'), (req, res) => {
    console.log("Received compression request");

    if (!req.file) {
        return res.status(400).send("Missing file");
    }

    const inputPath = path.join(__dirname, `temp_comp_in_${Date.now()}.pdf`);
    const outputPath = path.join(__dirname, `temp_comp_out_${Date.now()}.pdf`);

    try {
        fs.writeFileSync(inputPath, req.file.buffer);

        // Optimization attempt using muhammara
        muhammara.recrypt(inputPath, outputPath, {
            // compression settings could go here if supported by the specific version/API
        });

        // Smart Check: Compare sizes
        const inputSize = fs.statSync(inputPath).size;
        const outputSize = fs.statSync(outputPath).size;

        console.log(`Compression result: Original=${inputSize}, Compressed=${outputSize}`);

        if (outputSize < inputSize) {
            // Compression successful
            res.download(outputPath, `compressed_${req.file.originalname}`, (err) => {
                cleanupFiles();
                if (err) console.error("Error sending compressed file:", err);
            });
        } else {
            // Compression ineffective (file grew or stayed same), return original
            console.log("Compressed file is larger. Returning original.");
            res.download(inputPath, req.file.originalname, (err) => {
                cleanupFiles();
                if (err) console.error("Error sending original file:", err);
            });
        }

        function cleanupFiles() {
            setTimeout(() => {
                if (fs.existsSync(inputPath)) try { fs.unlinkSync(inputPath); } catch (e) { }
                if (fs.existsSync(outputPath)) try { fs.unlinkSync(outputPath); } catch (e) { }
            }, 1000);
        }

    } catch (err) {
        console.error("Compression error:", err);
        setTimeout(() => {
            if (fs.existsSync(inputPath)) try { fs.unlinkSync(inputPath); } catch (e) { }
            if (fs.existsSync(outputPath)) try { fs.unlinkSync(outputPath); } catch (e) { }
        }, 1000);
        res.status(500).send("Compression failed: " + err.message);
    }
});

// Endpoint to unlock (remove password) from PDF
app.post('/api/unlock-pdf', uploadMemory.single('file'), (req, res) => {
    console.log("Received unlock request");

    if (!req.file || !req.body.password) {
        return res.status(400).send("Missing file or password");
    }

    const password = req.body.password;
    const inputPath = path.join(__dirname, `temp_unlock_in_${Date.now()}.pdf`);
    const outputPath = path.join(__dirname, `temp_unlock_out_${Date.now()}.pdf`);

    try {
        fs.writeFileSync(inputPath, req.file.buffer);

        // To "unlock" (remove password), we simply create a new PDF Writer 
        // that reads from the encrypted source (providing the password)
        // and writes to a new file WITHOUT encryption options.

        // 1. Create a Writer for the new unlocked file
        const pdfWriter = muhammara.createWriter(outputPath);

        // 2. Create a Copying Context from the encrypted source
        const copyingContext = pdfWriter.createPDFCopyingContext(inputPath, { password: password });

        // 3. Copy all pages
        const pdfReader = muhammara.createReader(inputPath, { password: password });
        const pageCount = pdfReader.getPagesCount();

        for (let i = 0; i < pageCount; i++) {
            copyingContext.appendPDFPageFromPDF(i);
        }

        pdfWriter.end();

        // Send back the unlocked file
        res.download(outputPath, 'unlocked.pdf', (err) => {
            setTimeout(() => {
                if (fs.existsSync(inputPath)) try { fs.unlinkSync(inputPath); } catch (e) { }
                if (fs.existsSync(outputPath)) try { fs.unlinkSync(outputPath); } catch (e) { }
            }, 1000);
            if (err) console.error("Error sending unlocked file:", err);
        });

    } catch (err) {
        console.error("Unlock error:", err);
        setTimeout(() => {
            if (fs.existsSync(inputPath)) try { fs.unlinkSync(inputPath); } catch (e) { }
            if (fs.existsSync(outputPath)) try { fs.unlinkSync(outputPath); } catch (e) { }
        }, 1000);
        res.status(500).send("Unlock failed (Wrong Password?): " + err.message);
    }
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
