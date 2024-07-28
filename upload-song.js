const uploadSongBtn = document.getElementById('upload-song-btn');
const uploadPopup = document.getElementById('upload-popup');
const uploadSubmit = document.getElementById('upload-submit');
const uploadCancel = document.getElementById('upload-cancel');
const youtubeLinkInput = document.getElementById('youtube-link');
const songFileInput = document.getElementById('song-file');
const thumbnailFileInput = document.getElementById('thumbnail-file');

const savePresetBtn = document.getElementById('save-preset');
const loadPresetBtn = document.getElementById('load-preset');

const dimmer = document.getElementById('dimmer');
const songGrid = document.getElementById('song_grid');

youtubeLinkInput.addEventListener('paste', async (event) => {
    let youtubeLink = event.clipboardData.getData("text");
    if (youtubeLink.includes('youtube.com/watch?v=')) {
        await downloadVideo(youtubeLink);
    } else {
        console.log('invalid url');
    }
});

async function downloadVideo(youtubeLink) {
    try {
        // download audio
        const audioResponse = await fetch('http://localhost:3000/download/audio', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({message: youtubeLink})
        });

        if (!audioResponse.ok) {
            throw new Error(`error: ${audioResponse.status}`);
        }
        const videoTitle = audioResponse.headers.get('Content-Disposition').split('"')[1].toString().slice(0, -4);
        const audioBlob = await audioResponse.blob();
        const audioFile = new File([audioBlob], videoTitle + '.mp3', { type: "audio/mpeg" });

        // download thumbnail
        const thumbnailResponse = await fetch('http://localhost:3000/download/thumbnail', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({message: youtubeLink})
        });

        if (!thumbnailResponse.ok) {
            throw new Error(thumbnailResponse.status);
        }

        const thumbnailBlob = await thumbnailResponse.blob();
        const thumbnailFile = new File([thumbnailBlob], videoTitle + '.jpg', { type: thumbnailResponse.headers.get('Content-Type') });

        // add files to inputs
        const audioDataTransfer = new DataTransfer();
        audioDataTransfer.items.add(audioFile);
        songFileInput.files = audioDataTransfer.files;

        const thumbnailDataTransfer = new DataTransfer();
        thumbnailDataTransfer.items.add(thumbnailFile);
        thumbnailFileInput.files = thumbnailDataTransfer.files;

    } catch (error) {
        console.error(error);
    }
}


uploadSubmit.addEventListener('click', () => {
    // remember to loop through added genres later
    const thumbnail = thumbnailFileInput.files[0];
    const audio = songFileInput.files[0];
    const title = thumbnail.name.toString().slice(0, -4);

    const songElement = document.createElement('div');
    songElement.classList.add('song_item');
    songElement.innerHTML = `
        <h3>${title}</h3>
        <p>ambient + music</p>
        <img src="${URL.createObjectURL(thumbnail)}" alt="${title}">
    `;
    songGrid.appendChild(songElement);

    thumbnailFileInput.value = null;
    songFileInput.value = null;
    youtubeLinkInput.value = null;
    
    uploadPopup.style.opacity = '0';
    dimmer.style.opacity = '0';
    setTimeout(() => {
       uploadPopup.style.visibility = 'hidden';
       dimmer.style.visibility = 'hidden'; 
    }, 10);

    // audio play test
    /*
    const audioUrl = URL.createObjectURL(audio);
    console.log('Audio URL:', audioUrl);
    
    const audioTest = new Audio(audioUrl);
    audioTest.play().then(console.log('audio play started'));
    */

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