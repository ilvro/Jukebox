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
        //const audioResponse = await fetch('https://jukebox-mu.vercel.app/api/download/audio', {
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
        //const thumbnailResponse = await fetch('https://jukebox-mu.vercel.app/api/download/thumbnail', {
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
        alert("Your browser doesn't support the File System Access API. Switch to a modern browser.");
        return;
    }

    try {
        const directoryHandle = await window.showDirectoryPicker();
        const songItems = document.querySelectorAll('.song-item');
        let presetData = [];

        // load preset_metadata.json if it exists, create one if it doesnt
        try {
            const presetMetadataHandle = await directoryHandle.getFileHandle('preset_metadata.json');
            const metadataFile = await presetMetadataHandle.getFile();
            const metadataText = await metadataFile.text();
            presetData = metadataText.trim() ? JSON.parse(metadataText) : []; // wow
        } catch (err) {
            if (err.name === 'NotFoundError') {
                console.log('no existing preset_metadata.json, starting fresh');
            } else {
                throw err;
            }
        }

        for (const songItem of songItems) {
            const currentTitle = encodeURIComponent(songItem.querySelector('input').value);
            const originalTitle = encodeURIComponent(songItem.querySelector('input').defaultValue);
            const audioUrl = songItem.dataset.audioUrl;
            const imageUrl = songItem.querySelector('img').src;
            const genres = songItem.getAttribute('data-genres').split(',');
            const tags = songItem.querySelector('p').textContent.split(' + ');
        
            // check for title changes
            const existingIndex = presetData.findIndex(item => item.currentTitle === originalTitle);
            if (existingIndex !== -1) {
                console.log(`updating existing song: ${decodeURIComponent(originalTitle)} to ${decodeURIComponent(currentTitle)}`);
                presetData[existingIndex] = {
                    currentTitle,
                    genres,
                    tags
                };
        
                // rename audio and image files
                if (currentTitle !== originalTitle) {
                    try {
                        const oldAudioHandle = await directoryHandle.getFileHandle(`${originalTitle}.mp3`);
                        const newAudioHandle = await directoryHandle.getFileHandle(`${currentTitle}.mp3`, { create: true });
                        const writable = await newAudioHandle.createWritable();
                        const oldFile = await oldAudioHandle.getFile();
                        await writable.write(await oldFile.arrayBuffer());
                        await writable.close();
                        await directoryHandle.removeEntry(`${originalTitle}.mp3`);
                    } catch (err) {
                        console.warn(`audio file rename failed for ${decodeURIComponent(originalTitle)}:`, err);
                    }
        
                    try {
                        const oldImageHandle = await directoryHandle.getFileHandle(`${originalTitle}.jpg`);
                        const newImageHandle = await directoryHandle.getFileHandle(`${currentTitle}.jpg`, { create: true });
                        const writable = await newImageHandle.createWritable();
                        const oldFile = await oldImageHandle.getFile();
                        await writable.write(await oldFile.arrayBuffer());
                        await writable.close();
                        await directoryHandle.removeEntry(`${originalTitle}.jpg`);
                    } catch (err) {
                        console.warn(`image file rename failed for ${decodeURIComponent(originalTitle)}:`, err);
                    }
                }
            } else {
                console.log(`adding new song: ${decodeURIComponent(currentTitle)}`);
                presetData.push({ currentTitle, genres, tags });
            }
        
            try {
                await directoryHandle.getFileHandle(`${currentTitle}.mp3`);
            } catch (err) {
                const audioResponse = await fetch(audioUrl);
                const audioBlob = await audioResponse.blob();
                const audioFileHandle = await directoryHandle.getFileHandle(`${currentTitle}.mp3`, { create: true });
                const audioWritable = await audioFileHandle.createWritable();
                await audioWritable.write(audioBlob);
                await audioWritable.close();
            }
        
            try {
                await directoryHandle.getFileHandle(`${currentTitle}.jpg`);
            } catch (err) {
                const imageResponse = await fetch(imageUrl);
                const imageBlob = await imageResponse.blob();
                const imageFileHandle = await directoryHandle.getFileHandle(`${currentTitle}.jpg`, { create: true });
                const imageWritable = await imageFileHandle.createWritable();
                await imageWritable.write(imageBlob);
                await imageWritable.close();
            }
        
            console.log(`Saved ${currentTitle}`);
        }
        

        const presetMetadataHandle = await directoryHandle.getFileHandle('preset_metadata.json', { create: true });
        const presetMetadataWritable = await presetMetadataHandle.createWritable();
        await presetMetadataWritable.write(JSON.stringify(presetData, null, 2));
        await presetMetadataWritable.close();

        console.log('saved preset');
    } catch (error) {
        console.error('error saving preset:', error);
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

        const presetMetadataHandle = await directoryHandle.getFileHandle('preset_metadata.json');
        const presetMetadataFile = await presetMetadataHandle.getFile();
        const presetMetadata = JSON.parse(await presetMetadataFile.text());

        for (const songMetadata of presetMetadata) {
            const {currentTitle, genres, tags} = songMetadata;
    
            const audioEntry = await directoryHandle.getFileHandle(`${currentTitle}.mp3`);
            const audio = await audioEntry.getFile();
            const thumbnailEntry = await directoryHandle.getFileHandle(`${currentTitle}.jpg`);
            const thumbnail = await thumbnailEntry.getFile();

            // create song item
            const songItem = document.createElement('div');
            songItem.classList.add('song-item');
            songItem.setAttribute('draggable', 'true');
            songItem.setAttribute('data-genres', genres.join(','));
            songItem.innerHTML = `
                <input spellcheck='false' class='title-input' value="${decodeURIComponent(currentTitle)}"</input>
                <p>${tags.join(' + ')}</p>
                <img src="${URL.createObjectURL(thumbnail)}" alt="${decodeURIComponent(currentTitle)}">
            `

            // disables images and audio blob links from being dragged to the title input
            const titleInput = songItem.querySelector('.title-input');
            titleInput.addEventListener('dragover', (event) => {
                event.preventDefault();
            });
            titleInput.addEventListener('drop', (event) => {
                event.preventDefault();
                event.stopPropagation();
            });
            songGrid.appendChild(songItem);
            addSongToPlayer(songItem, audio);

        }
        console.log('loaded preset');
        document.dispatchEvent(new Event('songsUpdated'));
    }
    catch (error) {
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

    const songItem = document.createElement('div');
    songItem.classList.add('song-item');
    songItem.setAttribute('draggable', 'true');
    songItem.setAttribute('data-genres', genres.join(','));
    songItem.innerHTML = `
        <input class="title-input" value="${title}"</input>
        <p>${tags.join(' + ')}</p>
        <img src="${URL.createObjectURL(thumbnail)}" alt="${title}">
    `;
    songGrid.appendChild(songItem);
    addSongToPlayer(songItem, audio);
    document.dispatchEvent(new Event('songsUpdated'));

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