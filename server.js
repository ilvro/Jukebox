const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-exec');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { pipeline } = require('stream/promises');
const { promisify } = require('util');
const { execSync, execFile } = require('child_process');
const app = express();
const port = Number(process.env.JUKEBOX_PORT) || 3000;
const ytdlpPath = execSync('which yt-dlp').toString().trim(); // force latest ytdlp version
const execFileAsync = promisify(execFile);
// Keep generated audio outside the web project. Live Server watches project
// files and would reload the page like an F5 whenever FFmpeg created a temp
// segment under ./temp.
const audioEditDirectory = path.join(os.tmpdir(), 'jukebox-audio-edits');
fs.mkdirSync(audioEditDirectory, { recursive: true });

const allowedOrigins = [
    'https://jukebox-wza8.onrender.com',
    'https://jukebox-backend-16sx.onrender.com',
    'http://127.0.0.1:5500',
    'http://localhost:5500'
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
    allowedHeaders: [
        'Content-Type',
        'Content-Disposition',
        'X-Edit-Start',
        'X-Edit-End',
        'X-Audio-Duration',
        'X-Source-Result'
    ],
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

let audioEditInProgress = false;

app.get('/edit/audio/status', (req, res) => {
    res.json({ available: true, busy: audioEditInProgress, editVersion: 3 });
});

async function removeTemporaryFiles(files) {
    await Promise.all(files.map(file => fs.promises.unlink(file).catch(() => {})));
}

async function runFFmpeg(args) {
    return execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
        maxBuffer: 8 * 1024 * 1024
    });
}

app.get('/edit/audio/result/:filename', (req, res) => {
    if (!/^[0-9a-f-]+\.(mp3|m4a|webm)$/i.test(req.params.filename)) {
        return res.status(400).send('Invalid edited audio filename.');
    }
    const resultPath = path.join(audioEditDirectory, req.params.filename);
    if (!fs.existsSync(resultPath)) return res.status(404).send('Edited audio has expired.');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(resultPath);
});

// Long edits are staged on disk and use FFmpeg stream-copy whenever the
// source codec allows it. This avoids both multi-gigabyte PCM buffers and a
// second giant response Blob in the browser.
app.post('/edit/audio/delete-region', async (req, res) => {
    if (audioEditInProgress) {
        return res.status(429).send('Another long audio edit is already running.');
    }

    const start = Number(req.get('X-Edit-Start'));
    const end = Number(req.get('X-Edit-End'));
    const duration = Number(req.get('X-Audio-Duration'));
    if (![start, end, duration].every(Number.isFinite) ||
        start < 0 || end <= start || duration <= 0 || end > duration + 0.5) {
        return res.status(400).send('Invalid audio selection.');
    }

    audioEditInProgress = true;
    const jobId = randomUUID();
    let inputPath = path.join(audioEditDirectory, `${jobId}.input`);
    const temporaryFiles = [inputPath];
    let outputPath = null;

    try {
        const sourceResult = req.get('X-Source-Result');
        if (sourceResult) {
            if (!/^[0-9a-f-]+\.(mp3|m4a|webm)$/i.test(sourceResult)) {
                throw new Error('Invalid server audio source.');
            }
            inputPath = path.join(audioEditDirectory, sourceResult);
            await fs.promises.access(inputPath, fs.constants.R_OK);
        } else {
            await pipeline(req, fs.createWriteStream(inputPath));
        }

        const probe = await execFileAsync('ffprobe', [
            '-v', 'error', '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_name',
            '-of', 'default=nw=1:nk=1', inputPath
        ]);
        const codec = probe.stdout.trim().toLowerCase();
        const outputFormat = codec === 'mp3' ? 'mp3'
            : codec === 'aac' ? 'm4a'
            : (codec === 'opus' || codec === 'vorbis') ? 'webm'
            : 'mp3';
        const codecArgs = ['mp3', 'aac', 'opus', 'vorbis'].includes(codec)
            ? ['-c:a', 'copy']
            : ['-c:a', 'libmp3lame', '-b:a', '192k'];
        const safeStart = Math.max(0, Math.min(start, duration));
        const safeEnd = Math.max(safeStart, Math.min(end, duration));
        outputPath = path.join(audioEditDirectory, `${jobId}.${outputFormat}`);

        if (safeStart <= 0.001) {
            await runFFmpeg([
                '-ss', String(safeEnd), '-i', inputPath,
                '-map', '0:a:0', '-vn', ...codecArgs, outputPath
            ]);
        } else if (safeEnd >= duration - 0.05) {
            await runFFmpeg([
                '-i', inputPath, '-t', String(safeStart),
                '-map', '0:a:0', '-vn', ...codecArgs, outputPath
            ]);
        } else {
            const beforePath = path.join(audioEditDirectory, `${jobId}-before.${outputFormat}`);
            const afterPath = path.join(audioEditDirectory, `${jobId}-after.${outputFormat}`);
            const concatPath = path.join(audioEditDirectory, `${jobId}-concat.txt`);
            temporaryFiles.push(beforePath, afterPath, concatPath);

            await runFFmpeg([
                '-i', inputPath, '-t', String(safeStart),
                '-map', '0:a:0', '-vn', ...codecArgs, beforePath
            ]);
            await runFFmpeg([
                '-ss', String(safeEnd), '-i', inputPath,
                '-map', '0:a:0', '-vn', ...codecArgs, afterPath
            ]);
            await fs.promises.writeFile(
                concatPath,
                `file '${beforePath}'\nfile '${afterPath}'\n`,
                'utf8'
            );
            await runFFmpeg([
                '-f', 'concat', '-safe', '0', '-i', concatPath,
                '-c', 'copy', outputPath
            ]);
        }

        const filename = path.basename(outputPath);
        res.json({
            url: `${req.protocol}://${req.get('host')}/edit/audio/result/${filename}`,
            duration: duration - (safeEnd - safeStart)
        });
    } catch (error) {
        console.error('FFmpeg audio edit failed:', error.stderr || error);
        if (outputPath) temporaryFiles.push(outputPath);
        if (!res.headersSent) res.status(500).send(error.stderr || 'FFmpeg audio edit failed.');
    } finally {
        await removeTemporaryFiles(temporaryFiles);
        audioEditInProgress = false;
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
