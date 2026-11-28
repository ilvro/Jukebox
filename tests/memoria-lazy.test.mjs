import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_AUDIO_POOL,
    MAX_THUMBNAIL_CACHE,
    MAX_WAVEFORM_DECODE_BYTES,
    MAX_WAVEFORM_DECODE_SECONDS,
    clearSongStateRegistryForTests,
    getAllSongStates,
    registerSongState,
    removeSongState,
    selectEvictableAudioIds,
    shouldSkipWaveformDecode
} from '../song-state.mjs';

test('batch registration of 500 songs keeps audio null and zero blob URLs', () => {
    clearSongStateRegistryForTests();

    for (let i = 0; i < 500; i++) {
        registerSongState(`song-${i}`, {
            audio: null,
            audioFile: { name: `track-${i}.mp3`, size: 1024 },
            thumbnailFile: { name: `cover-${i}.jpg`, size: 512 },
            audioBlobUrl: null,
            thumbnailBlobUrl: null,
            lastUsedAt: 0
        });
    }

    const states = getAllSongStates();
    assert.equal(states.length, 500);
    assert.ok(states.every(state => state.audio === null));
    assert.ok(states.every(state => state.audioBlobUrl === null));
    assert.ok(states.every(state => state.thumbnailBlobUrl === null));

    clearSongStateRegistryForTests();
});

test('selectEvictableAudioIds respects MAX_AUDIO_POOL and never evicts playing or player-paused tracks', () => {
    clearSongStateRegistryForTests();

    const states = [
        registerSongState('playing-old', { audio: {}, status: 'playing', lastUsedAt: 1 }),
        registerSongState('paused-old', { audio: {}, status: 'player-paused', lastUsedAt: 2 }),
        registerSongState('stopped-oldest', { audio: {}, status: 'stopped', lastUsedAt: 10 }),
        registerSongState('stopped-second', { audio: {}, status: 'stopped', lastUsedAt: 20 }),
        registerSongState('stopped-third', { audio: {}, status: 'stopped', lastUsedAt: 30 }),
        registerSongState('stopped-fourth', { audio: {}, status: 'stopped', lastUsedAt: 40 }),
        registerSongState('stopped-fifth', { audio: {}, status: 'stopped', lastUsedAt: 50 }),
        registerSongState('stopped-sixth', { audio: {}, status: 'stopped', lastUsedAt: 60 }),
        registerSongState('stopped-seventh', { audio: {}, status: 'stopped', lastUsedAt: 70 }),
        registerSongState('just-created', { audio: {}, status: 'stopped', lastUsedAt: 100 }),
        registerSongState('never-loaded', { audio: null, status: 'stopped', lastUsedAt: 0 })
    ];

    assert.equal(MAX_AUDIO_POOL, 8);
    assert.equal(MAX_THUMBNAIL_CACHE, 60);

    const toEvict = selectEvictableAudioIds(states, MAX_AUDIO_POOL, 'just-created');
    assert.deepEqual(toEvict, ['stopped-oldest', 'stopped-second']);
    assert.ok(!toEvict.includes('playing-old'));
    assert.ok(!toEvict.includes('paused-old'));
    assert.ok(!toEvict.includes('just-created'));

    clearSongStateRegistryForTests();
});

test('shouldSkipWaveformDecode blocks files over 15 MB or 600s', () => {
    assert.equal(shouldSkipWaveformDecode({ byteSize: MAX_WAVEFORM_DECODE_BYTES, durationSeconds: 600 }), false);
    assert.equal(shouldSkipWaveformDecode({ byteSize: MAX_WAVEFORM_DECODE_BYTES + 1 }), true);
    assert.equal(shouldSkipWaveformDecode({ durationSeconds: MAX_WAVEFORM_DECODE_SECONDS + 1 }), true);
    assert.equal(shouldSkipWaveformDecode({}), false);
});

test('clearing all song states resets the registry cleanly', () => {
    clearSongStateRegistryForTests();
    registerSongState('a', { audio: {}, audioBlobUrl: 'blob:1', thumbnailBlobUrl: 'blob:2' });
    registerSongState('b', { audio: {}, audioBlobUrl: 'blob:3', thumbnailBlobUrl: 'blob:4' });
    assert.equal(getAllSongStates().length, 2);

    removeSongState('a');
    assert.equal(getAllSongStates().length, 1);

    clearSongStateRegistryForTests();
    assert.equal(getAllSongStates().length, 0);
});
