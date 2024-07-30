import { addSongToPlayer } from "./player.js";

const uploadSongBtn = document.getElementById('upload-song-btn');
const uploadPopup = document.getElementById('upload-popup');
const uploadSubmit = document.getElementById('upload-submit');
const uploadCancel = document.getElementById('upload-cancel');
const youtubeLinkInput = document.getElementById('youtube-link');
const songFileInput = document.getElementById('song-file');
const thumbnailFileInput = document.getElementById('thumbnail-file');

const savePresetBtn = document.getElementById('save-preset-btn');
const loadPresetBtn = document.getElementById('load-preset-btn');
const supportsFileSystemAccess = 'showDirectoryPicker' in window;

const dimmer = document.getElementById('dimmer');
const songGrid = document.getElementById('song-grid');

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

async function savePreset() {
    if (!supportsFileSystemAccess) {
        alert("your browser doesn't support the file system access api. switch to a modern browser");
        return;
    }

    try {
        const directoryHandle = await window.showDirectoryPicker();
        const songItems = document.querySelectorAll('.song-item');

        for (const songItem of songItems) {
            const title = songItem.querySelector('h3').textContent;
            const audioUrl = songItem.dataset.audioUrl;
            const imageUrl = songItem.querySelector('img').src;

            // urls are temporary, so we have to work backwards and get the file itself
            const audioResponse = await fetch(audioUrl);
            const audioBlob = await audioResponse.blob();

            const imageResponse = await fetch(imageUrl);
            const imageBlob = await imageResponse.blob();

            // save
            const audioFileHandle = await directoryHandle.getFileHandle(`${title}.mp3`, { create: true });
            const audioWritable = await audioFileHandle.createWritable();
            await audioWritable.write(audioBlob);
            await audioWritable.close();

            const imageFileHandle = await directoryHandle.getFileHandle(`${title}.jpg`, { create: true });
            const imageWritable = await imageFileHandle.createWritable();
            await imageWritable.write(imageBlob);
            await imageWritable.close();
        }
        console.log('preset saved');
    }
    catch {
        console.error('error saving preset: ', error)
    }
}

async function loadPreset() {
    if (!supportsFileSystemAccess) {
        alert("your browser doesn't support the file system access api. switch to a modern browser");
        return;
    }
    try {
        const directoryHandle = await window.showDirectoryPicker();
        songGrid.innerHTML = '';

        for await (const entry of directoryHandle.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.mp3')) {
                const title = entry.name.slice(0, -4); // remove .mp3 from the name
                const audio = await entry.getFile();
                const imageEntry = await directoryHandle.getFileHandle(`${title}.jpg`);
                const thumbnail = await imageEntry.getFile();

                const songElement = document.createElement('div');
                songElement.classList.add('song-item');
                songElement.innerHTML = `
                    <h3>${title}</h3>
                    <p>ambient + music</p>
                    <img src="${URL.createObjectURL(thumbnail)}" alt="${title}">
                `
                songGrid.appendChild(songElement);

                addSongToPlayer(songElement, audio);
            }
        }
        console.log('loaded preset');
    }
    catch {
        console.error('error loading preset: ', error);
    }
}

function getSelectedTags() {
    const tags = document.querySelectorAll('input[name="tag"]');
    const selectedTags = [];
    
    tags.forEach(tag => {
        if (tag.checked) {
            selectedTags.push(tag.value);
        }
    })
    return selectedTags;
}

function getSelectedGenres() {
    const genres = document.querySelectorAll('input[name="genre"]');
    const selectedGenres = [];
    
    genres.forEach(genre => {
        if (genre.checked) {
            selectedGenres.push(genre.value);
        }
    })
    return selectedGenres;
}

savePresetBtn.addEventListener('click', savePreset);
loadPresetBtn.addEventListener('click', loadPreset);

youtubeLinkInput.addEventListener('paste', async (event) => {
    let youtubeLink = event.clipboardData.getData("text");
    if (youtubeLink.includes('youtube.com/watch?v=')) {
        await downloadVideo(youtubeLink);
    } else {
        console.log('invalid url');
    }
});

uploadSubmit.addEventListener('click', () => {
    // remember to loop through added genres later
    const thumbnail = thumbnailFileInput.files[0];
    const audio = songFileInput.files[0];
    const title = thumbnail.name.toString().slice(0, -4);
    const genres = getSelectedGenres();
    const tags = getSelectedTags();

    const songElement = document.createElement('div');
    songElement.classList.add('song-item');
    songElement.setAttribute('data-genres', genres.join(','));
    songElement.innerHTML = `
        <h3>${title}</h3>
        <p>${tags.join(' + ')}</p>
        <img src="${URL.createObjectURL(thumbnail)}" alt="${title}">
    `;
    songGrid.appendChild(songElement);
    addSongToPlayer(songElement, audio);

    // fade out the ui
    thumbnailFileInput.value = null;
    songFileInput.value = null;
    youtubeLinkInput.value = null;
    
    uploadPopup.style.opacity = '0';
    dimmer.style.opacity = '0';
    setTimeout(() => {
       uploadPopup.style.visibility = 'hidden';
       dimmer.style.visibility = 'hidden'; 
    }, 10);
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