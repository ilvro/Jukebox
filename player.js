import { setupAudioEffects } from './mixing/index.js';
import { setMasterVolume, createRecordingTap, releaseAudioContext } from './mixing/audio-context.js';
import { getFadeDuration } from './settings.js';
import {
    pendingHotkeyEffectsView as pendingHotkeyEffects,
    getAllSongStates,
    getPlayingSongStates,
    getSongState,
    getVisiblePlayerSongStates,
    registerSongState,
    removeSongState,
    songActiveEffectsView as songActiveEffects,
    songMarkerColorsView as songMarkerColors,
    songMarkerLabelsView as songMarkerLabels,
    songMarkersView as songMarkers,
    songRegionsView as songRegions,
    songSelectionFadeEffectsView as songSelectionFadeEffects,
    songSelectionStopEffectsView as songSelectionStopEffects
} from './song-state.mjs';
let sharedAudioContext;
const playerContainer = document.getElementById('player-container');
const playerHoverZone = document.getElementById('player-hover-zone');
const showPlayerBtn = document.getElementById('show-player-button');
const masterVolumeSlider = document.getElementById('master-volume-slider');
const stopAllBtn = document.getElementById('stop-all-button');
const doubleClickDelay = 300;
let lastRightClickTime = 0;
let isDragging = false;

function getSongElement(songId) {
    return getSongState(songId)?.element || null;
}

const waveformCache = new Map();
const waveformGenerationQueue = new Map();
const waveformGenerationControllers = new Map();
const MAX_WAVEFORM_WIDTH = 500;
const MAX_WAVEFORM_WIDTH_LONG = 150;
const MAX_CONCURRENT_GENERATIONS = 1;
const MAX_SAFE_WAVEFORM_DURATION = 20 * 60;
const LONG_AUDIO_SERVER_EDIT_DURATION = 10 * 60;
const AUDIO_EDIT_API_URL = 'http://localhost:3000';
let currentGenerations = 0;

const MAX_MARKER_SNAP_TOLERANCE = 2.5;
const MARKER_HIT_RADIUS_PX = 7;
const MARKER_TIME_EPSILON = 0.001;
const DEFAULT_MARKER_COLOR = '#ffaa00';
const SMOOTH_SKIP_DURATION = 2.5;

if (masterVolumeSlider) {
    masterVolumeSlider.addEventListener('input', () => {
        setMasterVolume(parseFloat(masterVolumeSlider.value));
    });
}

if (stopAllBtn) {
    // an instant, full stop for every playing song at once — separate from
    // the per-song "Fade Out", meant for when you need silence immediately
    stopAllBtn.addEventListener('click', () => {
        getPlayingSongStates().forEach(state => {
            const { id, audio } = state;
            audio.pause();
            audio.volume = state.volume ?? audio.volume;
            const item = getSongElement(id);
            item?.classList.remove('playing');
            state.status = 'stopped';
        });
        getVisiblePlayerSongStates().forEach(state => {
            if (state.status === 'player-paused') state.status = 'stopped';
        });
        updatePlayerUI();
    });
}

function createAudioElement(audioUrl, songId, songItem) {
    const audio = new Audio(audioUrl);
    // A large preset can contain hundreds of songs. Loading metadata for all
    // of them at once creates a large burst of I/O; playback loads on demand.
    audio.preload = 'none';
    audio.volume = 0;
    
    audio.addEventListener('pause', () => {
        const state = getSongState(songId);
        if (state?.status === 'playing') {
            state.status = 'stopped';
            state.currentTime = audio.currentTime;
        }
        updatePlayerUI();
    });
    
    audio.addEventListener('ended', () => {
        // A natural finish must behave like a real stop. Merely refreshing
        // the player left the grid item green because its state class and
        // active-audio entry were never cleared.
        const state = getSongState(songId);
        if (state) {
            state.status = 'stopped';
            state.currentTime = 0;
        }
        songItem?.classList.remove('playing');
        updatePlayerUI();
    });
    
    audio.addEventListener('play', () => {
        const state = getSongState(songId);
        if (state) state.status = 'playing';
        updatePlayerUI();
    });
    
    return audio;
}

function toggleAudio(audioElement, songItem) {
    const songId = songItem.dataset.songId;
    const state = getSongState(songId);
    if (!state) return;

    if (audioElement.paused) {
        // restore saved time when resuming
        audioElement.currentTime = state.currentTime;
        // restore saved volume
        audioElement.volume = state.volume;
        songItem.classList.add('playing');
        state.status = 'playing';
        audioElement.play().catch(error => {
            state.status = 'stopped';
            songItem.classList.remove('playing');
            console.error('Error playing audio:', error);
            updatePlayerUI();
        });
    } else {
        // save time and volume when pausing
        state.currentTime = audioElement.currentTime;
        renderedTracks.get(songId)?.restoreTransientVolume();
        state.volume = audioElement.volume;
        state.status = 'stopped';
        audioElement.pause();
        songItem.classList.remove('playing');
    }
}

function addClickListenerToSongItem(songItem, audio) {
    songItem.addEventListener('click', (event) => {
        if (event.target.classList.contains('title-input')) {
            return;
        }
        const songId = songItem.dataset.songId;
        const state = getSongState(songId);
        if (state?.status === 'player-paused') {
            state.status = 'stopped';
            updatePlayerUI();
            return;
        }
        toggleAudio(audio, songItem);
        updatePlayerUI();
    });
}

function addSongToPlayer(songElement, audioFile) {
    const audioUrl = URL.createObjectURL(audioFile);
    songElement.dataset.audioUrl = audioUrl;
    
    const songId = `song-${Date.now()}-${Math.random()}`;
    songElement.dataset.songId = songId;
    
    const audio = createAudioElement(audioUrl, songId, songElement);
    registerSongState(songId, {
        audio,
        audioSource: audioFile,
        element: songElement,
        volume: 1,
        currentTime: 0
    });
    addClickListenerToSongItem(songElement, audio);
}

function getMarkerTolerance(duration, element) {
    const width = element?.getBoundingClientRect().width || element?.clientWidth || 0;
    if (!Number.isFinite(duration) || duration <= 0 || width <= 0) {
        return MAX_MARKER_SNAP_TOLERANCE;
    }
    return Math.min(MAX_MARKER_SNAP_TOLERANCE, (duration / width) * MARKER_HIT_RADIUS_PX);
}

function findClosestMarker(songId, time, tolerance) {
    const markers = songMarkers[songId] || [];
    let closestMarker = null;
    let closestDistance = tolerance;

    for (const marker of markers) {
        const distance = Math.abs(marker - time);
        if (distance <= closestDistance) {
            closestMarker = marker;
            closestDistance = distance;
        }
    }
    return closestMarker;
}

function snapToMarker(songId, time, tolerance) {
    return findClosestMarker(songId, time, tolerance) ?? time;
}

function addMarker(songId, time) {
    if (!songMarkers[songId]) {
        songMarkers[songId] = [];
    }
    
    const exists = songMarkers[songId].some(marker => Math.abs(marker - time) <= MARKER_TIME_EPSILON);
    if (!exists) {
        songMarkers[songId].push(time);
        songMarkers[songId].sort((a, b) => a - b);
        return true;
    }
    return false;
}

function removeMarker(songId, time) {
    if (!songMarkers[songId]) return false;
    
    const index = songMarkers[songId].findIndex(marker => Math.abs(marker - time) <= MARKER_TIME_EPSILON);
    if (index !== -1) {
        const key = markerLabelKey(songMarkers[songId][index]);
        delete songMarkerLabels[songId]?.[key];
        delete songMarkerColors[songId]?.[key];
        songMarkers[songId].splice(index, 1);
        return true;
    }
    return false;
}

function getMarkers(songId) {
    return (songMarkers[songId] || []).map(time => {
        const key = markerLabelKey(time);
        const text = songMarkerLabels[songId]?.[key] || '';
        const color = songMarkerColors[songId]?.[key] || '';
        if (!text && !color) return time;

        const marker = { time };
        if (text) marker.text = text;
        if (color) marker.color = color;
        return marker;
    });
}

function setMarkers(songId, markers) {
    songMarkerLabels[songId] = {};
    songMarkerColors[songId] = {};
    songMarkers[songId] = (markers || []).map(marker => {
        if (typeof marker === 'number') return marker;
        const time = Number(marker.time);
        if (marker.text) songMarkerLabels[songId][markerLabelKey(time)] = marker.text;
        if (isValidMarkerColor(marker.color)) {
            songMarkerColors[songId][markerLabelKey(time)] = marker.color.toLowerCase();
        }
        return time;
    }).filter(Number.isFinite).sort((a, b) => a - b);
}

function markerLabelKey(time) {
    return Number(time).toFixed(3);
}

function isValidMarkerColor(color) {
    return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
}

function lightenMarkerColor(color, amount = 0.35) {
    const normalized = isValidMarkerColor(color) ? color : DEFAULT_MARKER_COLOR;
    const value = Number.parseInt(normalized.slice(1), 16);
    const channels = [value >> 16, (value >> 8) & 255, value & 255]
        .map(channel => Math.round(channel + (255 - channel) * amount));
    return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

function hexToHsl(color) {
    const value = Number.parseInt(color.slice(1), 16);
    const r = (value >> 16) / 255;
    const g = ((value >> 8) & 255) / 255;
    const b = (value & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;
    let hue = 0;
    let saturation = 0;

    if (delta !== 0) {
        saturation = delta / (1 - Math.abs(2 * lightness - 1));
        if (max === r) hue = 60 * (((g - b) / delta) % 6);
        else if (max === g) hue = 60 * ((b - r) / delta + 2);
        else hue = 60 * ((r - g) / delta + 4);
    }

    return {
        h: Math.round((hue + 360) % 360),
        s: Math.round(saturation * 100),
        l: Math.round(lightness * 100)
    };
}

function hslToHex(hue, saturation, lightness) {
    const h = ((Number(hue) % 360) + 360) % 360;
    const s = Number(saturation) / 100;
    const l = Number(lightness) / 100;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const section = h / 60;
    const secondary = chroma * (1 - Math.abs((section % 2) - 1));
    let [r, g, b] = section < 1 ? [chroma, secondary, 0]
        : section < 2 ? [secondary, chroma, 0]
        : section < 3 ? [0, chroma, secondary]
        : section < 4 ? [0, secondary, chroma]
        : section < 5 ? [secondary, 0, chroma]
        : [chroma, 0, secondary];
    const offset = l - chroma / 2;
    return `#${[r, g, b]
        .map(channel => Math.round((channel + offset) * 255).toString(16).padStart(2, '0'))
        .join('')}`;
}

function createAudioEditIndicator(message) {
    const indicator = document.createElement('div');
    indicator.className = 'audio-edit-indicator';
    indicator.textContent = message;
    document.body.appendChild(indicator);
    return indicator;
}

function confirmRegionDeletion(selectedDuration, formatTime) {
    return new Promise(resolve => {
        const previousModal = document.querySelector('.jukebox-confirm-overlay');
        previousModal?.remove();

        const overlay = document.createElement('div');
        overlay.className = 'jukebox-confirm-overlay';
        overlay.setAttribute('role', 'presentation');

        const dialog = document.createElement('div');
        dialog.className = 'jukebox-confirm-dialog';
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'delete-region-title');
        dialog.setAttribute('aria-describedby', 'delete-region-description');

        const title = document.createElement('h2');
        title.id = 'delete-region-title';
        title.textContent = 'Delete selected region?';

        const description = document.createElement('p');
        description.id = 'delete-region-description';
        description.textContent =
            `This will remove ${formatTime(selectedDuration)} from the song and join the audio before and after it. ` +
            'This cannot be undone inside Jukebox, and long songs may take a while to process.';

        const actions = document.createElement('div');
        actions.className = 'jukebox-confirm-actions';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'jukebox-confirm-cancel';
        cancelButton.textContent = 'Cancel';

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'jukebox-confirm-delete';
        deleteButton.textContent = 'Delete region';

        let settled = false;
        const finish = confirmed => {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', handleKeydown);
            overlay.classList.remove('visible');
            overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
            setTimeout(() => overlay.remove(), 250);
            resolve(confirmed);
        };
        const handleKeydown = event => {
            if (event.key === 'Escape') finish(false);
        };

        cancelButton.addEventListener('click', () => finish(false));
        deleteButton.addEventListener('click', () => finish(true));
        overlay.addEventListener('mousedown', event => {
            if (event.target === overlay) finish(false);
        });
        dialog.addEventListener('mousedown', event => event.stopPropagation());
        document.addEventListener('keydown', handleKeydown);

        actions.append(cancelButton, deleteButton);
        dialog.append(title, description, actions);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
            cancelButton.focus();
        });
    });
}

async function encodeAudioWithoutRegionViaServer(audioUrl, startTime, endTime, duration, onStatus, sourceFile) {
    onStatus?.('Checking local FFmpeg server…');
    try {
        const statusResponse = await fetch(`${AUDIO_EDIT_API_URL}/edit/audio/status`);
        if (!statusResponse.ok) throw new Error('Audio edit endpoint is unavailable');
        const status = await statusResponse.json();
        if (status.editVersion !== 3) throw new Error('Audio edit server is outdated');
    } catch (error) {
        throw new Error(
            'Long audio editing needs the updated local Jukebox server. Restart it with "node server.js" and try again.'
        );
    }

    const serverResultPrefix = `${AUDIO_EDIT_API_URL}/edit/audio/result/`;
    const isExistingServerResult = audioUrl.startsWith(serverResultPrefix);
    let sourceBlob = null;
    let sourceResult = '';
    if (isExistingServerResult) {
        sourceResult = decodeURIComponent(new URL(audioUrl).pathname.split('/').pop());
    } else {
        onStatus?.('Preparing long audio for FFmpeg…');
        if (!(sourceFile instanceof Blob)) {
            throw new Error('The original audio file is unavailable. Reload the preset and try again.');
        }
        // A File/Blob request body is streamed from its backing storage. Do
        // not fetch(blobUrl).blob() here: that can duplicate a multi-hour
        // file inside the renderer before the upload even begins.
        sourceBlob = sourceFile;
    }

    onStatus?.('Copying and editing long audio on disk with FFmpeg…');
    let response;
    try {
        response = await fetch(`${AUDIO_EDIT_API_URL}/edit/audio/delete-region`, {
            method: 'POST',
            headers: {
                'Content-Type': sourceBlob?.type || 'application/octet-stream',
                'X-Edit-Start': String(startTime),
                'X-Edit-End': String(endTime),
                'X-Audio-Duration': String(duration),
                ...(sourceResult ? { 'X-Source-Result': sourceResult } : {})
            },
            body: sourceBlob || new Blob([])
        });
    } catch (error) {
        throw new Error(
            'The local FFmpeg edit was interrupted. Make sure the Jukebox server is still running and try again.'
        );
    }

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `FFmpeg edit failed (${response.status})`);
    }

    onStatus?.('Loading edited audio…');
    const result = await response.json();
    if (!result.url) throw new Error('FFmpeg did not return an edited audio URL.');

    const start = Math.max(0, Math.min(startTime, duration));
    const end = Math.max(start, Math.min(endTime, duration));
    return {
        audioUrl: result.url,
        duration: Number(result.duration) || Math.max(0, duration - (end - start)),
        removedDuration: end - start,
        start,
        end
    };
}

async function encodeAudioWithoutRegion(audioUrl, startTime, endTime, onStatus, sourceDuration, sourceFile) {
    if (Number.isFinite(sourceDuration) && sourceDuration > LONG_AUDIO_SERVER_EDIT_DURATION) {
        return encodeAudioWithoutRegionViaServer(
            audioUrl,
            startTime,
            endTime,
            sourceDuration,
            onStatus,
            sourceFile
        );
    }

    onStatus?.('Decoding audio…');
    if (!sharedAudioContext) {
        sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error(`Could not read audio (${response.status})`);
    const sourceBuffer = await sharedAudioContext.decodeAudioData(await response.arrayBuffer());

    const start = Math.max(0, Math.min(startTime, sourceBuffer.duration));
    const end = Math.max(start, Math.min(endTime, sourceBuffer.duration));
    const startFrame = Math.floor(start * sourceBuffer.sampleRate);
    const endFrame = Math.floor(end * sourceBuffer.sampleRate);
    const outputFrames = sourceBuffer.length - (endFrame - startFrame);
    if (outputFrames < sourceBuffer.sampleRate * 0.05) {
        throw new Error('The selection would delete the entire song. Leave at least a small part outside the selection.');
    }

    onStatus?.('Removing selected region…');
    const editedBuffer = sharedAudioContext.createBuffer(
        sourceBuffer.numberOfChannels,
        outputFrames,
        sourceBuffer.sampleRate
    );
    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
        const source = sourceBuffer.getChannelData(channel);
        const target = editedBuffer.getChannelData(channel);
        target.set(source.subarray(0, startFrame), 0);
        target.set(source.subarray(endFrame), startFrame);
    }

    if (!window.lamejs) {
        throw new Error('The MP3 encoder is unavailable. Reload the page while connected to the internet and try again.');
    }

    // Let the progress message paint before the synchronous MP3 encoder runs.
    onStatus?.('Encoding edited MP3…');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
        blob: encodeMp3(editedBuffer),
        duration: editedBuffer.duration,
        removedDuration: end - start,
        start,
        end
    };
}

function waitForAudioMetadata(audio) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            audio.removeEventListener('loadedmetadata', handleLoaded);
            audio.removeEventListener('error', handleError);
        };
        const handleLoaded = () => {
            cleanup();
            resolve();
        };
        const handleError = () => {
            cleanup();
            reject(new Error('The edited audio could not be loaded.'));
        };
        audio.addEventListener('loadedmetadata', handleLoaded);
        audio.addEventListener('error', handleError);
        audio.load();
    });
}

function smoothSkipToMarker(audio, targetTime, progressBar, audioEffects) {
    const originalVolume = audio.volume;

    const crossfadeAudio = new Audio(audio.src);
    crossfadeAudio.currentTime = targetTime;
    crossfadeAudio.volume = 0;
    crossfadeAudio.load();

    // mirror whichever effects are currently active onto the crossfade
    // audio too, tied to the same selected region — it's the one actually
    // audible during most of the transition, so it needs the same
    // speed/pitch/filters/etc. as the main audio, evaluated dynamically at
    // its own position rather than copied once as a static snapshot
    const activeKeys = audioEffects ? audioEffects.getActiveEffectKeys() : [];
    const tempEffects = setupAudioEffects(crossfadeAudio, progressBar);
    activeKeys.forEach(key => tempEffects.activateEffect(key));

    let animationFrameId;
    const startTime = performance.now();

    const animate = () => {
        const elapsed = (performance.now() - startTime) / 1000;
        const progress = Math.min(elapsed / SMOOTH_SKIP_DURATION, 1);

        const fadeOutCurve = Math.cos(progress * Math.PI * 0.5);
        const fadeInCurve = Math.sin(progress * Math.PI * 0.5);

        audio.volume = originalVolume * fadeOutCurve;
        crossfadeAudio.volume = originalVolume * fadeInCurve;

        if (progress < 1) {
            animationFrameId = requestAnimationFrame(animate);
        } else {
            audio.currentTime = targetTime + SMOOTH_SKIP_DURATION;
            audio.volume = originalVolume;
            crossfadeAudio.pause();
            tempEffects.cleanup();
        }
    };

    crossfadeAudio.play().then(() => {
        animationFrameId = requestAnimationFrame(animate);
    }).catch(error => {
        console.error("Error playing crossfade audio:", error);
        audio.volume = originalVolume;
        tempEffects.cleanup();
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
    });
}

function createMarkerContextMenu(x, y, songId, markerTime, audio, progressBar, audioEffects) {
    const existingMenu = document.querySelector('.marker-context-menu');
    if (existingMenu) {
        existingMenu._destroyMarkerMenu?.();
        existingMenu.remove();
    }
    
    const menu = document.createElement('div');
    menu.className = 'marker-context-menu';
    Object.assign(menu.style, {
        position: 'fixed',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        borderRadius: '5px',
        padding: '10px',
        zIndex: '1001',
        opacity: '0',
        visibility: 'hidden',
        transform: 'translateY(-10px)',
        transition: 'opacity 0.3s ease, transform 0.5s ease, visibility 0.3s',
        minWidth: '150px'
    });
    
    const formatTime = (timeInSeconds) => {
        const minutes = Math.floor(timeInSeconds / 60);
        const seconds = Math.floor(timeInSeconds % 60);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };
    
    const header = document.createElement('div');
    header.textContent = `Marker at ${formatTime(markerTime)}`;
    header.style.color = '#2bdba0';
    header.style.fontSize = '0.8em';
    header.style.textTransform = 'uppercase';
    header.style.padding = '5px';
    header.style.marginBottom = '5px';
    menu.appendChild(header);
    
    const smoothSkipItem = document.createElement('div');
    smoothSkipItem.className = 'context-menu-item';
    smoothSkipItem.textContent = 'Smooth Skip';
    Object.assign(smoothSkipItem.style, {
        cursor: 'default',
        padding: '5px 5px 5px 15px',
        transition: 'all 0.3s ease',
        borderLeft: '2px solid transparent',
        color: '#fff'
    });
    
    smoothSkipItem.addEventListener('mouseover', () => {
        smoothSkipItem.style.borderLeft = '2px solid #2bdba0';
        smoothSkipItem.style.backgroundColor = 'rgba(43, 219, 160, 0.1)';
    });
    
    smoothSkipItem.addEventListener('mouseout', () => {
        smoothSkipItem.style.borderLeft = '2px solid transparent';
        smoothSkipItem.style.backgroundColor = 'transparent';
    });
    
    smoothSkipItem.addEventListener('click', () => {
        smoothSkipToMarker(audio, markerTime, progressBar, audioEffects);
        menu.style.opacity = '0';
        menu.style.transform = 'translateY(-10px)';
        menu.style.visibility = 'hidden';
        setTimeout(() => destroyMenu(), 300);
    });
    
    menu.appendChild(smoothSkipItem);

    const cutToItem = document.createElement('div');
    cutToItem.className = 'context-menu-item';
    cutToItem.textContent = 'Cut To';
    Object.assign(cutToItem.style, {
        cursor: 'default',
        padding: '5px 5px 5px 15px',
        transition: 'all 0.3s ease',
        borderLeft: '2px solid transparent',
        color: '#fff'
    });
    
    cutToItem.addEventListener('mouseover', () => {
        cutToItem.style.borderLeft = '2px solid #2bdba0';
        cutToItem.style.backgroundColor = 'rgba(43, 219, 160, 0.1)';
    });
    
    cutToItem.addEventListener('mouseout', () => {
        cutToItem.style.borderLeft = '2px solid transparent';
        cutToItem.style.backgroundColor = 'transparent';
    });
    
    cutToItem.addEventListener('click', () => {
        audio.currentTime = markerTime;
        audio.volume = 1.0;
        menu.style.opacity = '0';
        menu.style.transform = 'translateY(-10px)';
        menu.style.visibility = 'hidden';
        setTimeout(() => destroyMenu(), 300);
    });
    
    menu.appendChild(cutToItem);

    const labelHeader = document.createElement('div');
    labelHeader.textContent = 'Marker text';
    labelHeader.style.color = '#2bdba0';
    labelHeader.style.fontSize = '0.8em';
    labelHeader.style.textTransform = 'uppercase';
    labelHeader.style.padding = '10px 5px 5px';
    menu.appendChild(labelHeader);

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'marker-label-input';
    labelInput.placeholder = 'Add a note...';
    labelInput.maxLength = 80;
    labelInput.value = songMarkerLabels[songId]?.[markerLabelKey(markerTime)] || '';
    labelInput.addEventListener('input', () => {
        songMarkerLabels[songId] ||= {};
        const value = labelInput.value.trim();
        if (value) {
            songMarkerLabels[songId][markerLabelKey(markerTime)] = value;
        } else {
            delete songMarkerLabels[songId][markerLabelKey(markerTime)];
        }
        updateWaveformProgress(audio, progressBar.previousElementSibling, progressBar);
    });
    labelInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') labelInput.blur();
        event.stopPropagation();
    });
    menu.appendChild(labelInput);

    const colorHeader = document.createElement('div');
    colorHeader.textContent = 'Marker color';
    colorHeader.className = 'marker-option-header';
    menu.appendChild(colorHeader);

    const colorControl = document.createElement('div');
    colorControl.className = 'marker-color-control';

    const initialColor = songMarkerColors[songId]?.[markerLabelKey(markerTime)] || DEFAULT_MARKER_COLOR;
    const colorButton = document.createElement('button');
    colorButton.type = 'button';
    colorButton.className = 'marker-color-swatch';
    colorButton.title = 'Choose marker color';
    colorButton.setAttribute('aria-label', 'Choose marker color');
    colorButton.setAttribute('aria-expanded', 'false');
    colorButton.style.backgroundColor = initialColor;

    const colorValue = document.createElement('span');
    colorValue.className = 'marker-color-value';
    colorValue.textContent = initialColor.toUpperCase();

    const resetColorButton = document.createElement('button');
    resetColorButton.type = 'button';
    resetColorButton.className = 'marker-color-reset';
    resetColorButton.textContent = 'Default';

    const colorPicker = document.createElement('div');
    colorPicker.className = 'marker-color-picker';
    colorPicker.hidden = true;

    const createColorSlider = (labelText, min, max) => {
        const row = document.createElement('label');
        row.className = 'marker-color-slider-row';
        const label = document.createElement('span');
        label.textContent = labelText;
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'marker-color-slider';
        slider.min = min;
        slider.max = max;
        slider.step = '1';
        row.append(label, slider);
        colorPicker.appendChild(row);
        return slider;
    };

    const hueSlider = createColorSlider('Hue', 0, 359);
    hueSlider.classList.add('marker-color-hue');
    const saturationSlider = createColorSlider('Saturation', 0, 100);
    const lightnessSlider = createColorSlider('Lightness', 0, 100);

    const hexRow = document.createElement('label');
    hexRow.className = 'marker-color-hex-row';
    const hexLabel = document.createElement('span');
    hexLabel.textContent = 'Hex';
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'marker-color-hex';
    hexInput.maxLength = 7;
    hexInput.spellcheck = false;
    hexRow.append(hexLabel, hexInput);
    colorPicker.appendChild(hexRow);

    const updateSliderBackgrounds = () => {
        const h = hueSlider.value;
        const s = saturationSlider.value;
        const l = lightnessSlider.value;
        saturationSlider.style.background =
            `linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`;
        lightnessSlider.style.background =
            `linear-gradient(to right, #000, hsl(${h} ${s}% 50%), #fff)`;
    };

    const syncColorControls = color => {
        const hsl = hexToHsl(color);
        hueSlider.value = hsl.h;
        saturationSlider.value = hsl.s;
        lightnessSlider.value = hsl.l;
        hexInput.value = color.toUpperCase();
        updateSliderBackgrounds();
    };

    let currentMarkerColor = initialColor;
    const applyMarkerColor = (color, syncControls = true) => {
        songMarkerColors[songId] ||= {};
        const key = markerLabelKey(markerTime);
        const normalized = color.toLowerCase();
        if (normalized === DEFAULT_MARKER_COLOR) {
            delete songMarkerColors[songId][key];
        } else {
            songMarkerColors[songId][key] = normalized;
        }
        currentMarkerColor = normalized;
        colorButton.style.backgroundColor = normalized;
        colorValue.textContent = normalized.toUpperCase();
        if (syncControls) syncColorControls(normalized);
        else hexInput.value = normalized.toUpperCase();
        header.style.color = normalized;
        updateWaveformProgress(audio, progressBar.previousElementSibling, progressBar);
    };

    colorButton.addEventListener('click', event => {
        event.stopPropagation();
        colorPicker.hidden = !colorPicker.hidden;
        colorButton.setAttribute('aria-expanded', String(!colorPicker.hidden));
    });
    [hueSlider, saturationSlider, lightnessSlider].forEach(slider => {
        slider.addEventListener('input', () => {
            updateSliderBackgrounds();
            applyMarkerColor(
                hslToHex(hueSlider.value, saturationSlider.value, lightnessSlider.value),
                false
            );
        });
    });
    hexInput.addEventListener('input', () => {
        const value = hexInput.value.startsWith('#') ? hexInput.value : `#${hexInput.value}`;
        if (isValidMarkerColor(value)) applyMarkerColor(value);
    });
    hexInput.addEventListener('blur', () => {
        if (!isValidMarkerColor(hexInput.value)) {
            hexInput.value = currentMarkerColor.toUpperCase();
        }
    });
    hexInput.addEventListener('keydown', event => event.stopPropagation());
    resetColorButton.addEventListener('click', event => {
        event.stopPropagation();
        applyMarkerColor(DEFAULT_MARKER_COLOR);
    });

    syncColorControls(initialColor);
    colorControl.append(colorButton, colorValue, resetColorButton);
    menu.append(colorControl, colorPicker);
    
    document.body.appendChild(menu);

    const openingRect = progressBar.getBoundingClientRect();
    const anchor = {
        offsetX: x - window.scrollX - openingRect.left,
        offsetY: y - window.scrollY - openingRect.top,
        adjustX: 0,
        adjustY: 0
    };
    const positionMenu = (setViewportAdjustment = false) => {
        if (!progressBar.isConnected || !menu.isConnected) return;
        const anchorRect = progressBar.getBoundingClientRect();
        const desiredLeft = anchorRect.left + anchor.offsetX;
        const desiredTop = anchorRect.top + anchor.offsetY;

        if (setViewportAdjustment) {
            const menuRect = menu.getBoundingClientRect();
            const margin = 8;
            const clampedLeft = Math.max(margin, Math.min(desiredLeft, window.innerWidth - menuRect.width - margin));
            const clampedTop = Math.max(margin, Math.min(desiredTop, window.innerHeight - menuRect.height - margin));
            anchor.adjustX = clampedLeft - desiredLeft;
            anchor.adjustY = clampedTop - desiredTop;
        }

        menu.style.left = `${desiredLeft + anchor.adjustX}px`;
        menu.style.top = `${desiredTop + anchor.adjustY}px`;
    };
    const handleAnchorScroll = () => positionMenu();
    const handleAnchorResize = () => positionMenu(true);
    window.addEventListener('scroll', handleAnchorScroll, { capture: true, passive: true });
    window.addEventListener('resize', handleAnchorResize);
    positionMenu(true);
    
    requestAnimationFrame(() => {
        menu.style.opacity = '1';
        menu.style.visibility = 'visible';
        menu.style.transform = 'translateY(0)';
    });
    
    let closeMenu = null;
    const destroyMenu = () => {
        window.removeEventListener('scroll', handleAnchorScroll, true);
        window.removeEventListener('resize', handleAnchorResize);
        if (closeMenu) document.removeEventListener('click', closeMenu);
        menu.remove();
    };
    menu._destroyMarkerMenu = destroyMenu;

    closeMenu = (event) => {
        if (!menu.contains(event.target)) {
            menu.style.opacity = '0';
            menu.style.transform = 'translateY(-10px)';
            menu.style.visibility = 'hidden';
            
            setTimeout(() => {
                destroyMenu();
            }, 300);
        }
    };
    
    setTimeout(() => {
        if (menu.isConnected) document.addEventListener('click', closeMenu);
    }, 0);
    
    menu.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });
    
    return menu;
}

export { addSongToPlayer, getMarkers, setMarkers };

document.addEventListener('genresUpdated', () => {
    updatePlayerUI();
});

function showPlayer() {
    playerContainer.classList.toggle('active');
    playerContainer.classList.toggle('showBtn')
    showPlayerBtn.textContent = showPlayerBtn.textContent === 'Show Player' ? 'Hide Player' : 'Show Player';
}
window.showPlayer = showPlayer;

playerContainer.addEventListener('mouseover', () => {
    if (!playerContainer.classList.contains('active')) {
        playerContainer.classList.add('active');
    }
});

if (playerHoverZone) {
    playerHoverZone.addEventListener('mouseenter', () => {
        playerContainer.classList.add('active');
    });

    playerHoverZone.addEventListener('mouseleave', () => {
        requestAnimationFrame(() => {
            const isPinnedOpen = playerContainer.classList.contains('showBtn');
            if (!isPinnedOpen && !playerContainer.matches(':hover')) {
                playerContainer.classList.remove('active');
            }
        });
    });
}

// Preserve the original "hover where the player lives" behavior without
// putting an invisible element over the grid. A short delay lets normal card
// clicks pass through, while a deliberate hover reveals the panel.
let playerHoverTimer = null;
document.addEventListener('pointermove', event => {
    if (playerContainer.classList.contains('showBtn')) return;

    const rect = playerContainer.getBoundingClientRect();
    const isInsidePlayerArea = event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;

    if (isInsidePlayerArea) {
        if (!playerContainer.classList.contains('active') && playerHoverTimer === null) {
            playerHoverTimer = setTimeout(() => {
                playerHoverTimer = null;
                playerContainer.classList.add('active');
            }, 160);
        }
    } else {
        if (playerHoverTimer !== null) clearTimeout(playerHoverTimer);
        playerHoverTimer = null;
        if (!playerContainer.matches(':hover')) {
            playerContainer.classList.remove('active');
        }
    }
}, { passive: true });

playerContainer.addEventListener('mouseout', () => {
    if (playerContainer.classList.contains('active') && !playerContainer.classList.contains('showBtn') && !document.getElementById('waveform-context-menu')) {
        playerContainer.classList.remove('active');
    }
});

function isPointInSelectedRegion(time, progressBar) {
    return progressBar.selectedStartTime !== undefined && 
           progressBar.selectedEndTime !== undefined &&
           time >= progressBar.selectedStartTime && 
           time <= progressBar.selectedEndTime;
}

playerContainer.addEventListener('contextmenu', (event) => {
    event.preventDefault();
})

const renderedTracks = new Map(); // songId -> { trackDiv, refresh, cleanup }

function updatePlayerUI() {
    const playerContainer = document.getElementById('track-list');

    // The grid is a projection of SongState, never a second source of truth.
    getAllSongStates().forEach(state => {
        const isActuallyPlaying = state.status === 'playing' && !state.audio?.paused;
        state.element?.classList.toggle('playing', isActuallyPlaying);
    });

    const currentVisibleIds = new Set(
        getVisiblePlayerSongStates()
            .filter(state => state.status === 'player-paused' || !state.audio?.paused)
            .map(state => state.id)
    );

    // tear down tracks that are no longer playing: remove the listener we
    // attached to the (long-lived) audio element and deactivate its effects,
    // otherwise both keep piling up in memory every time this runs
    renderedTracks.forEach((track, songId) => {
        if (!currentVisibleIds.has(songId)) {
            track.cleanup();
            renderedTracks.delete(songId);
        }
    });

    // create tracks that just started playing, lightly refresh ones already rendered
    currentVisibleIds.forEach(songId => {
        const audio = getSongState(songId)?.audio;
        if (!audio) return;
        if (renderedTracks.has(songId)) {
            renderedTracks.get(songId).refresh();
        } else {
            const track = createTrackUI(songId, audio, playerContainer);
            renderedTracks.set(songId, track);
        }
    });

    document.dispatchEvent(new Event('playbackUpdated'));
}

function createTrackUI(songId, audio, playerContainer) {
    const getExactTime = (event, element) => {
        const rect = element.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        return (mouseX / rect.width) * audio.duration;
    };

    const formatPlaybackTime = (timeInSeconds) => {
        const safeTime = Number.isFinite(timeInSeconds) && timeInSeconds >= 0
            ? Math.floor(timeInSeconds)
            : 0;
        const hours = Math.floor(safeTime / 3600);
        const minutes = Math.floor((safeTime % 3600) / 60);
        const seconds = safeTime % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    const trackDiv = document.createElement('div');
    trackDiv.className = 'track-item';
    trackDiv.dataset.songId = songId;

    const songElement = getSongElement(songId);
    
    const titleContainer = document.createElement('div');
    titleContainer.className = 'track-title-container';
    titleContainer.style.display = 'flex';
    titleContainer.style.flexDirection = 'column';
    titleContainer.style.gap = '2px';
    
    const getSongTitle = () => {
        let songTitle = songElement.querySelector('input').value;
        if (songTitle.length > 15) {
            songTitle = songTitle.substring(0, 15) + "...";
        }
        return songTitle;
    };

    const titleSpan = document.createElement('span');
    titleSpan.textContent = getSongTitle();
    titleContainer.appendChild(titleSpan);

    const timeDisplay = document.createElement('span');
    timeDisplay.className = 'track-time-display';
    const updateTimeDisplay = () => {
        const currentTime = formatPlaybackTime(audio.currentTime);
        const totalTime = Number.isFinite(audio.duration) && audio.duration > 0
            ? formatPlaybackTime(audio.duration)
            : '--:--';
        timeDisplay.textContent = `${currentTime} / ${totalTime}`;
        timeDisplay.setAttribute('aria-label', `${currentTime} of ${totalTime}`);
    };
    updateTimeDisplay();
    titleContainer.appendChild(timeDisplay);
    
    const tags = songElement.getAttribute('data-tags');
    if (tags && tags.trim() !== '') {
        const tagsSpan = document.createElement('span');
        tagsSpan.textContent = tags.split(',').join(' + ');
        tagsSpan.style.fontSize = '0.7em';
        tagsSpan.style.color = '#888';
        titleContainer.appendChild(tagsSpan);
    }
    
    trackDiv.appendChild(titleContainer);

    const pauseButton = document.createElement('button');
    pauseButton.type = 'button';
    pauseButton.className = 'track-pause-button';
    pauseButton.textContent = '⏸';
    pauseButton.title = 'Pause';
    pauseButton.setAttribute('aria-label', `Pause ${getSongTitle()}`);
    pauseButton.addEventListener('click', event => {
        event.stopPropagation();
        const state = getSongState(songId);
        if (!state) return;
        if (audio.paused) {
            state.status = 'playing';
            songElement?.classList.add('playing');
            audio.play().then(() => {
                updatePlayerUI();
            }).catch(error => {
                state.status = 'player-paused';
                songElement?.classList.remove('playing');
                console.error('Error resuming audio:', error);
                updatePlayerUI();
            });
        } else {
            state.currentTime = audio.currentTime;
            state.status = 'player-paused';
            songElement?.classList.remove('playing');
            audio.pause();
            updatePlayerUI();
        }
    });
    const updatePauseButton = () => {
        const paused = audio.paused;
        pauseButton.textContent = paused ? '▶' : '⏸';
        pauseButton.title = paused ? 'Resume' : 'Pause';
        pauseButton.setAttribute('aria-label', `${paused ? 'Resume' : 'Pause'} ${getSongTitle()}`);
        pauseButton.classList.toggle('paused', paused);
    };
    updatePauseButton();
    trackDiv.appendChild(pauseButton);

    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';

    const timeTooltip = document.createElement('div');
    timeTooltip.className = 'time-tooltip';
    timeTooltip.style.display = 'none';
    progressContainer.appendChild(timeTooltip);

    const waveformCanvas = document.createElement('canvas');
    waveformCanvas.className = 'waveform-canvas';
    waveformCanvas.width = MAX_WAVEFORM_WIDTH;
    waveformCanvas.height = 30;
    progressContainer.appendChild(waveformCanvas);

    const progressBar = document.createElement('input');
    progressBar.type = 'range';
    progressBar.min = 0;
    progressBar.max = audio.duration || 100;
    progressBar.step = 0.001;
    progressBar.value = audio.currentTime;
    progressBar.className = 'progress-bar';
    progressContainer.appendChild(progressBar);

    const zoomIndicator = document.createElement('span');
    zoomIndicator.className = 'timeline-zoom-indicator';
    zoomIndicator.hidden = true;
    progressContainer.appendChild(zoomIndicator);

    let timelineZoom = 1;

    const positionZoomIndicator = () => {
        zoomIndicator.style.left = `${progressContainer.scrollLeft + progressContainer.clientWidth - zoomIndicator.offsetWidth - 5}px`;
    };

    const updateZoomIndicator = () => {
        const roundedZoom = Math.round(timelineZoom * 10) / 10;
        zoomIndicator.textContent = `${Number.isInteger(roundedZoom) ? roundedZoom : roundedZoom.toFixed(1)}×`;
        zoomIndicator.hidden = timelineZoom <= 1.01;
        if (!zoomIndicator.hidden) positionZoomIndicator();
    };

    const syncWaveformResolution = () => {
        if (!waveformCanvas.waveformData) return;
        const displayWidth = Math.max(1, Math.round(waveformCanvas.getBoundingClientRect().width));
        if (waveformCanvas.width !== displayWidth) waveformCanvas.width = displayWidth;
        if (waveformCanvas.height !== 30) waveformCanvas.height = 30;
        updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime, hoveredMarker);
    };

    const setTimelineZoom = (newZoom, focusTime = audio.currentTime) => {
        timelineZoom = Math.min(32, Math.max(1, newZoom));
        waveformCanvas.style.width = `calc(${timelineZoom * 100}% - 6px)`;
        progressBar.style.width = `calc(${timelineZoom * 100}% + 6px)`;

        updateZoomIndicator();

        requestAnimationFrame(() => {
            syncWaveformResolution();
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
            const focusRatio = Math.min(1, Math.max(0, focusTime / audio.duration));
            const focusX = focusRatio * waveformCanvas.offsetWidth;
            progressContainer.scrollLeft = Math.max(0, focusX - progressContainer.clientWidth / 2);
            positionZoomIndicator();
        });
    };

    progressContainer.addEventListener('scroll', positionZoomIndicator, { passive: true });

    progressContainer.addEventListener('wheel', event => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        const focusTime = getExactTime(event, waveformCanvas);
        setTimelineZoom(event.deltaY < 0 ? timelineZoom * 1.5 : timelineZoom / 1.5, focusTime);
    }, { passive: false });

    // restore a previously selected region, otherwise a paused/resumed song
    // silently loses its effect region every time it starts playing again
    const savedRegion = songRegions[songId];
    if (savedRegion) {
        progressBar.selectedStartTime = savedRegion.start;
        progressBar.selectedEndTime = savedRegion.end;
    }

    trackDiv.appendChild(progressContainer);

    const volumeControl = document.createElement('input');
    volumeControl.type = 'range';
    volumeControl.min = 0;
    volumeControl.max = 1;
    volumeControl.step = 0.01;
    volumeControl.value = audio.volume;
    volumeControl.className = 'volume-slider';
    trackDiv.appendChild(volumeControl);
    
    updateVolumeSlider(volumeControl);

    const formatTime = (timeInSeconds) => {
        const minutes = Math.floor(timeInSeconds / 60);
        const seconds = Math.floor(timeInSeconds % 60);
        const milliseconds = Math.floor((timeInSeconds % 1) * 1000);
        const preciseSuffix = timelineZoom >= 4 ? `.${milliseconds.toString().padStart(3, '0')}` : '';
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}${preciseSuffix}`;
    };

    progressBar.addEventListener('input', () => {
        audio.currentTime = progressBar.value;
        updateTimeDisplay();
    });

    volumeControl.addEventListener('input', () => {
        const newVolume = parseFloat(volumeControl.value);
        // if a fade is running on this audio, aim it at the new value instead
        // of setting volume directly, otherwise the fade overwrites this on
        // its very next animation frame
        const redirected = redirectFadeTarget(audio, newVolume);
        if (!redirected) {
            audio.volume = newVolume;
        }
        if (songId) {
            const state = getSongState(songId);
            if (state) state.volume = newVolume;
        }
        updateVolumeSlider(volumeControl);
    });

    let hoveredBar = -1;
    let hoveredTime = -1;
    let hoveredMarker = -1;
    const getCurrentMarkerTolerance = () => getMarkerTolerance(audio.duration, waveformCanvas);
    progressContainer.addEventListener('mousemove', (event) => {
        const rect = waveformCanvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        hoveredTime = (mouseX / rect.width) * audio.duration;
        
        const canvasX = (mouseX / rect.width) * waveformCanvas.width;
        const barWidth = 2;
        const gap = 1;
        const totalBarWidth = barWidth + gap;
        const newHoveredBar = Math.floor(canvasX / totalBarWidth);
        
        const markers = songMarkers[songId] || [];
        let newHoveredMarker = -1;
        let closestMarkerDistance = getCurrentMarkerTolerance();
        for (let i = 0; i < markers.length; i++) {
            const markerDistance = Math.abs(hoveredTime - markers[i]);
            if (markerDistance <= closestMarkerDistance) {
                newHoveredMarker = i;
                closestMarkerDistance = markerDistance;
            }
        }

        const markerLabel = newHoveredMarker >= 0
            ? songMarkerLabels[songId]?.[markerLabelKey(markers[newHoveredMarker])]
            : '';
        timeTooltip.textContent = markerLabel || formatTime(hoveredTime);
        timeTooltip.classList.toggle('marker-label-tooltip', Boolean(markerLabel));
        timeTooltip.style.display = 'block';

        const tooltipWidth = timeTooltip.offsetWidth;
        const tooltipHeight = timeTooltip.offsetHeight;
        let tooltipLeft = event.clientX - (tooltipWidth / 2);
        tooltipLeft = Math.max(4, Math.min(tooltipLeft, window.innerWidth - tooltipWidth - 4));
        timeTooltip.style.left = `${tooltipLeft}px`;
        timeTooltip.style.top = `${Math.max(4, rect.top - tooltipHeight - 8)}px`;
        
        if (newHoveredBar !== hoveredBar || newHoveredMarker !== hoveredMarker) {
            const visibleBarCount = Math.ceil(waveformCanvas.width / 3);
            if (newHoveredBar >= 0 && newHoveredBar < visibleBarCount) {
                hoveredBar = newHoveredBar;
            }
            hoveredMarker = newHoveredMarker;
            requestAnimationFrame(() => {
                updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime, hoveredMarker);
            });
        }
    });

    progressContainer.addEventListener('click', (event) => {
        let clickTime = hoveredTime;
        if (clickTime >= 0 && clickTime <= audio.duration) {
            clickTime = snapToMarker(songId, clickTime, getCurrentMarkerTolerance());
            audio.currentTime = clickTime;
            progressBar.value = clickTime;
            updateTimeDisplay();
        }
    });

    progressContainer.addEventListener('mousedown', (event) => {
        if (event.button === 1) {
            event.preventDefault();
            let clickTime = getExactTime(event, waveformCanvas);
            
            const snappedTime = snapToMarker(songId, clickTime, getCurrentMarkerTolerance());
            
            const removed = removeMarker(songId, snappedTime);
            if (!removed) {
                const added = addMarker(songId, snappedTime);
                if (added) {
                    console.log(`Marker added at ${formatTime(snappedTime)}`);
                }
            } else {
                console.log(`Marker removed from ${formatTime(snappedTime)}`);
            }
            
            requestAnimationFrame(() => {
                updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime);
            });
        }
    });

    progressContainer.addEventListener('mouseleave', () => {
        hoveredBar = -1;
        hoveredTime = -1;
        hoveredMarker = -1;
        timeTooltip.style.display = 'none';
        requestAnimationFrame(() => {
            updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime, hoveredMarker);
        });
    });
    
    let waveformSetupStarted = false;
    const setupTrackWaveform = () => {
        if (waveformSetupStarted || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
        waveformSetupStarted = true;
        progressBar.max = audio.duration;
        updateTimeDisplay();

        if (audio.duration > MAX_SAFE_WAVEFORM_DURATION) {
            createLightweightWaveform(waveformCanvas);
        } else {
            // Every real waveform goes through one bounded queue. Rapidly
            // opening several songs can no longer start many full decoders.
            generateWaveformLazy(audio, waveformCanvas, songId);
        }
    };
    const handleWaveformMetadata = () => {
        updateTimeDisplay();
        setupTrackWaveform();
    };
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setupTrackWaveform();
    } else {
        audio.addEventListener('loadedmetadata', handleWaveformMetadata, { once: true });
    }
    
    // stored so we can remove it in cleanup() instead of stacking a new one every render
    const handleTimeUpdate = () => {
        progressBar.value = audio.currentTime;
        updateTimeDisplay();
        requestAnimationFrame(() => {
            updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime);
        });
    };
    audio.addEventListener('timeupdate', handleTimeUpdate);

    progressBar.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });
    
    // Optional selection effect. It never seeks or starts playback. The fade
    // only begins when the playhead enters the final Settings-defined fade
    // window of the region (6.5 seconds by default).
    let selectionFadeEnabled = Boolean(songSelectionFadeEffects[songId]);
    let selectionStopEnabled = Boolean(songSelectionStopEffects[songId]);
    let selectionStopArmed = false;
    let selectionFadeState = null;
    let selectionFadeFrameId = null;

    const restoreSelectionFadeVolume = () => {
        if (selectionFadeState) {
            audio.volume = selectionFadeState.startVolume;
            selectionFadeState = null;
        }
    };

    const monitorSelectionFade = () => {
        selectionFadeFrameId = null;
        if ((!selectionFadeEnabled && !selectionStopEnabled) || audio.paused) return;

        const start = progressBar.selectedStartTime;
        const end = progressBar.selectedEndTime;
        if (start === undefined || end === undefined || end <= start) {
            restoreSelectionFadeVolume();
            selectionStopArmed = false;
            return;
        }

        const currentTime = audio.currentTime;
        const configuredFadeDuration = Math.max(0, getFadeDuration());
        const fadeStart = Math.max(start, end - configuredFadeDuration);
        if (selectionFadeState &&
            (selectionFadeState.regionStart !== start || selectionFadeState.regionEnd !== end)) {
            restoreSelectionFadeVolume();
            selectionStopArmed = false;
        }

        if (selectionStopEnabled && currentTime >= start && currentTime < end) {
            selectionStopArmed = true;
        }

        const reachedSelectionEnd = currentTime >= end &&
            (selectionFadeState || (selectionStopEnabled && selectionStopArmed));
        if (reachedSelectionEnd) {
            const restoredVolume = selectionFadeState?.startVolume ?? audio.volume;
            selectionFadeState = null;
            selectionStopArmed = false;
            const state = getSongState(songId);
            if (state) state.status = 'stopped';
            songElement?.classList.remove('playing');
            audio.pause();

            // Do not leave the saved playhead exactly on the effect boundary.
            // Some media formats seek a fraction backwards to the nearest
            // frame, which would immediately re-enter the fade and stop again
            // on the next play. At the actual end of the file, restart at 0.
            const duration = audio.duration;
            const resumeTime = Number.isFinite(duration) && end >= duration - 0.1
                ? 0
                : Math.min(end + 0.1, Number.isFinite(duration) ? duration : end + 0.1);
            audio.currentTime = resumeTime;
            if (state) state.currentTime = resumeTime;
            audio.volume = restoredVolume;
            updatePlayerUI();
            return;
        }

        if (currentTime < start) selectionStopArmed = false;

        if (!selectionFadeEnabled || currentTime < fadeStart || currentTime >= end) {
            restoreSelectionFadeVolume();
        } else {
            if (!selectionFadeState) {
                selectionFadeState = {
                    startTime: currentTime,
                    startVolume: audio.volume,
                    regionStart: start,
                    regionEnd: end
                };
            }

            const remainingDuration = end - selectionFadeState.startTime;
            const progress = remainingDuration > 0
                ? Math.min(1, Math.max(0, (currentTime - selectionFadeState.startTime) / remainingDuration))
                : 1;
            audio.volume = selectionFadeState.startVolume * Math.pow(1 - progress, 2);
        }

        selectionFadeFrameId = requestAnimationFrame(monitorSelectionFade);
    };

    const startSelectionFadeMonitor = () => {
        if ((selectionFadeEnabled || selectionStopEnabled) && !audio.paused && selectionFadeFrameId === null) {
            selectionFadeFrameId = requestAnimationFrame(monitorSelectionFade);
        }
    };

    const handleSelectionFadePlay = () => startSelectionFadeMonitor();
    audio.addEventListener('play', handleSelectionFadePlay);

    let isEditingAudio = false;
    const deleteSelectedRegion = async () => {
        if (isEditingAudio) return;

        const selectedStart = progressBar.selectedStartTime;
        const selectedEnd = progressBar.selectedEndTime;
        if (selectedStart === undefined || selectedEnd === undefined || selectedEnd <= selectedStart) return;

        const selectedDuration = selectedEnd - selectedStart;
        const confirmed = await confirmRegionDeletion(selectedDuration, formatTime);
        if (!confirmed) return;

        isEditingAudio = true;
        const indicator = createAudioEditIndicator('Preparing audio edit…');
        const oldAudioUrl = audio.src;
        let replacementUrl = null;
        let oldUrlRevoked = false;

        try {
            const edit = await encodeAudioWithoutRegion(
                oldAudioUrl,
                selectedStart,
                selectedEnd,
                message => { indicator.textContent = message; },
                audio.duration,
                getSongState(songId)?.audioSource
            );

            const previousTime = audio.currentTime;
            const adjustedTime = previousTime <= edit.start
                ? previousTime
                : previousTime < edit.end
                    ? edit.start
                    : previousTime - edit.removedDuration;

            selectionFadeEnabled = false;
            selectionStopEnabled = false;
            selectionStopArmed = false;
            delete songSelectionFadeEffects[songId];
            delete songSelectionStopEffects[songId];
            if (selectionFadeFrameId !== null) cancelAnimationFrame(selectionFadeFrameId);
            selectionFadeFrameId = null;
            restoreSelectionFadeVolume();

            const state = getSongState(songId);
            if (state) state.status = 'stopped';
            songElement?.classList.remove('playing');
            audio.pause();
            updatePlayerUI();

            indicator.textContent = 'Loading edited audio…';
            replacementUrl = edit.audioUrl || URL.createObjectURL(edit.blob);
            if (edit.audioUrl) audio.crossOrigin = 'anonymous';
            audio.src = replacementUrl;
            songElement.dataset.audioUrl = replacementUrl;
            await waitForAudioMetadata(audio);

            audio.currentTime = Math.min(adjustedTime, edit.duration);
            if (state) state.currentTime = audio.currentTime;
            songElement.dataset.audioEdited = 'true';
            if (state) state.audioSource = edit.audioUrl ? null : edit.blob;

            const adjustedMarkers = [];
            const adjustedLabels = {};
            const adjustedColors = {};
            (songMarkers[songId] || []).forEach(markerTime => {
                if (markerTime >= edit.start && markerTime < edit.end) return;
                const newTime = markerTime >= edit.end
                    ? markerTime - edit.removedDuration
                    : markerTime;
                adjustedMarkers.push(newTime);
                const label = songMarkerLabels[songId]?.[markerLabelKey(markerTime)];
                if (label) adjustedLabels[markerLabelKey(newTime)] = label;
                const color = songMarkerColors[songId]?.[markerLabelKey(markerTime)];
                if (color) adjustedColors[markerLabelKey(newTime)] = color;
            });
            songMarkers[songId] = adjustedMarkers;
            songMarkerLabels[songId] = adjustedLabels;
            songMarkerColors[songId] = adjustedColors;

            cancelWaveformGeneration(songId);
            waveformCache.delete(songId);
            waveformGenerationQueue.delete(songId);
            delete songRegions[songId];
            delete songActiveEffects[songId];

            if (oldAudioUrl.startsWith('blob:')) {
                URL.revokeObjectURL(oldAudioUrl);
                oldUrlRevoked = true;
            }

            indicator.textContent = 'Selected region deleted ✓';
            setTimeout(() => indicator.remove(), 1800);
        } catch (error) {
            console.error('Could not delete selected audio region:', error);

            if (replacementUrl && !oldUrlRevoked) {
                audio.src = oldAudioUrl;
                songElement.dataset.audioUrl = oldAudioUrl;
                audio.load();
                URL.revokeObjectURL(replacementUrl);
            }

            indicator.classList.add('error');
            indicator.textContent = 'Audio edit failed';
            setTimeout(() => indicator.remove(), 3000);
            window.alert(error.message || 'Could not edit this audio.');
        } finally {
            isEditingAudio = false;
        }
    };

    const audioEffects = setupAudioEffects(audio, progressBar, {
        isPlayAndFadeOutActive: () => selectionFadeEnabled,
        togglePlayAndFadeOut: () => {
            selectionFadeEnabled = !selectionFadeEnabled;
            songSelectionFadeEffects[songId] = selectionFadeEnabled;
            if (selectionFadeEnabled) {
                selectionStopEnabled = false;
                selectionStopArmed = false;
                songSelectionStopEffects[songId] = false;
                startSelectionFadeMonitor();
            } else {
                restoreSelectionFadeVolume();
                if (!selectionStopEnabled) {
                    if (selectionFadeFrameId !== null) cancelAnimationFrame(selectionFadeFrameId);
                    selectionFadeFrameId = null;
                }
            }
            return selectionFadeEnabled;
        },
        isPlayAndStopActive: () => selectionStopEnabled,
        togglePlayAndStop: () => {
            selectionStopEnabled = !selectionStopEnabled;
            songSelectionStopEffects[songId] = selectionStopEnabled;
            if (selectionStopEnabled) {
                selectionFadeEnabled = false;
                songSelectionFadeEffects[songId] = false;
                restoreSelectionFadeVolume();
            }
            selectionStopArmed = selectionStopEnabled &&
                audio.currentTime >= progressBar.selectedStartTime &&
                audio.currentTime < progressBar.selectedEndTime;
            if (selectionStopEnabled) {
                startSelectionFadeMonitor();
            } else if (!selectionFadeEnabled) {
                if (selectionFadeFrameId !== null) cancelAnimationFrame(selectionFadeFrameId);
                selectionFadeFrameId = null;
            }
            return selectionStopEnabled;
        },
        deleteSelectedRegion
    });

    let waitingForHotkeyMetadata = false;
    const handleHotkeyEffectsMetadata = () => {
        waitingForHotkeyMetadata = false;
        const requestedEffects = pendingHotkeyEffects.get(songId);
        if (requestedEffects) applyHotkeyEffectSelection(requestedEffects);
    };
    const applyHotkeyEffectSelection = (effectKeys = []) => {
        const requestedEffects = [...new Set(effectKeys.filter(key => typeof key === 'string'))];

        if (requestedEffects.length > 0 && (!Number.isFinite(audio.duration) || audio.duration <= 0)) {
            pendingHotkeyEffects.set(songId, requestedEffects);
            if (!waitingForHotkeyMetadata) {
                waitingForHotkeyMetadata = true;
                audio.addEventListener('loadedmetadata', handleHotkeyEffectsMetadata, { once: true });
            }
            return false;
        }

        pendingHotkeyEffects.delete(songId);
        selectionFadeEnabled = false;
        selectionStopEnabled = false;
        selectionStopArmed = false;
        delete songSelectionFadeEffects[songId];
        delete songSelectionStopEffects[songId];

        if (requestedEffects.length === 0) {
            progressBar.selectedStartTime = undefined;
            progressBar.selectedEndTime = undefined;
            delete songRegions[songId];
            delete songActiveEffects[songId];
            audioEffects.setActiveEffectKeys([]);
            progressBar.style.background = '#333';
        } else {
            // Keep a small gap before the real media end. This prevents the
            // browser's natural ended event from racing a loop at the exact
            // same timestamp, while still selecting 98%+ of short sounds.
            const endPadding = Math.min(0.1, audio.duration * 0.02);
            const region = {
                start: 0,
                end: Math.max(0.001, audio.duration - endPadding)
            };
            progressBar.selectedStartTime = region.start;
            progressBar.selectedEndTime = region.end;
            songRegions[songId] = region;
            const activatedEffects = audioEffects.setActiveEffectKeys(requestedEffects);
            songActiveEffects[songId] = activatedEffects;
            updateProgressBarGradient(progressBar, audio);
        }

        requestAnimationFrame(() => {
            updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime, hoveredMarker);
        });
        return true;
    };
    startSelectionFadeMonitor();

    if (savedRegion) {
        updateProgressBarGradient(progressBar, audio);
        requestAnimationFrame(() => {
            updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime);
        });

        const savedEffectKeys = songActiveEffects[songId] || [];
        savedEffectKeys.forEach(key => audioEffects.activateEffect(key));
    }

    if (pendingHotkeyEffects.has(songId)) {
        applyHotkeyEffectSelection(pendingHotkeyEffects.get(songId));
    }
    
    let rightClickStartPos = null;
    let hasMovedMouse = false;
    
    progressBar.addEventListener('mousedown', (event) => {
        if (event.button === 2) {
            event.preventDefault();
            let selectedTime = getExactTime(event, waveformCanvas);
    
            if (isDragging) {
                return;
            }
            
            rightClickStartPos = { x: event.clientX, y: event.clientY, time: selectedTime };
            hasMovedMouse = false;
    
            const currentTime = Date.now();
            const isDoubleClick = (currentTime - lastRightClickTime) < doubleClickDelay;
            lastRightClickTime = currentTime;

            const isOverMarker = findClosestMarker(
                songId,
                selectedTime,
                getCurrentMarkerTolerance()
            ) !== null;
            // Hover and click use the exact same pixel-based tolerance. If a
            // marker is visibly highlighted it owns the right-click; the
            // selected region owns only the remaining space inside it.
            if (isPointInSelectedRegion(selectedTime, progressBar) && !isOverMarker) {
                audioEffects.createContextMenu(
                    event.pageX, 
                    event.pageY,
                    (progressBar, audio) => {
                        updateProgressBarGradient(progressBar, audio);
                    },
                    () => {
                        updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime);
                    }
                );
            } else if (isDoubleClick && !isOverMarker) {
                selectionFadeEnabled = false;
                selectionStopEnabled = false;
                selectionStopArmed = false;
                delete songSelectionFadeEffects[songId];
                delete songSelectionStopEffects[songId];
                if (selectionFadeFrameId !== null) cancelAnimationFrame(selectionFadeFrameId);
                selectionFadeFrameId = null;
                restoreSelectionFadeVolume();
                audioEffects.cleanup();
                delete songRegions[songId];
                delete songActiveEffects[songId];
                setTimeout(() => {
                    progressBar.selectedStartTime = undefined;
                    progressBar.selectedEndTime = undefined;
                    progressBar.style.background = '#333';
                    const existingMenu = document.querySelector('.waveform-context-menu');
                    if (existingMenu) {
                        existingMenu._destroyWaveformMenu?.();
                        existingMenu.remove();
                    }
                    requestAnimationFrame(() => {
                        updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime);
                    });
                }, 50);
            } else if ((progressBar.selectedStartTime === undefined || progressBar.selectedEndTime === undefined) || isOverMarker) {
                // don't commit to a new selection on mousedown alone — a plain
                // right-click on a marker (no movement) should only open the
                // marker menu and must NOT wipe out the existing region.
                // the previous selection is only overwritten once real
                // dragging is detected below.
                const pendingStartTime = selectedTime;
                let dragCommitted = false;
                
                const onMouseMove = (moveEvent) => {
                    const moveDistance = Math.sqrt(
                        Math.pow(moveEvent.clientX - rightClickStartPos.x, 2) + 
                        Math.pow(moveEvent.clientY - rightClickStartPos.y, 2)
                    );
                    
                    if (moveDistance > 5) {
                        hasMovedMouse = true;
                    }
                    
                    if (!hasMovedMouse) return;
                    
                    if (!dragCommitted) {
                        dragCommitted = true;
                        isDragging = true;
                        progressBar.selectedStartTime = pendingStartTime;
                    }
                    
                    let movedTime = getExactTime(moveEvent, waveformCanvas);
                    movedTime = snapToMarker(songId, movedTime, getCurrentMarkerTolerance());
                    progressBar.selectedEndTime = movedTime;
    
                    if (progressBar.selectedStartTime > progressBar.selectedEndTime) {
                        [progressBar.selectedStartTime, progressBar.selectedEndTime] = [
                            progressBar.selectedEndTime,
                            progressBar.selectedStartTime,
                        ];
                    }
    
                    updateProgressBarGradient(progressBar, audio);
                    requestAnimationFrame(() => {
                        updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime, hoveredMarker);
                    });
                };
    
                const onMouseUp = (upEvent) => {
                    isDragging = false;
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    
                    if (!hasMovedMouse && rightClickStartPos) {
                        const clickedMarker = findClosestMarker(
                            songId,
                            rightClickStartPos.time,
                            getCurrentMarkerTolerance()
                        );
                        
                        if (clickedMarker !== null) {
                            createMarkerContextMenu(
                                upEvent.pageX,
                                upEvent.pageY,
                                songId,
                                clickedMarker,
                                audio,
                                progressBar,
                                audioEffects
                            );
                        }
                    }
                    
                    rightClickStartPos = null;
                    hasMovedMouse = false;
                };
    
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            } else {
                const existingMenu = document.querySelector('.waveform-context-menu');
                if (existingMenu) {
                    existingMenu._destroyWaveformMenu?.();
                    existingMenu.remove();
                }
            }
        }
    });

    playerContainer.appendChild(trackDiv);
    requestAnimationFrame(() => {
        syncWaveformResolution();
        updateZoomIndicator();
    });

    return {
        trackDiv,
        // called on every updatePlayerUI() while the track keeps playing;
        // deliberately does NOT touch listeners, effects, or the waveform
        refresh() {
            volumeControl.value = audio.volume;
            updateVolumeSlider(volumeControl);
            progressBar.max = audio.duration || 100;
            titleSpan.textContent = getSongTitle();
            updateTimeDisplay();
            updatePauseButton();
        },
        applyHotkeyEffects(effectKeys) {
            applyHotkeyEffectSelection(effectKeys);
        },
        // called once, when the track actually stops playing
        cleanup() {
            // remember the region and active effects so they come back if
            // this song starts playing again later, instead of resetting
            if (progressBar.selectedStartTime !== undefined && progressBar.selectedEndTime !== undefined) {
                songRegions[songId] = {
                    start: progressBar.selectedStartTime,
                    end: progressBar.selectedEndTime
                };
                songActiveEffects[songId] = audioEffects.getActiveEffectKeys();
            } else {
                delete songRegions[songId];
                delete songActiveEffects[songId];
            }

            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('play', handleSelectionFadePlay);
            audio.removeEventListener('loadedmetadata', handleWaveformMetadata);
            audio.removeEventListener('loadedmetadata', handleHotkeyEffectsMetadata);
            cancelWaveformGeneration(songId, waveformCanvas);
            if (selectionFadeFrameId !== null) cancelAnimationFrame(selectionFadeFrameId);
            selectionFadeFrameId = null;
            restoreSelectionFadeVolume();
            audioEffects.cleanup();
            trackDiv.remove();
        },
        restoreTransientVolume() {
            restoreSelectionFadeVolume();
        }
    };
}

function updateProgressBarGradient(progressBar, audio) {
    if (progressBar.selectedStartTime === undefined || progressBar.selectedEndTime === undefined) {
        progressBar.style.background = '#333';
        return;
    }

    const startPercent = (progressBar.selectedStartTime / audio.duration * 100).toFixed(4);
    const endPercent = (progressBar.selectedEndTime / audio.duration * 100).toFixed(4);
    
    progressBar.style.background = `linear-gradient(to right, 
        #333 ${startPercent}%, 
        #2bdbb0 ${startPercent}%, 
        #2bdbb0 ${endPercent}%, 
        #333 ${endPercent}%)`;
}

async function generateWaveformDirect(audio, canvas, songId) {
    if (waveformCache.has(songId)) {
        const cachedData = waveformCache.get(songId);
        canvas.waveformData = cachedData;
        drawWaveform(canvas, cachedData);
        return;
    }
    
    try {
        if (!sharedAudioContext) {
            sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const response = await fetch(audio.src);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await sharedAudioContext.decodeAudioData(arrayBuffer);
        
        canvas.width = MAX_WAVEFORM_WIDTH;
        
        const rawData = audioBuffer.getChannelData(0);
        const samplesPerPixel = Math.floor(rawData.length / MAX_WAVEFORM_WIDTH);
        const waveformData = new Array(MAX_WAVEFORM_WIDTH);
        
        const chunkSize = 2000;
        for (let i = 0; i < MAX_WAVEFORM_WIDTH; i += chunkSize) {
            await new Promise(resolve => setTimeout(resolve, 0));
            
            const endChunk = Math.min(i + chunkSize, MAX_WAVEFORM_WIDTH);
            for (let j = i; j < endChunk; j++) {
                const start = j * samplesPerPixel;
                const end = Math.min(start + samplesPerPixel, rawData.length);
                
                let sum = 0;
                let peakPositive = 0;
                let peakNegative = 0;
                
                for (let k = start; k < end; k++) {
                    const amplitude = rawData[k];
                    sum += Math.abs(amplitude);
                    if (amplitude > peakPositive) peakPositive = amplitude;
                    if (amplitude < peakNegative) peakNegative = amplitude;
                }
                
                waveformData[j] = {
                    average: sum / samplesPerPixel,
                    peak: Math.max(Math.abs(peakPositive), Math.abs(peakNegative))
                };
            }
        }

        let maxPeak = 0.001;
        let maxAverage = 0.001;
        waveformData.forEach(point => {
            maxPeak = Math.max(maxPeak, point.peak);
            maxAverage = Math.max(maxAverage, point.average);
        });

        waveformData.forEach(point => {
            point.peak /= maxPeak;
            point.average /= maxAverage;
        });

        waveformCache.set(songId, waveformData);
        canvas.waveformData = waveformData;
        drawWaveform(canvas, waveformData);

    } catch (error) {
        console.error("Direct waveform generation error:", error);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

function createLightweightWaveform(canvas) {
    canvas.width = MAX_WAVEFORM_WIDTH_LONG;
    const waveformData = Array.from({ length: MAX_WAVEFORM_WIDTH_LONG }, (_, index) => ({
        average: 0.08 + (index % 5) * 0.006,
        peak: 0.14 + (index % 7) * 0.005
    }));
    canvas.waveformData = waveformData;
    canvas.dataset.lightweightWaveform = 'true';
    drawWaveform(canvas, waveformData);
}

function cancelWaveformGeneration(songId, canvas = null) {
    const queued = waveformGenerationQueue.get(songId);
    if (queued && (canvas === null || queued.canvas === canvas)) {
        waveformGenerationQueue.delete(songId);
    }

    const active = waveformGenerationControllers.get(songId);
    if (active && (canvas === null || active.canvas === canvas)) active.controller.abort();
}

function generateWaveformLazy(audio, canvas, songId) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#666';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Loading...', canvas.width / 2, canvas.height / 2);
    
    if (waveformCache.has(songId)) {
        const cachedData = waveformCache.get(songId);
        canvas.waveformData = cachedData;
        drawWaveform(canvas, cachedData);
        return;
    }
    
    // Keep the newest canvas as a follow-up when this song is reopened while
    // an older, now-cancelled generation is still unwinding.
    waveformGenerationQueue.set(songId, { audio, canvas });
    processWaveformQueue();
}

async function processWaveformQueue() {
    if (currentGenerations >= MAX_CONCURRENT_GENERATIONS) {
        return;
    }
    
    const nextEntry = Array.from(waveformGenerationQueue.entries())[0];
    if (!nextEntry) {
        return;
    }
    
    const [songId, { audio, canvas }] = nextEntry;
    waveformGenerationQueue.delete(songId);
    currentGenerations++;
    const controller = new AbortController();
    waveformGenerationControllers.set(songId, { controller, canvas });
    
    try {
        await generateWaveformActual(audio, canvas, songId, controller.signal);
    } catch (error) {
        if (error.name !== 'AbortError') console.error('Waveform generation failed:', error);
    } finally {
        const active = waveformGenerationControllers.get(songId);
        if (active?.controller === controller) waveformGenerationControllers.delete(songId);
        currentGenerations--;
        if (waveformGenerationQueue.size > 0) {
            setTimeout(() => processWaveformQueue(), 100);
        }
    }
}

async function generateWaveformActual(audio, canvas, songId, signal) {
    try {
        if (waveformCache.has(songId)) {
            const cachedData = waveformCache.get(songId);
            if (!signal.aborted && canvas.isConnected) {
                canvas.waveformData = cachedData;
                drawWaveform(canvas, cachedData);
            }
            return;
        }
        if (!sharedAudioContext) {
            sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const response = await fetch(audio.src, { signal });
        const arrayBuffer = await response.arrayBuffer();
        if (signal.aborted) return;
        const audioBuffer = await sharedAudioContext.decodeAudioData(arrayBuffer);
        if (signal.aborted) return;
        
        const duration = audioBuffer.duration;
        const targetWidth = duration > 600 ? MAX_WAVEFORM_WIDTH_LONG : MAX_WAVEFORM_WIDTH;
        canvas.width = targetWidth;
        
        const rawData = audioBuffer.getChannelData(0);
        const samplesPerPixel = Math.floor(rawData.length / targetWidth);
        const waveformData = new Array(targetWidth);
        
        const chunkSize = Math.max(1, Math.floor(targetWidth / 10));
        for (let i = 0; i < targetWidth; i += chunkSize) {
            await new Promise(resolve => setTimeout(resolve, 50));
            if (signal.aborted) return;
            
            const endChunk = Math.min(i + chunkSize, targetWidth);
            for (let j = i; j < endChunk; j++) {
                const start = j * samplesPerPixel;
                const end = Math.min(start + samplesPerPixel, rawData.length);
                
                const sampleStep = samplesPerPixel > 50000 ? Math.floor(samplesPerPixel / 500) : Math.max(1, Math.floor(samplesPerPixel / 5000));
                
                let sum = 0;
                let peakPositive = 0;
                let peakNegative = 0;
                let sampleCount = 0;
                
                for (let k = start; k < end; k += sampleStep) {
                    const amplitude = rawData[k];
                    sum += Math.abs(amplitude);
                    if (amplitude > peakPositive) peakPositive = amplitude;
                    if (amplitude < peakNegative) peakNegative = amplitude;
                    sampleCount++;
                }
                
                waveformData[j] = {
                    average: sampleCount > 0 ? sum / sampleCount : 0,
                    peak: Math.max(Math.abs(peakPositive), Math.abs(peakNegative))
                };
            }
        }

        let maxPeak = 0.001;
        let maxAverage = 0.001;
        waveformData.forEach(point => {
            maxPeak = Math.max(maxPeak, point.peak);
            maxAverage = Math.max(maxAverage, point.average);
        });

        waveformData.forEach(point => {
            point.peak /= maxPeak;
            point.average /= maxAverage;
        });

        waveformCache.set(songId, waveformData);
        if (canvas.isConnected) {
            canvas.waveformData = waveformData;
            drawWaveform(canvas, waveformData);
        }

    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error("Waveform generation error:", error);
        if (canvas.isConnected) {
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#333';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    }
}

function drawWaveform(canvas, waveformData) {
    const displayWidth = Math.round(canvas.getBoundingClientRect().width);
    if (displayWidth > 0 && canvas.width !== displayWidth) canvas.width = displayWidth;
    if (canvas.height !== 30) canvas.height = 30;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    canvas.waveformData = waveformData;
    ctx.clearRect(0, 0, width, height);
    
    const barWidth = 2;
    const gap = 1;
    const totalBarWidth = barWidth + gap;
    const renderBarCount = Math.ceil(width / totalBarWidth);
    const centerY = height / 2;
    
    for (let i = 0; i < renderBarCount; i++) {
        const sourceIndex = Math.min(
            waveformData.length - 1,
            Math.floor((i / Math.max(1, renderBarCount - 1)) * (waveformData.length - 1))
        );
        const point = waveformData[sourceIndex];
        const x = i * totalBarWidth;
        
        const avgHeight = point.average * height * 0.8;
        const avgY = centerY - (avgHeight / 2);
        ctx.fillStyle = '#333';
        ctx.fillRect(x, avgY, barWidth, avgHeight);
        
        const peakHeight = point.peak * height * 0.8;
        const peakTopY = centerY - (peakHeight / 2);
        const peakBottomY = centerY + (peakHeight / 2) - 1;
        
        ctx.fillStyle = '#444';
        ctx.fillRect(x, peakTopY, barWidth, 1);
        ctx.fillRect(x, peakBottomY, barWidth, 1);
    }
}

function updateWaveformProgress(audio, canvas, progressBar, hoveredBar = -1, hoveredTime = -1, hoveredMarker = -1) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    const waveformData = canvas.waveformData;
    
    if (!waveformData) return;

    ctx.clearRect(0, 0, width, height);
    
    const barWidth = 2;
    const gap = 1;
    const totalBarWidth = barWidth + gap;
    const renderBarCount = Math.ceil(width / totalBarWidth);
    const centerY = height / 2;
    const progress = audio.currentTime / audio.duration;
    const progressPixel = Math.floor(width * progress);
    const selectedStartPixel = progressBar.selectedStartTime !== undefined
        ? Math.floor((progressBar.selectedStartTime / audio.duration) * width)
        : -1;
    const selectedEndPixel = progressBar.selectedEndTime !== undefined
        ? Math.floor((progressBar.selectedEndTime / audio.duration) * width)
        : -1;

    if (hoveredTime >= 0) {
        const hoverPixel = Math.floor((hoveredTime / audio.duration) * width);
        ctx.fillStyle = 'rgba(74, 255, 219, 0.3)';
        ctx.fillRect(hoverPixel - 1, 0, 2, height);
    }

    const batchSize = 100;
    for (let i = 0; i < renderBarCount; i += batchSize) {
        const endIndex = Math.min(i + batchSize, renderBarCount);
        
        for (let j = i; j < endIndex; j++) {
            const sourceIndex = Math.min(
                waveformData.length - 1,
                Math.floor((j / Math.max(1, renderBarCount - 1)) * (waveformData.length - 1))
            );
            const point = waveformData[sourceIndex];
            const x = j * totalBarWidth;
            const barTime = (x / width) * audio.duration;
            
            let mainColor, peakColor;
            if (j === hoveredBar || 
                (hoveredTime >= 0 && 
                 barTime <= hoveredTime && 
                 barTime + (totalBarWidth / width * audio.duration) >= hoveredTime)) {
                mainColor = '#4affdb';
                peakColor = '#2affdb';
            } else if (x <= progressPixel) {
                mainColor = '#2bdbb0';
                peakColor = '#1a9977';
            } else if (selectedStartPixel !== -1 && selectedEndPixel !== -1 && 
                      x >= selectedStartPixel && x <= selectedEndPixel) {
                mainColor = '#4a9eff';
                peakColor = '#3a7ecc';
            } else {
                mainColor = '#333';
                peakColor = '#444';
            }
            
            const avgHeight = point.average * height * 0.8;
            const avgY = centerY - (avgHeight / 2);
            ctx.fillStyle = mainColor;
            ctx.fillRect(x, avgY, barWidth, avgHeight);
            
            const peakHeight = point.peak * height * 0.8;
            const peakTopY = centerY - (peakHeight / 2);
            const peakBottomY = centerY + (peakHeight / 2) - 1;
            
            ctx.fillStyle = peakColor;
            ctx.fillRect(x, peakTopY, barWidth, 1);
            ctx.fillRect(x, peakBottomY, barWidth, 1);  
        }
    }

    if (progressBar.selectedStartTime !== undefined && progressBar.selectedEndTime !== undefined) {
        ctx.fillStyle = '#4a9eff';
        const startX = (progressBar.selectedStartTime / audio.duration) * width;
        const endX = (progressBar.selectedEndTime / audio.duration) * width;
        
        ctx.fillRect(startX - 1, 0, 2, height);
        ctx.fillRect(endX - 1, 0, 2, height);
    }

    const trackDiv = canvas.closest('.track-item');
    const songId = trackDiv?.dataset.songId;
    if (songId && songMarkers[songId]) {
        songMarkers[songId].forEach((markerTime, index) => {
            const markerX = (markerTime / audio.duration) * width;
            const markerColor = songMarkerColors[songId]?.[markerLabelKey(markerTime)] || DEFAULT_MARKER_COLOR;
            ctx.fillStyle = index === hoveredMarker
                ? lightenMarkerColor(markerColor)
                : markerColor;
            ctx.fillRect(markerX - 1.5, 0, 3, height);

        });
    }
}

function updateVolumeSlider(slider) {
    const value = slider.value;
    const min = slider.min || 0;
    const max = slider.max || 100;
    const percentage = ((value - min) / (max - min)) * 100;
    
    slider.style.background = `linear-gradient(to right, 
        rgb(43, 219, 160) 0%, 
        rgb(43, 219, 160) ${percentage}%, 
        rgba(255, 255, 255, 0.2) ${percentage}%, 
        rgba(255, 255, 255, 0.2) 100%)`;
}

// smoothly animates volume using a curve that matches how we perceive loudness
// (loudness is logarithmic, not linear) instead of stepping volume in fixed linear increments.
// fading in eases in (starts slow, speeds up near the end) and fading out eases out
// (drops quickly at first, tapers off gently near silence) - this avoids the "sudden jump"
// feeling you get with a plain linear ramp.
const activeFadeTargets = new Map(); // audio -> { value: targetVolume }, kept live so a manual volume change mid-fade can redirect it

function animateVolume(audio, startVolume, endVolume, duration, onComplete) {
    const startTime = performance.now();
    const targetRef = { value: endVolume };
    activeFadeTargets.set(audio, targetRef);

    const step = () => {
        // if another animateVolume call took over this audio, stop here
        if (activeFadeTargets.get(audio) !== targetRef) return;

        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const target = targetRef.value; // read live: may have been redirected
        const isFadingIn = target > startVolume;

        const eased = isFadingIn
            ? progress * progress
            : 1 - Math.pow(1 - progress, 2);

        audio.volume = startVolume + (target - startVolume) * eased;

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            audio.volume = target;
            if (activeFadeTargets.get(audio) === targetRef) {
                activeFadeTargets.delete(audio);
            }
            if (onComplete) onComplete();
        }
    };

    requestAnimationFrame(step);
}

// called from the volume slider: if a fade is currently running on this
// audio, redirect its target instead of letting the fade silently
// overwrite the manual adjustment on the next animation frame
function redirectFadeTarget(audio, newVolume) {
    const targetRef = activeFadeTargets.get(audio);
    if (targetRef) {
        targetRef.value = newVolume;
        return true;
    }
    return false;
}

export function fadeOut(targetSongId) {
    const fadeDuration = getFadeDuration();
    const state = getSongState(targetSongId);
    const audio = state?.audio;
    if (!state || state.status !== 'playing' || !audio || audio.paused) return;
    
    const startVolume = audio.volume;

    animateVolume(audio, startVolume, 0, fadeDuration * 1000, () => {
        // remember where playback stopped, so fadeTo/cutTo resume here later
        state.currentTime = audio.currentTime;

        audio.pause();
        audio.volume = startVolume;

        // mark the central state as stopped
        state.status = 'stopped';

        // remove playing class from grid (to remove the green color)
        const songElement = getSongElement(targetSongId);
        if (songElement) {
            songElement.classList.remove('playing');
        }

        updatePlayerUI();
    });
}

// instant stop for a single song, no fade — the "cut" counterpart to fadeOut
export function stopSong(targetSongId) {
    const state = getSongState(targetSongId);
    if (!state) return;
    const audio = state.audio;
    if (state.status !== 'playing' || !audio) {
        if (state.status === 'player-paused') {
            state.status = 'stopped';
            updatePlayerUI();
        }
        return;
    }

    // remember where playback stopped, so fadeTo/cutTo resume here later
    state.currentTime = audio.currentTime;

    audio.pause();
    audio.volume = state.volume ?? audio.volume;
    state.status = 'stopped';

    const songElement = getSongElement(targetSongId);
    if (songElement) {
        songElement.classList.remove('playing');
    }

    updatePlayerUI();
}

export function fadeTo(targetSongId) {
    const fadeDuration = getFadeDuration() * 1000; // ms
    const targetItem = getSongElement(targetSongId);
    
    if (!targetItem) return;

    const targetState = getSongState(targetSongId);
    const targetAudio = targetState?.audio;
    if (!targetAudio) {
        console.error(`No audio found for song ${targetSongId}`);
        return;
    }

    const savedVolume = targetState.volume ?? 1;
    const savedTime = targetState.currentTime ?? 0;

    // fade out and stop all other active audios
    getPlayingSongStates().forEach(state => {
        const id = state.id;
        if (id !== targetSongId) {
            const audio = state.audio;
            const item = getSongElement(id);
            
            state.volume = audio.volume;
            state.currentTime = audio.currentTime;
            const startVol = audio.volume;
            animateVolume(audio, startVol, 0, fadeDuration, () => {
                audio.pause();
                audio.volume = state.volume;
                item?.classList.remove('playing');
                state.status = 'stopped';
                updatePlayerUI();
            });
        }
    });

    // if target audio is already playing, just fade volume
    if (!targetAudio.paused && targetState.status === 'playing') {
        targetAudio.volume = 0;
        animateVolume(targetAudio, 0, savedVolume, fadeDuration);
        updatePlayerUI();
        return;
    }

    if (targetAudio.paused) {
        targetAudio.muted = true;
        targetAudio.volume = 0;
        
        targetAudio.pause();
        
        targetAudio.currentTime = savedTime;
        
        (async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            
            try {
                await targetAudio.play();
                targetState.status = 'playing';
                targetItem.classList.add('playing');
                updatePlayerUI();
                
                await new Promise(resolve => setTimeout(resolve, 100));
                
                targetAudio.muted = false;
                animateVolume(targetAudio, 0, savedVolume, fadeDuration);
                
            } catch (error) {
                console.error("Error playing audio:", error);
                targetState.status = 'stopped';
                targetAudio.muted = false;
                updatePlayerUI();
            }
        })();
    }
}

// starts a song from silence and fades it up to its saved volume, without
// touching whatever else is currently playing — unlike fadeTo, which fades
// everything else out first
export function fadeIn(targetSongId) {
    const fadeDuration = getFadeDuration() * 1000; // ms
    const targetItem = getSongElement(targetSongId);
    
    if (!targetItem) return;

    const targetState = getSongState(targetSongId);
    const targetAudio = targetState?.audio;
    if (!targetAudio) {
        console.error(`No audio found for song ${targetSongId}`);
        return;
    }

    const savedVolume = targetState.volume ?? 1;
    const savedTime = targetState.currentTime ?? 0;

    // if it's already playing, just fade its volume up from where it is
    if (!targetAudio.paused && targetState.status === 'playing') {
        targetAudio.volume = 0;
        animateVolume(targetAudio, 0, savedVolume, fadeDuration);
        updatePlayerUI();
        return;
    }

    if (targetAudio.paused) {
        targetAudio.muted = true;
        targetAudio.volume = 0;
        
        targetAudio.pause();
        
        targetAudio.currentTime = savedTime;
        
        (async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            
            try {
                await targetAudio.play();
                targetState.status = 'playing';
                targetItem.classList.add('playing');
                updatePlayerUI();
                
                await new Promise(resolve => setTimeout(resolve, 100));
                
                targetAudio.muted = false;
                animateVolume(targetAudio, 0, savedVolume, fadeDuration);
                
            } catch (error) {
                console.error("Error playing audio:", error);
                targetState.status = 'stopped';
                targetAudio.muted = false;
                updatePlayerUI();
            }
        })();
    }
}

// instant transition to selected audio
export function cutTo(targetSongId) {
    const targetItem = getSongElement(targetSongId);
    
    if (!targetItem) return;

    const targetState = getSongState(targetSongId);
    const targetAudio = targetState?.audio;
    if (!targetAudio) {
        console.error(`No audio found for song ${targetSongId}`);
        return;
    }
    const savedVolume = targetState.volume ?? 1;
    const savedTime = targetState.currentTime ?? 0;

    // stop everything else immediately
    getPlayingSongStates().forEach(state => {
        const id = state.id;
        if (id !== targetSongId) {
            const audio = state.audio;
            const item = getSongElement(id);
            
            state.volume = audio.volume;
            state.currentTime = audio.currentTime;
            
            audio.pause();
            audio.volume = state.volume;
            item?.classList.remove('playing');
            state.status = 'stopped';
        }
    });

    // play target immediately
    if (targetAudio.paused) {
        targetAudio.currentTime = savedTime;
        targetAudio.volume = savedVolume;
        
        targetAudio.play().then(() => {
            targetState.status = 'playing';
            targetItem.classList.add('playing');
            updatePlayerUI();
        }).catch(error => {
            targetState.status = 'stopped';
            console.error("Error playing audio:", error);
            updatePlayerUI();
        });
    } else {
        updatePlayerUI();
    }
}

// Starts or resumes one song immediately while leaving every other active
// audio untouched. This is the hotkey "Insert" counterpart to Fade and Cut.
export function playSong(targetSongId) {
    const targetItem = getSongElement(targetSongId);
    const targetState = getSongState(targetSongId);
    const targetAudio = targetState?.audio;

    if (!targetItem || !targetAudio) {
        console.error(`No audio found for song ${targetSongId}`);
        return;
    }

    if (!targetAudio.paused) {
        targetState.status = 'playing';
        targetItem.classList.add('playing');
        updatePlayerUI();
        return;
    }

    const savedVolume = targetState.volume ?? 1;
    const savedTime = targetState.currentTime ?? targetAudio.currentTime ?? 0;

    targetState.status = 'playing';
    targetAudio.muted = false;
    targetAudio.volume = savedVolume;
    targetAudio.currentTime = savedTime;

    targetAudio.play().then(() => {
        targetState.status = 'playing';
        targetItem.classList.add('playing');
        updatePlayerUI();
    }).catch(error => {
        targetState.status = 'stopped';
        targetItem.classList.remove('playing');
        console.error('Error playing audio:', error);
        updatePlayerUI();
    });
}

export function prepareHotkeyPlayback(targetSongId, effectKeys = []) {
    const normalizedEffects = [...new Set(effectKeys.filter(key => typeof key === 'string'))];
    pendingHotkeyEffects.set(targetSongId, normalizedEffects);
    renderedTracks.get(targetSongId)?.applyHotkeyEffects(normalizedEffects);
}

export function removeSongAudio(songId) {
    const state = getSongState(songId);
    if (!state) return;

    cancelWaveformGeneration(songId);
    state.status = 'stopped';
    const audio = state.audio;
    if (audio) {
        activeFadeTargets.delete(audio);
        audio.pause();
        audio.currentTime = 0;
        // release the blob URL created on upload, otherwise it stays in
        // memory for the rest of the page's life even after the song is gone
        URL.revokeObjectURL(audio.src);
    }
    const imageUrl = state.element?.querySelector('img')?.src;
    if (imageUrl?.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
    waveformCache.delete(songId);

    // in case the song was actively playing, make sure its track panel
    // (and the listener/effects tied to it) gets torn down right away
    updatePlayerUI();

    // Remove the single state object only after the track cleanup has run;
    // cleanup still needs its audio/effect references during updatePlayerUI().
    if (audio) releaseAudioContext(audio);
    removeSongState(songId);
}

export function clearAllSongs() {
    const states = getAllSongStates();
    states.forEach(state => { state.status = 'stopped'; });

    // Stop render-owned effects/listeners before removing their state.
    renderedTracks.forEach(track => track.cleanup());
    renderedTracks.clear();

    waveformGenerationControllers.forEach(({ controller }) => controller.abort());
    waveformGenerationControllers.clear();
    waveformGenerationQueue.clear();
    waveformCache.clear();

    states.forEach(state => {
        activeFadeTargets.delete(state.audio);
        if (state.audio) {
            state.audio.pause();
            releaseAudioContext(state.audio);
            state.audio.removeAttribute('src');
            state.audio.load();
        }
        const audioUrl = state.element?.dataset.audioUrl;
        if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
        const imageUrl = state.element?.querySelector('img')?.src;
        if (imageUrl?.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
        removeSongState(state.id);
    });

    updatePlayerUI();
}

export function resetSong(songId) {
    const state = getSongState(songId);
    const audio = state?.audio;
    if (!state || !audio) return;
    
    const item = getSongElement(songId);
    state.status = 'stopped';

    if (!audio.paused) {
        audio.pause();
        item?.classList.remove('playing');
    }

    audio.currentTime = 0;
    audio.volume = 1;
    state.currentTime = 0;
    state.volume = 1;
    
    updatePlayerUI();

    // updatePlayerUI() may have just re-persisted the old region/effects via
    // the track's own cleanup, so clear them after, not before
    state.region = null;
    state.activeEffects = [];
    state.selectionFadeEnabled = false;
    state.selectionStopEnabled = false;
    state.hotkey.pendingEffects = null;
}

// records the song playing through with whatever effects are currently set
// up on it, then downloads the result. this plays the song in real time
// (not an instant export) because several effects — speed, pitch shift,
// reverse — are driven by properties of the actual <audio> element, so the
// most reliable way to capture exactly what you hear is to actually play
// it and record the output, rather than trying to reconstruct every effect
// offline.
//
// onProgress(currentTime, duration) is called periodically during
// recording so the caller can show a progress indicator.
export async function downloadSong(songId, onProgress) {
    if (typeof MediaRecorder === 'undefined') {
        throw new Error('Your browser doesn\'t support MediaRecorder, so recording a download isn\'t possible here. Try Chrome or Firefox.');
    }

    const state = getSongState(songId);
    const audio = state?.audio;
    if (!state || !audio) {
        throw new Error(`No audio found for song ${songId}`);
    }

    const songItem = getSongElement(songId);
    const title = songItem?.querySelector('.title-input')?.value || 'song';

    // solo this song — anything else playing would otherwise get captured
    // into the same recording, since they all share one output bus
    getPlayingSongStates().forEach(playingState => {
        if (playingState.id !== songId) {
            stopSong(playingState.id);
        }
    });

    const wasPaused = audio.paused;
    const volume = state.volume ?? 1;

    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;
    audio.muted = false;

    const { stream, release } = createRecordingTap();
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
    };

    const recordingStopped = new Promise(resolve => {
        recorder.onstop = resolve;
    });

    let progressInterval = null;
    let completionPoll = null;
    let handleEnded = null;

    const cleanupPlayback = () => {
        if (progressInterval) clearInterval(progressInterval);
        if (completionPoll) clearInterval(completionPoll);
        if (handleEnded) audio.removeEventListener('ended', handleEnded);
        state.status = 'stopped';
        songItem?.classList.remove('playing');
        updatePlayerUI();
    };

    if (onProgress) {
        progressInterval = setInterval(() => {
            onProgress(audio.currentTime, audio.duration || 0, 'recording');
        }, 200);
    }

    // waits for whichever comes first: the natural 'ended' event, or
    // audio.currentTime reaching the end of the track. currentTime always
    // reflects true progress through the ORIGINAL media regardless of the
    // current playback rate, so this works correctly even when Speed is
    // active — a fixed wall-clock timer based on the nominal duration would
    // fire too early whenever speed is below 1x (cutting the recording
    // short, as happened at 0.75x) and too late above 1x. the 'ended'
    // listener is kept as a fallback for the rare case duration is unknown,
    // and because a Loop/Smooth Loop effect would otherwise prevent
    // 'ended' from ever firing on its own.
    const playedThrough = new Promise((resolve, reject) => {
        let resolved = false;
        const finish = () => {
            if (resolved) return;
            resolved = true;
            resolve();
        };

        handleEnded = finish;
        audio.addEventListener('ended', handleEnded, { once: true });

        recorder.start();
        state.status = 'playing';
        songItem?.classList.add('playing');
        updatePlayerUI();

        audio.play().then(() => {
            const duration = audio.duration;
            if (isFinite(duration) && duration > 0) {
                completionPoll = setInterval(() => {
                    if (audio.currentTime >= duration - 0.15) {
                        finish();
                    }
                }, 100);
            }
        }).catch(reject);
    });

    try {
        await playedThrough;
    } finally {
        recorder.stop();
        await recordingStopped;
        release();
        cleanupPlayback();

        audio.currentTime = 0;
        if (wasPaused) {
            audio.pause();
        }
    }

    const recordedBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });

    // MediaRecorder can't produce mp3 directly, so convert the recording
    // afterward: decode it back to raw audio, then re-encode with lamejs.
    // falls back to the original recording if that library isn't available
    // or the conversion fails for any reason.
    let finalBlob = recordedBlob;
    let extension = recordedBlob.type.includes('mp4') ? 'm4a' : 'webm';

    if (window.lamejs) {
        try {
            if (onProgress) onProgress(0, 0, 'encoding');

            if (!sharedAudioContext) {
                sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            const arrayBuffer = await recordedBlob.arrayBuffer();
            const audioBuffer = await sharedAudioContext.decodeAudioData(arrayBuffer);
            finalBlob = encodeMp3(audioBuffer);
            extension = 'mp3';
        } catch (error) {
            console.error('Error encoding mp3, downloading the original recording instead:', error);
        }
    }

    const url = URL.createObjectURL(finalBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title} (remix).${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function floatTo16BitPCM(floatArray) {
    const output = new Int16Array(floatArray.length);
    for (let i = 0; i < floatArray.length; i++) {
        const s = Math.max(-1, Math.min(1, floatArray[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output;
}

function encodeMp3(audioBuffer) {
    const channels = Math.min(audioBuffer.numberOfChannels, 2); // lamejs only supports mono/stereo
    const sampleRate = audioBuffer.sampleRate;
    const kbps = 192;
    const mp3Encoder = new window.lamejs.Mp3Encoder(channels, sampleRate, kbps);

    const left = floatTo16BitPCM(audioBuffer.getChannelData(0));
    const right = channels === 2 ? floatTo16BitPCM(audioBuffer.getChannelData(1)) : null;

    const mp3Data = [];
    const sampleBlockSize = 1152; // required block size for lamejs

    for (let i = 0; i < left.length; i += sampleBlockSize) {
        const leftChunk = left.subarray(i, i + sampleBlockSize);
        const mp3buf = right
            ? mp3Encoder.encodeBuffer(leftChunk, right.subarray(i, i + sampleBlockSize))
            : mp3Encoder.encodeBuffer(leftChunk);
        if (mp3buf.length > 0) mp3Data.push(mp3buf);
    }

    const finalBuf = mp3Encoder.flush();
    if (finalBuf.length > 0) mp3Data.push(finalBuf);

    return new Blob(mp3Data, { type: 'audio/mp3' });
}
