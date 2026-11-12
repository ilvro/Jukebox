import { addSongToPlayer, clearAllSongs, getMarkers, setMarkers, fadeIn, fadeTo, cutTo, playSong, prepareHotkeyPlayback, fadeOut, stopSong, removeSongAudio, resetSong, downloadSong } from "./player.js";
import { mesclarMetadados } from "./preset-mescla.js";
import {
    assignSongHotkey,
    clearSongHotkey,
    getAllSongStates,
    getHotkeyEntries,
    getSongIdForHotkey,
    getOrderedSongStates,
    getSongState,
    setSongHotkeyEffects
} from './song-state.mjs';
import { getActiveFolder, resetFolders, showFolderPicker } from './filters.js';
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
const HOTKEY_EFFECT_CATEGORIES = [
    ['Playback', [['loop', 'Loop'], ['smoothLoop', 'Smooth Loop'], ['reverse', 'Reverse']]],
    ['Speed & Pitch', [['speed075', 'Speed 0.75x'], ['speed090', 'Speed 0.90x'], ['speed110', 'Speed 1.10x'], ['speed125', 'Speed 1.25x'], ['pitchShift', 'Pitch Shift']]],
    ['Effects', [['echo', 'Echo'], ['reverb', 'Reverb'], ['tremolo', 'Tremolo']]],
    ['Filters', [['highpass', 'Highpass'], ['lowpass', 'Lowpass']]],
    ['Presets', [['nightcore', 'Nightcore'], ['hell', 'Hell']]]
];
const VALID_HOTKEY_EFFECTS = new Set(
    HOTKEY_EFFECT_CATEGORIES.flatMap(([, effects]) => effects.map(([key]) => key))
);
let expandedHotkeyEffectsSongId = null;
const HOTKEY_MODES = ['fade', 'cut', 'insert'];
const HOTKEY_MODE_LABELS = {
    fade: 'Hotkeys: Fade',
    cut: 'Hotkeys: Cut',
    insert: 'Hotkeys: Insert'
};
let hotkeyMode = 'fade';

export function getHotkeyMode() {
    return hotkeyMode;
}

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

    const sortedKeys = getHotkeyEntries().map(([key]) => key).sort();

    if (sortedKeys.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'hotkey-panel-empty';
        empty.textContent = 'No hotkeys assigned yet. Right-click a song to set one.';
        hotkeyPanelList.appendChild(empty);
        return;
    }

    sortedKeys.forEach(key => {
        const songId = getSongIdForHotkey(key);
        const songItem = getSongState(songId)?.element;
        if (!songItem) {
            clearSongHotkey(songId); // song no longer exists, drop the stale entry
            return;
        }

        const entry = document.createElement('div');
        entry.className = 'hotkey-panel-entry';

        const row = document.createElement('div');
        row.className = 'hotkey-panel-row';

        const badge = document.createElement('span');
        badge.className = 'hotkey-panel-key';
        badge.textContent = key;

        const label = document.createElement('span');
        label.className = 'hotkey-panel-title';
        label.textContent = songItem.querySelector('.title-input')?.value || 'Unknown';

        const configuredEffects = getSongState(songId)?.hotkey.effects || [];
        const effectsButton = document.createElement('button');
        effectsButton.type = 'button';
        effectsButton.className = 'hotkey-panel-effects-button';
        effectsButton.textContent = configuredEffects.length > 0 ? `FX ${configuredEffects.length}` : 'FX';
        effectsButton.title = 'Choose effects applied when this hotkey starts the song';
        effectsButton.addEventListener('click', () => {
            expandedHotkeyEffectsSongId = expandedHotkeyEffectsSongId === songId ? null : songId;
            renderHotkeyPanel();
        });

        const clearBtn = document.createElement('span');
        clearBtn.className = 'hotkey-panel-clear';
        clearBtn.textContent = '×';
        clearBtn.title = 'Clear hotkey';
        clearBtn.addEventListener('click', () => clearHotkey(songId));

        row.appendChild(badge);
        row.appendChild(label);
        row.appendChild(effectsButton);
        row.appendChild(clearBtn);
        entry.appendChild(row);

        if (expandedHotkeyEffectsSongId === songId) {
            const effectsMenu = document.createElement('div');
            effectsMenu.className = 'hotkey-effects-menu';

            const help = document.createElement('div');
            help.className = 'hotkey-effects-help';
            help.textContent = 'Applied to almost the entire song before playback.';
            effectsMenu.appendChild(help);

            HOTKEY_EFFECT_CATEGORIES.forEach(([categoryName, effects]) => {
                const category = document.createElement('div');
                category.className = 'hotkey-effects-category';
                category.textContent = categoryName;
                effectsMenu.appendChild(category);

                effects.forEach(([effectKey, effectName]) => {
                    const option = document.createElement('label');
                    option.className = 'hotkey-effect-option';
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.checked = configuredEffects.includes(effectKey);
                    checkbox.addEventListener('change', () => {
                        const nextEffects = new Set(getSongState(songId)?.hotkey.effects || []);
                        if (checkbox.checked) {
                            if (effectKey === 'loop') nextEffects.delete('smoothLoop');
                            if (effectKey === 'smoothLoop') nextEffects.delete('loop');
                            nextEffects.add(effectKey);
                        } else {
                            nextEffects.delete(effectKey);
                        }
                        setSongHotkeyEffects(songId, [...nextEffects]);
                        renderHotkeyPanel();
                    });
                    const optionText = document.createElement('span');
                    optionText.textContent = effectName;
                    option.append(checkbox, optionText);
                    effectsMenu.appendChild(option);
                });
            });
            entry.appendChild(effectsMenu);
        }

        hotkeyPanelList.appendChild(entry);
    });
}

function toggleHotkeyPanel() {
    if (!hotkeyPanel) return;
    hotkeyPanel.classList.toggle('active');
    if (showHotkeysBtn) {
        showHotkeysBtn.textContent = showHotkeysBtn.textContent === 'Show Hotkeys' ? 'Hide Hotkeys' : 'Show Hotkeys';
    }
    renderHotkeyPanel();
    if (hotkeyPanel.classList.contains('active')) {
        document.dispatchEvent(new CustomEvent('jukeboxPanelOpened', { detail: 'hotkeys' }));
    }
}
window.toggleHotkeyPanel = toggleHotkeyPanel;

document.addEventListener('jukeboxPanelOpened', event => {
    if (event.detail === 'hotkeys' || !hotkeyPanel?.classList.contains('active')) return;
    hotkeyPanel.classList.remove('active');
    if (showHotkeysBtn) showHotkeysBtn.textContent = 'Show Hotkeys';
});

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
    const item = getSongState(songId)?.element;
    if (item) removeHotkeyBadge(item);
    clearSongHotkey(songId);
    if (expandedHotkeyEffectsSongId === songId) expandedHotkeyEffectsSongId = null;
    renderHotkeyPanel();
}

function normalizeHotkeyEffects(effectKeys) {
    if (!Array.isArray(effectKeys)) return [];
    const normalized = [...new Set(effectKeys.filter(key => VALID_HOTKEY_EFFECTS.has(key)))];
    if (normalized.includes('smoothLoop')) {
        return normalized.filter(key => key !== 'loop');
    }
    return normalized;
}

// assigns a hotkey to a song, taking it away from whoever had it before —
// shared by manual assignment and preset loading
function assignHotkey(key, songItem, effectKeys) {
    const songId = songItem.dataset.songId;
    const retainedEffects = effectKeys === undefined
        ? [...(getSongState(songId)?.hotkey.effects || [])]
        : normalizeHotkeyEffects(effectKeys);

    const previousSongId = getSongIdForHotkey(key);
    if (previousSongId && previousSongId !== songId) {
        const previousItem = getSongState(previousSongId)?.element;
        if (previousItem) removeHotkeyBadge(previousItem);
        clearSongHotkey(previousSongId);
    }
    clearHotkey(songId);

    assignSongHotkey(songId, key, retainedEffects);
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

    const songId = getSongIdForHotkey(event.key);
    if (!songId) return;
    event.preventDefault();

    const isPlaying = getSongState(songId)?.status === 'playing';

    if (isPlaying) {
        if (hotkeyMode === 'fade') {
            fadeOut(songId);
        } else {
            stopSong(songId);
        }
    } else {
        prepareHotkeyPlayback(songId, getSongState(songId)?.hotkey.effects || []);
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
    window.__isDownloading = true;
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
            window.__isDownloading = false;
        }, 1000);

        console.log('Download successful:', videoTitle);

    } catch (error) {
        console.error('download failed:', error);
        console.error('Error stack:', error.stack);
        updateLoadingStatus(`Error: ${error.message}`);
        setTimeout(() => {
            removeLoadingIndicator();
            isDownloading = false;
            window.__isDownloading = false;
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

async function writeBlobToFile(blob, fileHandle) {
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
}

async function getSongAudioBlob(songItem) {
    const source = getSongState(songItem.dataset.songId)?.audioSource;
    if (source instanceof Blob) {
        return source;
    }
    const response = await fetch(songItem.dataset.audioUrl);
    if (!response.ok) {
        throw new Error(`Could not read edited audio (${response.status})`);
    }
    return await response.blob();
}

async function getSongImageBlob(songItem) {
    const source = getSongState(songItem.dataset.songId)?.imageSource;
    if (source instanceof Blob) {
        return source;
    }
    const response = await fetch(songItem.querySelector('img').src);
    if (!response.ok) throw new Error(`Could not read song image (${response.status})`);
    return await response.blob();
}

async function writeSongAudioToFile(songItem, fileHandle) {
    const source = getSongState(songItem.dataset.songId)?.audioSource;
    if (source instanceof Blob) {
        await writeBlobToFile(source, fileHandle);
        return;
    }
    const response = await fetch(songItem.dataset.audioUrl);
    await writeAudioResponseToFile(response, fileHandle);
}

async function writeSongImageToFile(songItem, fileHandle) {
    const source = getSongState(songItem.dataset.songId)?.imageSource;
    if (source instanceof Blob) {
        await writeBlobToFile(source, fileHandle);
        return;
    }
    const response = await fetch(songItem.querySelector('img').src);
    if (!response.ok) throw new Error(`Could not read song image (${response.status})`);
    await writeBlobToFile(await response.blob(), fileHandle);
}

async function presetFileExists(directoryHandle, filename) {
    try {
        await directoryHandle.getFileHandle(filename);
        return true;
    } catch (error) {
        if (error.name === 'NotFoundError') return false;
        throw error;
    }
}

async function copyPresetFile(directoryHandle, sourceName, targetName) {
    if (typeof directoryHandle.copyEntry === 'function') {
        await directoryHandle.copyEntry(sourceName, targetName);
        return;
    }
    const sourceHandle = await directoryHandle.getFileHandle(sourceName);
    const sourceFile = await sourceHandle.getFile();
    const targetHandle = await directoryHandle.getFileHandle(targetName, { create: true });
    await writeBlobToFile(sourceFile, targetHandle);
}

let loadedPresetFileNames = new Set();
let loadedPresetFolderName = 'preset';
let tituloNaAbertura = new Set();

function createNotFoundError(message = 'File not found') {
    const err = new Error(message);
    err.name = 'NotFoundError';
    return err;
}

function createServerDirectoryHandle({ token, directoryName, files }) {
    const knownFiles = new Set(Array.isArray(files) ? files : []);

    function createServerFileHandle(filename) {
        return {
            kind: 'file',
            name: filename,
            async getFile() {
                const response = await fetch(`${API_URL}/preset/file`, {
                    method: 'GET',
                    headers: {
                        'X-Preset-Token': token,
                        'X-Preset-Filename': filename
                    }
                });
                if (response.status === 404) throw createNotFoundError(`File not found: ${filename}`);
                if (!response.ok) throw new Error(`Could not read "${filename}" (${response.status})`);
                const blob = await response.blob();
                return new File([blob], filename, { type: blob.type });
            },
            async createWritable() {
                const chunks = [];
                return {
                    async write(data) {
                        chunks.push(data instanceof Blob ? data : new Blob([data]));
                    },
                    async close() {
                        const body = chunks.length === 1 ? chunks[0] : new Blob(chunks);
                        const response = await fetch(`${API_URL}/preset/file`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/octet-stream',
                                'X-Preset-Token': token,
                                'X-Preset-Filename': filename
                            },
                            body
                        });
                        if (!response.ok) {
                            throw new Error(`Could not write "${filename}" (${response.status})`);
                        }
                        knownFiles.add(filename);
                    }
                };
            }
        };
    }

    return {
        kind: 'directory',
        name: directoryName || 'preset',
        async getFileHandle(filename, options = {}) {
            if (!options.create && !knownFiles.has(filename)) {
                throw createNotFoundError(`File not found: ${filename}`);
            }
            return createServerFileHandle(filename);
        },
        async removeEntry(filename) {
            const response = await fetch(`${API_URL}/preset/file`, {
                method: 'DELETE',
                headers: {
                    'X-Preset-Token': token,
                    'X-Preset-Filename': filename
                }
            });
            knownFiles.delete(filename);
            if (response.status === 404) throw createNotFoundError(`File not found: ${filename}`);
            if (!response.ok) throw new Error(`Could not delete "${filename}" (${response.status})`);
        },
        async copyEntry(sourceName, targetName) {
            const response = await fetch(`${API_URL}/preset/copy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, sourceName, targetName })
            });
            if (response.status === 404) throw createNotFoundError(`File not found: ${sourceName}`);
            if (!response.ok) throw new Error(`Could not copy "${sourceName}" to "${targetName}" (${response.status})`);
            knownFiles.add(targetName);
        },
        async *entries() {
            for (const name of knownFiles) {
                yield [name, createServerFileHandle(name)];
            }
        }
    };
}

async function tryPickServerDirectoryHandle() {
    try {
        const response = await fetch(`${API_URL}/preset/pick-directory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) return null;
        const result = await response.json();
        if (!result || !result.available) return null;
        if (result.cancelled) {
            const abortError = new Error('The user aborted a request.');
            abortError.name = 'AbortError';
            throw abortError;
        }
        return createServerDirectoryHandle(result);
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        return null;
    }
}

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

async function computeBlobCrc32(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function createStoredZipBlob(entries) {
    const encoder = new TextEncoder();
    const parts = [];
    const centralRecords = [];
    let offset = 0;

    for (const { name, blob } of entries) {
        const nameBytes = encoder.encode(name);
        const crc = await computeBlobCrc32(blob);
        const size = blob.size >>> 0;

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const localView = new DataView(localHeader.buffer);
        localView.setUint32(0, 0x04034b50, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(6, 0x0800, true); // UTF-8 filename flag
        localView.setUint16(8, 0, true); // STORE (no re-compression needed for mp3/jpg)
        localView.setUint16(10, 0, true);
        localView.setUint16(12, 0, true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, size, true);
        localView.setUint32(22, size, true);
        localView.setUint16(26, nameBytes.length, true);
        localView.setUint16(28, 0, true);
        localHeader.set(nameBytes, 30);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const centralView = new DataView(centralHeader.buffer);
        centralView.setUint32(0, 0x02014b50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(8, 0x0800, true);
        centralView.setUint16(10, 0, true);
        centralView.setUint16(12, 0, true);
        centralView.setUint16(14, 0, true);
        centralView.setUint32(16, crc, true);
        centralView.setUint32(20, size, true);
        centralView.setUint32(24, size, true);
        centralView.setUint16(28, nameBytes.length, true);
        centralView.setUint16(30, 0, true);
        centralView.setUint16(32, 0, true);
        centralView.setUint16(34, 0, true);
        centralView.setUint16(36, 0, true);
        centralView.setUint32(38, 0, true);
        centralView.setUint32(42, offset >>> 0, true);
        centralHeader.set(nameBytes, 46);

        parts.push(localHeader, blob);
        centralRecords.push(centralHeader);
        offset += localHeader.byteLength + size;
    }

    const centralDirOffset = offset >>> 0;
    let centralDirSize = 0;
    for (const record of centralRecords) {
        parts.push(record);
        centralDirSize += record.byteLength;
    }

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, entries.length, true);
    eocdView.setUint16(10, entries.length, true);
    eocdView.setUint32(12, centralDirSize >>> 0, true);
    eocdView.setUint32(16, centralDirOffset, true);
    eocdView.setUint16(20, 0, true);
    parts.push(eocd);

    return new Blob(parts, { type: 'application/zip' });
}

function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function savePresetBrowserFallback(songItems) {
    // Limitação do fallback no navegador: o download em .zip não tem acesso ao sistema de arquivos
    // nem à pasta de origem, empacotando apenas as músicas atualmente carregadas na interface.
    const desiredTitles = new Set();
    for (const songItem of songItems) {
        const readableTitle = songItem.querySelector('.title-input')?.value.trim();
        if (!readableTitle) throw new Error('Every song needs a title before saving.');
        const encodedTitle = encodeURIComponent(readableTitle);
        if (desiredTitles.has(encodedTitle)) {
            throw new Error(`Two songs have the same title: ${readableTitle}`);
        }
        desiredTitles.add(encodedTitle);
    }

    const indicator = createPresetLoadIndicator(songItems.length, 'Saving preset…');
    try {
        const updatedData = [];
        const filesToExport = [];
        const savedIdentities = [];
        let processed = 0;

        for (const songItem of songItems) {
            const titleInput = songItem.querySelector('.title-input');
            const currentTitle = encodeURIComponent(titleInput.value.trim());
            const persistedPresetTitle = songItem.dataset.presetTitle || null;
            const persistedFileTitle = songItem.dataset.fileTitle || persistedPresetTitle;
            const genres = songItem.getAttribute('data-genres').split(',').filter(g => g.trim());
            const tags = songItem.getAttribute('data-tags').split(',').filter(t => t.trim());
            const folder = songItem.dataset.folder || null;

            const songId = songItem.dataset.songId;
            const markers = getMarkers(songId);
            const hotkey = getSongState(songId)?.hotkey.key || null;
            const hotkeyEffects = hotkey ? [...(getSongState(songId)?.hotkey.effects || [])] : [];

            updatedData.push({
                currentTitle,
                genres,
                tags,
                folder,
                markers,
                hotkey,
                hotkeyEffects
            });

            const shouldOverwriteAudio = songItem.dataset.audioEdited === 'true';
            const isNewSong = !persistedPresetTitle;
            const userChangedTitle = Boolean(persistedPresetTitle && persistedPresetTitle !== currentTitle);

            const hasAudioInFolder = !isNewSong && !userChangedTitle && (
                loadedPresetFileNames.has(`${currentTitle}.mp3`) ||
                (persistedFileTitle && loadedPresetFileNames.has(`${persistedFileTitle}.mp3`))
            );
            const hasImageInFolder = !isNewSong && !userChangedTitle && (
                loadedPresetFileNames.has(`${currentTitle}.jpg`) ||
                (persistedFileTitle && loadedPresetFileNames.has(`${persistedFileTitle}.jpg`))
            );

            let resultingFileTitle = (!userChangedTitle && persistedFileTitle) ? persistedFileTitle : currentTitle;

            if (isNewSong || shouldOverwriteAudio || userChangedTitle || !hasAudioInFolder) {
                const audioBlob = await runPresetSaveStep(currentTitle, 'prepare the audio file', () =>
                    getSongAudioBlob(songItem)
                );
                filesToExport.push({ name: `${currentTitle}.mp3`, blob: audioBlob });
                resultingFileTitle = currentTitle;
            }

            if (isNewSong || userChangedTitle || !hasImageInFolder) {
                const imageBlob = await runPresetSaveStep(currentTitle, 'prepare the image file', () =>
                    getSongImageBlob(songItem)
                );
                filesToExport.push({ name: `${currentTitle}.jpg`, blob: imageBlob });
                resultingFileTitle = currentTitle;
            }

            savedIdentities.push({ songItem, titleInput, currentTitle, resultingFileTitle });
            processed++;
            const label = indicator.querySelector('.preset-load-label');
            const progressFill = indicator.querySelector('.preset-load-progress-fill');
            if (label) label.textContent = `Saving preset… ${processed} / ${songItems.length}`;
            if (progressFill) progressFill.style.width = `${songItems.length > 0 ? (processed / songItems.length) * 100 : 100}%`;
        }

        const metadataBlob = new Blob([JSON.stringify(updatedData, null, 2)], { type: 'application/json' });

        if (filesToExport.length === 0) {
            triggerBlobDownload(metadataBlob, 'preset_metadata.json');
        } else {
            const label = indicator.querySelector('.preset-load-label');
            if (label) label.textContent = 'Packaging preset files (.zip)…';
            const zipBlob = await createStoredZipBlob([
                { name: 'preset_metadata.json', blob: metadataBlob },
                ...filesToExport
            ]);
            const zipName = `${loadedPresetFolderName || 'preset'}.zip`;
            triggerBlobDownload(zipBlob, zipName);
        }

        deletedSongs.length = 0;
        savedIdentities.forEach(({ songItem, titleInput, currentTitle, resultingFileTitle }) => {
            songItem.dataset.presetTitle = currentTitle;
            songItem.dataset.fileTitle = resultingFileTitle;
            titleInput.defaultValue = titleInput.value.trim();
            delete songItem.dataset.audioEdited;
            loadedPresetFileNames.add(`${resultingFileTitle}.mp3`);
            loadedPresetFileNames.add(`${resultingFileTitle}.jpg`);
        });
        loadedPresetFileNames.add('preset_metadata.json');
        console.log('saved preset via browser fallback');
    } finally {
        indicator.remove();
    }
}

async function runPresetSaveStep(title, step, callback) {
    try {
        return await callback();
    } catch (error) {
        const readableTitle = (() => {
            try { return decodeURIComponent(title); } catch { return title; }
        })();
        const wrappedError = new Error(`Could not ${step} for "${readableTitle}": ${error.message}`);
        wrappedError.cause = error;
        throw wrappedError;
    }
}

async function savePreset() {
    window.__isSavingPreset = true;
    try {
        const songItems = getOrderedSongStates().map(state => state.element).filter(Boolean);
        let directoryHandle = null;

        if (supportsFileSystemAccess) {
            directoryHandle = await window.showDirectoryPicker();
        } else {
            directoryHandle = await tryPickServerDirectoryHandle();
            if (!directoryHandle) {
                await savePresetBrowserFallback(songItems);
                return;
            }
        }

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

        const desiredTitles = new Set();
        for (const songItem of songItems) {
            const readableTitle = songItem.querySelector('.title-input')?.value.trim();
            if (!readableTitle) throw new Error('Every song needs a title before saving.');
            const encodedTitle = encodeURIComponent(readableTitle);
            if (desiredTitles.has(encodedTitle)) {
                throw new Error(`Two songs have the same title: ${readableTitle}`);
            }
            desiredTitles.add(encodedTitle);
        }

        let updatedData = [];
        const obsoleteFileTitles = new Set();
        const savedIdentities = [];
        for (const songItem of songItems) {
            const titleInput = songItem.querySelector('.title-input');
            const currentTitle = encodeURIComponent(titleInput.value.trim());
            const persistedPresetTitle = songItem.dataset.presetTitle || null;
            const persistedFileTitle = songItem.dataset.fileTitle || persistedPresetTitle;
            const genres = songItem.getAttribute('data-genres').split(',').filter(g => g.trim());
            const tags = songItem.getAttribute('data-tags').split(',').filter(t => t.trim());
            const folder = songItem.dataset.folder || null;
            
            const songId = songItem.dataset.songId;
            const markers = getMarkers(songId);
            const hotkey = getSongState(songId)?.hotkey.key || null;
            const hotkeyEffects = hotkey ? [...(getSongState(songId)?.hotkey.effects || [])] : [];

            // Metadata identity is kept separately from the editable input.
            // defaultValue is not a safe file identity: several new songs can
            // legitimately start with the same suggested title.
            const existingIndex = persistedPresetTitle
                ? presetData.findIndex(item => item.currentTitle === persistedPresetTitle)
                : -1;
            if (existingIndex !== -1) {
                console.log(`updating existing song: ${decodeURIComponent(persistedPresetTitle)} to ${decodeURIComponent(currentTitle)}`);
                const updatedSong = {
                    currentTitle,
                    genres,
                    tags,
                    folder,
                    markers,
                    hotkey,
                    hotkeyEffects
                };

                presetData[existingIndex] = updatedSong;
                updatedData.push(updatedSong);
            } else {
                console.log(`adding new song: ${decodeURIComponent(currentTitle)}`);
                const newSong = { currentTitle, genres, tags, folder, markers, hotkey, hotkeyEffects };
                presetData.push(newSong);
                updatedData.push(newSong);
            }

            const shouldOverwriteAudio = songItem.dataset.audioEdited === 'true';
            const isNewSong = !persistedPresetTitle;
            const titleChanged = Boolean(persistedFileTitle && persistedFileTitle !== currentTitle);
            const audioExists = await runPresetSaveStep(currentTitle, 'check the audio file', () =>
                presetFileExists(directoryHandle, `${currentTitle}.mp3`)
            );
            if (isNewSong || shouldOverwriteAudio || titleChanged || !audioExists) {
                await runPresetSaveStep(currentTitle, 'save the audio file', async () => {
                    const audioFileHandle = await directoryHandle.getFileHandle(`${currentTitle}.mp3`, { create: true });
                    try {
                        await writeSongAudioToFile(songItem, audioFileHandle);
                    } catch (sourceError) {
                        if (!persistedFileTitle) throw sourceError;
                        await copyPresetFile(
                            directoryHandle,
                            `${persistedFileTitle}.mp3`,
                            `${currentTitle}.mp3`
                        );
                    }
                });
            }

            const imageExists = await runPresetSaveStep(currentTitle, 'check the image file', () =>
                presetFileExists(directoryHandle, `${currentTitle}.jpg`)
            );
            if (isNewSong || titleChanged || !imageExists) {
                await runPresetSaveStep(currentTitle, 'save the image file', async () => {
                    const imageFileHandle = await directoryHandle.getFileHandle(`${currentTitle}.jpg`, { create: true });
                    try {
                        await writeSongImageToFile(songItem, imageFileHandle);
                    } catch (sourceError) {
                        if (!persistedFileTitle) throw sourceError;
                        await copyPresetFile(
                            directoryHandle,
                            `${persistedFileTitle}.jpg`,
                            `${currentTitle}.jpg`
                        );
                    }
                });
            }

            if (titleChanged) obsoleteFileTitles.add(persistedFileTitle);
            savedIdentities.push({ songItem, titleInput, currentTitle });

            console.log(`saved ${currentTitle}`);
        }

        const dadosMesclados = mesclarMetadados({
            noDisco: presetData,
            daTela: updatedData,
            apagadas: deletedSongs,
            tituloNaAbertura,
        });

        const dadosFinais = [];
        for (const item of dadosMesclados) {
            const isDaTela = updatedData.some(d => d.currentTitle === item.currentTitle);
            if (isDaTela) {
                dadosFinais.push(item);
                continue;
            }
            // Item que entrou por fora (ex.: conector MCP): confere se os arquivos existem na pasta
            const audioExiste = await presetFileExists(directoryHandle, `${item.currentTitle}.mp3`);
            const imagemExiste = await presetFileExists(directoryHandle, `${item.currentTitle}.jpg`);
            if (audioExiste && imagemExiste) {
                dadosFinais.push(item);
            } else {
                console.warn(`Jukebox: descartando item externo incompleto "${item.currentTitle}" (áudio: ${audioExiste}, imagem: ${imagemExiste})`);
            }
        }

        await runPresetSaveStep('preset_metadata.json', 'save the preset metadata', async () => {
            const presetMetadataHandle = await directoryHandle.getFileHandle('preset_metadata.json', { create: true });
            const presetMetadataWritable = await presetMetadataHandle.createWritable();
            await presetMetadataWritable.write(JSON.stringify(dadosFinais, null, 2));
            await presetMetadataWritable.close();
        });

        tituloNaAbertura = new Set(dadosFinais.map(m => m.currentTitle).filter(Boolean));

        // Only advance the in-memory persisted identity after both media and
        // metadata have been committed successfully.
        savedIdentities.forEach(({ songItem, titleInput, currentTitle }) => {
            songItem.dataset.presetTitle = currentTitle;
            songItem.dataset.fileTitle = currentTitle;
            titleInput.defaultValue = titleInput.value.trim();
            delete songItem.dataset.audioEdited;
        });

        // Delete superseded filenames only after every replacement is safely
        // written and metadata is committed. This also makes title swaps safe
        // (A→B and B→A).
        for (const obsoleteTitle of obsoleteFileTitles) {
            if (desiredTitles.has(obsoleteTitle)) continue;
            for (const extension of ['mp3', 'jpg']) {
                try {
                    await directoryHandle.removeEntry(`${obsoleteTitle}.${extension}`);
                } catch (error) {
                    if (error.name !== 'NotFoundError') {
                        console.warn(`could not remove old ${extension} file for ${decodeURIComponent(obsoleteTitle)}:`, error);
                    }
                }
            }
        }

        console.log('saved preset');
    } catch (error) {
        if (error?.name !== 'AbortError') {
            console.error('error saving preset:', error);
            alert(error.message || 'Could not save preset.');
        }
    } finally {
        window.__isSavingPreset = false;
    }
}

function createPresetLoadIndicator(totalSongs = null, initialLabel = 'Loading preset…') {
    document.querySelector('.preset-load-indicator')?.remove();
    const hasKnownTotal = Number.isFinite(totalSongs);

    const indicator = document.createElement('div');
    indicator.className = 'preset-load-indicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.setAttribute('aria-busy', 'true');

    const label = document.createElement('div');
    label.className = 'preset-load-label';
    label.textContent = hasKnownTotal
        ? `Loading songs… 0 / ${totalSongs}`
        : initialLabel;

    const progress = document.createElement('div');
    progress.className = 'preset-load-progress';
    progress.classList.toggle('indeterminate', !hasKnownTotal);
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
    progressFill?.parentElement?.classList.remove('indeterminate');
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
        let decodedTitle = currentTitle;
        try {
            decodedTitle = decodeURIComponent(currentTitle);
        } catch {}

        // Resolve the filename from the index instead of causing failed file
        // operations for every song while guessing Google Drive's encoding.
        const fileTitle = [
            currentTitle.replace(/%/g, '_'),
            revertUnderscoreEncoding(currentTitle),
            currentTitle,
            decodedTitle
        ].find(candidate =>
            fileHandles.has(`${candidate}.mp3`) && fileHandles.has(`${candidate}.jpg`)
        );
        if (!fileTitle) throw new Error('Audio or thumbnail is missing');
        const files = await loadPair(fileTitle);

        return {
            ...songMetadata,
            ...files,
            fileTitle,
            genres,
            tags,
            decodedTitle
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
    songItem.dataset.presetTitle = song.currentTitle;
    songItem.dataset.fileTitle = song.fileTitle;
    if (song.folder) songItem.dataset.folder = song.folder;

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
    thumbnail.loading = 'lazy';
    thumbnail.decoding = 'async';
    thumbnail.fetchPriority = 'low';
    thumbnail.alt = song.decodedTitle;
    thumbnail.src = URL.createObjectURL(song.thumbnailFile);

    songItem.append(titleInput, metadata, thumbnail);
    return songItem;
}

export function receberMusicaNoPlayer(dados) {
    const { pasta, item, audio, capa } = dados || {};
    if (!pasta || !item || !item.currentTitle || !audio || !capa) {
        return { recebido: false, motivo: 'Parâmetros inválidos para receber música.' };
    }

    const pastaAlvo = String(pasta).trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    const pastaAberta = (loadedPresetFolderName || '').trim();

    if (!pastaAberta || (pasta !== pastaAberta && pastaAlvo !== pastaAberta)) {
        return {
            recebido: false,
            motivo: `Preset "${pastaAlvo}" não está aberto na Jukebox (aberto: "${pastaAberta || 'nenhum'}").`,
        };
    }

    let audioFile, thumbnailFile;
    try {
        const binAudio = atob(audio);
        const bytesAudio = new Uint8Array(binAudio.length);
        for (let i = 0; i < binAudio.length; i++) bytesAudio[i] = binAudio.charCodeAt(i);
        audioFile = new File([bytesAudio], `${item.currentTitle}.mp3`, { type: 'audio/mpeg' });

        const binCapa = atob(capa);
        const bytesCapa = new Uint8Array(binCapa.length);
        for (let i = 0; i < binCapa.length; i++) bytesCapa[i] = binCapa.charCodeAt(i);
        thumbnailFile = new File([bytesCapa], `${item.currentTitle}.jpg`, { type: 'image/jpeg' });
    } catch (err) {
        return { recebido: false, motivo: `Erro ao decodificar base64: ${err.message}` };
    }

    const estados = getAllSongStates();
    const existente = estados.find(s =>
        s.element?.dataset.presetTitle === item.currentTitle ||
        s.element?.dataset.fileTitle === item.currentTitle
    );
    if (existente) {
        clearHotkey(existente.id);
        removeSongAudio(existente.id);
        existente.element?.remove();
    }

    const song = {
        currentTitle: item.currentTitle,
        fileTitle: item.currentTitle,
        decodedTitle: decodeURIComponent(item.currentTitle),
        genres: Array.isArray(item.genres) ? item.genres : [],
        tags: Array.isArray(item.tags) ? item.tags : [],
        folder: item.folder || null,
        markers: Array.isArray(item.markers) ? item.markers : [],
        hotkey: item.hotkey || null,
        hotkeyEffects: Array.isArray(item.hotkeyEffects) ? item.hotkeyEffects : [],
        audioFile,
        thumbnailFile,
    };

    const songItem = createPresetSongItem(song);
    songItem.dataset.presetTitle = item.currentTitle;
    songItem.dataset.fileTitle = item.currentTitle;
    addSongToPlayer(songItem, audioFile, thumbnailFile);

    if (song.markers?.length) {
        setMarkers(songItem.dataset.songId, song.markers);
    }
    if (song.hotkey) {
        assignHotkey(song.hotkey, songItem, song.hotkeyEffects);
    }

    loadedPresetFileNames.add(`${item.currentTitle}.mp3`);
    loadedPresetFileNames.add(`${item.currentTitle}.jpg`);
    tituloNaAbertura.add(item.currentTitle);

    document.dispatchEvent(new Event('songsUpdated'));
    return { recebido: true, titulo: song.decodedTitle };
}

async function populatePresetFromFileHandles(fileHandles, presetMetadata, loadIndicator = null, folderName = 'preset') {
    clearAllSongs();
    resetFolders();
    expandedHotkeyEffectsSongId = null;
    renderHotkeyPanel();
    loadedPresetFileNames = new Set(fileHandles.keys());
    loadedPresetFolderName = folderName || 'preset';
    tituloNaAbertura = new Set(presetMetadata.map(m => m.currentTitle).filter(Boolean));
    document.dispatchEvent(new Event('songsUpdated'));

    const indicator = loadIndicator || createPresetLoadIndicator(presetMetadata.length);
    const FILE_BATCH_SIZE = 24;
    let loadedCount = 0;

    try {
        updatePresetLoadIndicator(indicator, 0, presetMetadata.length);

        for (let index = 0; index < presetMetadata.length; index += FILE_BATCH_SIZE) {
            const metadataBatch = presetMetadata.slice(index, index + FILE_BATCH_SIZE);

            // File System Access calls used to run four-at-a-time for one
            // song and then wait before starting the next song. A bounded
            // parallel batch keeps disk access busy without launching all
            // 1,200 files at once.
            const loadedBatch = await Promise.all(
                metadataBatch.map(songMetadata => loadPresetSongFiles(fileHandles, songMetadata))
            );
            const pendingHotkeys = [];

            loadedBatch.forEach(song => {
                if (!song) return;

                const songItem = createPresetSongItem(song);
                addSongToPlayer(songItem, song.audioFile, song.thumbnailFile);

                if (song.markers?.length) {
                    setMarkers(songItem.dataset.songId, song.markers);
                }
                if (song.hotkey) pendingHotkeys.push([song.hotkey, songItem, song.hotkeyEffects]);
            });

            // Cards stay detached until the virtual grid requests their
            // visible rows. This avoids laying out the whole preset here.
            pendingHotkeys.forEach(([hotkey, songItem, hotkeyEffects]) => assignHotkey(hotkey, songItem, hotkeyEffects));

            loadedCount += metadataBatch.length;
            updatePresetLoadIndicator(indicator, loadedCount, presetMetadata.length);
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    } finally {
        indicator.remove();
    }
}

async function loadPreset() {
    window.__isLoadingPreset = true;
    if (!window.showDirectoryPicker) {
        // Browsers without File System Access API (e.g. Firefox, Safari, mobile):
        // explicitly request a folder via webkitdirectory on desktop.
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
        if ('webkitdirectory' in fileInput && !isMobile) {
            fileInput.webkitdirectory = true;
            fileInput.setAttribute('webkitdirectory', '');
            fileInput.setAttribute('directory', '');
        } else {
            fileInput.accept = '.zip,application/json,audio/mpeg,image/jpeg';
        }
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        const cleanup = () => {
            fileInput.remove();
        };

        fileInput.addEventListener('change', async (event) => {
            try {
                const files = event.target.files;
                if (files && files.length > 0) {
                    await handleFilesFallback(files);
                }
            } catch (error) {
                console.error('error loading preset via directory input:', error);
            } finally {
                cleanup();
                window.__isLoadingPreset = false;
            }
        });
        fileInput.addEventListener('cancel', () => {
            cleanup();
            window.__isLoadingPreset = false;
        });
        fileInput.click();
        return;
    }

    try {
        const directoryHandle = await window.showDirectoryPicker();

        const presetMetadataHandle = await directoryHandle.getFileHandle('preset_metadata.json');
        const presetMetadataFile = await presetMetadataHandle.getFile();
        const presetMetadata = JSON.parse(await presetMetadataFile.text());

        const loadIndicator = createPresetLoadIndicator(presetMetadata.length);
        try {
            const fileHandles = await indexPresetFiles(directoryHandle, loadIndicator);
            await populatePresetFromFileHandles(fileHandles, presetMetadata, loadIndicator, directoryHandle.name || 'preset');
        } finally {
            loadIndicator.remove();
        }

        console.log('loaded preset');
        document.dispatchEvent(new Event('songsUpdated'));
    } catch (error) {
        console.error('error loading preset: ', error);
    } finally {
        window.__isLoadingPreset = false;
    }
}

async function loadSamplePreset() {
    if (loadSampleBtn.classList.contains('is-loading')) return;

    window.__isLoadingPreset = true;
    const buttonLabel = loadSampleBtn.querySelector('label');
    const originalButtonLabel = buttonLabel?.textContent || 'Load Sample Preset';
    const loadIndicator = createPresetLoadIndicator(null, 'Loading default preset…');
    let keepErrorVisible = false;

    loadSampleBtn.classList.add('is-loading');
    loadSampleBtn.setAttribute('aria-disabled', 'true');
    loadSampleBtn.setAttribute('aria-busy', 'true');
    if (buttonLabel) buttonLabel.textContent = 'Loading…';

    try {
        console.log('Loading sample preset...');

        const sampleFolderPath = './sample/';
        const metadataResponse = await fetch(`${sampleFolderPath}preset_metadata.json`);
        if (!metadataResponse.ok) {
            throw new Error(`Failed to fetch sample preset metadata: ${metadataResponse.status}`);
        }
        
        const presetMetadata = await metadataResponse.json();
        console.log('Loaded preset metadata:', presetMetadata);
        updatePresetLoadIndicator(loadIndicator, 0, presetMetadata.length);

        clearAllSongs();
        resetFolders();
        expandedHotkeyEffectsSongId = null;
        renderHotkeyPanel();
        loadedPresetFileNames = new Set(['preset_metadata.json']);
        loadedPresetFolderName = 'sample';
        tituloNaAbertura = new Set(presetMetadata.map(m => m.currentTitle).filter(Boolean));
        document.dispatchEvent(new Event('songsUpdated'));
        
        // Create requests only when their batch starts. Mapping every song to
        // an async promise up front still launches hundreds of simultaneous
        // fetches and can make large presets appear frozen.
        const loadSampleSong = async (songMetadata) => {
            const { currentTitle, genres, tags, folder, markers, hotkey, hotkeyEffects } = songMetadata;
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
                folder,
                markers,
                hotkey,
                hotkeyEffects,
                audioFile: new File([audioBlob], `${currentTitle}.mp3`, { type: 'audio/mpeg' }),
                thumbnailFile: new File([thumbnailBlob], `${currentTitle}.jpg`, { type: 'image/jpeg' })
            };
        };
        
        // processes batches of song to avoid overwhelming the browser (way faster this way)
        const BATCH_SIZE = 5;
        const totalSongs = presetMetadata.length;
        let loadedCount = 0;
        
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
                
                songItem.dataset.presetTitle = song.currentTitle;
                songItem.dataset.fileTitle = song.currentTitle;
                loadedPresetFileNames.add(`${song.currentTitle}.mp3`);
                loadedPresetFileNames.add(`${song.currentTitle}.jpg`);
                if (song.folder) songItem.dataset.folder = song.folder;
                addSongToPlayer(songItem, song.audioFile, song.thumbnailFile);
                
                if (song.markers && song.markers.length > 0) {
                    setMarkers(songItem.dataset.songId, song.markers);
                }
                if (song.hotkey) assignHotkey(song.hotkey, songItem, song.hotkeyEffects);
            });

            loadedCount += songBatch.length;
            updatePresetLoadIndicator(loadIndicator, loadedCount, totalSongs);
            
            // give the browser a break
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        console.log('Loaded sample preset');
        document.dispatchEvent(new Event('songsUpdated'));
    } catch (error) {
        keepErrorVisible = true;
        console.error('Error loading sample preset:', error);
        loadIndicator.classList.add('error');
        loadIndicator.setAttribute('aria-busy', 'false');
        const label = loadIndicator.querySelector('.preset-load-label');
        const progress = loadIndicator.querySelector('.preset-load-progress');
        const progressFill = loadIndicator.querySelector('.preset-load-progress-fill');
        if (label) label.textContent = 'Could not load the default preset.';
        progress?.classList.remove('indeterminate');
        if (progressFill) progressFill.style.width = '100%';
        setTimeout(() => loadIndicator.remove(), 4000);
    } finally {
        window.__isLoadingPreset = false;
        loadSampleBtn.classList.remove('is-loading');
        loadSampleBtn.removeAttribute('aria-disabled');
        loadSampleBtn.removeAttribute('aria-busy');
        if (buttonLabel) buttonLabel.textContent = originalButtonLabel;
        if (!keepErrorVisible) {
            loadIndicator.setAttribute('aria-busy', 'false');
            loadIndicator.remove();
        }
    }
}

async function handleFilesFallback(files) {
    const fileHandles = new Map();
    let detectedFolderName = 'preset';
    for (const file of files) {
        const relativePath = file.webkitRelativePath || file.name || '';
        if (relativePath.includes('__MACOSX/') || file.name.startsWith('._')) continue;
        if (detectedFolderName === 'preset' && file.webkitRelativePath && file.webkitRelativePath.includes('/')) {
            detectedFolderName = file.webkitRelativePath.split('/')[0] || 'preset';
        }
        fileHandles.set(file.name, {
            kind: 'file',
            getFile: async () => file
        });
    }

    const metadataHandle = fileHandles.get('preset_metadata.json');
    if (!metadataHandle) {
        alert('preset_metadata.json is missing');
        return;
    }

    const presetMetadataFile = await metadataHandle.getFile();
    const presetMetadata = JSON.parse(await presetMetadataFile.text());

    await populatePresetFromFileHandles(fileHandles, presetMetadata, null, detectedFolderName);
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
        title = decodeURIComponent(audio.name.replace(/\.[^.]+$/, ''));
    } catch {
        title = audio.name.replace(/\.[^.]+$/, '');
    }
    
    const genres = getSelectedGenres();
    const tags = getSelectedTags();

    const songItem = document.createElement('div');
    songItem.classList.add('song-item');
    songItem.setAttribute('draggable', 'true');
    songItem.setAttribute('data-genres', genres.join(','));
    songItem.setAttribute('data-tags', tags.join(','));
    const folder = getActiveFolder();
    if (folder) songItem.dataset.folder = folder;
    const titleInput = document.createElement('input');
    titleInput.className = 'title-input';
    titleInput.spellcheck = false;
    titleInput.value = title;
    titleInput.defaultValue = title;
    titleInput.addEventListener('dragover', event => event.preventDefault());
    titleInput.addEventListener('drop', event => {
        event.preventDefault();
        event.stopPropagation();
    });

    const metadata = document.createElement('p');
    metadata.textContent = `${tags.join(' + ')}${genres.length > 0 ? ' | ' + genres.join(' + ') : ''}`;

    const image = document.createElement('img');
    image.src = URL.createObjectURL(thumbnail);
    image.alt = title;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.fetchPriority = 'low';
    songItem.append(titleInput, metadata, image);
    addSongToPlayer(songItem, audio, thumbnail);
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
        if (contextMenu.style.display === 'none') return;
        if (!menuAnchor?.songItem?.isConnected) {
            contextMenu.style.display = 'none';
            menuAnchor = null;
            return;
        }

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

    contextMenu.appendChild(createOption('Move to Folder', (item) => {
        showFolderPicker(item);
    }));

    contextMenu.appendChild(createOption('Delete', (item) => {
        const songId = item.dataset.songId;
        // A song that has never been saved has no files to delete. Using its
        // suggested/default title here could remove another song that merely
        // started with the same title.
        if (item.dataset.fileTitle) {
            try {
                deletedSongs.push(decodeURIComponent(item.dataset.fileTitle));
            } catch {
                deletedSongs.push(item.dataset.fileTitle);
            }
        }

        clearHotkey(songId);
        removeSongAudio(songId); // Releases all state, audio nodes and blob URLs.
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
