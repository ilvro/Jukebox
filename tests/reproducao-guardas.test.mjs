import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSampleAssetUrls,
    clampSeekTime,
    computeProgressRatio,
    computeTimeFromRatio,
    formatTime,
    hasValidDuration
} from '../playback-guards.mjs';

test('formatTime guards NaN, Infinity, undefined, and negative values', () => {
    assert.equal(formatTime(NaN), '--:--');
    assert.equal(formatTime(Infinity), '--:--');
    assert.equal(formatTime(-Infinity), '--:--');
    assert.equal(formatTime(undefined), '--:--');
    assert.equal(formatTime(-1), '--:--');
    assert.equal(formatTime(-0.01, { fallback: '00:00' }), '00:00');
    assert.equal(formatTime(0), '00:00');
    assert.equal(formatTime(125), '02:05');
    assert.equal(formatTime(3665, { includeHours: true }), '1:01:05');
    assert.equal(formatTime(12.345, { showMilliseconds: true }), '00:12.345');
});

test('hasValidDuration, computeProgressRatio, and computeTimeFromRatio handle invalid durations safely', () => {
    assert.equal(hasValidDuration(NaN), false);
    assert.equal(hasValidDuration(0), false);
    assert.equal(hasValidDuration(-10), false);
    assert.equal(hasValidDuration(Infinity), false);
    assert.equal(hasValidDuration(180), true);

    assert.equal(computeProgressRatio(10, NaN), 0);
    assert.equal(computeProgressRatio(10, 0), 0);
    assert.equal(computeProgressRatio(NaN, 100), 0);
    assert.equal(computeProgressRatio(25, 100), 0.25);
    assert.equal(computeProgressRatio(150, 100), 1);

    assert.equal(computeTimeFromRatio(0.5, NaN), null);
    assert.equal(computeTimeFromRatio(0.5, 0), null);
    assert.equal(computeTimeFromRatio(NaN, 120), null);
    assert.equal(computeTimeFromRatio(0.5, 120), 60);
    assert.equal(computeTimeFromRatio(1.5, 120), 120);
    assert.equal(computeTimeFromRatio(-0.2, 120), 0);
});

test('clampSeekTime keeps seek targets bounded and non-negative', () => {
    assert.equal(clampSeekTime(-5, 100), 0);
    assert.equal(clampSeekTime(NaN, 100), 0);
    assert.equal(clampSeekTime(42, NaN), 42);
    assert.equal(clampSeekTime(120, 100), 99.999);
});

test('buildSampleAssetUrls preserves percent-encoded filenames for direct streaming', () => {
    const assets = buildSampleAssetUrls('Den%20of%20Iniquity%3F!');
    assert.equal(assets.decodedTitle, 'Den of Iniquity?!');
    assert.equal(assets.audioStaticUrl, './sample/Den%2520of%2520Iniquity%253F!.mp3');
    assert.equal(assets.thumbnailStaticUrl, './sample/Den%2520of%2520Iniquity%253F!.jpg');
});
