const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');
const app = express();
const port = 3000;

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
        callback(new Error('unrecognized origin, not allowed by CORS'));
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

const runCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout || stderr);
      }
    });
  });
};

async function getVideoTitle(url) {
  const command = `yt-dlp --get-title ${url}`;
  const title = await runCommand(command);
  return title.trim().replace(/[<>:"/\\|?*]/g, '-');
}

app.get('/', (req, res) => {
    res.json({ status: 'Server is running' });
});

app.post('/download/youtube/audio', async (req, res) => {
    const url = req.body.message;

    if (!url || !url.startsWith('http')) {
        return res.status(400).json({ success: false, message: 'Invalid URL' });
    }

    try {
        // fetch video information to get the title
        const ytDlpInfoProcess = spawn('yt-dlp', ['--dump-json', url]);

        let jsonData = '';
        ytDlpInfoProcess.stdout.on('data', (data) => {
            jsonData += data;
        });

        ytDlpInfoProcess.on('close', (code) => {
            if (code !== 0) {
                return res.status(500).json({ success: false, message: 'Failed to fetch video info.' });
            }

            const videoInfo = JSON.parse(jsonData);
            const videoTitle = videoInfo.title.replace(/[<>:"/\\|?*]/g, '-'); // Sanitize filename

            // set headers for audio file response
            res.header('Content-Disposition', `attachment; filename="${videoTitle}.mp3"`);
            res.header('Content-Type', 'audio/mpeg');
            res.set('Access-Control-Expose-Headers', 'Content-Disposition');

            // stream audio
            const ytDlpAudioProcess = spawn('yt-dlp', [
                '--quiet',
                '--no-warnings',
                '-f', 'bestaudio[ext=m4a]',
                '-o', '-',
                url
            ]);

            ytDlpAudioProcess.stdout.pipe(res);
            ytDlpAudioProcess.stderr.on('data', (data) => {
                console.error('yt-dlp error:', data.toString());
            });

            ytDlpAudioProcess.on('close', (audioCode) => {
                if (audioCode !== 0) {
                    res.status(500).json({ success: false, message: 'audio download failed' });
                }
            });
        });

        ytDlpInfoProcess.stderr.on('data', (data) => {
            console.error('yt-dlp info error:', data.toString());
        });

    } catch (error) {
        console.error('Error in /download/audio:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


  

app.post('/download/youtube/thumbnail', async (req, res) => {
    const url = req.body.message;

    if (!url || !url.startsWith('http')) {
        return res.status(400).json({ success: false, message: 'Invalid URL' });
    }

    try {
        const ytDlpInfoProcess = spawn('yt-dlp', ['--dump-json', url]);

        let jsonData = '';
        ytDlpInfoProcess.stdout.on('data', (data) => {
            jsonData += data;
        });

        ytDlpInfoProcess.on('close', (code) => {
            if (code !== 0) {
                return res.status(500).json({ success: false, message: 'failed to fetch video info' });
            }

            const videoInfo = JSON.parse(jsonData);
            const thumbnailUrl = videoInfo.thumbnail;

            // fetch and stream the thumbnail
            https.get(thumbnailUrl, (response) => {
                res.setHeader('Content-Type', response.headers['content-type']);
                response.pipe(res);
            }).on('error', (err) => {
                console.error('Error fetching thumbnail:', err);
                res.status(500).json({ success: false, message: 'error fetching thumbnail' });
            });
        });

    } catch (error) {
        console.error('error in /download/youtube/thumbnail:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});