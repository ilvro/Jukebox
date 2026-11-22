import { test } from 'node:test';
import assert from 'node:assert/strict';

// the effects use these browser globals
globalThis.requestAnimationFrame = () => 0;
console.log = () => {};

const { criarMotor, estadoDaFaixa } = await import('../mixing/motor.js');
const { setTrackVolume } = await import('../mixing/audio-context.js');

const PARAMETROS = new Set(['gain', 'frequency', 'Q', 'delayTime', 'detune', 'pan', 'threshold', 'ratio', 'knee', 'attack', 'release']);

function criarParametro(chamadas, nome) {
    const param = { value: 0 };
    return new Proxy(param, {
        get(alvo, prop) {
            if (prop in alvo) return alvo[prop];
            return (...args) => { chamadas.push([`${nome}.${String(prop)}`, ...args]); };
        },
        set(alvo, prop, valor) { alvo[prop] = valor; if (prop === 'value') chamadas.push([`${nome}=`, valor]); return true; }
    });
}

function criarNo(chamadas, tipo) {
    const parametros = {};
    const proprios = {};
    return new Proxy({ tipo }, {
        get(alvo, prop) {
            if (prop in alvo) return alvo[prop];
            if (prop in proprios) return proprios[prop];
            if (PARAMETROS.has(prop)) return parametros[prop] ??= criarParametro(chamadas, `${tipo}.${prop}`);
            if (prop === 'connect' || prop === 'disconnect') {
                return (...args) => { chamadas.push([`${tipo}.${prop}`, ...args.map(a => a?.tipo ?? a)]); return args[0]; };
            }
            if (prop === 'then') return undefined;
            return (...args) => { chamadas.push([`${tipo}.${String(prop)}`]); };
        },
        set(alvo, prop, valor) { proprios[prop] = valor; return true; }
    });
}

function criarContextoFalso() {
    const chamadas = [];
    const contexto = {
        chamadas,
        currentTime: 0,
        sampleRate: 48000,
        state: 'running',
        destination: criarNo(chamadas, 'destino'),
        createMediaElementSource: () => criarNo(chamadas, 'fonte'),
    };
    return new Proxy(contexto, {
        get(alvo, prop) {
            if (prop in alvo) return alvo[prop];
            if (typeof prop === 'string' && prop.startsWith('create')) {
                return () => criarNo(chamadas, prop.slice(6).toLowerCase());
            }
            return undefined;
        }
    });
}

function audioFalso() {
    const ouvintes = {};
    return {
        volume: 1,
        playbackRate: 1,
        currentTime: 0,
        paused: false,
        addEventListener: (nome, fn) => { (ouvintes[nome] ??= new Set()).add(fn); },
        removeEventListener: (nome, fn) => { ouvintes[nome]?.delete(fn); },
    };
}

// the mixing module keeps one context per page, so every test shares this one
const ctx = criarContextoFalso();
const motor = criarMotor({ audioContext: ctx, tempoDeRemocao: 0.01 });

const REGIAO = {
    id: 'r1', start: 10, end: 20, active: true, color: '#4a9eff',
    effects: ['echo'], effectSettings: { echo: { delay: 0.3 } },
    playAndFadeOut: false, playAndStop: false
};

test('aplicar liga efeitos, ajustes e regioes e estado volta igual', () => {
    const audio = audioFalso();
    const faixa = motor.prepararFaixa(audio);
    faixa.aplicar({
        volume: 0.4,
        efeitos: ['lowpass', 'tremolo'],
        ajustes: { lowpass: { frequency: 900, Q: 2 } },
        regioes: [REGIAO]
    });
    const estado = faixa.estado();
    assert.equal(audio.volume, 0.4);
    assert.equal(estado.volume, 0.4);
    assert.deepEqual(estado.efeitos.sort(), ['lowpass', 'tremolo']);
    assert.equal(estado.ajustes.lowpass.frequency, 900);
    assert.equal(estado.ajustes.lowpass.Q, 2);
    assert.deepEqual(estado.regioes, [REGIAO]);
    faixa.soltar();
});

test('estadoDaFaixa le uma faixa do Jukebox e outra faixa reproduz o mesmo estado', () => {
    // "master" track: the motor stands in for the interface's setupAudioEffects
    const mestreAudio = audioFalso();
    const mestre = motor.prepararFaixa(mestreAudio);
    mestre.aplicar({ volume: 0.7, efeitos: ['highpass'], ajustes: { highpass: { frequency: 500 } }, regioes: [REGIAO] });
    const audioEffects = {
        getActiveEffectKeys: () => mestre.registro.getActiveEffectKeys(),
        getEffectSettings: () => mestre.registro.getEffectSettings()
    };
    const lido = estadoDaFaixa({ audio: mestreAudio, audioEffects, progressBar: mestre.barra });

    const jogadorAudio = audioFalso();
    const jogador = motor.prepararFaixa(jogadorAudio);
    jogador.aplicar(lido);
    assert.deepEqual(jogador.estado(), lido);
    assert.equal(jogadorAudio.volume, 0.7);
    mestre.soltar();
    jogador.soltar();
});

test('aplicar o mesmo estado nao chama nada', () => {
    const audio = audioFalso();
    const faixa = motor.prepararFaixa(audio);
    const estado = { volume: 0.5, efeitos: ['lowpass'], ajustes: { lowpass: { frequency: 1200 } }, regioes: [REGIAO] };
    faixa.aplicar(estado);
    const antes = ctx.chamadas.length;
    faixa.aplicar(JSON.parse(JSON.stringify(estado)));
    assert.equal(ctx.chamadas.length, antes);
    faixa.soltar();
});

test('desligar um filtro passa pela saida gradual e ligar de novo funciona', async () => {
    const audio = audioFalso();
    const faixa = motor.prepararFaixa(audio);
    faixa.aplicar({ efeitos: ['lowpass'] });
    const filtro = faixa.registro.effects.lowpass;
    assert.ok(filtro.active);
    const antes = ctx.chamadas.length;
    faixa.aplicar({ efeitos: [] });
    assert.equal(filtro.active, false);
    // gradual: the cutoff ramps to neutral and the nodes stay connected until the timer
    const novas = ctx.chamadas.slice(antes).map(c => c[0]);
    assert.ok(novas.includes('biquadfilter.frequency.exponentialRampToValueAtTime'), novas.join());
    assert.ok(filtro.pendingRemovalCleanup, 'removal is pending');
    await new Promise(r => setTimeout(r, 80));
    assert.equal(filtro.pendingRemovalCleanup, null);
    faixa.aplicar({ efeitos: ['lowpass'] });
    assert.ok(filtro.active);
    faixa.soltar();
});

test('efeito desconhecido e ignorado e soltar desliga tudo', () => {
    const audio = audioFalso();
    const faixa = motor.prepararFaixa(audio);
    faixa.aplicar({ efeitos: ['nao-existe', 'echo'] });
    assert.deepEqual(faixa.registro.getActiveEffectKeys(), ['echo']);
    faixa.soltar();
    assert.deepEqual(faixa.registro.getActiveEffectKeys(), []);
    faixa.aplicar({ efeitos: ['echo'] }); // after soltar, nothing happens
    assert.deepEqual(faixa.registro.getActiveEffectKeys(), []);
});

test('volumeMestre muda o ganho do destino compartilhado', () => {
    motor.volumeMestre(0.3);
    assert.ok(ctx.chamadas.some(c => c[0] === 'gain.gain=' && c[1] === 0.3));
});
