import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarCena } from '../scene-build.js';

test('montarCena grava o formato de createScene, com volume pedido ou o da faixa', () => {
    const identidade = { songId: 's1', title: 'Sombras', originalTitle: 'Sombras', sourceName: 'Sombras.mp3', presetTitle: '', fileTitle: '' };
    const c = montarCena({ id: 'x', nome: 'Pântano', agora: 5, faixas: [
        { identidade, snapshot: { volume: 0.4, activeEffects: ['smoothLoop'] }, volume: undefined },
        { identidade: { ...identidade, songId: 's2' }, snapshot: null, volume: 0.2 },
    ] });
    assert.equal(c.name, 'Pântano');
    assert.equal(c.createdAt, 5);
    assert.equal(c.masterVolume, 1);
    assert.equal(c.tracks[0].volume, 0.4);
    assert.deepEqual(c.tracks[0].activeEffects, ['smoothLoop']);
    assert.equal(c.tracks[1].volume, 0.2);
    assert.equal(c.tracks[1].region, null);
    assert.equal(c.tracks[1].songId, 's2');
});
