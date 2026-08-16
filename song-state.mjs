const songStates = new Map();

function createDefaultState(songId) {
    return {
        id: songId,
        audio: null,
        audioSource: null,
        element: null,
        status: 'stopped', // stopped | playing | player-paused
        currentTime: 0,
        volume: 1,
        markers: [],
        markerLabels: {},
        markerColors: {},
        region: null,
        activeEffects: [],
        selectionFadeEnabled: false,
        selectionStopEnabled: false,
        hotkey: {
            key: null,
            effects: [],
            pendingEffects: null
        }
    };
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

export function getPlayingSongStates() {
    return getAllSongStates().filter(state => state.status === 'playing');
}

export function getVisiblePlayerSongStates() {
    return getAllSongStates().filter(state =>
        state.status === 'playing' || state.status === 'player-paused'
    );
}

export function removeSongState(songId) {
    return songStates.delete(songId);
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
}
