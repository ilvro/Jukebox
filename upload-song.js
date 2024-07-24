const uploadSongBtn = document.getElementById('upload-song-btn');
const uploadPopup = document.getElementById('upload-popup');
const uploadSubmit = document.getElementById('upload-submit');
const uploadCancel = document.getElementById('upload-cancel');
const youtubeLinkInput = document.getElementById('youtube-link');
const dimmer = document.getElementById('dimmer');

youtubeLinkInput.addEventListener('paste', (event) => {
    let youtubeLink = event.clipboardData.getData("text");
    if (youtubeLink.includes("youtube.com/watch?v=")) {
        // server should handle this. its downloading a video and converting it to mp3, probably using the yt-dlp library
    }
    else {
        console.log("invalid url")
    }
});

uploadSongBtn.addEventListener('click', () => {
    uploadPopup.style.visibility = 'visible';
    dimmer.style.visibility = 'visible';
    setTimeout(() => {
        uploadPopup.style.opacity = '1';
        dimmer.style.opacity = '0.6';
    }, 10);
});

uploadCancel.addEventListener('click', () => {
    uploadPopup.style.opacity = '0';
    dimmer.style.opacity = '0';
    setTimeout(() => {
       uploadPopup.style.visibility = 'hidden';
       dimmer.style.visibility = 'hidden'; 
    }, 10);
});

uploadSubmit.addEventListener('click', () => {

});