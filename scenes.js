import {
    configureSongForScene,
    fadeIn,
    fadeOut,
    getSongSceneSnapshot,
    stopSong
} from './player.js';
import { getAllSongStates } from './song-state.mjs';

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
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(scene =>
            scene && typeof scene.id === 'string' && typeof scene.name === 'string' && Array.isArray(scene.tracks)
        );
    } catch (error) {
        console.error('Could not load scenes:', error);
        return [];
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
        sourceName: state.audioSource?.name || ''
    };
}

function captureCurrentMix() {
    return getAllSongStates()
        .filter(state => state.status === 'playing' && state.audio && !state.audio.paused)
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

function matchesSceneTrack(state, track) {
    const identity = getSongIdentity(state);
    return (track.songId && track.songId === state.id) ||
        (track.sourceName && track.sourceName === identity.sourceName) ||
        (track.originalTitle && track.originalTitle === identity.originalTitle) ||
        track.title === identity.title;
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
    openDialog({
        title: 'Save Current Mix',
        description: tracks.length === 0
            ? 'No songs are playing. This will create a Silence scene that fades everything out.'
            : `This scene will remember ${tracks.length} playing ${tracks.length === 1 ? 'song' : 'songs'}, including volumes, positions and effects.`,
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
    openDialog({
        title: `Update “${scene.name}”?`,
        description: tracks.length === 0
            ? 'The scene will become a Silence scene and fade out every song.'
            : `Replace it with the current mix of ${tracks.length} playing ${tracks.length === 1 ? 'song' : 'songs'}?`,
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

function activateScene(scene) {
    const resolvedTracks = scene.tracks
        .map(track => ({ track, state: resolveSceneTrack(track) }))
        .filter(entry => entry.state);
    const targetSongIds = new Set(resolvedTracks.map(entry => entry.state.id));

    applyMasterVolume(scene.masterVolume);

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

renderScenes();
