import { initializeAudioContext, disconnectAudioContext, getAudioContext } from '../audio-context.js';
import { AudioEffect } from './base-effect.js';

export class NightcoreEffect extends AudioEffect {
    constructor() {
        super('Nightcore');
        this.processor = null;
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        this.processor = createNightcoreProcessor(audioContext, wetGainNode, mainGainNode);
    }
    

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
    const handleTimeUpdate = () => {
        if (progressBar.selectedStartTime !== undefined && 
            progressBar.selectedEndTime !== undefined) {
            
            const currentTime = audio.currentTime;
            const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                    currentTime <= progressBar.selectedEndTime;
            
            audio.preservesPitch = false; // important for nightcore effect
            
            const transitionTime = 0.1;
            if (isInSelectedRegion) {
                wetGainNode.gain.setTargetAtTime(0.9, audioContext.currentTime, transitionTime);
                dryGainNode.gain.setTargetAtTime(0.1, audioContext.currentTime, transitionTime);
                if (Math.abs(audio.playbackRate - 1.3) > 0.01) {
                    audio.playbackRate = 1.3;
                }
            } else {
                wetGainNode.gain.setTargetAtTime(0, audioContext.currentTime, transitionTime);
                dryGainNode.gain.setTargetAtTime(1, audioContext.currentTime, transitionTime);
                if (Math.abs(audio.playbackRate - 1.0) > 0.01) {
                    audio.playbackRate = 1.0;
                }
            }
        }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    this.cleanup = () => {
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        if (this.processor) {
            if (this.processor.compressor) this.processor.compressor.disconnect();
            if (this.processor.lowShelf) this.processor.lowShelf.disconnect();
            if (this.processor.highShelf) this.processor.highShelf.disconnect();
            if (this.processor.presence) this.processor.presence.disconnect();
            if (this.processor.sparkleReverb) this.processor.sparkleReverb.disconnect();
            if (this.processor.reverbGain) this.processor.reverbGain.disconnect();
            if (this.processor.outputGain) this.processor.outputGain.disconnect();
            this.processor = null;
        }
        audio.playbackRate = 1.0;
        audio.preservesPitch = true;
        wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
        dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);
    };
}
}

export function createNightcoreProcessor(audioContext, wetGainNode, mainGainNode) {
    const processor = {
        input: audioContext.createGain(),
        compressor: audioContext.createDynamicsCompressor(),
        lowShelf: audioContext.createBiquadFilter(),
        highShelf: audioContext.createBiquadFilter(),
        presence: audioContext.createBiquadFilter(),
        sparkleReverb: audioContext.createDelay(1.0),
        reverbGain: audioContext.createGain(),
        outputGain: audioContext.createGain()
    };

    // compressor settings for better dynamics
    processor.compressor.threshold.value = -24;
    processor.compressor.knee.value = 10;
    processor.compressor.ratio.value = 2.5;
    processor.compressor.attack.value = 0.005;
    processor.compressor.release.value = 0.2;

    // bass boost
    processor.lowShelf.type = 'lowshelf';
    processor.lowShelf.frequency.value = 150;
    processor.lowShelf.gain.value = 3;

    // high end sparkle
    processor.highShelf.type = 'highshelf';
    processor.highShelf.frequency.value = 7000;
    processor.highShelf.gain.value = 2;

    // presence
    processor.presence.type = 'peaking';
    processor.presence.frequency.value = 2500;
    processor.presence.Q.value = 0.7;
    processor.presence.gain.value = 2;

    // light reverb
    processor.sparkleReverb.delayTime.value = 0.06;
    processor.reverbGain.gain.value = 0.15;
    processor.outputGain.gain.value = 1.0;

    // connect nodes
    wetGainNode.connect(processor.input);
    processor.input.connect(processor.compressor);
    processor.compressor.connect(processor.lowShelf);
    processor.lowShelf.connect(processor.highShelf);
    processor.highShelf.connect(processor.presence);
    processor.presence.connect(processor.sparkleReverb);
    processor.sparkleReverb.connect(processor.reverbGain);
    processor.reverbGain.connect(processor.sparkleReverb);
    processor.presence.connect(processor.outputGain);
    processor.outputGain.connect(mainGainNode);

    return processor;
}