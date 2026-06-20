const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// In server.js, when calling the Python script
// const pythonProcess = spawn('python', [
//     path.join(__dirname, 'predict_severity.py'),  // Use __dirname for current directory
//     JSON.stringify(featureData)
// ]);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'issue-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
        }
    }
});

// SQLite Database Connection
const db = new sqlite3.Database('./civicpulse.db', (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// Add this function to server.js
const { spawn } = require('child_process');

// Function to predict severity using Python model
async function predictIssueSeverity(title, description, category, coordinates) {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python', [
            path.join(__dirname, 'predict_severity.py'),
            JSON.stringify({
                title,
                description,
                category,
                lat: coordinates.lat,
                lng: coordinates.lng,
                upvotes: 0  // New issues have no votes yet
            })
        ]);
        
        let result = '';
        let error = '';
        
        pythonProcess.stdout.on('data', (data) => {
            result += data.toString();
        });
        
        pythonProcess.stderr.on('data', (data) => {
            error += data.toString();
        });
        
        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                console.error('Python process error:', error);
                // Fallback to rule-based prediction
                resolve(ruleBasedSeverityPrediction(title, description, category));
                return;
            }
            
            try {
                const prediction = JSON.parse(result);
                resolve(prediction);
            } catch (e) {
                console.error('Error parsing prediction result:', e);
                resolve(ruleBasedSeverityPrediction(title, description, category));
            }
        });
    });
}

// Fallback rule-based prediction
function ruleBasedSeverityPrediction(title, description, category) {
    const text = `${title} ${description}`.toLowerCase();
    
    // Critical patterns (same as in Python script)
    const criticalPatterns = {
        "Electricity": [/electric.*water|water.*electric|live.*wire.*water/i, /transformer.*fire/i, /power line.*down/i, /electric shock/i],
        "Roads": [/bridge.*collapse|bridge.*damage/i, /road.*collapse|sinkhole/i, /landslide/i, /major.*accident/i],
        "Water Supply": [/water.*contamination|contaminated.*water/i, /sewage.*leak|sewage.*water/i, /main.*break|pipe.*burst/i],
        "Public Safety": [/active.*shooter|gun.*violence/i, /fire.*building|building.*fire/i, /explosion|blast/i, /violent.*crime/i],
        "Sanitation": [/hazardous.*waste|toxic.*waste/i, /chemical.*spill|gas.*leak/i, /medical.*waste|biohazard/i]
    };
    
    const crossCategoryPatterns = [/immediate.*danger|life.*threatening/i, /emergency.*services|ambulance.*needed/i, /children.*at.*risk/i, /hospital.*affected/i, /evacuation.*needed/i];
    
    // Check category-specific patterns
    if (category in criticalPatterns) {
        for (const pattern of criticalPatterns[category]) {
            if (pattern.test(text)) {
                return { severity: 3, is_critical: true, reason: `Critical pattern detected in ${category}` };
            }
        }
    }
    
    // Check cross-category patterns
    for (const pattern of crossCategoryPatterns) {
        if (pattern.test(text)) {
            return { severity: 3, is_critical: true, reason: "Critical pattern detected" };
        }
    }
    
    // Default to moderate
    return { severity: 1, is_critical: false, reason: "Default classification" };
}

// Function to notify authorities about critical issues
async function notifyAuthorities(issueId, severityPrediction) {
    try {
        // Get all authorities
        const authorities = await dbAll('SELECT * FROM authorities');
        
        // Create notification for each authority
        for (const authority of authorities) {
            await dbRun(
                `INSERT INTO notifications (user_id, text, is_critical, created_at) 
                 VALUES (?, ?, ?, ?)`,
                [
                    authority.id,
                    `CRITICAL ISSUE: Severity ${severityPrediction.severity}/3. ${severityPrediction.reason}`,
                    1,
                    new Date().toISOString()
                ]
            );
        }
        
        console.log(`Notified ${authorities.length} authorities about critical issue #${issueId}`);
    } catch (error) {
        console.error('Error notifying authorities:', error);
    }
}

// Enhanced Haversine formula to calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // Distance in kilometers
    return distance * 1000; // Convert to meters
}

// Enhanced text similarity using multiple algorithms
function calculateTextSimilarity(text1, text2) {
    // Jaccard similarity
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    const jaccardSimilarity = intersection.size / union.size;
    
    // Levenshtein distance similarity
    function levenshteinDistance(str1, str2) {
        const matrix = [];
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        return matrix[str2.length][str1.length];
    }
    
    const maxLength = Math.max(text1.length, text2.length);
    const levenshteinSimilarity = maxLength > 0 ? 1 - (levenshteinDistance(text1.toLowerCase(), text2.toLowerCase()) / maxLength) : 1;
    
    // Combined similarity score (weighted average)
    return (jaccardSimilarity * 0.6) + (levenshteinSimilarity * 0.4);
}

// Enhanced keyword extraction for better duplicate detection
function extractKeywords(text, title = '', category = '') {
    const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
        'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'
    ]);
    
    // Combine title, category, and description for keyword extraction
    const combinedText = `${title} ${category} ${text}`.toLowerCase();
    
    // Extract meaningful keywords
    const words = combinedText.match(/\b\w{3,}\b/g) || [];
    const keywords = words
        .filter(word => !stopWords.has(word))
        .reduce((acc, word) => {
            acc[word] = (acc[word] || 0) + 1;
            return acc;
        }, {});
    
    // Return top keywords sorted by frequency
    return Object.entries(keywords)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([word]) => word);
}

// Advanced spam detection system
function detectSpamContent(title, description, category) {
    const spamIndicators = {
        repetitiveWords: /(.+?)\1{2,}/gi, // Repeated words/phrases
        excessiveCaps: /[A-Z]{5,}/g, // Excessive capitals
        spamPhrases: [
            'click here', 'free money', 'urgent action required', 'act now',
            'limited time', 'congratulations', 'you have won', 'claim now'
        ],
        suspiciousChars: /[^\w\s\.,!?-]/g, // Unusual characters
        shortMeaningless: /^.{1,5}$/g // Very short content
    };
    
    let spamScore = 0;
    const text = `${title} ${description}`.toLowerCase();
    
    // Check for repetitive content
    if (spamIndicators.repetitiveWords.test(text)) spamScore += 30;
    
    // Check for excessive capitals
    if (spamIndicators.excessiveCaps.test(title + description)) spamScore += 20;
    
    // Check for spam phrases
    spamIndicators.spamPhrases.forEach(phrase => {
        if (text.includes(phrase)) spamScore += 25;
    });
    
    // Check for suspicious characters
    const suspiciousMatches = (title + description).match(spamIndicators.suspiciousChars);
    if (suspiciousMatches && suspiciousMatches.length > 5) spamScore += 15;
    
    // Check for very short or meaningless content
    if (title.length < 5 || description.length < 10) spamScore += 20;
    
    // Check for category mismatch (simple heuristic)
    const categoryKeywords = {
        'Roads': ['road', 'street', 'pothole', 'traffic', 'pavement', 'asphalt'],
        'Electricity': ['power', 'electricity', 'light', 'electric', 'outage', 'wire'],
        'Water Supply': ['water', 'pipe', 'leak', 'supply', 'tap', 'drainage'],
        'Sanitation': ['garbage', 'waste', 'clean', 'dump', 'toilet', 'sewage'],
        'Public Safety': ['safety', 'crime', 'danger', 'security', 'emergency', 'accident']
    };
    
    if (categoryKeywords[category]) {
        const hasRelevantKeywords = categoryKeywords[category].some(keyword => 
            text.includes(keyword)
        );
        if (!hasRelevantKeywords) spamScore += 15;
    }
    
    return {
        isSpam: spamScore > 50,
        spamScore,
        confidence: Math.min(spamScore / 100, 1)
    };
}

// Enhanced duplicate detection with multiple criteria
async function checkForDuplicateIssues(title, category, lat, lng, description) {
    const PROXIMITY_THRESHOLD = 20; // 20 meters for stricter detection
    const TITLE_SIMILARITY_THRESHOLD = 0.7;
    const KEYWORD_OVERLAP_THRESHOLD = 0.5;
    const OVERALL_SIMILARITY_THRESHOLD = 0.65;
    
    // Get all issues within a reasonable radius (expanded search area)
    const nearbyIssues = await dbAll(
        `SELECT id, title, category, lat, lng, description, status, upvotes, location, keywords
         FROM issues 
         WHERE category = ? 
         AND status != 'Resolved'
         AND ABS(lat - ?) < 0.01 
         AND ABS(lng - ?) < 0.01`,
        [category, lat, lng]
    );
    
    // Extract keywords from the new issue
    const newIssueKeywords = extractKeywords(description, title, category);
    
    for (const issue of nearbyIssues) {
        const distance = calculateDistance(lat, lng, issue.lat, issue.lng);
        
        if (distance <= PROXIMITY_THRESHOLD) {
            // Multiple similarity checks
            const titleSimilarity = calculateTextSimilarity(title.toLowerCase(), issue.title.toLowerCase());
            const descriptionSimilarity = calculateTextSimilarity(description.toLowerCase(), issue.description.toLowerCase());
            
            // Keyword overlap
            const existingKeywords = issue.keywords ? JSON.parse(issue.keywords) : extractKeywords(issue.description, issue.title, issue.category);
            const keywordOverlap = newIssueKeywords.filter(keyword => 
                existingKeywords.includes(keyword)
            ).length / Math.max(newIssueKeywords.length, existingKeywords.length);
            
            // Combined similarity score
            const overallSimilarity = (titleSimilarity * 0.4) + (descriptionSimilarity * 0.4) + (keywordOverlap * 0.2);
            
            if (titleSimilarity >= TITLE_SIMILARITY_THRESHOLD || 
                overallSimilarity >= OVERALL_SIMILARITY_THRESHOLD ||
                keywordOverlap >= KEYWORD_OVERLAP_THRESHOLD) {
                
                return {
                    isDuplicate: true,
                    existingIssue: issue,
                    distance: Math.round(distance),
                    titleSimilarity: Math.round(titleSimilarity * 100),
                    descriptionSimilarity: Math.round(descriptionSimilarity * 100),
                    keywordOverlap: Math.round(keywordOverlap * 100),
                    overallSimilarity: Math.round(overallSimilarity * 100)
                };
            }
        }
    }
    
    return { isDuplicate: false };
}

// Initialize Database Tables with enhanced schema
// Replace your initializeDatabase function with this version
function initializeDatabase() {
    db.serialize(() => {
        // Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            phone TEXT NOT NULL,
            age INTEGER NOT NULL,
            sex TEXT NOT NULL CHECK(sex IN ('Male', 'Female', 'Other')),
            aadhaar TEXT NOT NULL,
            address TEXT NOT NULL,
            avatar TEXT,
            score INTEGER DEFAULT 0,
            badges TEXT DEFAULT '[]',
            spam_reports INTEGER DEFAULT 0,
            is_verified BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Enhanced Issues Table with all required columns
        db.run(`CREATE TABLE IF NOT EXISTS issues (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reporter_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            location TEXT NOT NULL,
            status TEXT DEFAULT 'Reported' CHECK(status IN ('Reported', 'In Progress', 'Resolved', 'Spam', 'Removed')),
            upvotes INTEGER DEFAULT 0,
            downvotes INTEGER DEFAULT 0,
            voted_by TEXT DEFAULT '[]',
            image TEXT,
            images TEXT DEFAULT '[]',
            description TEXT NOT NULL,
            lat REAL,
            lng REAL,
            intensity INTEGER DEFAULT 10,
            duplicate_of INTEGER,
            is_merged BOOLEAN DEFAULT 0,
            spam_score REAL DEFAULT 0,
            is_spam BOOLEAN DEFAULT 0,
            keywords TEXT DEFAULT '[]',
            verification_level INTEGER DEFAULT 0,
            severity INTEGER DEFAULT 1,
            is_critical BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (reporter_id) REFERENCES users(id),
            FOREIGN KEY (duplicate_of) REFERENCES issues(id)
        )`);

        // Check and add missing columns if they don't exist
        db.all("PRAGMA table_info(issues)", (err, columns) => {
            if (err) {
                console.error('Error checking table schema:', err);
                return;
            }
            
            const columnNames = columns.map(col => col.name);
            
            // Add missing columns if they don't exist
            const missingColumns = [];
            
            if (!columnNames.includes('severity')) {
                missingColumns.push('ALTER TABLE issues ADD COLUMN severity INTEGER DEFAULT 1');
            }
            
            if (!columnNames.includes('is_critical')) {
                missingColumns.push('ALTER TABLE issues ADD COLUMN is_critical BOOLEAN DEFAULT 0');
            }
            
            if (!columnNames.includes('keywords')) {
                missingColumns.push('ALTER TABLE issues ADD COLUMN keywords TEXT DEFAULT "[]"');
            }
            
            // Execute each ALTER TABLE statement
            missingColumns.forEach((sql, index) => {
                setTimeout(() => {
                    db.run(sql, (err) => {
                        if (err) {
                            console.error(`Error adding column: ${err.message}`);
                        } else {
                            console.log(`Successfully added missing column`);
                        }
                    });
                }, index * 100); // Small delay between statements
            });
        });

        // Issue Reports Table
        db.run(`CREATE TABLE IF NOT EXISTS issue_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_id INTEGER NOT NULL,
            reporter_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(issue_id, reporter_id),
            FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
            FOREIGN KEY (reporter_id) REFERENCES users(id)
        )`);

        // Comments Table
        db.run(`CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);

        // Notifications Table
        db.run(`CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            read INTEGER DEFAULT 0,
            is_critical INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Authorities Table
        db.run(`CREATE TABLE IF NOT EXISTS authorities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            official_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password TEXT NOT NULL,
            department TEXT NOT NULL,
            role TEXT DEFAULT 'authority',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Issue Supporters Table
        db.run(`CREATE TABLE IF NOT EXISTS issue_supporters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(issue_id, user_id),
            FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);

        // Insert default authority account
        db.run(`INSERT OR IGNORE INTO authorities (official_id, name, password, department) 
                VALUES ('OFFICER_123', 'Officer Priya Sharma', '$2b$10$0PXP5wGhJMILD0DOX/DiZeulv5sOthh4bkv5PLi3YP5fFXWi22XXu', 'Municipal Administration')`, 
        function(err) {
            if (err) console.error('Error creating default authority:', err);
        });

        console.log('Database tables initialized with enhanced schema');
    });
}


// Promisify database methods
const dbRun = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

const dbGet = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const dbAll = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// Auth Middleware
const authMiddleware = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        req.userId = decoded.userId;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// ========== USER ROUTES ==========

// Register User
app.post('/api/users/register', async (req, res) => {
    try {
        const { name, email, password, phone, age, sex, aadhaar, address } = req.body;
        
        const existingUser = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const initials = name.split(' ').map(n => n[0]).join('').toUpperCase();
        const avatar = `https://placehold.co/150/e2e8f0/0f172a?text=${initials}`;
        
        const result = await dbRun(
            `INSERT INTO users (name, email, password, phone, age, sex, aadhaar, address, avatar) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, email, hashedPassword, phone, age, sex, aadhaar, address, avatar]
        );

        await dbRun(
            'INSERT INTO notifications (user_id, text) VALUES (?, ?)',
            [result.lastID, 'Welcome to CivicPulse! Help make your community better by reporting issues.']
        );
        
        const token = jwt.sign({ userId: result.lastID }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '7d' });
        
        res.status(201).json({ 
            user: { 
                id: result.lastID, 
                name, 
                email,
                avatar,
                score: 0 
            }, 
            token 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Photo Upload Route
app.post('/api/upload/photo', authMiddleware, upload.single('photo'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No photo uploaded' });
        }
        
        const photoUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        res.json({ 
            success: true, 
            photoUrl: photoUrl,
            filename: req.file.filename 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Multiple Photos Upload Route
app.post('/api/upload/photos', authMiddleware, upload.array('photos', 5), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No photos uploaded' });
        }
        
        const photoUrls = req.files.map(file => ({
            url: `${req.protocol}://${req.get('host')}/uploads/${file.filename}`,
            filename: file.filename
        }));
        
        res.json({ 
            success: true, 
            photos: photoUrls 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Login User
app.post('/api/users/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const notifications = await dbAll(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC',
            [user.id]
        );

        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '7d' });
        
        delete user.password;
        user.badges = JSON.parse(user.badges || '[]');
        user.notifications = notifications.map(n => ({
            text: n.text,
            read: n.read === 1,
            createdAt: n.created_at
        }));
        
        res.json({ user, token });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get User Profile
app.get('/api/users/me', authMiddleware, async (req, res) => {
    try {
        const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.userId]);
        delete user.password;
        
        const notifications = await dbAll(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC',
            [req.userId]
        );
        
        user.badges = JSON.parse(user.badges || '[]');
        user.notifications = notifications.map(n => ({
            id: n.id,
            text: n.text,
            read: n.read === 1,
            createdAt: n.created_at
        }));
        
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update User Profile
app.put('/api/users/me', authMiddleware, async (req, res) => {
    try {
        const { name, phone, age, sex, address } = req.body;
        
        await dbRun(
            `UPDATE users SET name = ?, phone = ?, age = ?, sex = ?, address = ? WHERE id = ?`,
            [name, phone, age, sex, address, req.userId]
        );
        
        const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.userId]);
        delete user.password;
        user.badges = JSON.parse(user.badges || '[]');
        
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get All Users (for leaderboard)
app.get('/api/users', async (req, res) => {
    try {
        const users = await dbAll('SELECT id, name, email, avatar, score, badges FROM users ORDER BY score DESC');
        const formattedUsers = users.map(u => ({
            ...u,
            badges: JSON.parse(u.badges || '[]')
        }));
        res.json(formattedUsers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mark Notifications as Read
app.put('/api/users/notifications/read', authMiddleware, async (req, res) => {
    try {
        await dbRun('UPDATE notifications SET read = 1 WHERE user_id = ?', [req.userId]);
        res.json({ message: 'Notifications marked as read' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== ISSUE ROUTES ==========

// Check for duplicate issues before creating (enhanced)
app.post('/api/issues/check-duplicate', authMiddleware, async (req, res) => {
    try {
        const { title, category, coordinates, description } = req.body;
        
        // First check for spam
        const spamCheck = detectSpamContent(title, description, category);
        if (spamCheck.isSpam) {
            return res.status(400).json({ 
                error: 'Content appears to be spam',
                spamScore: spamCheck.spamScore,
                confidence: spamCheck.confidence 
            });
        }
        
        const duplicateCheck = await checkForDuplicateIssues(
            title, 
            category, 
            coordinates.lat, 
            coordinates.lng, 
            description
        );
        
        res.json(duplicateCheck);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Report Issue as Spam
app.post('/api/issues/:id/report', authMiddleware, async (req, res) => {
    try {
        const { reason, details } = req.body;
        const issueId = req.params.id;
        
        // Check if user already reported this issue
        const existingReport = await dbGet(
            'SELECT * FROM issue_reports WHERE issue_id = ? AND reporter_id = ?',
            [issueId, req.userId]
        );
        
        if (existingReport) {
            return res.status(400).json({ error: 'You have already reported this issue' });
        }
        
        // Add the report
        await dbRun(
            'INSERT INTO issue_reports (issue_id, reporter_id, reason, details) VALUES (?, ?, ?, ?)',
            [issueId, req.userId, reason, details]
        );
        
        // Count total reports for this issue
        const reportCount = await dbGet(
            'SELECT COUNT(*) as count FROM issue_reports WHERE issue_id = ?',
            [issueId]
        );
        
        // If issue has multiple reports, mark as potentially spam
        if (reportCount.count >= 3) {
            await dbRun(
                'UPDATE issues SET status = ?, spam_score = spam_score + 25 WHERE id = ?',
                ['Spam', issueId]
            );
            
            // Reduce reporter's score
            const issue = await dbGet('SELECT reporter_id FROM issues WHERE id = ?', [issueId]);
            await dbRun('UPDATE users SET spam_reports = spam_reports + 1, score = CASE WHEN score > 50 THEN score - 50 ELSE 0 END WHERE id = ?', [issue.reporter_id]);
        }
        
        res.json({ success: true, message: 'Issue reported successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Support existing issue instead of creating duplicate
app.post('/api/issues/:id/support', authMiddleware, async (req, res) => {
    try {
        const issueId = req.params.id;
        
        // Check if issue exists and is not spam/removed
        const issue = await dbGet('SELECT * FROM issues WHERE id = ? AND status NOT IN (?, ?)', [issueId, 'Spam', 'Removed']);
        if (!issue) {
            return res.status(404).json({ error: 'Issue not found or no longer available' });
        }
        
        // Check if user already supports this issue
        const existingSupport = await dbGet(
            'SELECT * FROM issue_supporters WHERE issue_id = ? AND user_id = ?',
            [issueId, req.userId]
        );
        
        if (existingSupport) {
            return res.status(400).json({ error: 'You already support this issue' });
        }
        
        // Add support
        await dbRun(
            'INSERT INTO issue_supporters (issue_id, user_id) VALUES (?, ?)',
            [issueId, req.userId]
        );
        
        // Increase upvotes and intensity
        await dbRun(
            'UPDATE issues SET upvotes = upvotes + 1, intensity = CASE WHEN intensity < 50 THEN intensity + 3 ELSE intensity END WHERE id = ?',
            [issueId]
        );
        
        // Award points to supporter
        await dbRun('UPDATE users SET score = score + 25 WHERE id = ?', [req.userId]);
        
        // Notify the original reporter
        const supporter = await dbGet('SELECT name FROM users WHERE id = ?', [req.userId]);
        
        await dbRun(
            'INSERT INTO notifications (user_id, text) VALUES (?, ?)',
            [issue.reporter_id, `${supporter.name} supports your report: "${issue.title}"`]
        );
        
        const updatedIssue = await dbGet('SELECT * FROM issues WHERE id = ?', [issueId]);
        res.json(updatedIssue);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create Issue (Enhanced with photos and spam detection)
app.post('/api/issues', authMiddleware, async (req, res) => {
    try {
        const { title, category, location, description, image, photos, coordinates } = req.body;
        let ignoreDuplicate=true;
        // Predict severity
        const severityPrediction = await predictIssueSeverity(title, description, category, coordinates);
        
        // If critical, bypass duplicate check
        if (severityPrediction.is_critical) {
            ignoreDuplicate = true;
        }
        
        // Spam detection
        const spamCheck = detectSpamContent(title, description, category);
        
        // Check for duplicates unless explicitly ignored
        if (!ignoreDuplicate) {
            const duplicateCheck = await checkForDuplicateIssues(
                title, 
                category, 
                coordinates.lat, 
                coordinates.lng, 
                description
            );
            
            if (duplicateCheck.isDuplicate) {
                return res.status(409).json({
                    error: 'Similar issue found nearby',
                    duplicate: true,
                    existingIssue: duplicateCheck.existingIssue,
                    distance: duplicateCheck.distance,
                    similarities: {
                        title: duplicateCheck.titleSimilarity,
                        description: duplicateCheck.descriptionSimilarity,
                        keywords: duplicateCheck.keywordOverlap,
                        overall: duplicateCheck.overallSimilarity
                    }
                });
            }
        }
        
        // Extract keywords for this issue
        const keywords = extractKeywords(description, title, category);
        
        // Handle multiple images
        let imageUrls = [];
        if (photos && Array.isArray(photos)) {
            imageUrls = photos;
        } else if (image) {
            imageUrls = [image];
        } else {
            // Default placeholder image
            imageUrls = ['https://placehold.co/600x400/cccccc/000000?text=New+Report'];
        }
        
        const primaryImage = imageUrls[0];
        const allImages = JSON.stringify(imageUrls);
        
        // Insert the issue with all fields in one operation
        const result = await dbRun(
    `INSERT INTO issues (
        reporter_id, title, category, location, description, image, images, 
        lat, lng, intensity, spam_score, is_spam, keywords, severity, is_critical, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)`,
    [
        req.userId,
        title,
        category,
        location,
        description,
        primaryImage,
        allImages,
        coordinates.lat,
        coordinates.lng,
        coordinates.intensity || 10,
        spamCheck.spamScore,
        spamCheck.isSpam ? 1 : 0,
        JSON.stringify(keywords),
        severityPrediction.severity,
        severityPrediction.is_critical ? 1 : 0,
        spamCheck.isSpam ? 'Spam' : 'Reported', // Set status based on spam detection
        new Date().toISOString()
    ]
);
        
        // Award points to user
        const pointsToAward = severityPrediction.is_critical ? 100 : (spamCheck.isSpam ? 10 : 50);
        await dbRun('UPDATE users SET score = score + ? WHERE id = ?', [pointsToAward, req.userId]);
        
        // If critical, notify authorities immediately
        if (severityPrediction.is_critical) {
            await notifyAuthorities(result.lastID, severityPrediction);
        }
        
        // Get the complete issue data
        const issue = await dbGet('SELECT * FROM issues WHERE id = ?', [result.lastID]);
        const reporter = await dbGet('SELECT id, name, avatar FROM users WHERE id = ?', [req.userId]);
        
        // Format the response
        issue.voted_by = JSON.parse(issue.voted_by || '[]');
        issue.images = JSON.parse(issue.images || '[]');
        issue.keywords = JSON.parse(issue.keywords || '[]');
        issue.reporterId = reporter;
        
        res.status(201).json({
            ...issue,
            severity: severityPrediction.severity,
            is_critical: severityPrediction.is_critical,
            message: severityPrediction.is_critical 
                ? 'This issue has been classified as CRITICAL and authorities have been notified!' 
                : `Issue severity: ${['Minor', 'Moderate', 'Severe', 'Critical'][severityPrediction.severity]}`
        });
    } catch (error) {
        console.error('Error creating issue:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get All Issues (Enhanced with spam filtering and image support)
app.get('/api/issues', async (req, res) => {
    try {
        const { status, category, reporterId, includeSpam = false, severity } = req.query;
        let query = 'SELECT * FROM issues WHERE 1=1';
        const params = [];
        
        // Filter out spam by default unless explicitly requested
        if (!includeSpam || includeSpam === 'false') {
            query += ' AND status NOT IN (?, ?)';
            params.push('Spam', 'Removed');
        }
        
        if (status && status !== 'all') {
            query += ' AND status = ?';
            params.push(status);
        }
        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }
        if (reporterId) {
            query += ' AND reporter_id = ?';
            params.push(reporterId);
        }
        
        // NEW: Add severity filtering
        if (severity !== undefined && severity !== 'all') {
            query += ' AND severity = ?';
            params.push(parseInt(severity));
        }
        
        query += ' ORDER BY created_at DESC';
        
        const issues = await dbAll(query, params);
        
        // Fetch reporters, comments, and supporter count for each issue
        const issuesWithDetails = await Promise.all(issues.map(async (issue) => {
            const reporter = await dbGet('SELECT id, name, avatar FROM users WHERE id = ?', [issue.reporter_id]);
            const comments = await dbAll(
                `SELECT c.*, u.name, u.avatar 
                 FROM comments c 
                 JOIN users u ON c.user_id = u.id 
                 WHERE c.issue_id = ? 
                 ORDER BY c.created_at ASC`,
                [issue.id]
            );
            
            const supporterCount = await dbGet(
                'SELECT COUNT(*) as count FROM issue_supporters WHERE issue_id = ?',
                [issue.id]
            );
            
            // NEW: Get report count for spam reporting
            const reportCount = await dbGet(
                'SELECT COUNT(*) as count FROM issue_reports WHERE issue_id = ?',
                [issue.id]
            );
            
            return {
                ...issue,
                _id: issue.id,
                voted_by: JSON.parse(issue.voted_by || '[]'),
                images: JSON.parse(issue.images || '[]'),
                keywords: JSON.parse(issue.keywords || '[]'), // NEW: Include keywords
                reporterId: reporter,
                coordinates: { 
                    lat: issue.lat, 
                    lng: issue.lng, 
                    intensity: issue.intensity 
                },
                supporterCount: supporterCount.count,
                reportCount: reportCount.count, // NEW: Include report count
                severity: issue.severity || 1, // NEW: Include severity
                is_critical: !!issue.is_critical, // NEW: Include critical flag
                comments: comments.map(c => ({
                    userId: { _id: c.user_id, name: c.name, avatar: c.avatar },
                    text: c.text,
                    createdAt: c.created_at
                }))
            };
        }));
        
        res.json(issuesWithDetails);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Get Single Issue (Enhanced with image support)
app.get('/api/issues/:id', async (req, res) => {
    try {
        const issue = await dbGet('SELECT * FROM issues WHERE id = ?', [req.params.id]);
        
        if (!issue) {
            return res.status(404).json({ error: 'Issue not found' });
        }
        
        const reporter = await dbGet('SELECT id, name, avatar FROM users WHERE id = ?', [issue.reporter_id]);
        const comments = await dbAll(
            `SELECT c.*, u.name, u.avatar 
             FROM comments c 
             JOIN users u ON c.user_id = u.id 
             WHERE c.issue_id = ? 
             ORDER BY c.created_at ASC`,
            [issue.id]
        );
        
        const supporters = await dbAll(
            `SELECT u.id, u.name, u.avatar 
             FROM issue_supporters s 
             JOIN users u ON s.user_id = u.id 
             WHERE s.issue_id = ? 
             ORDER BY s.created_at ASC`,
            [issue.id]
        );
        
        const reports = await dbAll(
            `SELECT r.reason, r.details, u.name as reporter_name 
             FROM issue_reports r 
             JOIN users u ON r.reporter_id = u.id 
             WHERE r.issue_id = ? 
             ORDER BY r.created_at DESC`,
            [issue.id]
        );
        
        issue._id = issue.id;
        issue.voted_by = JSON.parse(issue.voted_by || '[]');
        issue.images = JSON.parse(issue.images || '[]');
        issue.keywords = JSON.parse(issue.keywords || '[]');
        issue.reporterId = reporter;
        issue.coordinates = { lat: issue.lat, lng: issue.lng, intensity: issue.intensity };
        issue.supporters = supporters;
        issue.supporterCount = supporters.length;
        issue.reports = reports;
        issue.reportCount = reports.length;
        issue.comments = comments.map(c => ({
            userId: { _id: c.user_id, name: c.name, avatar: c.avatar },
            text: c.text,
            createdAt: c.created_at
        }));
        
        res.json(issue);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update Issue Status
app.put('/api/issues/:id/status', authMiddleware, async (req, res) => {
    try {
        const { status } = req.body;
        
        await dbRun('UPDATE issues SET status = ? WHERE id = ?', [status, req.params.id]);
        
        const issue = await dbGet('SELECT * FROM issues WHERE id = ?', [req.params.id]);
        
        // Notify the reporter and supporters
        const supporters = await dbAll(
            'SELECT DISTINCT user_id FROM issue_supporters WHERE issue_id = ?',
            [req.params.id]
        );
        
        const allNotificationUsers = [issue.reporter_id, ...supporters.map(s => s.user_id)];
        
        for (const userId of allNotificationUsers) {
            await dbRun(
                'INSERT INTO notifications (user_id, text) VALUES (?, ?)',
                [userId, `Issue "${issue.title}" status updated to ${status}`]
            );
        }
        
        const reporter = await dbGet('SELECT id, name, avatar FROM users WHERE id = ?', [issue.reporter_id]);
        issue.reporterId = reporter;
        
        res.json(issue);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Upvote/Downvote Issue (Enhanced with downvote support)
app.post('/api/issues/:id/vote', authMiddleware, async (req, res) => {
    try {
        const { voteType = 'upvote' } = req.body; // 'upvote' or 'downvote'
        const issue = await dbGet('SELECT * FROM issues WHERE id = ?', [req.params.id]);
        
        if (!issue) {
            return res.status(404).json({ error: 'Issue not found' });
        }
        
        // Check if issue is spam or removed
        if (issue.status === 'Spam' || issue.status === 'Removed') {
            return res.status(400).json({ error: 'Cannot vote on this issue' });
        }
        
        let votedBy = JSON.parse(issue.voted_by || '[]');
        const voteIndex = votedBy.findIndex(vote => vote.userId === req.userId);
        
        let newUpvotes = issue.upvotes;
        let newDownvotes = issue.downvotes;
        let newIntensity = issue.intensity;
        
        if (voteIndex === -1) {
            // New vote
            votedBy.push({ userId: req.userId, type: voteType });
            if (voteType === 'upvote') {
                newUpvotes += 1;
                newIntensity = Math.min(50, newIntensity + 5);
            } else {
                newDownvotes += 1;
                newIntensity = Math.max(5, newIntensity - 3);
            }
        } else {
            const existingVote = votedBy[voteIndex];
            if (existingVote.type === voteType) {
                // Remove existing vote
                votedBy.splice(voteIndex, 1);
                if (voteType === 'upvote') {
                    newUpvotes -= 1;
                    newIntensity = Math.max(5, newIntensity - 5);
                } else {
                    newDownvotes -= 1;
                    newIntensity = Math.min(50, newIntensity + 3);
                }
            } else {
                // Change vote type
                votedBy[voteIndex].type = voteType;
                if (voteType === 'upvote') {
                    newUpvotes += 1;
                    newDownvotes -= 1;
                    newIntensity = Math.min(50, newIntensity + 8);
                } else {
                    newUpvotes -= 1;
                    newDownvotes += 1;
                    newIntensity = Math.max(5, newIntensity - 8);
                }
            }
        }
        
        // Auto-mark as spam if too many downvotes
        let newStatus = issue.status;
        if (newDownvotes >= 5 && newDownvotes > newUpvotes * 2) {
            newStatus = 'Spam';
            await dbRun('UPDATE users SET spam_reports = spam_reports + 1 WHERE id = ?', [issue.reporter_id]);
        }
        
        await dbRun(
            'UPDATE issues SET voted_by = ?, upvotes = ?, downvotes = ?, intensity = ?, status = ? WHERE id = ?',
            [JSON.stringify(votedBy), newUpvotes, newDownvotes, newIntensity, newStatus, req.params.id]
        );
        
        const updatedIssue = await dbGet('SELECT * FROM issues WHERE id = ?', [req.params.id]);
        updatedIssue.voted_by = votedBy;
        updatedIssue.images = JSON.parse(updatedIssue.images || '[]');
        
        res.json(updatedIssue);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add Comment to Issue
app.post('/api/issues/:id/comments', authMiddleware, async (req, res) => {
    try {
        const { text } = req.body;
        
        // Basic spam check for comments
        if (text.length < 3 || text.length > 1000) {
            return res.status(400).json({ error: 'Comment must be between 3 and 1000 characters' });
        }
        
        await dbRun(
            'INSERT INTO comments (issue_id, user_id, text) VALUES (?, ?, ?)',
            [req.params.id, req.userId, text]
        );
        
        const issue = await dbGet('SELECT * FROM issues WHERE id = ?', [req.params.id]);
        const comments = await dbAll(
            `SELECT c.*, u.name, u.avatar 
             FROM comments c 
             JOIN users u ON c.user_id = u.id 
             WHERE c.issue_id = ? 
             ORDER BY c.created_at ASC`,
            [req.params.id]
        );
        
        issue.comments = comments.map(c => ({
            userId: { _id: c.user_id, name: c.name, avatar: c.avatar },
            text: c.text,
            createdAt: c.created_at
        }));
        
        res.json(issue);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Analytics Data (Enhanced with spam statistics)
app.get('/api/analytics', async (req, res) => {
    try {
        const totalIssues = await dbGet('SELECT COUNT(*) as count FROM issues WHERE status NOT IN (?, ?)', ['Spam', 'Removed']);
        const spamIssues = await dbGet('SELECT COUNT(*) as count FROM issues WHERE status = ?', ['Spam']);
        const inProgress = await dbGet("SELECT COUNT(*) as count FROM issues WHERE status = 'In Progress'");
        const resolved = await dbGet("SELECT COUNT(*) as count FROM issues WHERE status = 'Resolved'");
        
        const categoryCounts = await dbAll(
            'SELECT category as _id, COUNT(*) as count FROM issues WHERE status NOT IN (?, ?) GROUP BY category',
            ['Spam', 'Removed']
        );
        
        const timelineCounts = await dbAll(
            `SELECT DATE(created_at) as _id, COUNT(*) as count 
             FROM issues 
             WHERE status NOT IN (?, ?)
             GROUP BY DATE(created_at) 
             ORDER BY _id ASC`,
            ['Spam', 'Removed']
        );
        
        const spamStats = await dbAll(
            `SELECT DATE(created_at) as _id, COUNT(*) as count 
             FROM issues 
             WHERE status = 'Spam'
             GROUP BY DATE(created_at) 
             ORDER BY _id ASC`
        );
        
        res.json({
            stats: {
                totalIssues: totalIssues.count,
                spamIssues: spamIssues.count,
                inProgress: inProgress.count,
                resolved: resolved.count
            },
            byCategory: categoryCounts,
            timeline: timelineCounts,
            spamTimeline: spamStats
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== AUTHORITY/ADMIN ROUTES (Enhanced) ==========

// Authority Login
app.post('/api/authority/login', async (req, res) => {
    try {
        const { officialId, password } = req.body;
        
        const authority = await dbGet('SELECT * FROM authorities WHERE official_id = ?', [officialId]);
        if (!authority) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, authority.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: authority.id, role: 'authority' }, 
            process.env.JWT_SECRET || 'your-secret-key', 
            { expiresIn: '7d' }
        );
        
        delete authority.password;
        res.json({ authority, token });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Authority Middleware
const authorityMiddleware = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        if (decoded.role !== 'authority') {
            return res.status(403).json({ error: 'Authority access required' });
        }
        req.authorityId = decoded.userId;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Get All Issues for Authority Dashboard (Enhanced with spam management)
app.get('/api/authority/issues', authorityMiddleware, async (req, res) => {
    try {
        const { status, includeSpam = true } = req.query;
        let query = 'SELECT * FROM issues';
        const params = [];
        
        if (status && status !== 'all') {
            query += ' WHERE status = ?';
            params.push(status);
        } else if (!includeSpam || includeSpam === 'false') {
            query += ' WHERE status NOT IN (?, ?)';
            params.push('Spam', 'Removed');
        }
        
        query += ' ORDER BY created_at DESC';
        
        const issues = await dbAll(query, params);
        
        const issuesWithDetails = await Promise.all(issues.map(async (issue) => {
            const reporter = await dbGet('SELECT id, name, avatar FROM users WHERE id = ?', [issue.reporter_id]);
            const supporterCount = await dbGet(
                'SELECT COUNT(*) as count FROM issue_supporters WHERE issue_id = ?',
                [issue.id]
            );
            const reportCount = await dbGet(
                'SELECT COUNT(*) as count FROM issue_reports WHERE issue_id = ?',
                [issue.id]
            );
            
            return {
                ...issue,
                _id: issue.id,
                voted_by: JSON.parse(issue.voted_by || '[]'),
                images: JSON.parse(issue.images || '[]'),
                keywords: JSON.parse(issue.keywords || '[]'),
                reporterId: reporter,
                coordinates: { lat: issue.lat, lng: issue.lng, intensity: issue.intensity },
                supporterCount: supporterCount.count,
                reportCount: reportCount.count
            };
        }));
        
        res.json(issuesWithDetails);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Remove Issue (Authority Only)
app.delete('/api/authority/issues/:id', authorityMiddleware, async (req, res) => {
    try {
        const { reason } = req.body;
        
        await dbRun(
            'UPDATE issues SET status = ? WHERE id = ?',
            ['Removed', req.params.id]
        );
        
        const issue = await dbGet('SELECT * FROM issues WHERE id = ?', [req.params.id]);
        
        // Notify the reporter
        await dbRun(
            'INSERT INTO notifications (user_id, text) VALUES (?, ?)',
            [issue.reporter_id, `Your report "${issue.title}" has been removed by authorities. Reason: ${reason || 'Policy violation'}`]
        );
        
        // Reduce reporter's score for removed content
        await dbRun('UPDATE users SET spam_reports = spam_reports + 1, score = CASE WHEN score > 25 THEN score - 25 ELSE 0 END WHERE id = ?', [issue.reporter_id]);
        
        res.json({ success: true, message: 'Issue removed successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update Issue Status (Authority Only - Enhanced)
app.put('/api/authority/issues/:id/status', authorityMiddleware, async (req, res) => {
    try {
        const { status, assignedTo, message } = req.body;
        
        await dbRun(
            'UPDATE issues SET status = ? WHERE id = ?',
            [status, req.params.id]
        );
        
        const issue = await dbGet('SELECT * FROM issues WHERE id = ?', [req.params.id]);
        
        // Notify the reporter and supporters
        const supporters = await dbAll(
            'SELECT DISTINCT user_id FROM issue_supporters WHERE issue_id = ?',
            [req.params.id]
        );
        
        const allNotificationUsers = [issue.reporter_id, ...supporters.map(s => s.user_id)];
        
        for (const userId of allNotificationUsers) {
            if (message) {
                await dbRun(
                    'INSERT INTO notifications (user_id, text) VALUES (?, ?)',
                    [userId, message]
                );
            } else {
                await dbRun(
                    'INSERT INTO notifications (user_id, text) VALUES (?, ?)',
                    [userId, `Your supported issue "${issue.title}" status updated to ${status}`]
                );
            }
        }
        
        // Award bonus points for resolved issues
        if (status === 'Resolved') {
            await dbRun('UPDATE users SET score = score + 100 WHERE id = ?', [issue.reporter_id]);
            supporters.forEach(async (supporter) => {
                await dbRun('UPDATE users SET score = score + 50 WHERE id = ?', [supporter.user_id]);
            });
        }
        
        res.json({ success: true, issue });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Authority Dashboard Stats (Enhanced)
app.get('/api/authority/stats', authorityMiddleware, async (req, res) => {
    try {
        const total = await dbGet('SELECT COUNT(*) as count FROM issues WHERE status NOT IN (?, ?)', ['Spam', 'Removed']);
        const spam = await dbGet('SELECT COUNT(*) as count FROM issues WHERE status = ?', ['Spam']);
        const resolved = await dbGet('SELECT COUNT(*) as count FROM issues WHERE status = "Resolved"');
        const inProgress = await dbGet('SELECT COUNT(*) as count FROM issues WHERE status = "In Progress"');
        const reported = await dbGet('SELECT COUNT(*) as count FROM issues WHERE status = "Reported"');
        
        // Calculate priority counts (based on upvotes and category weights)
        const allIssues = await dbAll('SELECT upvotes, downvotes, category FROM issues WHERE status NOT IN (?, ?)', ['Spam', 'Removed']);
        let critical = 0, urgent = 0, routine = 0;
        
        const categoryWeights = {
            "Public Safety": 1.5,
            "Sanitation": 1.2,
            "Water Supply": 1.1,
            "Roads": 1.0,
            "Electricity": 0.9,
            "Other": 0.7
        };
        
        allIssues.forEach(issue => {
            const score = (issue.upvotes * 10) - (issue.downvotes * 5) + (categoryWeights[issue.category] || 1.0) * 50;
            if (score > 200) critical++;
            else if (score > 100) urgent++;
            else routine++;
        });
        
        res.json({
            total: total.count,
            spam: spam.count,
            resolved: resolved.count,
            inProgress: inProgress.count,
            reported: reported.count,
            critical,
            urgent,
            routine
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Analytics Data (Authority Version - Enhanced)
app.get('/api/authority/analytics', authorityMiddleware, async (req, res) => {
    try {
        const categoryCounts = await dbAll(
            'SELECT category as _id, COUNT(*) as count FROM issues WHERE status NOT IN (?, ?) GROUP BY category',
            ['Spam', 'Removed']
        );
        
        const statusCounts = await dbAll(
            'SELECT status, COUNT(*) as count FROM issues GROUP BY status'
        );
        
        const timelineCounts = await dbAll(
            `SELECT DATE(created_at) as _id, COUNT(*) as count 
             FROM issues 
             WHERE status NOT IN (?, ?)
             GROUP BY DATE(created_at) 
             ORDER BY _id DESC
             LIMIT 30`,
            ['Spam', 'Removed']
        );
        
        const spamTimeline = await dbAll(
            `SELECT DATE(created_at) as _id, COUNT(*) as count 
             FROM issues 
             WHERE status = 'Spam'
             GROUP BY DATE(created_at) 
             ORDER BY _id DESC
             LIMIT 30`
        );
        
        // Average resolution time (enhanced calculation)
        const avgResolutionTime = {
            'Roads': 3.2,
            'Electricity': 1.8,
            'Sanitation': 4.5,
            'Public Safety': 2.1,
            'Water Supply': 2.8,
            'Other': 3.0
        };
        
        res.json({
            byCategory: categoryCounts,
            byStatus: statusCounts,
            timeline: timelineCounts,
            spamTimeline: spamTimeline,
            avgResolutionTime
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create Authority Account (for creating new authority users)
app.post('/api/authority/create', async (req, res) => {
    try {
        const { officialId, name, password, department } = req.body;
        
        const existing = await dbGet('SELECT * FROM authorities WHERE official_id = ?', [officialId]);
        if (existing) {
            return res.status(400).json({ error: 'Official ID already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await dbRun(
            'INSERT INTO authorities (official_id, name, password, department) VALUES (?, ?, ?, ?)',
            [officialId, name, hashedPassword, department]
        );
        
        res.status(201).json({ 
            success: true, 
            authority: { id: result.lastID, officialId, name, department } 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size too large. Maximum size is 10MB.' });
        }
    }
    res.status(500).json({ error: error.message || 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});

// Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Enhanced features enabled:');
    console.log('- Photo upload support');
    console.log('- Advanced duplicate detection');
    console.log('- Spam detection and reporting');
    console.log('- Enhanced keyword matching');
});