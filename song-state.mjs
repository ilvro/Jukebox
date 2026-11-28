const songStates = new Map();
let nextSongOrder = 0;

export const MAX_AUDIO_POOL = 8;
export const MAX_THUMBNAIL_CACHE = 60;
export const MAX_WAVEFORM_DECODE_BYTES = 15 * 1024 * 1024;
export const MAX_WAVEFORM_DECODE_SECONDS = 600;

function createDefaultState(songId) {
    return {
        id: songId,
        order: nextSongOrder++,
        audio: null,
        audioSource: null,
        audioFile: null,
        audioFileHandle: null,
        audioStaticUrl: null,
        audioBlobUrl: null,
        imageSource: null,
        thumbnailFile: null,
        thumbnailStaticUrl: null,
        thumbnailBlobUrl: null,
        lastUsedAt: 0,
        element: null,
        status: 'stopped', // stopped | playing | player-paused
        currentTime: 0,
        volume: 1,
        markers: [],
        markerLabels: {},
        markerColors: {},
        markerEvents: {},
        region: null,
        activeEffects: [],
        effectSettings: {},
        selectionFadeEnabled: false,
        selectionStopEnabled: false,
        hotkey: {
            key: null,
            effects: [],
            pendingEffects: null
        }
    };
}

export function selectEvictableAudioIds(states, maxActive = MAX_AUDIO_POOL, protectedId = null) {
    const stateList = Array.from(states || []);
    const activeStates = stateList.filter(state => Boolean(state?.audio));
    if (activeStates.length <= maxActive) return [];

    const excess = activeStates.length - maxActive;
    const evictable = activeStates
        .filter(state =>
            state.id !== protectedId &&
            state.status !== 'playing' &&
            state.status !== 'player-paused'
        )
        .sort((left, right) => {
            const timeDiff = (left.lastUsedAt || 0) - (right.lastUsedAt || 0);
            if (timeDiff !== 0) return timeDiff;
            return (left.order || 0) - (right.order || 0);
        });

    return evictable.slice(0, excess).map(state => state.id);
}

export function shouldSkipWaveformDecode({ byteSize = null, durationSeconds = null } = {}) {
    if (Number.isFinite(byteSize) && byteSize > MAX_WAVEFORM_DECODE_BYTES) return true;
    if (Number.isFinite(durationSeconds) && durationSeconds > MAX_WAVEFORM_DECODE_SECONDS) return true;
    return false;
}

export function ensureSongState(songId) {
    if (!songStates.has(songId)) songStates.set(songId, createDefaultState(songId));
    return songStates.get(songId);
}

export function registerSongState(songId, values = {}) {
    const state = ensureSongState(songId);
    Object.assign(state, values);
    return state;
}

export function getSongState(songId) {
    return songStates.get(songId);
}

export function getAllSongStates() {
    return [...songStates.values()];
}

export function getOrderedSongStates() {
    return getAllSongStates().sort((left, right) => left.order - right.order);
}

export function reorderSongState(songId, targetIndex) {
    const orderedStates = getOrderedSongStates();
    const currentIndex = orderedStates.findIndex(state => state.id === songId);
    if (currentIndex < 0) return false;

    const [movedState] = orderedStates.splice(currentIndex, 1);
    const boundedTarget = Math.max(0, Math.min(targetIndex, orderedStates.length));
    orderedStates.splice(boundedTarget, 0, movedState);
    orderedStates.forEach((state, index) => {
        state.order = index;
    });
    nextSongOrder = orderedStates.length;
    return true;
}

export function getPlayingSongStates() {
    return getAllSongStates().filter(state => state.status === 'playing');
}

export function getVisiblePlayerSongStates() {
    return getAllSongStates().filter(state =>
        state.status === 'playing' || state.status === 'player-paused'
    );
}

export function removeSongState(songId) {
    const removed = songStates.delete(songId);
    if (songStates.size === 0) nextSongOrder = 0;
    return removed;
}

export function setSongStatus(songId, status) {
    const allowedStatuses = new Set(['stopped', 'playing', 'player-paused']);
    if (!allowedStatuses.has(status)) throw new Error(`Invalid song status: ${status}`);
    ensureSongState(songId).status = status;
}

export function getHotkeyEntries() {
    return getAllSongStates()
        .filter(state => state.hotkey.key)
        .map(state => [state.hotkey.key, state.id]);
}

export function getSongIdForHotkey(key) {
    return getAllSongStates().find(state => state.hotkey.key === key)?.id || null;
}

export function assignSongHotkey(songId, key, effects = []) {
    getAllSongStates().forEach(state => {
        if (state.id !== songId && state.hotkey.key === key) {
            state.hotkey.key = null;
            state.hotkey.effects = [];
        }
    });
    const state = ensureSongState(songId);
    state.hotkey.key = key;
    state.hotkey.effects = [...effects];
    return state.hotkey;
}

export function clearSongHotkey(songId) {
    const state = getSongState(songId);
    if (!state) return false;
    const hadHotkey = Boolean(state.hotkey.key);
    state.hotkey.key = null;
    state.hotkey.effects = [];
    state.hotkey.pendingEffects = null;
    return hadHotkey;
}

export function setSongHotkeyEffects(songId, effects) {
    const state = ensureSongState(songId);
    state.hotkey.effects = [...effects];
    return state.hotkey.effects;
}

function createFieldView(field, { deletedValue = undefined } = {}) {
    return new Proxy(Object.create(null), {
        get(_target, property) {
            if (typeof property !== 'string') return undefined;
            const state = getSongState(property);
            return state ? state[field] : undefined;
        },
        set(_target, property, value) {
            if (typeof property !== 'string') return false;
            ensureSongState(property)[field] = value;
            return true;
        },
        deleteProperty(_target, property) {
            if (typeof property !== 'string') return false;
            const state = getSongState(property);
            if (state) state[field] = typeof deletedValue === 'function' ? deletedValue() : deletedValue;
            return true;
        },
        ownKeys() {
            return getAllSongStates()
                .filter(state => state[field] !== undefined && state[field] !== null)
                .map(state => state.id);
        },
        getOwnPropertyDescriptor(_target, property) {
            const state = getSongState(property);
            if (!state || state[field] === undefined || state[field] === null) return undefined;
            return { enumerable: true, configurable: true };
        }
    });
}

export const songMarkersView = createFieldView('markers', { deletedValue: () => [] });
export const songMarkerLabelsView = createFieldView('markerLabels', { deletedValue: () => ({}) });
export const songMarkerColorsView = createFieldView('markerColors', { deletedValue: () => ({}) });
export const songMarkerEventsView = createFieldView('markerEvents', { deletedValue: () => ({}) });
export const songRegionsView = createFieldView('region', { deletedValue: null });
export const songActiveEffectsView = createFieldView('activeEffects', { deletedValue: () => [] });
export const songSelectionFadeEffectsView = createFieldView('selectionFadeEnabled', { deletedValue: false });
export const songSelectionStopEffectsView = createFieldView('selectionStopEnabled', { deletedValue: false });

export const pendingHotkeyEffectsView = {
    get(songId) {
        return getSongState(songId)?.hotkey.pendingEffects ?? undefined;
    },
    set(songId, effects) {
        ensureSongState(songId).hotkey.pendingEffects = [...effects];
        return this;
    },
    has(songId) {
        return getSongState(songId)?.hotkey.pendingEffects !== null;
    },
    delete(songId) {
        const state = getSongState(songId);
        if (!state || state.hotkey.pendingEffects === null) return false;
        state.hotkey.pendingEffects = null;
        return true;
    }
};

export function clearSongStateRegistryForTests() {
    songStates.clear();
    nextSongOrder = 0;
}
