import { addSongToPlayer } from "./player.js";
//const API_URL = 'https://jukebox-backend-16sx.onrender.com'
const API_URL = 'http://localhost:3000';

const uploadSongBtn = document.getElementById('upload-song-btn');
const uploadPopup = document.getElementById('upload-popup');
const uploadSubmit = document.getElementById('upload-submit');
const uploadCancel = document.getElementById('upload-cancel');
const youtubeLinkInput = document.getElementById('youtube-link');
const songFileInput = document.getElementById('song-file');
const thumbnailFileInput = document.getElementById('thumbnail-file');

const savePresetBtn = document.getElementById('save-preset-btn');
const loadPresetBtn = document.getElementById('load-preset-btn');
const loadSampleBtn = document.getElementById('load-sample-btn');
const supportsFileSystemAccess = 'showDirectoryPicker' in window;

const dimmer = document.getElementById('dimmer');
const songGrid = document.getElementById('song-grid');

async function downloadVideo(youtubeLink) {
    try {
        const audioPromise = fetch(`${API_URL}/download/youtube/audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: youtubeLink })
        });

        const thumbnailPromise = fetch(`${API_URL}/download/youtube/thumbnail`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: youtubeLink })
        });

        const [audioResponse, thumbnailResponse] = await Promise.all([audioPromise, thumbnailPromise]); // send requests in parallel for faster downloading

        // handle audio response
        if (!audioResponse.ok) {
            throw new Error(`audio download failed: ${audioResponse.statusText}`);
        }
        const contentDisposition = audioResponse.headers.get('Content-Disposition');
        if (!contentDisposition) {
            throw new Error('missing Content-Disposition header in audio response');
        }
        const videoTitle = contentDisposition.split('filename=')[1].replace(/"/g, '').slice(0, -4).replace("inquote", '’');
        const audioBlob = await audioResponse.blob();
        const audioFile = new File([audioBlob], `${videoTitle}.mp3`, { type: "audio/mpeg" });

        // handle thumbnail response
        if (!thumbnailResponse.ok) {
            throw new Error(`thumbnail download failed: ${thumbnailResponse.statusText}`);
        }
        const thumbnailBlob = await thumbnailResponse.blob();
        const thumbnailFile = new File([thumbnailBlob], `${videoTitle}.jpg`, {
            type: thumbnailResponse.headers.get('Content-Type')
        });

        // populate input forms
        const audioDataTransfer = new DataTransfer();
        audioDataTransfer.items.add(audioFile);
        songFileInput.files = audioDataTransfer.files;

        const thumbnailDataTransfer = new DataTransfer();
        thumbnailDataTransfer.items.add(thumbnailFile);
        thumbnailFileInput.files = thumbnailDataTransfer.files;

    } catch (error) {
        console.error('download failed:', error);
    }
}

async function savePreset() {
    if (!supportsFileSystemAccess) {
        alert("Your browser doesn't support the File System Access API. Switch to a desktop environment.");
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
        // remove queued deleted songs from metadata and files
        presetData = presetData.filter(
            song => !deletedSongs.includes(decodeURIComponent(song.currentTitle))
        );

        for (let title of deletedSongs) {
            title = encodeURIComponent(title);
            try {
                await directoryHandle.removeEntry(`${title}.mp3`);
                console.log(`deleted audio file: ${title}.mp3`);
            } catch (err) {
                console.warn(`could not delete audio file for ${title}:`, err);
            }

            try {
                await directoryHandle.removeEntry(`${title}.jpg`);
                console.log(`deleted image file: ${title}.jpg`);
            } catch (err) {
                console.warn(`could not delete image file for ${title}:`, err);
            }
        }
        deletedSongs.length = 0;

        let updatedData = [];
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
                const updatedSong = {
                    currentTitle,
                    genres,
                    tags
                };

                presetData[existingIndex] = updatedSong;

                // rename audio and image files if the title changed
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

                updatedData.push(updatedSong);
            } else {
                console.log(`adding new song: ${decodeURIComponent(currentTitle)}`);
                const newSong = { currentTitle, genres, tags };
                presetData.push(newSong);
                updatedData.push(newSong);
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

            console.log(`saved ${currentTitle}`);
        }
        

        const presetMetadataHandle = await directoryHandle.getFileHandle('preset_metadata.json', { create: true });
        const presetMetadataWritable = await presetMetadataHandle.createWritable();
        await presetMetadataWritable.write(JSON.stringify(updatedData, null, 2));
        await presetMetadataWritable.close();

        console.log('saved preset');
    } catch (error) {
        console.error('error saving preset:', error);
    }
}


async function loadPreset() {
    if (!window.showDirectoryPicker) {
        // android user, use alternate fallback function
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.zip,application/json,audio/mpeg,image/jpeg';
        fileInput.multiple = true;
        fileInput.addEventListener('change', async (event) => {
            const files = event.target.files;
            await handleFilesFallback(files);
        });
        fileInput.click();
        return;
    }

    try {
        const directoryHandle = await window.showDirectoryPicker();
        songGrid.innerHTML = '';

        const presetMetadataHandle = await directoryHandle.getFileHandle('preset_metadata.json');
        const presetMetadataFile = await presetMetadataHandle.getFile();
        const presetMetadata = JSON.parse(await presetMetadataFile.text());

        const encodingMap = {
            '%20': '_20', // space
            '%21': '_21', // !
            '%22': '_22', // "
            '%23': '_23', // #
            '%24': '_24', // $
            '%25': '_25', // %
            '%26': '_26', // &
            '%27': '_27', // '
            '%28': '_28', // (
            '%29': '_29', // )
            '%2A': '_2A', // *
            '%2B': '_2B', // +
            '%2C': '_2C', // ,
            '%2D': '_2D', // -
            '%2E': '_2E', // .
            '%2F': '_2F', // /
            '%3A': '_3A', // :
            '%3B': '_3B', // ;
            '%3C': '_3C', // <
            '%3D': '_3D', // =
            '%3E': '_3E', // >
            '%3F': '_3F', // ?
            '%40': '_40', // @
            '%5B': '_5B', // [
            '%5C': '_5C', // \
            '%5D': '_5D', // ]
            '%5E': '_5E', // ^
            '%5F': '_5F', // _
            '%60': '_60', // `
            '%7B': '_7B', // {
            '%7C': '_7C', // |
            '%7D': '_7D', // }
            '%7E': '_7E'  // ~
        };

        for (const songMetadata of presetMetadata) {
            let { currentTitle, genres, tags } = songMetadata;

            genres = genres.map(genre => genre === 'modern' ? 'mystery' : genre);
            songMetadata.genres = genres;

            let audioFile, thumbnailFile;
            try {
                // first try with the original % encoding
                const audioEntry = await directoryHandle.getFileHandle(`${currentTitle}.mp3`);
                const thumbnailEntry = await directoryHandle.getFileHandle(`${currentTitle}.jpg`);
                audioFile = await audioEntry.getFile();
                thumbnailFile = await thumbnailEntry.getFile();
            } catch (error) {
                // try with _ encoding
                try {
                    let underscoreTitle = currentTitle;
                    for (const [encoded, underscore] of Object.entries(encodingMap)) {
                        underscoreTitle = underscoreTitle.split(encoded).join(underscore);
                    }

                    const audioEntry = await directoryHandle.getFileHandle(`${underscoreTitle}.mp3`);
                    const thumbnailEntry = await directoryHandle.getFileHandle(`${underscoreTitle}.jpg`);
                    audioFile = await audioEntry.getFile();
                    thumbnailFile = await thumbnailEntry.getFile();
                } catch (secondError) {
                    console.error(`could not load files for ${decodeURIComponent(currentTitle)}`);
                    continue;
                }
            }

            // create song item
            const songItem = document.createElement('div');
            songItem.classList.add('song-item');
            songItem.setAttribute('draggable', 'true');
            songItem.setAttribute('data-genres', genres.join(','));
            songItem.setAttribute('data-tags', tags.join(','));
            songItem.innerHTML = `
                <input spellcheck='false' class='title-input' value="${decodeURIComponent(currentTitle)}"></input>
                <p>${tags.join(' + ')}</p>
                <img src="${URL.createObjectURL(thumbnailFile)}" alt="${decodeURIComponent(currentTitle)}">
            `;

            // disables input and audio blob links from being dragged to the title input
            const titleInput = songItem.querySelector('.title-input');
            titleInput.addEventListener('dragover', (event) => {
                event.preventDefault();
            });
            titleInput.addEventListener('drop', (event) => {
                event.preventDefault();
                event.stopPropagation();
            });

            songGrid.appendChild(songItem);
            addSongToPlayer(songItem, audioFile);
        }
        console.log('loaded preset');
        document.dispatchEvent(new Event('songsUpdated'));
    } catch (error) {
        console.error('error loading preset: ', error);
    }
}

async function loadSamplePreset() {
    try {
        console.log('Loading sample preset...');
        songGrid.innerHTML = '';
        
        const sampleFolderPath = './sample/';
        const metadataResponse = await fetch(`${sampleFolderPath}preset_metadata.json`);
        if (!metadataResponse.ok) {
            throw new Error(`Failed to fetch sample preset metadata: ${metadataResponse.status}`);
        }
        
        const presetMetadata = await metadataResponse.json();
        console.log('Loaded preset metadata:', presetMetadata);
        
        // process each song in the metadata
        for (const songMetadata of presetMetadata) {
            try {
                const { currentTitle, genres, tags } = songMetadata;
                const decodedTitle = decodeURIComponent(currentTitle);
                
                console.log(`Loading song: ${decodedTitle}`);
                
                const updatedGenres = genres.map(genre => genre === 'modern' ? 'mystery' : genre);
                // replace % with %25 to properly encode the already encoded characters
                const fixedTitle = currentTitle.replace(/%/g, '%25');
                
                const audioPath = `${sampleFolderPath}${fixedTitle}.mp3`;
                const imagePath = `${sampleFolderPath}${fixedTitle}.jpg`;
                
                console.log(`Fetching audio: ${audioPath}`);
                console.log(`Fetching image: ${imagePath}`);
                
                const audioResponse = await fetch(audioPath);
                const thumbnailResponse = await fetch(imagePath);
                
                if (!audioResponse.ok) {
                    throw new Error(`Failed to fetch audio file: ${audioResponse.status}`);
                }
                
                if (!thumbnailResponse.ok) {
                    throw new Error(`Failed to fetch thumbnail file: ${thumbnailResponse.status}`);
                }
                
                const audioBlob = await audioResponse.blob();
                const thumbnailBlob = await thumbnailResponse.blob();
                
                const audioFile = new File([audioBlob], `${currentTitle}.mp3`, { type: 'audio/mpeg' });
                const thumbnailFile = new File([thumbnailBlob], `${currentTitle}.jpg`, { type: 'image/jpeg' });
                
                const songItem = document.createElement('div');
                songItem.classList.add('song-item');
                songItem.setAttribute('draggable', 'true');
                songItem.setAttribute('data-genres', updatedGenres.join(','));
                songItem.setAttribute('data-tags', tags.join(','));
                songItem.innerHTML = `
                    <input spellcheck='false' class='title-input' value="${decodedTitle}"></input>
                    <p>${tags.join(' + ')}</p>
                    <img src="${URL.createObjectURL(thumbnailFile)}" alt="${decodedTitle}">
                `;
                
                const titleInput = songItem.querySelector('.title-input');
                titleInput.addEventListener('dragover', (event) => {
                    event.preventDefault();
                });
                titleInput.addEventListener('drop', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                });
                
                songGrid.appendChild(songItem);
                addSongToPlayer(songItem, audioFile);
                console.log(`Added song: ${decodedTitle}`);
            } catch (err) {
                console.error(`Error loading song:`, err);
            }
        }
        
        console.log('Loaded sample preset');
        document.dispatchEvent(new Event('songsUpdated'));
    } catch (error) {
        console.error('Error loading sample preset:', error);
    }
}

async function handleFilesFallback(files) {
    const fileMap = {};
    for (const file of files) {
        fileMap[file.name] = file;
    }

    if (!fileMap['preset_metadata.json']) {
        alert('preset_metadata.json is missing');
        return;
    }

    const presetMetadataFile = fileMap['preset_metadata.json'];
    const presetMetadata = JSON.parse(await presetMetadataFile.text());

    for (const songMetadata of presetMetadata) {
        let { currentTitle, genres, tags } = songMetadata;
        genres = genres.map(genre => genre === 'modern' ? 'mystery' : genre);

        const audioFile = fileMap[`${currentTitle}.mp3`];
        const thumbnailFile = fileMap[`${currentTitle}.jpg`];

        if (!audioFile || !thumbnailFile) {
            console.error(`missing files for ${currentTitle}`);
            continue;
        }

        const songItem = document.createElement('div');
        songItem.classList.add('song-item');
        songItem.setAttribute('draggable', 'true');
        songItem.setAttribute('data-genres', genres.join(','));
        songItem.innerHTML = `
            <input spellcheck='false' class='title-input' value="${decodeURIComponent(currentTitle)}"></input>
            <p>${tags.join(' + ')}</p>
            <img src="${URL.createObjectURL(thumbnailFile)}" alt="${decodeURIComponent(currentTitle)}">
        `;

        const titleInput = songItem.querySelector('.title-input');
        titleInput.addEventListener('dragover', (event) => {
            event.preventDefault();
        });
        titleInput.addEventListener('drop', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        songGrid.appendChild(songItem);
        addSongToPlayer(songItem, audioFile);
    }
    console.log('loaded files via fallback');
    document.dispatchEvent(new Event('songsUpdated'));
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
loadSampleBtn.addEventListener('click', loadSamplePreset);

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
    let title;
    try {
        title = decodeURIComponent(thumbnail.name.toString().slice(0, -4));
    } catch {
        title = thumbnail.name.toString().slice(0, -4); // use raw name as fallback
    }
    
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

// right click functions
const deletedSongs = [];
async function deleteSongFile(directoryHandle, fileName) {
    try {
        await directoryHandle.removeEntry(fileName);
        console.log(`deleted ${fileName}`)
    } catch (error) {
        console.error(`error deleting file ${fileName}: `, error)
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const songGrid = document.getElementById('song-grid');
    const contextMenu = document.createElement('div');

    contextMenu.id = 'custom-context-menu';
    contextMenu.style.position = 'absolute';
    contextMenu.style.display = 'none';
    contextMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
    contextMenu.style.color = '#fff';
    contextMenu.style.padding = '10px';
    contextMenu.style.borderRadius = '5px';
    contextMenu.style.zIndex = '1000';

    const deleteOption = document.createElement('div');
    deleteOption.innerText = 'Delete';
    deleteOption.style.cursor = 'pointer';

    contextMenu.appendChild(deleteOption);
    document.body.appendChild(contextMenu);

    let currentSongItem = null;
    songGrid.addEventListener('contextmenu', (event) => {
        event.preventDefault();

        const songItem = event.target.closest('.song-item');
        if (!songItem) return;

        currentSongItem = songItem;
        contextMenu.style.top = `${event.pageY}px`;
        contextMenu.style.left = `${event.pageX}px`;
        contextMenu.style.display = 'block';
    });

    document.addEventListener('click', () => {
        contextMenu.style.display = 'none';
    });

    // delete functionality
    deleteOption.addEventListener('click', async () => {
        if (currentSongItem) {
            const title = currentSongItem.querySelector('.title-input').defaultValue;
            deletedSongs.push(title);
            currentSongItem.remove();

            document.dispatchEvent(new Event('songsUpdated'));
            console.log(`queued ${title} for deletion`)
        }

        contextMenu.style.display = 'none';
    });
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