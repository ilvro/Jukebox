import { initializeAudioContext, disconnectAudioContext, getAudioContext } from '../audio-context.js';
import { AudioEffect } from './base-effect.js';

export class ReverbEffect extends AudioEffect {
    constructor(options = {}) {
        super('Reverb');
        this.options = {
            delayTime: options.delayTime ?? 0.06,
            feedback: options.feedback ?? 0.15,
            wet: options.wet ?? 0.3,
            ...options
        };
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        const sparkleReverb = audioContext.createDelay(1.0);
        const reverbGain = audioContext.createGain();
        const outputGain = audioContext.createGain();

        sparkleReverb.delayTime.value = this.options.delayTime;
        reverbGain.gain.value = this.options.feedback;
        outputGain.gain.value = this.options.wet;

        wetGainNode.connect(sparkleReverb);
        sparkleReverb.connect(reverbGain);
        reverbGain.connect(sparkleReverb);
        sparkleReverb.connect(outputGain);
        outputGain.connect(mainGainNode);

        this.nodes = { sparkleReverb, reverbGain, outputGain };
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        const handleTimeUpdate = this.createRegionBasedHandler(
            audio, audioContext, progressBar, dryGainNode, wetGainNode
        );
        
        audio.addEventListener('timeupdate', handleTimeUpdate);
        
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            if (this.nodes) {
                wetGainNode.disconnect(this.nodes.sparkleReverb);
                Object.values(this.nodes).forEach(node => node.disconnect());
            }
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
            delayTime: options.delayTime ?? 0.3,
            feedback: options.feedback ?? 0.4,
            ...options
        };
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        const delay = audioContext.createDelay();
        const feedback = audioContext.createGain();
        
        delay.delayTime.value = this.options.delayTime;
        feedback.gain.value = this.options.feedback;

        wetGainNode.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(mainGainNode);

        this.nodes = { delay, feedback };
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        const handleTimeUpdate = this.createRegionBasedHandler(
            audio, audioContext, progressBar, dryGainNode, wetGainNode
        );
        
        audio.addEventListener('timeupdate', handleTimeUpdate);
        
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            if (this.nodes) {
                wetGainNode.disconnect(this.nodes.delay);
                Object.values(this.nodes).forEach(node => node.disconnect());
            }
        };
    }
}