const uploadSongBtn = document.getElementById('upload-song-btn');
const uploadPopup = document.getElementById('upload-popup');
const uploadSubmit = document.getElementById('upload-submit');
const uploadCancel = document.getElementById('upload-cancel');
const youtubeLinkInput = document.getElementById('youtube-link');
const dimmer = document.getElementById('dimmer');

youtubeLinkInput.addEventListener('paste', (event) => {
    let youtubeLink = event.clipboardData.getData("text");
    if (youtubeLink.includes("youtube.com/watch?v=")) {
        // server should handle this
        downloadVideo(youtubeLink);
    }
    else {
        console.log("invalid url")
    }
});

function downloadVideo(youtubeLink) {
    fetch('http://localhost:3000/download', { // will change this url later when the server is deployed. currently doesn't work on github pages
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({message: youtubeLink})
      })
        .then(response => response.text())
        .then(data => console.log(data));      
}


uploadSubmit.addEventListener('click', () => {

});

// ------------------- styling ------------------------------
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