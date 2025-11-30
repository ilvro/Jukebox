# Jukebox

Jukebox is a tool used to efficiently control audio. You can add songs from your local machine or from youtube (for youtube, see Automatically Downloading from Youtube)

It is a tool designed for DMing D&D/TTRPG sessions.

# Uploading Audios
In the "Manage Songs" tab, press 'Upload Song' and follow the instructions to upload a song from your local machine.  

Downloading videos from youtube isn't possible without some setup due to youtube restrictions - see "Automatically Downloading from Youtube" below.

# Sound Effects
Select a region in the song player by dragging the right mouse button over the progress bar. You can apply sound effects by right clicking on the selected region.

# Automatically downloading from youtube

Youtube doesn't allow public hosting for services like this, so it's necessary to locally run the code. To use this feature, you must:
1. Clone this repository with <a href='https://git-scm.com/downloads'> git<a/> and manually host the website on your machine (do not use an external server, VPN or proxy)
2. Install the following <a href='https://nodejs.org/en/download'> node<a/> modules:
```bash
npm install cors yt-dlp-exec express
```

Clone the <a href='https://github.com/ilvro/jukebox-backend'> backend<a/>, navigate to the directory and run the code on the terminal with `node server.js`

The terminal should show `Server is running on port 3000`. 

This should allow you to paste any youtube URL into `Paste a youtube link here...` in the Upload tab to automatically download audios.