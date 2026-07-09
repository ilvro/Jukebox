import { addSongToPlayer, getMarkers, setMarkers, fadeTo, cutTo, fadeOut, removeSongAudio, resetSong } from "./player.js";
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

function createLoadingIndicator() {
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-indicator';
    loadingDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 20px 40px;
        border-radius: 10px;
        z-index: 10000;
        font-size: 18px;
        text-align: center;
    `;
    loadingDiv.innerHTML = `
        <div>Downloading from YouTube...</div>
        <div style="margin-top: 10px; font-size: 14px;" id="loading-status">Please wait...</div>
    `;
    document.body.appendChild(loadingDiv);
    return loadingDiv;
}

function updateLoadingStatus(message) {
    const statusEl = document.getElementById('loading-status');
    if (statusEl) {
        statusEl.textContent = message;
    }
}

function removeLoadingIndicator() {
    const loadingDiv = document.getElementById('loading-indicator');
    if (loadingDiv) {
        loadingDiv.remove();
    }
}

let isDownloading = false;

window.addEventListener('beforeunload', (event) => {
    if (isDownloading) {
        event.preventDefault();
        event.returnValue = '';
        return '';
    }
});

async function downloadVideo(youtubeLink) {
    isDownloading = true;
    const loadingIndicator = createLoadingIndicator();
    
    try {
        updateLoadingStatus('Fetching audio...');
        
        const audioPromise = fetch(`${API_URL}/download/youtube/audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: youtubeLink })
        });

        updateLoadingStatus('Fetching thumbnail...');
        const thumbnailPromise = fetch(`${API_URL}/download/youtube/thumbnail`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: youtubeLink })
        });

        const [audioResponse, thumbnailResponse] = await Promise.all([audioPromise, thumbnailPromise]);
        
        console.log('Audio response status:', audioResponse.status);
        console.log('Thumbnail response status:', thumbnailResponse.status);
        
        // handle audio response
        if (!audioResponse.ok) {
            const errorText = await audioResponse.text();
            console.error('Audio response error:', errorText);
            throw new Error(`audio download failed: ${audioResponse.statusText} - ${errorText}`);
        }
        
        updateLoadingStatus('Processing audio...');
        const contentDisposition = audioResponse.headers.get('Content-Disposition');
        if (!contentDisposition) {
            throw new Error('missing Content-Disposition header in audio response');
        }
        
        let videoTitle;
        const filenameStarMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/);
        if (filenameStarMatch) {
            videoTitle = decodeURIComponent(filenameStarMatch[1]).replace(/\.(mp3|m4a)$/, '');
        } else {
            const filenameMatch = contentDisposition.match(/filename="?([^";\n]+)"?/);
            if (filenameMatch) {
                videoTitle = filenameMatch[1].replace(/\.(mp3|m4a)$/, '').replace(/"/g, '');
            } else {
                videoTitle = 'audio';
            }
        }
        videoTitle = videoTitle.replace(/\.(mp3|m4a)$/i, '').trim();
        
        console.log('Video title:', videoTitle);
        
        const audioBlob = await audioResponse.blob();
        console.log('Audio blob size:', audioBlob.size, 'bytes');
        console.log('Audio blob type:', audioBlob.type);
        
        if (audioBlob.size === 0) {
            throw new Error('Audio file is empty');
        }
        
        const audioFile = new File([audioBlob], `${videoTitle}.mp3`, { type: 'audio/mpeg' });

        // handle thumbnail response
        updateLoadingStatus('Processing thumbnail...');
        if (!thumbnailResponse.ok) {
            const errorText = await thumbnailResponse.text();
            console.error('Thumbnail response error:', errorText);
            throw new Error(`thumbnail download failed: ${thumbnailResponse.statusText} - ${errorText}`);
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

        updateLoadingStatus('Download complete! ✓');
        setTimeout(() => {
            removeLoadingIndicator();
            isDownloading = false;
        }, 1000);

        console.log('Download successful:', videoTitle);

    } catch (error) {
        console.error('download failed:', error);
        console.error('Error stack:', error.stack);
        updateLoadingStatus(`Error: ${error.message}`);
        setTimeout(() => {
            removeLoadingIndicator();
            isDownloading = false;
        }, 5000);
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
            presetData = metadataText.trim() ? JSON.parse(metadataText) : [];
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
            const genres = songItem.getAttribute('data-genres').split(',').filter(g => g.trim());
            const tags = songItem.getAttribute('data-tags').split(',').filter(t => t.trim());
            
            const songId = songItem.dataset.songId;
            const markers = getMarkers(songId);

            // check for title changes
            const existingIndex = presetData.findIndex(item => item.currentTitle === originalTitle);
            if (existingIndex !== -1) {
                console.log(`updating existing song: ${decodeURIComponent(originalTitle)} to ${decodeURIComponent(currentTitle)}`);
                const updatedSong = {
                    currentTitle,
                    genres,
                    tags,
                    markers
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
                const newSong = { currentTitle, genres, tags, markers };
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

        for (const songMetadata of presetMetadata) {
            let { currentTitle, genres, tags, markers } = songMetadata;

            genres = genres.map(genre => genre === 'modern' ? 'mystery' : genre).filter(g => g);
            songMetadata.genres = genres;

            let audioFile, thumbnailFile;
            try {
                // first try with the _ encoding (more common because google drive turns it into underscore)
                const underscoreTitle = currentTitle.replace(/%/g, '_');
                const audioEntry = await directoryHandle.getFileHandle(`${underscoreTitle}.mp3`);
                const thumbnailEntry = await directoryHandle.getFileHandle(`${underscoreTitle}.jpg`);
                audioFile = await audioEntry.getFile();
                thumbnailFile = await thumbnailEntry.getFile();
            } catch (error) {
                // try with the original % encoding
                try {
                    const revertedTitle = revertUnderscoreEncoding(currentTitle);
                    const audioEntry = await directoryHandle.getFileHandle(`${revertedTitle}.mp3`);
                    const thumbnailEntry = await directoryHandle.getFileHandle(`${revertedTitle}.jpg`);
                    audioFile = await audioEntry.getFile();
                    thumbnailFile = await thumbnailEntry.getFile();
                } catch (finalError) {
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
                <p>${tags.join(' + ')}${genres.length > 0 ? ' | ' + genres.join(' + ') : ''}</p>
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
            
            // load markers
            if (markers && markers.length > 0) {
                setMarkers(songItem.dataset.songId, markers);
            }
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
        
        // promises for all songs
        const songPromises = presetMetadata.map(async (songMetadata) => {
            const { currentTitle, genres, tags, markers } = songMetadata;
            const decodedTitle = decodeURIComponent(currentTitle);
            const updatedGenres = genres.map(genre => genre === 'modern' ? 'mystery' : genre).filter(g => g);
            const fixedTitle = currentTitle.replace(/%/g, '%25');
            
            const audioPath = `${sampleFolderPath}${fixedTitle}.mp3`;
            const imagePath = `${sampleFolderPath}${fixedTitle}.jpg`;
            
            // fetch audio and image in parallel for faster processing
            const [audioResponse, thumbnailResponse] = await Promise.all([
                fetch(audioPath),
                fetch(imagePath)
            ]);
            
            if (!audioResponse.ok) {
                throw new Error(`Failed to fetch audio file: ${audioResponse.status}`);
            }
            
            if (!thumbnailResponse.ok) {
                throw new Error(`Failed to fetch thumbnail file: ${thumbnailResponse.status}`);
            }
            
            const [audioBlob, thumbnailBlob] = await Promise.all([
                audioResponse.blob(),
                thumbnailResponse.blob()
            ]);
            
            return {
                currentTitle,
                decodedTitle,
                updatedGenres,
                tags,
                markers,
                audioFile: new File([audioBlob], `${currentTitle}.mp3`, { type: 'audio/mpeg' }),
                thumbnailFile: new File([thumbnailBlob], `${currentTitle}.jpg`, { type: 'image/jpeg' })
            };
        });
        
        // processes batches of song to avoid overwhelming the browser (way faster this way)
        const BATCH_SIZE = 5;
        const totalSongs = songPromises.length;
        
        for (let i = 0; i < totalSongs; i += BATCH_SIZE) {
            const batch = songPromises.slice(i, i + BATCH_SIZE);
            const songBatch = await Promise.all(batch);

            songBatch.forEach(song => {
                const songItem = document.createElement('div');
                songItem.classList.add('song-item');
                songItem.setAttribute('draggable', 'true');
                songItem.setAttribute('data-genres', song.updatedGenres.join(','));
                songItem.setAttribute('data-tags', song.tags.join(','));
                songItem.innerHTML = `
                    <input spellcheck='false' class='title-input' value="${song.decodedTitle}"></input>
                    <p>${song.tags.join(' + ')}${song.updatedGenres.length > 0 ? ' | ' + song.updatedGenres.join(' + ') : ''}</p>
                    <img src="${URL.createObjectURL(song.thumbnailFile)}" alt="${song.decodedTitle}">
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
                addSongToPlayer(songItem, song.audioFile);
                
                if (song.markers && song.markers.length > 0) {
                    setMarkers(songItem.dataset.songId, song.markers);
                }
            });
            
            // give the browser a break
            await new Promise(resolve => setTimeout(resolve, 0));
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
        let { currentTitle, genres, tags, markers } = songMetadata;
        genres = genres.map(genre => genre === 'modern' ? 'mystery' : genre).filter(g => g);

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
        songItem.setAttribute('data-tags', tags.join(','));
        songItem.innerHTML = `
            <input spellcheck='false' class='title-input' value="${decodeURIComponent(currentTitle)}"></input>
            <p>${tags.join(' + ')}${genres.length > 0 ? ' | ' + genres.join(' + ') : ''}</p>
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
        
        if (markers && markers.length > 0) {
            setMarkers(songItem.dataset.songId, markers);
        }
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

function revertUnderscoreEncoding(title) { // because google drive turns presets into .zips and extracting them changes the name, so we have to revert to the normal name to make the preset work again
    return title.replace(/_([0-9A-F]{2})/g, '%$1');
}

savePresetBtn.addEventListener('click', savePreset);
loadPresetBtn.addEventListener('click', loadPreset);
loadSampleBtn.addEventListener('click', loadSamplePreset);

youtubeLinkInput.addEventListener('paste', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    
    let youtubeLink = event.clipboardData.getData("text");
    
    // manually insert the text since we prevented default
    youtubeLinkInput.value = youtubeLink;
    
    if (youtubeLink.includes('youtube.com/watch?v=')) {
        await downloadVideo(youtubeLink);
    } else {
        console.log('invalid url');
    }
    
    return false;
});

// Also prevent form submission if Enter is pressed
youtubeLinkInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        return false;
    }
});

// Prevent any default action on the input itself
youtubeLinkInput.addEventListener('submit', (event) => {
    event.preventDefault();
    return false;
});

// Stop navigation when clicking anywhere on the popup
uploadPopup.addEventListener('click', (event) => {
    // Don't prevent clicks on buttons
    if (!event.target.matches('button')) {
        event.stopPropagation();
    }
});

uploadSubmit.addEventListener('click', () => {
    // remember to loop through added genres later
    const thumbnail = thumbnailFileInput.files[0];
    const audio = songFileInput.files[0];
    
    if (!thumbnail || !audio) {
        alert('Please select both an audio file and a thumbnail!');
        return;
    }
    
    let title;
    try {
        title = decodeURIComponent(thumbnail.name.toString().slice(0, -4));
    } catch {
        title = thumbnail.name.toString().slice(0, -4);
    }
    
    const genres = getSelectedGenres();
    const tags = getSelectedTags();

    const songItem = document.createElement('div');
    songItem.classList.add('song-item');
    songItem.setAttribute('draggable', 'true');
    songItem.setAttribute('data-genres', genres.join(','));
    songItem.setAttribute('data-tags', tags.join(','));
    songItem.innerHTML = `
        <input class="title-input" value="${title}"</input>
        <p>${tags.join(' + ')}${genres.length > 0 ? ' | ' + genres.join(' + ') : ''}</p>
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
document.addEventListener('DOMContentLoaded', () => {
    const songGrid = document.getElementById('song-grid');
    const contextMenu = document.createElement('div');
    
    // tracks the song item currently targeted by right-click
    let currentSongItem = null;

    contextMenu.id = 'custom-context-menu';
    contextMenu.style.position = 'absolute';
    contextMenu.style.display = 'none';
    contextMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.8)'; // darker as requested
    contextMenu.style.color = '#fff';
    contextMenu.style.padding = '10px';
    contextMenu.style.borderRadius = '5px';
    contextMenu.style.zIndex = '10000'; // high z-index to stay on top
    contextMenu.style.cursor = 'default';

    songGrid.addEventListener('contextmenu', (event) => {
        const songItem = event.target.closest('.song-item');
        if (!songItem) return;

        event.preventDefault();
        event.stopPropagation(); // prevent other context menus
        currentSongItem = songItem;
        
        contextMenu.style.top = `${event.pageY}px`;
        contextMenu.style.left = `${event.pageX}px`;
        contextMenu.style.display = 'block';
    });

    // helper to create menu options with the visual style you liked
    const createOption = (text, callback) => {
        const opt = document.createElement('div');
        opt.textContent = text;
        opt.style.padding = '5px 10px';
        opt.style.cursor = 'pointer';
        opt.onmouseover = () => opt.style.backgroundColor = '#444';
        opt.onmouseout = () => opt.style.backgroundColor = 'transparent';
        
        // use mousedown to execute BEFORE the global click listener closes the menu
        opt.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation(); // CRITICAL: stops the click from hitting the song tile
            if (currentSongItem) {
                callback(currentSongItem);
            }
            contextMenu.style.display = 'none';
        });
        return opt;
    };

    // adding options in order
    contextMenu.appendChild(createOption('Fade To', (item) => {
        fadeTo(item.dataset.songId);
    }));

    contextMenu.appendChild(createOption('Cut To', (item) => {
        cutTo(item.dataset.songId);
    }));

    contextMenu.appendChild(createOption('Fade Out', (item) => {
        fadeOut(item.dataset.songId);
    }));

    contextMenu.appendChild(createOption('Reset', (item) => {
        resetSong(item.dataset.songId);
    }));

    contextMenu.appendChild(createOption('Edit Genres', (item) => {
        showEditGenresPopup(item);
    }));

    contextMenu.appendChild(createOption('Delete', (item) => {
        const titleInput = item.querySelector('.title-input');
        const title = titleInput ? titleInput.defaultValue : 'Unknown';
        const songId = item.dataset.songId;
        deletedSongs.push(title);

        // release the thumbnail's blob URL too, not just the audio's
        const thumbnailImg = item.querySelector('img');
        if (thumbnailImg && thumbnailImg.src.startsWith('blob:')) {
            URL.revokeObjectURL(thumbnailImg.src);
        }

        removeSongAudio(songId); // Clean up audio references
        item.remove();
        document.dispatchEvent(new Event('songsUpdated'));
    }));

    document.body.appendChild(contextMenu);

    // close menu on click outside
    document.addEventListener('mousedown', (e) => {
        if (!contextMenu.contains(e.target)) {
            contextMenu.style.display = 'none';
        }
    });
});

function showEditGenresPopup(songItem) {
    const existingPopup = document.getElementById('edit-genres-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    const popup = document.createElement('div');
    popup.id = 'edit-genres-popup';
    popup.className = 'popup';
    
    // ensure proper positioning and z-index
    Object.assign(popup.style, {
        position: 'fixed',
        left: '50%',
        top: '45%',
        transform: 'translate(-50%, -50%)',
        zIndex: '4',
        pointerEvents: 'auto'
    });

    const header = document.createElement('header');
    header.className = 'popup-header';
    
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'upload-end-btns';
    
    const saveButton = document.createElement('button');
    saveButton.id = 'edit-submit';
    saveButton.className = 'button';
    saveButton.textContent = 'Save';
    
    const cancelButton = document.createElement('button');
    cancelButton.id = 'edit-cancel';
    cancelButton.className = 'red-button';
    cancelButton.textContent = 'X';
    
    buttonsContainer.appendChild(saveButton);
    buttonsContainer.appendChild(cancelButton);
    header.appendChild(buttonsContainer);
    popup.appendChild(header);

    const content = document.createElement('div');
    content.className = 'popup-content';
    content.innerHTML = '<br><br>';

    const genresAttr = songItem.getAttribute('data-genres');
    const tagsAttr = songItem.getAttribute('data-tags');
    
    const currentGenres = genresAttr ? genresAttr.split(',').filter(g => g.trim()) : [];
    const currentTags = tagsAttr ? tagsAttr.split(',').filter(t => t.trim()) : [];

    const allGenres = ['fun', 'hopeful', 'mystery', 'suspense', 'horror', 'sfx'];
    const allTags = ['ambient', 'investigation', 'event', 'battle', 'emotional'];

    const uploadStep = document.createElement('div');
    uploadStep.className = 'upload-step';
    
    const label = document.createElement('label');
    label.textContent = 'Select the song\'s genres:';
    uploadStep.appendChild(label);

    const tagCheckboxes = document.createElement('div');
    tagCheckboxes.className = 'genre-checkboxes';
    tagCheckboxes.id = 'edit-tag-checkboxes';
    
    allTags.forEach(tag => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `edit-tag-${tag}`;
        checkbox.name = 'edit-tag';
        checkbox.value = tag;
        checkbox.checked = currentTags.includes(tag);

        const checkboxLabel = document.createElement('label');
        checkboxLabel.htmlFor = `edit-tag-${tag}`;
        checkboxLabel.className = 'genre-btn';
        checkboxLabel.textContent = tag;

        tagCheckboxes.appendChild(checkbox);
        tagCheckboxes.appendChild(checkboxLabel);
    });
    
    uploadStep.appendChild(tagCheckboxes);

    const genreCheckboxes = document.createElement('div');
    genreCheckboxes.className = 'genre-checkboxes';
    genreCheckboxes.id = 'edit-genre-checkboxes';

    allGenres.forEach(genre => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `edit-genre-${genre}`;
        checkbox.name = 'edit-genre';
        checkbox.value = genre;
        checkbox.checked = currentGenres.includes(genre);

        const checkboxLabel = document.createElement('label');
        checkboxLabel.htmlFor = `edit-genre-${genre}`;
        checkboxLabel.className = 'genre-btn';
        checkboxLabel.textContent = genre;

        genreCheckboxes.appendChild(checkbox);
        genreCheckboxes.appendChild(checkboxLabel);
    });

    uploadStep.appendChild(genreCheckboxes);
    content.appendChild(uploadStep);
    popup.appendChild(content);

    saveButton.addEventListener('click', () => {
        const selectedTags = [];
        const selectedGenres = [];

        allTags.forEach(tag => {
            const checkbox = document.getElementById(`edit-tag-${tag}`);
            if (checkbox && checkbox.checked) {
                selectedTags.push(tag);
            }
        });

        allGenres.forEach(genre => {
            const checkbox = document.getElementById(`edit-genre-${genre}`);
            if (checkbox && checkbox.checked) {
                selectedGenres.push(genre);
            }
        });

        songItem.setAttribute('data-genres', selectedGenres.join(','));
        songItem.setAttribute('data-tags', selectedTags.join(','));
        
        const pTag = songItem.querySelector('p');
        if (pTag) {
            pTag.textContent = selectedTags.join(' + ') + (selectedGenres.length > 0 ? ' | ' + selectedGenres.join(' + ') : '');
        }

        popup.style.opacity = '0';
        dimmer.style.opacity = '0';
        setTimeout(() => {
            popup.style.visibility = 'hidden';
            dimmer.style.visibility = 'hidden';
        }, 300);
    });

    cancelButton.addEventListener('click', () => {
        popup.style.opacity = '0';
        dimmer.style.opacity = '0';
        setTimeout(() => {
            popup.style.visibility = 'hidden';
            dimmer.style.visibility = 'hidden';
        }, 300);
    });

    const dimmer = document.getElementById('dimmer');
    document.body.appendChild(popup);
    
    popup.style.visibility = 'visible';
    dimmer.style.visibility = 'visible';
    setTimeout(() => {
        popup.style.opacity = '1';
        dimmer.style.opacity = '0.6';
    }, 10);
}

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