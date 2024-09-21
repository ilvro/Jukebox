import ytdl from '@distube/ytdl-core';
import https from 'https';

export default async function handler(req, res) {
  const url = req.body.message;
  
  if (ytdl.validateURL(url)) {
    try {
      const videoInfo = await ytdl.getInfo(url);
      const videoThumbnail = videoInfo.videoDetails.thumbnails.slice(-1)[0].url;

      https.get(videoThumbnail, (response) => {
        res.setHeader('Content-Type', response.headers['content-type']);
        response.pipe(res);
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: error.message });
    }
  } else {
    res.status(400).json({ success: false, message: 'Invalid URL' });
  }
}
