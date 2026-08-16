import { addSongToPlayer, getMarkers, setMarkers, fadeIn, fadeTo, cutTo, playSong, fadeOut, stopSong, removeSongAudio, resetSong, downloadSong } from "./player.js";
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

// ---------------- song hotkeys (1-9) ----------------
const songHotkeys = new Map(); // '1'..'9' -> songId
const HOTKEY_MODES = ['fade', 'cut', 'insert'];
const HOTKEY_MODE_LABELS = {
    fade: 'Hotkeys: Fade',
    cut: 'Hotkeys: Cut',
    insert: 'Hotkeys: Insert'
};
let hotkeyMode = 'fade';

const hotkeyModeBtn = document.getElementById('hotkey-mode-button');
const hotkeyPanel = document.getElementById('hotkey-panel');
const hotkeyPanelList = document.getElementById('hotkey-panel-list');
const showHotkeysBtn = document.getElementById('show-hotkeys-button');

function updateHotkeyModeLabel() {
    if (hotkeyModeBtn) {
        hotkeyModeBtn.textContent = HOTKEY_MODE_LABELS[hotkeyMode];
        hotkeyModeBtn.title = hotkeyMode === 'insert'
            ? 'Starts the assigned song without stopping or fading other songs'
            : `Hotkey mode: ${hotkeyMode}`;
    }
}

if (hotkeyModeBtn) {
    hotkeyModeBtn.addEventListener('click', () => {
        const currentModeIndex = HOTKEY_MODES.indexOf(hotkeyMode);
        hotkeyMode = HOTKEY_MODES[(currentModeIndex + 1) % HOTKEY_MODES.length];
        updateHotkeyModeLabel();
    });
    updateHotkeyModeLabel();
}

function renderHotkeyPanel() {
    if (!hotkeyPanelList) return;

    hotkeyPanelList.innerHTML = '';

    const sortedKeys = [...songHotkeys.keys()].sort();

    if (sortedKeys.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'hotkey-panel-empty';
        empty.textContent = 'No hotkeys assigned yet. Right-click a song to set one.';
        hotkeyPanelList.appendChild(empty);
        return;
    }

    sortedKeys.forEach(key => {
        const songId = songHotkeys.get(key);
        const songItem = document.querySelector(`.song-item[data-song-id="${songId}"]`);
        if (!songItem) {
            songHotkeys.delete(key); // song no longer exists, drop the stale entry
            return;
        }

        const row = document.createElement('div');
        row.className = 'hotkey-panel-row';

        const badge = document.createElement('span');
        badge.className = 'hotkey-panel-key';
        badge.textContent = key;

        const label = document.createElement('span');
        label.className = 'hotkey-panel-title';
        label.textContent = songItem.querySelector('.title-input')?.value || 'Unknown';

        const clearBtn = document.createElement('span');
        clearBtn.className = 'hotkey-panel-clear';
        clearBtn.textContent = '×';
        clearBtn.title = 'Clear hotkey';
        clearBtn.addEventListener('click', () => clearHotkey(songId));

        row.appendChild(badge);
        row.appendChild(label);
        row.appendChild(clearBtn);
        hotkeyPanelList.appendChild(row);
    });
}

function toggleHotkeyPanel() {
    if (!hotkeyPanel) return;
    hotkeyPanel.classList.toggle('active');
    if (showHotkeysBtn) {
        showHotkeysBtn.textContent = showHotkeysBtn.textContent === 'Show Hotkeys' ? 'Hide Hotkeys' : 'Show Hotkeys';
    }
    renderHotkeyPanel();
}
window.toggleHotkeyPanel = toggleHotkeyPanel;

// keep the panel's titles fresh if it's open while someone renames a song
document.addEventListener('input', (event) => {
    if (hotkeyPanel?.classList.contains('active') && event.target.classList.contains('title-input')) {
        renderHotkeyPanel();
    }
});

function renderHotkeyBadge(songItem, key) {
    let badge = songItem.querySelector('.hotkey-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'hotkey-badge';
        songItem.appendChild(badge);
    }
    badge.textContent = key;
}

function removeHotkeyBadge(songItem) {
    const badge = songItem.querySelector('.hotkey-badge');
    if (badge) badge.remove();
}

function clearHotkey(songId) {
    for (const [key, id] of songHotkeys) {
        if (id === songId) {
            songHotkeys.delete(key);
            const item = document.querySelector(`.song-item[data-song-id="${songId}"]`);
            if (item) removeHotkeyBadge(item);
            break;
        }
    }
    renderHotkeyPanel();
}

// assigns a hotkey to a song, taking it away from whoever had it before —
// shared by manual assignment and preset loading
function assignHotkey(key, songItem) {
    const songId = songItem.dataset.songId;

    const previousSongId = songHotkeys.get(key);
    if (previousSongId && previousSongId !== songId) {
        const previousItem = document.querySelector(`.song-item[data-song-id="${previousSongId}"]`);
        if (previousItem) removeHotkeyBadge(previousItem);
    }
    clearHotkey(songId);

    songHotkeys.set(key, songId);
    renderHotkeyBadge(songItem, key);
    renderHotkeyPanel();
}

function startHotkeyAssignment(songItem) {
    const hint = document.createElement('div');
    hint.className = 'hotkey-assign-hint';
    hint.textContent = 'Press 1-9 to assign a hotkey (Esc to cancel)';
    document.body.appendChild(hint);

    const cleanup = () => {
        document.removeEventListener('keydown', onKeyDown);
        hint.remove();
    };

    const onKeyDown = (event) => {
        if (event.key === 'Escape') {
            cleanup();
            return;
        }
        if (/^[1-9]$/.test(event.key)) {
            event.preventDefault();
            assignHotkey(event.key, songItem);
            cleanup();
        }
    };

    document.addEventListener('keydown', onKeyDown);
}

// pressing 1-9 anywhere (outside of text inputs) triggers that song's hotkey.
// if the song is already playing, the same key stops it instead of
// restarting it — using fade, an instant cut, or inserting it alongside the
// currently playing songs, depending on hotkeyMode
document.addEventListener('keydown', (event) => {
    const activeTag = document.activeElement?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
    if (!/^[1-9]$/.test(event.key)) return;
    if (event.repeat) return;

    const songId = songHotkeys.get(event.key);
    if (!songId) return;
    event.preventDefault();

    const songItem = document.querySelector(`.song-item[data-song-id="${songId}"]`);
    const isPlaying = songItem?.classList.contains('playing');

    if (isPlaying) {
        if (hotkeyMode === 'fade') {
            fadeOut(songId);
        } else {
            stopSong(songId);
        }
    } else {
        if (hotkeyMode === 'fade') {
            fadeTo(songId);
        } else if (hotkeyMode === 'cut') {
            cutTo(songId);
        } else {
            playSong(songId);
        }
    }
});

function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function createRecordingIndicator() {
    const div = document.createElement('div');
    div.id = 'recording-indicator';
    div.style.cssText = `
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
    div.innerHTML = `
        <div>Recording your download...</div>
        <div style="margin-top: 10px; font-size: 14px;" id="recording-status">0:00 / 0:00</div>
        <div style="margin-top: 6px; font-size: 12px; color: rgba(255,255,255,0.6);">This plays in real time, so it takes as long as the song does.</div>
    `;
    document.body.appendChild(div);
    return div;
}

function updateRecordingStatus(current, duration, phase) {
    const statusEl = document.getElementById('recording-status');
    const titleEl = document.querySelector('#recording-indicator > div:first-child');
    if (phase === 'encoding') {
        if (titleEl) titleEl.textContent = 'Converting to mp3...';
        if (statusEl) statusEl.textContent = 'Almost done';
        return;
    }
    if (statusEl) {
        statusEl.textContent = `${formatDuration(current)} / ${formatDuration(duration)}`;
    }
}

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

async function writeAudioResponseToFile(audioResponse, audioFileHandle) {
    if (!audioResponse.ok) {
        throw new Error(`Could not read edited audio (${audioResponse.status})`);
    }

    const writable = await audioFileHandle.createWritable();
    if (audioResponse.body && typeof audioResponse.body.pipeTo === 'function') {
        // Streams server-backed multi-hour edits directly to disk instead of
        // creating another enormous Blob in browser memory.
        await audioResponse.body.pipeTo(writable);
        return;
    }

    await writable.write(await audioResponse.blob());
    await writable.close();
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
            const hotkeyEntry = [...songHotkeys].find(([key, id]) => id === songId);
            const hotkey = hotkeyEntry ? hotkeyEntry[0] : null;

            // check for title changes
            const existingIndex = presetData.findIndex(item => item.currentTitle === originalTitle);
            if (existingIndex !== -1) {
                console.log(`updating existing song: ${decodeURIComponent(originalTitle)} to ${decodeURIComponent(currentTitle)}`);
                const updatedSong = {
                    currentTitle,
                    genres,
                    tags,
                    markers,
                    hotkey
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
                const newSong = { currentTitle, genres, tags, markers, hotkey };
                presetData.push(newSong);
                updatedData.push(newSong);
            }

            const shouldOverwriteAudio = songItem.dataset.audioEdited === 'true';
            try {
                const audioFileHandle = await directoryHandle.getFileHandle(`${currentTitle}.mp3`);
                if (shouldOverwriteAudio) {
                    const audioResponse = await fetch(audioUrl);
                    await writeAudioResponseToFile(audioResponse, audioFileHandle);
                    delete songItem.dataset.audioEdited;
                }
            } catch (err) {
                const audioResponse = await fetch(audioUrl);
                const audioFileHandle = await directoryHandle.getFileHandle(`${currentTitle}.mp3`, { create: true });
                await writeAudioResponseToFile(audioResponse, audioFileHandle);
                delete songItem.dataset.audioEdited;
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

function createPresetLoadIndicator(totalSongs) {
    document.querySelector('.preset-load-indicator')?.remove();

    const indicator = document.createElement('div');
    indicator.className = 'preset-load-indicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');

    const label = document.createElement('div');
    label.className = 'preset-load-label';
    label.textContent = `Loading songs… 0 / ${totalSongs}`;

    const progress = document.createElement('div');
    progress.className = 'preset-load-progress';
    const progressFill = document.createElement('div');
    progressFill.className = 'preset-load-progress-fill';
    progress.appendChild(progressFill);

    indicator.append(label, progress);
    document.body.appendChild(indicator);
    return indicator;
}

function updatePresetLoadIndicator(indicator, loaded, total) {
    const label = indicator.querySelector('.preset-load-label');
    const progressFill = indicator.querySelector('.preset-load-progress-fill');
    if (label) label.textContent = `Loading songs… ${loaded} / ${total}`;
    if (progressFill) progressFill.style.width = `${total > 0 ? (loaded / total) * 100 : 100}%`;
}

async function indexPresetFiles(directoryHandle, indicator) {
    const fileHandles = new Map();
    const label = indicator.querySelector('.preset-load-label');
    if (label) label.textContent = 'Indexing playlist files…';

    for await (const [name, handle] of directoryHandle.entries()) {
        if (handle.kind === 'file') fileHandles.set(name, handle);
    }
    return fileHandles;
}

async function loadPresetSongFiles(fileHandles, songMetadata) {
    const currentTitle = songMetadata.currentTitle;
    const genres = (songMetadata.genres || [])
        .map(genre => genre === 'modern' ? 'mystery' : genre)
        .filter(Boolean);
    const tags = songMetadata.tags || [];

    const loadPair = async fileTitle => {
        const audioEntry = fileHandles.get(`${fileTitle}.mp3`);
        const thumbnailEntry = fileHandles.get(`${fileTitle}.jpg`);
        if (!audioEntry || !thumbnailEntry) throw new Error('Audio or thumbnail is missing');
        const [audioFile, thumbnailFile] = await Promise.all([
            audioEntry.getFile(),
            thumbnailEntry.getFile()
        ]);
        return { audioFile, thumbnailFile };
    };

    try {
        // Resolve the filename from the index instead of causing failed file
        // operations for every song while guessing Google Drive's encoding.
        const fileTitle = [
            currentTitle.replace(/%/g, '_'),
            revertUnderscoreEncoding(currentTitle),
            currentTitle
        ].find(candidate =>
            fileHandles.has(`${candidate}.mp3`) && fileHandles.has(`${candidate}.jpg`)
        );
        if (!fileTitle) throw new Error('Audio or thumbnail is missing');
        const files = await loadPair(fileTitle);

        return {
            ...songMetadata,
            ...files,
            genres,
            tags,
            decodedTitle: decodeURIComponent(currentTitle)
        };
    } catch (error) {
        let readableTitle = currentTitle;
        try {
            readableTitle = decodeURIComponent(currentTitle);
        } catch {}
        console.error(`could not load files for ${readableTitle}`, error);
        return null;
    }
}

function createPresetSongItem(song) {
    const songItem = document.createElement('div');
    songItem.className = 'song-item';
    songItem.draggable = true;
    songItem.dataset.genres = song.genres.join(',');
    songItem.dataset.tags = song.tags.join(',');

    const titleInput = document.createElement('input');
    titleInput.spellcheck = false;
    titleInput.className = 'title-input';
    titleInput.value = song.decodedTitle;
    titleInput.defaultValue = song.decodedTitle;
    titleInput.addEventListener('dragover', event => event.preventDefault());
    titleInput.addEventListener('drop', event => {
        event.preventDefault();
        event.stopPropagation();
    });

    const metadata = document.createElement('p');
    metadata.textContent =
        `${song.tags.join(' + ')}${song.genres.length > 0 ? ' | ' + song.genres.join(' + ') : ''}`;

    const thumbnail = document.createElement('img');
    thumbnail.src = URL.createObjectURL(song.thumbnailFile);
    thumbnail.alt = song.decodedTitle;
    thumbnail.loading = 'lazy';
    thumbnail.decoding = 'async';
    thumbnail.fetchPriority = 'low';

    songItem.append(titleInput, metadata, thumbnail);
    return songItem;
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

        const loadIndicator = createPresetLoadIndicator(presetMetadata.length);
        const FILE_BATCH_SIZE = 24;
        let loadedCount = 0;

        try {
            const fileHandles = await indexPresetFiles(directoryHandle, loadIndicator);
            updatePresetLoadIndicator(loadIndicator, 0, presetMetadata.length);

            for (let index = 0; index < presetMetadata.length; index += FILE_BATCH_SIZE) {
                const metadataBatch = presetMetadata.slice(index, index + FILE_BATCH_SIZE);

                // File System Access calls used to run four-at-a-time for one
                // song and then wait before starting the next song. A bounded
                // parallel batch keeps disk access busy without launching all
                // 1,200 files at once.
                const loadedBatch = await Promise.all(
                    metadataBatch.map(songMetadata => loadPresetSongFiles(fileHandles, songMetadata))
                );
                const fragment = document.createDocumentFragment();
                const pendingHotkeys = [];

                loadedBatch.forEach(song => {
                    if (!song) return;

                    const songItem = createPresetSongItem(song);
                    fragment.appendChild(songItem);
                    addSongToPlayer(songItem, song.audioFile);

                    if (song.markers?.length) {
                        setMarkers(songItem.dataset.songId, song.markers);
                    }
                    if (song.hotkey) pendingHotkeys.push([song.hotkey, songItem]);
                });

                // One DOM insertion per batch avoids hundreds of separate
                // style/layout passes while preserving metadata order.
                songGrid.appendChild(fragment);
                pendingHotkeys.forEach(([hotkey, songItem]) => assignHotkey(hotkey, songItem));

                loadedCount += metadataBatch.length;
                updatePresetLoadIndicator(loadIndicator, loadedCount, presetMetadata.length);
                await new Promise(resolve => requestAnimationFrame(resolve));
            }
        } finally {
            loadIndicator.remove();
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
        
        // Create requests only when their batch starts. Mapping every song to
        // an async promise up front still launches hundreds of simultaneous
        // fetches and can make large presets appear frozen.
        const loadSampleSong = async (songMetadata) => {
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
        };
        
        // processes batches of song to avoid overwhelming the browser (way faster this way)
        const BATCH_SIZE = 5;
        const totalSongs = presetMetadata.length;
        
        for (let i = 0; i < totalSongs; i += BATCH_SIZE) {
            const batch = presetMetadata.slice(i, i + BATCH_SIZE);
            const songBatch = await Promise.all(batch.map(loadSampleSong));

            songBatch.forEach(song => {
                const songItem = document.createElement('div');
                songItem.classList.add('song-item');
                songItem.setAttribute('draggable', 'true');
                songItem.setAttribute('data-genres', song.updatedGenres.join(','));
                songItem.setAttribute('data-tags', song.tags.join(','));
                songItem.innerHTML = `
                    <input spellcheck='false' class='title-input' value="${song.decodedTitle}"></input>
                    <p>${song.tags.join(' + ')}${song.updatedGenres.length > 0 ? ' | ' + song.updatedGenres.join(' + ') : ''}</p>
                    <img src="${URL.createObjectURL(song.thumbnailFile)}" alt="${song.decodedTitle}" loading="lazy" decoding="async" fetchpriority="low">
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
            <img src="${URL.createObjectURL(thumbnailFile)}" alt="${decodeURIComponent(currentTitle)}" loading="lazy" decoding="async" fetchpriority="low">
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
        <img src="${URL.createObjectURL(thumbnail)}" alt="${title}" loading="lazy" decoding="async" fetchpriority="low">
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
    contextMenu.style.position = 'fixed';
    contextMenu.style.display = 'none';
    contextMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.8)'; // darker as requested
    contextMenu.style.color = '#fff';
    contextMenu.style.padding = '10px';
    contextMenu.style.borderRadius = '5px';
    contextMenu.style.zIndex = '10000'; // high z-index to stay on top
    contextMenu.style.cursor = 'default';

    let menuAnchor = null;
    const positionSongContextMenu = (setViewportAdjustment = false) => {
        if (!menuAnchor?.songItem?.isConnected || contextMenu.style.display === 'none') return;

        const anchorRect = menuAnchor.songItem.getBoundingClientRect();
        const desiredLeft = anchorRect.left + menuAnchor.offsetX;
        const desiredTop = anchorRect.top + menuAnchor.offsetY;

        if (setViewportAdjustment) {
            const menuRect = contextMenu.getBoundingClientRect();
            const margin = 8;
            const clampedLeft = Math.max(margin, Math.min(desiredLeft, window.innerWidth - menuRect.width - margin));
            const clampedTop = Math.max(margin, Math.min(desiredTop, window.innerHeight - menuRect.height - margin));
            menuAnchor.adjustX = clampedLeft - desiredLeft;
            menuAnchor.adjustY = clampedTop - desiredTop;
        }

        contextMenu.style.left = `${desiredLeft + menuAnchor.adjustX}px`;
        contextMenu.style.top = `${desiredTop + menuAnchor.adjustY}px`;
    };

    // Capture scroll events from the grid's own scrolling container too,
    // not just document/window scrolling.
    window.addEventListener('scroll', () => positionSongContextMenu(), {
        capture: true,
        passive: true
    });
    window.addEventListener('resize', () => positionSongContextMenu(true));

    songGrid.addEventListener('contextmenu', (event) => {
        const songItem = event.target.closest('.song-item');
        if (!songItem) return;

        event.preventDefault();
        event.stopPropagation(); // prevent other context menus
        currentSongItem = songItem;
        const songRect = songItem.getBoundingClientRect();
        menuAnchor = {
            songItem,
            offsetX: event.clientX - songRect.left,
            offsetY: event.clientY - songRect.top,
            adjustX: 0,
            adjustY: 0
        };

        contextMenu.style.display = 'block';
        positionSongContextMenu(true);
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
    contextMenu.appendChild(createOption('Fade In', (item) => {
        fadeIn(item.dataset.songId);
    }));

    contextMenu.appendChild(createOption('Fade To', (item) => {
        fadeTo(item.dataset.songId);
    }));

    contextMenu.appendChild(createOption('Cut To', (item) => {
        cutTo(item.dataset.songId);
    }));

    contextMenu.appendChild(createOption('Fade Out', (item) => {
        fadeOut(item.dataset.songId);
    }));

    contextMenu.appendChild(createOption('Download', async (item) => {
        const songId = item.dataset.songId;
        const indicator = createRecordingIndicator();
        try {
            await downloadSong(songId, (current, duration, phase) => {
                updateRecordingStatus(current, duration, phase);
            });
        } catch (error) {
            console.error('Error downloading song:', error);
            alert(error.message || 'Something went wrong while recording the download.');
        } finally {
            indicator.remove();
        }
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

        clearHotkey(songId);
        removeSongAudio(songId); // Clean up audio references
        item.remove();
        document.dispatchEvent(new Event('songsUpdated'));
    }));

    contextMenu.appendChild(createOption('Set Hotkey (1-9)', (item) => {
        startHotkeyAssignment(item);
    }));

    contextMenu.appendChild(createOption('Clear Hotkey', (item) => {
        clearHotkey(item.dataset.songId);
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

        // Notify filtering/player code immediately. Filters keep a small
        // per-card index for large playlists, so changing data attributes
        // alone is not enough to refresh that cached metadata.
        document.dispatchEvent(new CustomEvent('genresUpdated', {
            detail: { songItem }
        }));

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
