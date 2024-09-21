import ytdl from '@distube/ytdl-core';

export default async function handler(req, res) {
  const url = req.body.message;
  
  if (ytdl.validateURL(url)) {
    try {
      const videoInfo = await ytdl.getInfo(url);
      const videoTitle = videoInfo.videoDetails.title.replace('—', '-');

      res.setHeader('Content-Disposition', `attachment; filename="${videoTitle}.mp3"`);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

      ytdl(url, { filter: 'audioonly' }).pipe(res);
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: error.message });
    }
  } else {
    res.status(400).json({ success: false, message: 'Invalid URL' });
  }
}
