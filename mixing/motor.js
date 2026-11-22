// Headless mixing engine: applies the Jukebox's effects, settings, regions and
// volume to an audio element from plain data, with no interface. The online
// table shell loads it with import('/Jukebox/mixing/motor.js') and repeats the
// master's state, so effects sound the same as in the Jukebox.
//
// Only imports modules of mixing/ (no DOM, no localStorage at import time).
import {
    useAudioContext, setTrackVolume, getTrackVolume, releaseAudioContext, disconnectAudioContext
} from './audio-context.js';
import { EffectsRegistry } from './effects-registry.js';
import { initializeSelectedRegions, serializeSelectedRegions } from './selection-regions.js';

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function clonar(valor) {
    return valor === undefined ? undefined : JSON.parse(JSON.stringify(valor));
}

// Reads the state of a song playing in the Jukebox (the counterpart of aplicar).
// `audioEffects` is what setupAudioEffects(...) returned; `progressBar` is the
// element (or object) that holds the song's regions.
export function estadoDaFaixa({ audio, audioEffects, progressBar }) {
    return {
        volume: getTrackVolume(audio),
        efeitos: audioEffects.getActiveEffectKeys(),
        ajustes: clonar(audioEffects.getEffectSettings()),
        regioes: serializeSelectedRegions(progressBar)
    };
}

class Faixa {
    constructor(audio, destino, tempoDeRemocao) {
        this.audio = audio;
        // plain object standing in for the progress bar: effects and regions
        // only need the region list and the audio element
        this.barra = { audio };
        initializeSelectedRegions(this.barra, []);
        this.registro = new EffectsRegistry(audio, this.barra, {
            destino,
            removalDuration: tempoDeRemocao
        });
        this.anterior = { volume: undefined, efeitos: [], ajustes: {}, regioes: [] };
        this.solta = false;
    }

    // current state as the Jukebox would read it
    estado() {
        return {
            volume: getTrackVolume(this.audio),
            efeitos: this.registro.getActiveEffectKeys(),
            ajustes: clonar(this.registro.getEffectSettings()),
            regioes: serializeSelectedRegions(this.barra)
        };
    }

    aplicar(estado = {}) {
        if (this.solta) return;
        const anterior = this.anterior;
        const proximo = {
            volume: estado.volume === undefined ? anterior.volume : estado.volume,
            efeitos: Array.isArray(estado.efeitos) ? this.registro.normalizeEffectKeys(estado.efeitos) : anterior.efeitos,
            ajustes: estado.ajustes && typeof estado.ajustes === 'object' ? clonar(estado.ajustes) : anterior.ajustes,
            regioes: Array.isArray(estado.regioes) ? clonar(estado.regioes) : anterior.regioes
        };

        if (proximo.volume !== undefined && proximo.volume !== anterior.volume) {
            setTrackVolume(this.audio, proximo.volume);
        }

        if (!igual(proximo.regioes, anterior.regioes)) {
            initializeSelectedRegions(this.barra, proximo.regioes);
        }

        const ajustesMudados = {};
        for (const [chave, valor] of Object.entries(proximo.ajustes)) {
            if (!igual(valor, anterior.ajustes[chave])) ajustesMudados[chave] = valor;
        }
        if (Object.keys(ajustesMudados).length > 0) this.registro.setEffectSettings(ajustesMudados);

        if (!igual(proximo.efeitos, anterior.efeitos)) {
            const pedidos = new Set(proximo.efeitos);
            const atuais = this.registro.getActiveEffectKeys();
            // removing goes through the gradual exit, like toggling off in the menu
            atuais.filter(chave => !pedidos.has(chave))
                .forEach(chave => this.registro.deactivateEffect(chave, { gradual: true }));
            // activateEffect toggles when the effect is already on, so only call it for the off ones
            proximo.efeitos.forEach(chave => {
                const efeito = this.registro.effects[chave];
                if (efeito && !efeito.active) this.registro.activateEffect(chave);
            });
        }

        this.anterior = proximo;
    }

    soltar() {
        if (this.solta) return;
        this.solta = true;
        const volume = getTrackVolume(this.audio);
        this.registro.deactivateAllEffects();
        disconnectAudioContext(this.audio);
        releaseAudioContext(this.audio);
        this.audio.volume = volume;
        this.audio.playbackRate = 1;
    }
}

// audioContext: the context to use (default: the module creates its own);
// destino: AudioNode that receives every song (default: audioContext.destination);
// tempoDeRemocao: seconds of the gradual effect exit (default 0.5, like the Jukebox).
export function criarMotor({ audioContext, destino, tempoDeRemocao } = {}) {
    if (audioContext) useAudioContext(audioContext);
    let contexto = audioContext;
    let mestre = null;
    const garantirMestre = () => {
        if (mestre) return mestre;
        contexto = contexto || new (globalThis.AudioContext || globalThis.webkitAudioContext)({ latencyHint: 'playback' });
        useAudioContext(contexto);
        mestre = contexto.createGain();
        mestre.gain.value = 1;
        mestre.connect(destino || contexto.destination);
        return mestre;
    };

    return {
        // `saida` overrides the destination for this song only (bypasses the master volume)
        prepararFaixa(audio, { destino: saida } = {}) {
            const raiz = garantirMestre();
            return new Faixa(audio, saida || raiz, tempoDeRemocao);
        },
        volumeMestre(valor) {
            const numero = Number(valor);
            garantirMestre().gain.value = Number.isFinite(numero) ? Math.max(0, Math.min(1, numero)) : 1;
        }
    };
}
