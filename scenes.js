import {
    configureSongForScene,
    fadeIn,
    fadeOut,
    getSongSceneSnapshot,
    stopSong
} from './player.js';
import { getAllSongStates } from './song-state.mjs';
import { getHotkeyMode } from './upload-song.js';
import { DEFAULT_SCENES } from './default-scenes.js';

const SCENE_STORAGE_KEY = 'jukebox-scenes-v1';

const showScenesButton = document.getElementById('show-scenes-button');
const closeScenesButton = document.getElementById('close-scenes-button');
const createSceneButton = document.getElementById('create-scene-button');
const scenePanel = document.getElementById('scene-panel');
const sceneList = document.getElementById('scene-list');
const dialogOverlay = document.getElementById('scene-dialog-overlay');
const dialog = document.getElementById('scene-dialog');
const dialogTitle = document.getElementById('scene-dialog-title');
const dialogDescription = document.getElementById('scene-dialog-description');
const sceneNameInput = document.getElementById('scene-name-input');
const dialogCancel = document.getElementById('scene-dialog-cancel');
const dialogConfirm = document.getElementById('scene-dialog-confirm');

let scenes = loadScenes();
let activeSceneId = null;
let pendingDialogAction = null;
let toastTimer = null;

function loadScenes() {
    try {
        const parsed = JSON.parse(localStorage.getItem(SCENE_STORAGE_KEY) || '[]');
        const valid = Array.isArray(parsed)
            ? parsed.filter(scene =>
                scene && typeof scene.id === 'string' && typeof scene.name === 'string' && Array.isArray(scene.tracks)
            )
            : [];

        let modified = false;
        const existingNames = new Set(valid.map(s => s.name.trim().toLowerCase()));
        const existingIds = new Set(valid.map(s => s.id));

        DEFAULT_SCENES.forEach(defaultScene => {
            const key = defaultScene.name.trim().toLowerCase();
            if (!existingNames.has(key) && !existingIds.has(defaultScene.id)) {
                valid.push(structuredClone(defaultScene));
                existingNames.add(key);
                existingIds.add(defaultScene.id);
                modified = true;
            }
        });

        valid.forEach(scene => {
            if (scene.name.includes('Reed') && scene.tracks.length === 0) {
                const reedTemplate = DEFAULT_SCENES.find(s => s.name.includes('Reed'));
                if (reedTemplate) {
                    scene.tracks = structuredClone(reedTemplate.tracks);
                    modified = true;
                }
            }
        });

        if (modified || valid.length !== (Array.isArray(parsed) ? parsed.length : 0)) {
            try {
                localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify(valid));
            } catch {}
        }
        return valid;
    } catch (error) {
        console.error('Could not load scenes:', error);
        return structuredClone(DEFAULT_SCENES);
    }
}

function saveScenes() {
    try {
        localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify(scenes));
    } catch (error) {
        console.error('Could not save scenes:', error);
        showSceneToast('Scenes work for this session, but could not be saved.', true);
    }
}

export function getScenesSnapshot() {
    return structuredClone(scenes);
}

export function importPresetScenes(incomingScenes) {
    if (!Array.isArray(incomingScenes) || incomingScenes.length === 0) return 0;

    const valid = incomingScenes.filter(scene =>
        scene && typeof scene.id === 'string' && typeof scene.name === 'string' && Array.isArray(scene.tracks)
    );
    if (valid.length === 0) return 0;

    let importedCount = 0;
    valid.forEach(newScene => {
        const existingIndex = scenes.findIndex(s =>
            s.id === newScene.id || s.name.trim().toLowerCase() === newScene.name.trim().toLowerCase()
        );
        if (existingIndex !== -1) {
            scenes[existingIndex] = structuredClone(newScene);
        } else {
            scenes.push(structuredClone(newScene));
        }
        importedCount++;
    });

    saveScenes();
    renderScenes();
    showSceneToast(`Loaded ${importedCount} ${importedCount === 1 ? 'scene' : 'scenes'} from preset.`);
    return importedCount;
}

function createSceneId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return `scene-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSongIdentity(state) {
    const titleInput = state.element?.querySelector('.title-input');
    return {
        songId: state.id,
        title: titleInput?.value?.trim() || 'Unknown',
        originalTitle: titleInput?.defaultValue?.trim() || '',
        sourceName: state.audioSource?.name || '',
        presetTitle: state.element?.dataset?.presetTitle || '',
        fileTitle: state.element?.dataset?.fileTitle || ''
    };
}

function captureCurrentMix() {
    return getAllSongStates()
        .filter(state => {
            if (!state.audio) return false;
            // Capture actively playing tracks or tracks staged in the player
            return (state.status === 'playing' && !state.audio.paused) ||
                   (state.status === 'player-paused');
        })
        .map(state => ({
            ...getSongIdentity(state),
            ...getSongSceneSnapshot(state.id)
        }));
}

function captureMasterVolume() {
    const value = Number(document.getElementById('master-volume-slider')?.value);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function applyMasterVolume(value) {
    const slider = document.getElementById('master-volume-slider');
    if (!slider || !Number.isFinite(Number(value))) return;
    slider.value = String(Math.max(0, Math.min(1, Number(value))));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
}

function normalizeTitle(str) {
    if (!str) return '';
    try {
        return decodeURIComponent(str).trim().toLowerCase();
    } catch {
        return String(str).trim().toLowerCase();
    }
}

function matchesSceneTrack(state, track) {
    if (track.songId && track.songId === state.id) return true;

    const identity = getSongIdentity(state);
    const trackKeys = [
        normalizeTitle(track.title),
        normalizeTitle(track.originalTitle),
        normalizeTitle(track.sourceName?.replace(/\.[^.]+$/, '')),
        normalizeTitle(track.presetTitle),
        normalizeTitle(track.fileTitle)
    ].filter(Boolean);

    const stateKeys = [
        normalizeTitle(identity.title),
        normalizeTitle(identity.originalTitle),
        normalizeTitle(identity.sourceName?.replace(/\.[^.]+$/, '')),
        normalizeTitle(identity.presetTitle),
        normalizeTitle(identity.fileTitle)
    ].filter(Boolean);

    return trackKeys.some(tk => stateKeys.includes(tk));
}

function resolveSceneTrack(track) {
    return getAllSongStates().find(state => matchesSceneTrack(state, track)) || null;
}

function countMissingTracks(scene) {
    return scene.tracks.reduce((count, track) => count + (resolveSceneTrack(track) ? 0 : 1), 0);
}

function showSceneToast(message, isError = false) {
    let toast = scenePanel.querySelector('.scene-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'scene-toast';
        toast.setAttribute('role', 'status');
        scenePanel.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

function openScenePanel() {
    scenePanel.classList.add('active');
    scenePanel.setAttribute('aria-hidden', 'false');
    showScenesButton.textContent = 'Hide Scenes';
    showScenesButton.setAttribute('aria-expanded', 'true');

    const hotkeyPanel = document.getElementById('hotkey-panel');
    const hotkeyButton = document.getElementById('show-hotkeys-button');
    hotkeyPanel?.classList.remove('active');
    if (hotkeyButton) hotkeyButton.textContent = 'Show Hotkeys';

    document.dispatchEvent(new CustomEvent('jukeboxPanelOpened', { detail: 'scenes' }));
    renderScenes();
}

function closeScenePanel() {
    scenePanel.classList.remove('active');
    scenePanel.setAttribute('aria-hidden', 'true');
    showScenesButton.textContent = 'Scenes';
    showScenesButton.setAttribute('aria-expanded', 'false');
}

function toggleScenePanel() {
    if (scenePanel.classList.contains('active')) closeScenePanel();
    else openScenePanel();
}

function closeDialog() {
    dialogOverlay.hidden = true;
    pendingDialogAction = null;
}

function openDialog({ title, description, confirmText, name = '', destructive = false, showInput = true, onConfirm }) {
    dialogTitle.textContent = title;
    dialogDescription.textContent = description;
    dialogConfirm.textContent = confirmText;
    dialogConfirm.classList.toggle('destructive', destructive);
    sceneNameInput.hidden = !showInput;
    sceneNameInput.value = name;
    dialogOverlay.hidden = false;
    pendingDialogAction = onConfirm;

    requestAnimationFrame(() => {
        if (showInput) {
            sceneNameInput.focus();
            sceneNameInput.select();
        } else {
            dialogConfirm.focus();
        }
    });
}

function createScene() {
    const tracks = captureCurrentMix();
    if (tracks.length === 0) {
        showSceneToast('Cannot save scene: no songs are playing or in Now Playing.', true);
        return;
    }
    openDialog({
        title: 'Save Current Mix',
        description: `This scene will remember ${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}, including volumes, positions and effects.`,
        confirmText: 'Save Scene',
        name: `Scene ${scenes.length + 1}`,
        onConfirm: name => {
            scenes.push({
                id: createSceneId(),
                name,
                createdAt: Date.now(),
                masterVolume: captureMasterVolume(),
                tracks
            });
            saveScenes();
            renderScenes();
            showSceneToast(`Scene “${name}” saved.`);
        }
    });
}

function updateScene(scene) {
    const tracks = captureCurrentMix();
    if (tracks.length === 0) {
        showSceneToast(`Cannot update “${scene.name}”: no songs are currently playing or in Now Playing.`, true);
        return;
    }
    openDialog({
        title: `Update “${scene.name}”?`,
        description: `Replace it with the current mix of ${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}?`,
        confirmText: 'Update Scene',
        showInput: false,
        onConfirm: () => {
            scene.tracks = tracks;
            scene.masterVolume = captureMasterVolume();
            scene.updatedAt = Date.now();
            saveScenes();
            renderScenes();
            showSceneToast(`Scene “${scene.name}” updated.`);
        }
    });
}

function deleteScene(scene) {
    openDialog({
        title: `Delete “${scene.name}”?`,
        description: 'The songs themselves will not be deleted.',
        confirmText: 'Delete Scene',
        destructive: true,
        showInput: false,
        onConfirm: () => {
            scenes = scenes.filter(candidate => candidate.id !== scene.id);
            if (activeSceneId === scene.id) activeSceneId = null;
            saveScenes();
            renderScenes();
        }
    });
}

function getCurrentHotkeyMode() {
    try {
        if (typeof getHotkeyMode === 'function') return getHotkeyMode();
    } catch {}
    const text = document.getElementById('hotkey-mode-button')?.textContent?.toLowerCase() || '';
    if (text.includes('cut')) return 'cut';
    if (text.includes('insert')) return 'insert';
    return 'fade';
}

function deactivateCurrentScene() {
    const mode = getCurrentHotkeyMode();
    getAllSongStates().forEach(state => {
        if (state.status === 'playing' && !state.audio?.paused) {
            if (mode === 'fade') {
                fadeOut(state.id);
            } else {
                stopSong(state.id);
            }
        } else if (state.status === 'player-paused') {
            stopSong(state.id);
        }
    });

    const previousScene = scenes.find(s => s.id === activeSceneId);
    activeSceneId = null;
    renderScenes();
    if (previousScene) {
        showSceneToast(`Scene “${previousScene.name}” stopped.`);
    }
}

function activateScene(scene) {
    if (activeSceneId === scene.id) {
        deactivateCurrentScene();
        return;
    }

    if (!scene.tracks || scene.tracks.length === 0) {
        showSceneToast(`Scene “${scene.name}” has no songs saved.`, true);
        return;
    }

    const resolvedTracks = scene.tracks
        .map(track => ({ track, state: resolveSceneTrack(track) }))
        .filter(entry => entry.state);
    const targetSongIds = new Set(resolvedTracks.map(entry => entry.state.id));

    getAllSongStates().forEach(state => {
        if (targetSongIds.has(state.id)) return;
        if (state.status === 'playing' && !state.audio?.paused) fadeOut(state.id);
        else if (state.status === 'player-paused') stopSong(state.id);
    });

    resolvedTracks.forEach(({ track, state }) => {
        configureSongForScene(state.id, track);
        fadeIn(state.id);
    });

    activeSceneId = scene.id;
    renderScenes();
    const missing = scene.tracks.length - resolvedTracks.length;
    showSceneToast(
        missing > 0
            ? `Scene activated. ${missing} ${missing === 1 ? 'song was' : 'songs were'} not found.`
            : `Scene “${scene.name}” activated.`,
        missing > 0
    );
}

function renderScenes() {
    sceneList.replaceChildren();

    if (scenes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'scene-empty';
        empty.textContent = 'No scenes saved yet. Start a mix, adjust it, then save it here.';
        sceneList.appendChild(empty);
        return;
    }

    scenes.forEach(scene => {
        const item = document.createElement('article');
        item.className = 'scene-item';
        item.classList.toggle('active', scene.id === activeSceneId);

        const details = document.createElement('div');
        details.className = 'scene-details';

        const nameInput = document.createElement('input');
        nameInput.className = 'scene-name';
        nameInput.value = scene.name;
        nameInput.maxLength = 60;
        nameInput.setAttribute('aria-label', 'Scene name');
        nameInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') nameInput.blur();
            if (event.key === 'Escape') {
                nameInput.value = scene.name;
                nameInput.blur();
            }
        });
        nameInput.addEventListener('change', () => {
            const nextName = nameInput.value.trim();
            if (!nextName) {
                nameInput.value = scene.name;
                return;
            }
            scene.name = nextName;
            saveScenes();
        });

        const missing = countMissingTracks(scene);
        const summary = document.createElement('span');
        summary.className = 'scene-summary';
        summary.textContent = scene.tracks.length === 0
            ? 'Silence · fades out all songs'
            : `${scene.tracks.length} ${scene.tracks.length === 1 ? 'song' : 'songs'}${missing ? ` · ${missing} missing` : ''}`;
        summary.classList.toggle('has-missing', missing > 0);
        details.append(nameInput, summary);

        const actions = document.createElement('div');
        actions.className = 'scene-actions';

        const activateButton = document.createElement('button');
        activateButton.type = 'button';
        activateButton.className = 'scene-activate';
        activateButton.textContent = scene.id === activeSceneId ? 'Active' : 'Activate';
        activateButton.addEventListener('click', () => activateScene(scene));

        const updateButton = document.createElement('button');
        updateButton.type = 'button';
        updateButton.textContent = 'Update';
        updateButton.title = 'Replace this scene with the current mix';
        updateButton.addEventListener('click', () => updateScene(scene));

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'scene-delete';
        deleteButton.textContent = '×';
        deleteButton.title = 'Delete scene';
        deleteButton.setAttribute('aria-label', `Delete ${scene.name}`);
        deleteButton.addEventListener('click', () => deleteScene(scene));

        actions.append(activateButton, updateButton, deleteButton);
        item.append(details, actions);
        sceneList.appendChild(item);
    });
}

showScenesButton.addEventListener('click', toggleScenePanel);
closeScenesButton.addEventListener('click', closeScenePanel);
createSceneButton.addEventListener('click', createScene);

dialog.addEventListener('submit', event => {
    event.preventDefault();
    if (!pendingDialogAction) return;
    const value = sceneNameInput.hidden ? '' : sceneNameInput.value.trim();
    if (!sceneNameInput.hidden && !value) {
        sceneNameInput.focus();
        return;
    }
    const action = pendingDialogAction;
    closeDialog();
    action(value);
});

dialogCancel.addEventListener('click', closeDialog);
dialogOverlay.addEventListener('mousedown', event => {
    if (event.target === dialogOverlay) closeDialog();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !dialogOverlay.hidden) closeDialog();
});
document.addEventListener('songsUpdated', () => {
    if (scenePanel.classList.contains('active')) renderScenes();
});
document.addEventListener('jukeboxPanelOpened', event => {
    if (event.detail !== 'scenes') closeScenePanel();
});
document.getElementById('stop-all-button')?.addEventListener('click', () => {
    if (activeSceneId !== null) {
        activeSceneId = null;
        if (scenePanel.classList.contains('active')) renderScenes();
    }
});

renderScenes();
