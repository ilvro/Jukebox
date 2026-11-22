import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarIndice, criarPublicador, montarMix, montarEfeito, mudouMix, atenderArquivo, sha256Hex } from '../mix.mjs';

const blobDe = (texto, type = 'audio/mpeg') => new Blob([texto], { type });
const estadoFalso = ({ audioEffects }) => ({
    volume: audioEffects.volume ?? 1,
    efeitos: audioEffects.efeitos ?? [],
    ajustes: audioEffects.ajustes ?? {},
    regioes: audioEffects.regioes ?? [],
});
const fonte = (chave, blob, extra = {}) => ({
    chave, obterBlob: async () => blob, titulo: chave,
    audio: { currentTime: 10, paused: false, playbackRate: 1, loop: false, ...extra.audio },
    audioEffects: { volume: 0.8, ...extra.efeitos }, progressBar: {}, ...extra.resto,
});
const cenaRef = { app: 'jukebox', tipo: 'cena-sonora', id: 'c1' };

async function mixCom(fontes, indice = criarIndice(), agora = () => 5000) {
    const opcoes = { cena: cenaRef, mestre: 0.7, fontes, indice, agora, estadoDaFaixa: estadoFalso };
    montarMix(opcoes); // a primeira passada só inicia os hashes
    await new Promise(r => setTimeout(r, 20));
    return montarMix(opcoes);
}

test('o mesmo arquivo dá sempre o mesmo faixaId, e arquivos diferentes dão ids diferentes', async () => {
    const a = await sha256Hex(blobDe('bytes de uma musica'));
    assert.equal(a, await sha256Hex(blobDe('bytes de uma musica', 'audio/ogg')));
    assert.notEqual(a, await sha256Hex(blobDe('outra musica')));
    assert.match(a, /^[0-9a-f]{64}$/);
    // o hash é calculado uma vez por fonte
    let chamadas = 0;
    const indice = criarIndice({ hash: async b => { chamadas++; return sha256Hex(b); } });
    const f = fonte('blob:1', blobDe('x'));
    const [primeira] = (await mixCom([f], indice)).faixas;
    await mixCom([f], indice);
    assert.equal(chamadas, 1);
    // outra fonte com os mesmos bytes (um crossfade do mesmo arquivo) tem o mesmo id
    const dois = await mixCom([f, fonte('blob:2', blobDe('x'))], indice);
    assert.equal(dois.faixas[1].faixaId, primeira.faixaId);
});

test('o mix traz cena, mestre e, por faixa, o estado do motor com efeitos, ajustes, regiões e volume efetivo', async () => {
    const regioes = [{ id: 'r1', start: 2, end: 9, effects: ['echo'], effectSettings: {} }];
    const musica = fonte('blob:musica', blobDe('musica'), {
        audio: { currentTime: 42.5, loop: true, playbackRate: 1.3 },
        efeitos: { volume: 0.35, efeitos: ['lowpass', 'echo'], ajustes: { lowpass: { frequency: 800 } }, regioes },
        resto: { titulo: 'Chuva na taverna', url: 'sample/Chuva.mp3' },
    });
    const pausada = fonte('blob:pausada', blobDe('pausada'), { audio: { paused: true, currentTime: 3 } });
    const mix = await mixCom([musica, pausada]);
    assert.deepEqual(mix.cena, cenaRef);
    assert.equal(mix.mestre, 0.7);
    assert.equal(mix.faixas.length, 2);
    const [m, p] = mix.faixas;
    assert.deepEqual(Object.keys(m).sort(), ['desde', 'estado', 'faixaId', 'loop', 'pausada', 'posicao', 'taxa', 'titulo', 'url']);
    assert.equal(m.url, 'sample/Chuva.mp3');
    assert.equal(m.titulo, 'Chuva na taverna');
    assert.equal(m.loop, true);
    assert.equal(m.posicao, 42.5);
    assert.equal(m.taxa, 1.3);
    assert.equal(m.desde, 5000);
    assert.equal(m.pausada, false);
    assert.deepEqual(m.estado, { volume: 0.35, efeitos: ['lowpass', 'echo'], ajustes: { lowpass: { frequency: 800 } }, regioes });
    assert.equal(p.pausada, true);
    assert.equal('url' in p, false);
});

test('o loop também vem do efeito de loop e de loop suave', async () => {
    const mix = await mixCom([
        fonte('a', blobDe('a'), { efeitos: { efeitos: ['loop'] } }),
        fonte('b', blobDe('b'), { efeitos: { efeitos: ['smoothLoop'] } }),
        fonte('c', blobDe('c')),
    ]);
    assert.deepEqual(mix.faixas.map(f => f.loop), [true, true, false]);
});

test('num crossfade as duas faixas aparecem, com volumes diferentes, e a segunda marcada', async () => {
    const indice = criarIndice();
    const principal = fonte('blob:m', blobDe('mesmo arquivo'), { efeitos: { volume: 0.2, efeitos: ['lowpass'] } });
    const segunda = fonte('blob:m', blobDe('mesmo arquivo'), { audio: { currentTime: 60 }, efeitos: { volume: 0.6, efeitos: [] }, resto: { crossfade: true } });
    const mix = await mixCom([principal, segunda], indice);
    assert.equal(mix.faixas.length, 2);
    assert.equal(mix.faixas[0].faixaId, mix.faixas[1].faixaId);
    assert.equal(mix.faixas[0].estado.volume, 0.2);
    assert.equal(mix.faixas[1].estado.volume, 0.6);
    assert.equal(mix.faixas[1].crossfade, true);
    assert.equal('crossfade' in mix.faixas[0], false);
    assert.equal(mix.faixas[1].posicao, 60);
});

test('faixa ainda sem hash fica de fora e entra no próximo mix; o aviso de pronto sai uma vez', async () => {
    let prontos = 0;
    const indice = criarIndice();
    const f = fonte('blob:lenta', blobDe('lenta'));
    const opcoes = { cena: null, mestre: 1, fontes: [f], indice, estadoDaFaixa: estadoFalso, aoPronto: () => prontos++ };
    assert.equal(montarMix(opcoes).faixas.length, 0);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(prontos, 1);
    assert.equal(montarMix(opcoes).faixas.length, 1);
    assert.equal(prontos, 1);
    assert.equal(montarMix(opcoes).cena, null);
});

test('efeito-tocado: faixaId, url, titulo e estado', async () => {
    const indice = criarIndice();
    const dados = await montarEfeito(fonte('blob:trovao', blobDe('trovao'), { efeitos: { volume: 0.9 }, resto: { titulo: 'Trovão', url: 'sample/T.mp3' } }), { indice, estadoDaFaixa: estadoFalso });
    assert.match(dados.faixaId, /^[0-9a-f]{64}$/);
    assert.equal(dados.url, 'sample/T.mp3');
    assert.equal(dados.titulo, 'Trovão');
    assert.equal(dados.estado.volume, 0.9);
    const semPainel = await montarEfeito({ chave: 'blob:x', obterBlob: async () => blobDe('x'), titulo: 'X', audio: {}, volume: 0.4 }, { indice, estadoDaFaixa: estadoFalso });
    assert.deepEqual(semPainel.estado, { volume: 0.4, efeitos: [], ajustes: {}, regioes: [] });
});

test('mudouMix ignora o relógio, vê mudança de estado e salto de posição', async () => {
    const indice = criarIndice();
    const f = fonte('blob:s', blobDe('s'));
    let agora = 1000;
    const mix = async (extra = {}) => { const m = await mixCom([fonte('blob:s', blobDe('s'), extra)], indice, () => agora); return m; };
    const base = await mix({ audio: { currentTime: 10 } });
    agora = 3000;
    assert.equal(mudouMix(base, await mix({ audio: { currentTime: 12 } })), false); // andou 2 s em 2 s
    assert.equal(mudouMix(base, await mix({ audio: { currentTime: 12 }, efeitos: { efeitos: ['lowpass'] } })), true);
    assert.equal(mudouMix(base, await mix({ audio: { currentTime: 12 }, efeitos: { volume: 0.5 } })), true);
    assert.equal(mudouMix(base, await mix({ audio: { currentTime: 3 } })), true); // salto de loop
    assert.equal(mudouMix(base, await mix({ audio: { currentTime: 12, playbackRate: 2 } })), true);
    assert.equal(mudouMix(null, base), true);
    assert.equal(mudouMix(null, { cena: null, mestre: 1, faixas: [] }), false);
    void f;
});

// --- o limitador, com relógio falso ---

function relogioFalso() {
    let agora = 0, id = 0;
    const timers = new Map();
    return {
        agora: () => agora,
        agendar: (fn, ms) => { const t = ++id; timers.set(t, { fn, em: agora + ms }); return t; },
        cancelar: t => timers.delete(t),
        avancar(ms) {
            const fim = agora + ms;
            for (;;) {
                const proximo = [...timers.entries()].filter(([, t]) => t.em <= fim).sort((a, b) => a[1].em - b[1].em)[0];
                if (!proximo) break;
                timers.delete(proximo[0]); agora = proximo[1].em; proximo[1].fn();
            }
            agora = fim;
        },
    };
}

function publicadorFalso(extra = {}) {
    const rel = relogioFalso();
    const emitidos = [];
    let tocando = true;
    const pub = criarPublicador({
        montar: () => ({ cena: null, mestre: 1, faixas: tocando ? [{ faixaId: 'a', pausada: false, posicao: 0, taxa: 1, desde: rel.agora(), loop: false, estado: { volume: 1, efeitos: [], ajustes: {}, regioes: [] } }] : [] }),
        emitir: m => emitidos.push([rel.agora(), m]),
        agora: rel.agora, agendar: rel.agendar, cancelar: rel.cancelar, ...extra,
    });
    return { rel, emitidos, pub, parar: () => { tocando = false; } };
}

test('o limitador: no máximo 4 por segundo, e a rajada se funde numa emissão com o estado do fim', () => {
    const { rel, emitidos, pub } = publicadorFalso();
    for (let i = 0; i < 50; i++) { pub.solicitar(); rel.avancar(10); } // 50 pedidos em 500 ms
    const ate500 = emitidos.filter(([t]) => t <= 500).length;
    assert.ok(ate500 <= 3, `saíram ${ate500} em 500 ms`);
    rel.avancar(1000);
    const naPrimeiraSegunda = emitidos.filter(([t]) => t < 1000).length;
    assert.ok(naPrimeiraSegunda <= 4, `saíram ${naPrimeiraSegunda} em 1 s`);
    assert.equal(emitidos[0][0], 0); // a primeira sai na hora
});

test('o limitador: durante um fade, até 10 por segundo', () => {
    let fade = true;
    const { rel, emitidos, pub } = publicadorFalso({ emFade: () => fade });
    for (let i = 0; i < 200; i++) { pub.solicitar(); rel.avancar(5); } // 1 s
    const noFade = emitidos.filter(([t]) => t < 1000).length;
    assert.ok(noFade >= 9 && noFade <= 10, `saíram ${noFade} em 1 s de fade`);
    fade = false;
    const antes = emitidos.length;
    for (let i = 0; i < 200; i++) { pub.solicitar(); rel.avancar(5); }
    assert.ok(emitidos.length - antes <= 5, `saíram ${emitidos.length - antes} em 1 s sem fade`);
});

test('o limitador: a cada 3 s enquanto algo toca, e para quando nada toca', () => {
    const { rel, emitidos, pub, parar } = publicadorFalso();
    pub.solicitar();
    rel.avancar(9500);
    assert.deepEqual(emitidos.map(([t]) => t), [0, 3000, 6000, 9000]);
    parar();
    pub.solicitar(); // sai um mix vazio, que avisa que parou
    assert.equal(emitidos.at(-1)[1].faixas.length, 0);
    const n = emitidos.length;
    rel.avancar(10000);
    assert.equal(emitidos.length, n);
    pub.solicitar(); // vazio de novo: não repete
    assert.equal(emitidos.length, n);
});

test('vigiar só solicita quando o mix mudou', () => {
    let volume = 1;
    const rel = relogioFalso();
    const emitidos = [];
    const pub = criarPublicador({
        montar: () => ({ cena: null, mestre: 1, faixas: [{ faixaId: 'a', pausada: false, posicao: rel.agora() / 1000, taxa: 1, desde: rel.agora(), loop: false, estado: { volume, efeitos: [], ajustes: {}, regioes: [] } }] }),
        emitir: m => emitidos.push(m), agora: rel.agora, agendar: rel.agendar, cancelar: rel.cancelar,
    });
    pub.vigiar(); rel.avancar(500); pub.vigiar(); rel.avancar(500); pub.vigiar();
    assert.equal(emitidos.length, 1);
    volume = 0.5; rel.avancar(300); pub.vigiar();
    assert.equal(emitidos.length, 2);
});

// --- jukebox.arquivo ---

test('jukebox.arquivo responde o blob certo e "desconhecida" quando deve', async () => {
    const indice = criarIndice();
    const editado = blobDe('arquivo editado');
    const original = blobDe('arquivo original');
    const idOriginal = await indice.garantir('blob:orig', async () => original);
    const idEditado = await indice.garantir('blob:editado', async () => editado);
    assert.notEqual(idOriginal, idEditado);
    const r = await atenderArquivo({ faixaId: idEditado }, indice);
    assert.equal(r.ok, true);
    assert.equal(r.dados.blob, editado);
    assert.equal(r.dados.tipo, 'audio/mpeg');
    assert.equal(await r.dados.blob.text(), 'arquivo editado');
    assert.equal((await atenderArquivo({ faixaId: idOriginal }, indice)).dados.blob, original);
    for (const dados of [{ faixaId: 'zzz' }, { faixaId: 7 }, {}, null]) {
        assert.deepEqual(await atenderArquivo(dados, indice), { ok: false, motivo: 'desconhecida' });
    }
    // sem tipo, vira application/octet-stream
    const id = await indice.garantir('blob:sem-tipo', async () => new Blob(['q']));
    assert.equal((await atenderArquivo({ faixaId: id }, indice)).dados.tipo, 'application/octet-stream');
});

test('um hash que falha (arquivo sumiu) tenta de novo no próximo mix', async () => {
    const indice = criarIndice();
    let falhar = true;
    const obter = async () => { if (falhar) throw new Error('sumiu'); return blobDe('voltou'); };
    assert.equal(indice.idDe('blob:z', obter), null);
    await new Promise(r => setTimeout(r, 10));
    falhar = false;
    assert.equal(indice.idDe('blob:z', obter), null);
    await new Promise(r => setTimeout(r, 10));
    assert.match(indice.idDe('blob:z', obter), /^[0-9a-f]{64}$/);
});
