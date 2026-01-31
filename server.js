const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-exec');
const https = require('https');
const { execSync } = require('child_process'); 
const app = express();
const port = 3000;
const ytdlpPath = execSync('which yt-dlp').toString().trim(); // force latest ytdlp version

const allowedOrigins = [
    'https://jukebox-wza8.onrender.com',
    'https://jukebox-backend-16sx.onrender.com',
    'http://127.0.0.1:5500'
];

const corsOptions = {
    origin: function (origin, callback) {
        if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
        } else {
            callback(new Error('Blocked by CORS'));
        }
    },
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Content-Disposition'],
    exposedHeaders: ['Content-Disposition'],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

const sanitizeFilename = (title) => {
    if (!title) return 'audio';
    
    let sanitized = title
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/[—–−]/g, '-')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\.+$/g, '');
    
    const maxLength = 200;
    if (sanitized.length > maxLength) {
        const truncated = sanitized.substring(0, maxLength);
        const lastSpace = truncated.lastIndexOf(' ');
        sanitized = lastSpace > maxLength * 0.8 ? truncated.substring(0, lastSpace) : truncated;
    }
    
    return sanitized || 'audio';
};

app.get('/', (req, res) => {
    res.json({ status: 'Server is running' });
});

app.get('/test-ytdlp', async (req, res) => {
    try {
        const result = await ytdlp('https://www.youtube.com/watch?v=-xwZwEcO9R0', {
            dumpSingleJson: true,
            printToStdout: false
        });
        res.json({ 
            success: true, 
            title: result.title,
            formats: result.formats?.length 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            stack: error.stack 
        });
    }
});
app.post('/download/youtube/audio', async (req, res) => {
    const url = req.body.message;

    if (!url || !url.startsWith('http')) {
        return res.status(400).json({ success: false, message: 'Invalid URL' });
    }

    try {
        const info = await ytdlp(url, {
            dumpSingleJson: true,
            noWarnings: true,
            noCheckCertificates: true
        }, {
            youtubeDLPath: ytdlpPath
        });

        const videoTitle = sanitizeFilename(info.title || 'audio');

        const encodedFilename = encodeURIComponent(videoTitle)
            .replace(/['()]/g, escape)
            .replace(/\*/g, '%2A');

        res.header('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}.mp3`);
        res.header('Content-Type', 'audio/mpeg');
        res.set('Access-Control-Expose-Headers', 'Content-Disposition');

        const audioStream = ytdlp.exec(url, {
            format: 'bestaudio[ext=m4a]/bestaudio/best',
            output: '-',
            quiet: true,
            noWarnings: true,
            noCheckCertificates: true,
            preferFreeFormats: true,
            extractorArgs: 'youtube:player_client=android,web' // bypasses 403
        }, {
            youtubeDLPath: ytdlpPath
        });

        audioStream.stdout.pipe(res);

        audioStream.stderr.on('data', (data) => {
            console.error('yt-dlp stderr:', data.toString());
        });

        audioStream.on('error', (error) => {
            console.error('yt-dlp error:', error.message);
            if (!res.headersSent) {
                res.status(500).json({ 
                    success: false, 
                    message: 'Error on audio download' 
                });
            }
        });

        audioStream.on('close', (code) => {
            if (code !== 0 && code !== null) {
                console.error(`yt-dlp - code ${code}`);
            }
        });

    } catch (error) {
        console.error('Error in /download/audio:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ 
                success: false, 
                message: 'Error when searching for audio information' 
            });
        }
    }
});

app.post('/download/youtube/thumbnail', async (req, res) => {
    const url = req.body.message;

    if (!url || !url.startsWith('http')) {
        return res.status(400).json({ success: false, message: 'Invalid URL' });
    }

    try {
        const info = await ytdlp(url, {
            dumpSingleJson: true,
            noWarnings: true,
            noCheckCertificates: true
        }, {
            youtubeDLPath: ytdlpPath 
        });

        const thumbnails = info.thumbnails || [];
        const thumbnailUrl = thumbnails.sort((a, b) => 
            (b.width || 0) - (a.width || 0)
        )[0]?.url || info.thumbnail;

        if (!thumbnailUrl) {
            return res.status(404).json({ 
                success: false, 
                message: 'Thumbnail image not found' 
            });
        }

        https.get(thumbnailUrl, (response) => {
            res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
            response.pipe(res);
        }).on('error', (err) => {
            console.error('Error when searching for thumbnail', err);
            if (!res.headersSent) {
                res.status(500).json({ 
                    success: false, 
                    message: 'Error when downloading thumbnail' 
                });
            }
        });

    } catch (error) {
        console.error('Error in /download/thumbnail:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ 
                success: false, 
                message: 'Error when searching for thumbnail' 
            });
        }
    }
});

app.use((err, req, res, next) => {
    console.error('Global error:', err);
    if (!res.headersSent) {
        res.status(500).json({ 
            success: false, 
            message: 'Server internal error' 
        });
    }
});

app.listen(port, () => {
    console.log(`Running on http://localhost:${port}`);
});