const elementoFalso = () => ({
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    classList: { contains: () => false, add: () => {}, remove: () => {}, toggle: () => {} },
    querySelector: () => elementoFalso(),
    querySelectorAll: () => [],
    replaceChildren: () => {},
    appendChild: () => {},
    removeChild: () => {},
    append: () => {},
    setAttribute: () => {},
    removeAttribute: () => {},
    dataset: {},
    style: {},
});

if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        body: elementoFalso(),
        getElementById: () => elementoFalso(),
        querySelector: () => elementoFalso(),
        querySelectorAll: () => [],
        createElement: () => elementoFalso(),
        addEventListener: () => {},
        dispatchEvent: () => {},
    };
}
if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
        addEventListener: () => {},
    };
}
if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map();
    globalThis.localStorage = {
        getItem: k => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k),
        clear: () => store.clear(),
    };
}

const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { pedidoDeProntidao } = await import('../mesa.js');
const { getScenesSnapshot } = await import('../scenes.js');

test('pedidoDeProntidao rejeita ref de outro app ou tipo inválido', () => {
    const r1 = pedidoDeProntidao({ ref: { app: 'atlas', tipo: 'mapa', id: 'm1' } });
    assert.equal(r1.ok, false);
    assert.match(r1.motivo, /só avalia cenas sonoras suas/);

    const r2 = pedidoDeProntidao({ ref: { app: 'jukebox', tipo: 'efeito', id: 'sfx-1' } });
    assert.equal(r2.ok, false);
    assert.match(r2.motivo, /só avalia cenas sonoras suas/);
});

test('pedidoDeProntidao devolve erro para cena inexistente', () => {
    const r = pedidoDeProntidao({ ref: { app: 'jukebox', tipo: 'cena-sonora', id: 'cena-fantasma' } });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /não encontrada/);
});

test('pedidoDeProntidao devolve prontidão com total e faltando para cena existente', () => {
    const cenas = getScenesSnapshot();
    assert.ok(cenas.length > 0, 'Deve ter ao menos uma cena padrão');
    const cena = cenas[0];

    const r = pedidoDeProntidao({ ref: { app: 'jukebox', tipo: 'cena-sonora', id: cena.id } });
    assert.equal(r.ok, true);
    assert.equal(r.nome, cena.name);
    assert.equal(r.total, cena.tracks.length);
    assert.equal(typeof r.faltando, 'number');
});
