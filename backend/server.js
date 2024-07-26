// requires npm installs
const express = require('express');
const ytdl = require("@distube/ytdl-core")
const cors = require('cors');
const https = require('https');

//
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.post('/download', async (req, res) => {
  const url = req.body.message;
  if (ytdl.validateURL(url)) { // double check
    try {
      const videoInfo = await ytdl.getInfo(url);
      const videoTitle = videoInfo.videoDetails.title;
      const videoThumbnail = videoInfo.videoDetails.thumbnails.slice(-1)[0].url;
      const filePath = path.join(__dirname, 'download test', `${videoTitle}`);
  
      // download audio
      ytdl(url, {format: 'mp3'})
      .pipe(fs.createWriteStream(filePath + '.mp3'))
      .on('finish', () => {
        res.json({ success: true, message: 'download completed'});
      })
      .on('error', (error) => {
        console.error('download error:', error);
        res.status(500).json({ success: false, message: error.message });
      });

      // download thumbnail. ytdl doesn't seem to have a specific function for images so this uses https
      const thumbnailStream = fs.createWriteStream(filePath + '.jpg');
      https.get(videoThumbnail, (response) => {
        response.pipe(thumbnailStream);
        thumbnailStream.on('finish', () => {
          thumbnailStream.close();
        })
      }).on('error', (error) => {
        console.error('Error downloading thumbnail:', error)
      })
    } 
    catch {
      console.error('server error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  } 
  else {
    res.json({sucess: false, message: 'invalid url'});
  }

  //res.send(url);
})

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})
