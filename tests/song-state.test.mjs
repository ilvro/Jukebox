import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assignSongHotkey,
    clearSongHotkey,
    clearSongStateRegistryForTests,
    getHotkeyEntries,
    getSongIdForHotkey,
    getSongState,
    getVisiblePlayerSongStates,
    registerSongState,
    removeSongState,
    setSongStatus
} from '../song-state.mjs';

test.beforeEach(() => clearSongStateRegistryForTests());

test('keeps playback, media and region in one song record', () => {
    const audio = { paused: false };
    registerSongState('song-1', {
        audio,
        status: 'playing',
        region: { start: 0, end: 4.9 }
    });

    const state = getSongState('song-1');
    assert.equal(state.audio, audio);
    assert.equal(state.status, 'playing');
    assert.deepEqual(state.region, { start: 0, end: 4.9 });
});

test('tracks player-paused as a visible but non-playing state', () => {
    const audio = {};
    registerSongState('song-1', { audio, status: 'playing' });
    setSongStatus('song-1', 'player-paused');

    assert.equal(getSongState('song-1').status, 'player-paused');
    assert.deepEqual(getVisiblePlayerSongStates().map(state => state.id), ['song-1']);
});

test('assigning a hotkey moves ownership to one song', () => {
    registerSongState('song-1');
    registerSongState('song-2');
    assignSongHotkey('song-1', '1', ['smoothLoop']);
    assignSongHotkey('song-2', '1', ['reverb']);

    assert.equal(getSongIdForHotkey('1'), 'song-2');
    assert.deepEqual(getHotkeyEntries(), [['1', 'song-2']]);
    assert.equal(getSongState('song-1').hotkey.key, null);
    assert.deepEqual(getSongState('song-1').hotkey.effects, []);

    clearSongHotkey('song-2');
    assert.equal(getSongIdForHotkey('1'), null);
    assert.deepEqual(getSongState('song-2').hotkey.effects, []);
});

test('removing a song removes every part of its state', () => {
    registerSongState('song-1', { audio: {} });
    assignSongHotkey('song-1', '4', ['loop']);
    removeSongState('song-1');

    assert.equal(getSongState('song-1'), undefined);
    assert.equal(getSongIdForHotkey('4'), null);
});
