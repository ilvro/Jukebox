const express = require('express');
const ytdl = require("@distube/ytdl-core");
const cors = require('cors');
const https = require('https');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.post('/download/audio', async (req, res) => {
  const url = req.body.message;
  if (ytdl.validateURL(url)) {
    try {
      const videoInfo = await ytdl.getInfo(url);
      const videoTitle = videoInfo.videoDetails.title;

      res.header('Content-Disposition', `attachment; filename="${videoTitle}.mp3"`);
      res.header('Content-Type', 'audio/mpeg');
      res.set('Access-Control-Expose-Headers', 'Content-Disposition');

      ytdl(url, {format: 'mp3'}).pipe(res);
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
  const url = req.body.message;
  if (ytdl.validateURL(url)) {
    try {
      const videoInfo = await ytdl.getInfo(url);
      const videoThumbnail = videoInfo.videoDetails.thumbnails.slice(-1)[0].url;

      // Pipe the thumbnail directly to the response
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
  console.log(`Server is running on http://localhost:${port}`);
});