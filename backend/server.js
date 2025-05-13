const express = require('express');
const ytdl = require("@distube/ytdl-core");
const cors = require('cors');
const https = require('https');

const app = express();
const port = 3000;
const allowedOrigins = [
    'https://jukebox-wza8.onrender.com',
    'https://jukebox-backend-16sx.onrender.com',
    'http://127.0.0.1:5500'
  ];

//const agent: ytdl.createProxyAgent({ uri: "http://proxyip" }),
  
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
app.get('/', (req, res) => {
    res.json({ status: 'backend is running' });
  });

app.post('/download/audio', async (req, res) => {
  res.header('Access-Control-Allow-Headers', 'Content-Type, Content-Disposition');
  res.header('Access-Control-Expose-Headers', 'Content-Disposition');
  const url = req.body.message;
  if (ytdl.validateURL(url)) {
    try {
      const videoInfo = await ytdl.getInfo(url, agent);
      const videoTitle = videoInfo.videoDetails.title.replace('—', '-');

      res.header('content-type', 'application/json')
      res.header('Content-Disposition', `attachment; filename="${videoTitle}.mp3"`);
      res.header('Content-Type', 'audio/mpeg');
      res.set('Access-Control-Expose-Headers', 'Content-Disposition');

      ytdl(url, {filter: 'audioonly'}).pipe(res);
    } 
    catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: error.message });
    }
  } 
  else {
    res.status(400).json({success: false, message: 'Invalid URL'});
  }
});

app.post('/download/thumbnail', async (req, res) => {
  res.header('Access-Control-Allow-Headers', 'Content-Type, Content-Disposition');
  res.header('Access-Control-Expose-Headers', 'Content-Disposition');
  const url = req.body.message;
  if (ytdl.validateURL(url)) {
    try {
      const videoInfo = await ytdl.getInfo(url, agent);
      const videoThumbnail = videoInfo.videoDetails.thumbnails.slice(-1)[0].url;

      // pipe the thumbnail to the response
      https.get(videoThumbnail, (response) => {
        res.header('Content-Type', response.headers['content-type']);
        response.pipe(res);
      });
    } 
    catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: error.message });
    }
  } 
  else {
    res.status(400).json({success: false, message: 'Invalid URL'});
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});