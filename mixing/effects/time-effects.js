import { initializeAudioContext, disconnectAudioContext, getAudioContext } from '../audio-context.js';
import { AudioEffect } from './base-effect.js';

const reverbImpulseCache = new WeakMap();

function getReverbImpulse(audioContext, duration, decay) {
    let contextCache = reverbImpulseCache.get(audioContext);
    if (!contextCache) {
        contextCache = new Map();
        reverbImpulseCache.set(audioContext, contextCache);
    }

    const cacheKey = `${audioContext.sampleRate}:${duration}:${decay}`;
    if (contextCache.has(cacheKey)) return contextCache.get(cacheKey);

    const frameCount = Math.max(1, Math.floor(audioContext.sampleRate * duration));
    const impulse = audioContext.createBuffer(2, frameCount, audioContext.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
        const samples = impulse.getChannelData(channel);
        for (let index = 0; index < frameCount; index++) {
            const progress = index / frameCount;
            const envelope = Math.pow(1 - progress, decay);
            const diffusion = Math.random() * 2 - 1;
            samples[index] = diffusion * envelope;
        }
    }
    contextCache.set(cacheKey, impulse);
    return impulse;
}

export function createReverbChain(audioContext, options = {}) {
    const settings = {
        preDelay: options.preDelay ?? 0.024,
        duration: options.duration ?? 2.8,
        decay: options.decay ?? 2.4,
        wet: options.wet ?? 0.42,
        lowpass: options.lowpass ?? 7200,
        highpass: options.highpass ?? 110
    };

    const preDelay = audioContext.createDelay(0.25);
    const convolver = audioContext.createConvolver();
    const highpass = audioContext.createBiquadFilter();
    const lowpass = audioContext.createBiquadFilter();
    const outputGain = audioContext.createGain();

    preDelay.delayTime.value = settings.preDelay;
    highpass.type = 'highpass';
    highpass.frequency.value = settings.highpass;
    highpass.Q.value = 0.35;
    lowpass.type = 'lowpass';
    lowpass.frequency.value = settings.lowpass;
    lowpass.Q.value = 0.25;
    outputGain.gain.value = settings.wet;

    // A stereo exponentially decaying impulse produces an actual room tail,
    // unlike the previous single 60 ms feedback delay (a quiet comb echo).
    convolver.buffer = getReverbImpulse(audioContext, settings.duration, settings.decay);
    convolver.normalize = true;

    preDelay.connect(convolver);
    convolver.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(outputGain);

    return {
        input: preDelay,
        output: outputGain,
        nodes: { preDelay, convolver, highpass, lowpass, outputGain }
    };
}

export function createEchoChain(audioContext, options = {}) {
    const settings = {
        delayTime: options.delayTime ?? 0.34,
        feedback: options.feedback ?? 0.42,
        wet: options.wet ?? 0.36,
        lowpass: options.lowpass ?? 5200,
        stereoWidth: options.stereoWidth ?? 0.55
    };

    const leftDelay = audioContext.createDelay(2.0);
    const rightDelay = audioContext.createDelay(2.0);
    const leftTone = audioContext.createBiquadFilter();
    const rightTone = audioContext.createBiquadFilter();
    const leftFeedback = audioContext.createGain();
    const rightFeedback = audioContext.createGain();
    const leftPan = typeof audioContext.createStereoPanner === 'function'
        ? audioContext.createStereoPanner()
        : audioContext.createGain();
    const rightPan = typeof audioContext.createStereoPanner === 'function'
        ? audioContext.createStereoPanner()
        : audioContext.createGain();
    const outputGain = audioContext.createGain();

    leftDelay.delayTime.value = settings.delayTime;
    rightDelay.delayTime.value = settings.delayTime;
    leftTone.type = 'lowpass';
    rightTone.type = 'lowpass';
    leftTone.frequency.value = settings.lowpass;
    rightTone.frequency.value = settings.lowpass;
    leftTone.Q.value = 0.3;
    rightTone.Q.value = 0.3;
    leftFeedback.gain.value = settings.feedback;
    rightFeedback.gain.value = settings.feedback;
    if (leftPan.pan) leftPan.pan.value = -settings.stereoWidth;
    if (rightPan.pan) rightPan.pan.value = settings.stereoWidth;
    outputGain.gain.value = settings.wet;

    // The first repeat starts on the left, then crosses to the right and
    // continues alternating. The low-pass filters soften every return so the
    // echoes recede naturally instead of stacking harsh identical copies.
    leftDelay.connect(leftTone);
    leftTone.connect(leftPan);
    leftPan.connect(outputGain);
    leftTone.connect(leftFeedback);
    leftFeedback.connect(rightDelay);

    rightDelay.connect(rightTone);
    rightTone.connect(rightPan);
    rightPan.connect(outputGain);
    rightTone.connect(rightFeedback);
    rightFeedback.connect(leftDelay);

    return {
        input: leftDelay,
        output: outputGain,
        nodes: {
            leftDelay,
            rightDelay,
            leftTone,
            rightTone,
            leftFeedback,
            rightFeedback,
            leftPan,
            rightPan,
            outputGain
        }
    };
}

export class ReverbEffect extends AudioEffect {
    constructor(options = {}) {
        super('Reverb');
        this.options = {
            preDelay: options.preDelay ?? 0.024,
            duration: options.duration ?? 2.8,
            decay: options.decay ?? 2.4,
            wet: options.wet ?? 0.42,
            dry: options.dry ?? 0.9,
            lowpass: options.lowpass ?? 7200,
            highpass: options.highpass ?? 110,
            ...options
        };
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        const chain = createReverbChain(audioContext, this.options);
        wetGainNode.connect(chain.input);
        chain.output.connect(mainGainNode);
        this.nodes = chain.nodes;
        this.reverbInput = chain.input;
    }

    getTailDuration() {
        return this.options.preDelay + this.options.duration;
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        const handleTimeUpdate = () => {
            if (!this.active || progressBar.selectedStartTime === undefined || progressBar.selectedEndTime === undefined) {
                return;
            }

            const inRegion = audio.currentTime >= progressBar.selectedStartTime &&
                audio.currentTime <= progressBar.selectedEndTime;
            const now = audioContext.currentTime;
            const transitionTime = 0.045;

            // Preserve most of the direct sound. The wet signal is additive,
            // so enabling reverb changes the room around the audio instead of
            // replacing it with a much quieter delayed copy.
            dryGainNode.gain.setTargetAtTime(inRegion ? this.options.dry : 1, now, transitionTime);
            wetGainNode.gain.setTargetAtTime(inRegion ? 1 : 0, now, transitionTime);
        };
        
        audio.addEventListener('timeupdate', handleTimeUpdate);
        requestAnimationFrame(handleTimeUpdate);
        
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            if (this.nodes) {
                try {
                    wetGainNode.disconnect(this.reverbInput);
                } catch {
                    // Already disconnected during a wider audio cleanup.
                }
                Object.values(this.nodes).forEach(node => node.disconnect());
            }
            this.reverbInput = null;
        };
    }
}

export class TremoloEffect extends AudioEffect {
    constructor(options = {}) {
        super('Tremolo');
        this.options = {
            frequency: options.frequency ?? 4.0,
            depth: options.depth ?? 0.5,
            ...options
        };
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        const tremolo = audioContext.createGain();
        const lfo = audioContext.createOscillator();
        const lfoGain = audioContext.createGain();
        
        lfo.frequency.value = this.options.frequency;
        lfoGain.gain.value = this.options.depth;
        
        lfo.connect(lfoGain);
        lfoGain.connect(tremolo.gain);
        wetGainNode.connect(tremolo);
        tremolo.connect(mainGainNode);
        
        lfo.start();
        
        this.nodes = { tremolo, lfo, lfoGain };
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        const handleTimeUpdate = this.createRegionBasedHandler(
            audio, audioContext, progressBar, dryGainNode, wetGainNode
        );
        
        audio.addEventListener('timeupdate', handleTimeUpdate);
        
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            if (this.nodes) {
                this.nodes.lfo.stop();
                wetGainNode.disconnect(this.nodes.tremolo);
                Object.values(this.nodes).forEach(node => node.disconnect());
            }
        };
    }
}

export class EchoEffect extends AudioEffect {
    constructor(options = {}) {
        super('Echo');
        this.options = {
            delayTime: options.delayTime ?? 0.34,
            feedback: options.feedback ?? 0.42,
            wet: options.wet ?? 0.36,
            dry: options.dry ?? 0.92,
            lowpass: options.lowpass ?? 5200,
            stereoWidth: options.stereoWidth ?? 0.55,
            ...options
        };
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        const chain = createEchoChain(audioContext, this.options);
        wetGainNode.connect(chain.input);
        chain.output.connect(mainGainNode);
        this.nodes = chain.nodes;
        this.echoInput = chain.input;
    }

    getTailDuration() {
        const feedback = Math.max(0.01, Math.min(0.95, this.options.feedback));
        const audibleRepeats = Math.max(1, Math.ceil(Math.log(0.015) / Math.log(feedback)));
        return this.options.delayTime * audibleRepeats;
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        const handleTimeUpdate = () => {
            if (!this.active || progressBar.selectedStartTime === undefined || progressBar.selectedEndTime === undefined) {
                return;
            }

            const inRegion = audio.currentTime >= progressBar.selectedStartTime &&
                audio.currentTime <= progressBar.selectedEndTime;
            const now = audioContext.currentTime;
            const transitionTime = 0.035;
            dryGainNode.gain.setTargetAtTime(inRegion ? this.options.dry : 1, now, transitionTime);
            wetGainNode.gain.setTargetAtTime(inRegion ? 1 : 0, now, transitionTime);
        };
        
        audio.addEventListener('timeupdate', handleTimeUpdate);
        requestAnimationFrame(handleTimeUpdate);
        
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            if (this.nodes) {
                try {
                    wetGainNode.disconnect(this.echoInput);
                } catch {
                    // Already disconnected during a wider audio cleanup.
                }
                Object.values(this.nodes).forEach(node => node.disconnect());
            }
            this.echoInput = null;
        };
    }
}
