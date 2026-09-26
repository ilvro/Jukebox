import { initializeAudioContext, disconnectAudioContext, getAudioContext } from '../audio-context.js';
import { isTimeInSelectedRegions } from '../selection-regions.js';
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
            const currentTime = audio.currentTime;
            const isInSelectedRegion = isTimeInSelectedRegions(progressBar, currentTime);

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
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    requestAnimationFrame(handleTimeUpdate);
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

function createSaturationCurve(drive = 5.5, bias = 0.08, sampleCount = 8192) {
    const curve = new Float32Array(sampleCount);
    const center = Math.tanh(bias * drive);
    const normalization = Math.max(
        Math.abs(Math.tanh((1 + bias) * drive) - center),
        Math.abs(Math.tanh((-1 + bias) * drive) - center)
    );
    for (let index = 0; index < sampleCount; index++) {
        const input = index * 2 / (sampleCount - 1) - 1;
        curve[index] = (Math.tanh((input + bias) * drive) - center) / normalization;
    }
    return curve;
}

export function createHellProcessor(audioContext, inputNode, outputNode) {
    const processor = {
        input: audioContext.createGain(),
        subBass: audioContext.createBiquadFilter(),
        lowMidControl: audioContext.createBiquadFilter(),
        bodyGain: audioContext.createGain(),
        distortionDrive: audioContext.createGain(),
        saturation: audioContext.createWaveShaper(),
        distortionHighpass: audioContext.createBiquadFilter(),
        distortionBite: audioContext.createBiquadFilter(),
        distortionLowpass: audioContext.createBiquadFilter(),
        distortionGain: audioContext.createGain(),
        safetyCompressor: audioContext.createDynamicsCompressor(),
        outputGain: audioContext.createGain()
    };

    // Compared with the clean excerpt, the target carries about 6 dB more
    // energy below 120 Hz but only about 1 dB more in the 120-500 Hz band.
    processor.subBass.type = 'lowshelf';
    processor.subBass.frequency.value = 105;
    processor.subBass.gain.value = 7;
    processor.lowMidControl.type = 'peaking';
    processor.lowMidControl.frequency.value = 820;
    processor.lowMidControl.Q.value = 0.75;
    processor.lowMidControl.gain.value = -2.5;

    // Keep a mostly clean, immediate body so attacks and the source dynamics
    // survive. A separate driven branch adds upper harmonics: this sounds raw
    // and stressed without smearing notes into a reverb-like wash.
    processor.bodyGain.gain.value = 0.45;
    // These recordings peak around 0.025 (-32 dBFS). The old 4.5x drive did
    // not push a source this quiet far enough into the non-linear part of the
    // curve, so Hell was effectively just EQ. 24x makes the saturation clear;
    // the branch is attenuated again below to preserve the original loudness.
    processor.distortionDrive.gain.value = 24;

    processor.saturation.curve = createSaturationCurve();
    processor.saturation.oversample = '4x';

    processor.distortionHighpass.type = 'highpass';
    processor.distortionHighpass.frequency.value = 250;
    processor.distortionHighpass.Q.value = 0.45;
    processor.distortionBite.type = 'highshelf';
    processor.distortionBite.frequency.value = 1800;
    processor.distortionBite.gain.value = 9;
    processor.distortionLowpass.type = 'lowpass';
    processor.distortionLowpass.frequency.value = 14000;
    processor.distortionLowpass.Q.value = 0.4;
    // The aggressive branch is deliberately quiet after the waveshaper. It
    // contributes texture and sharp transients without turning the preset
    // into a volume boost or flattening the clean dynamics.
    processor.distortionGain.gain.value = 0.03;

    // This compressor is only a peak guard. The target retains almost exactly
    // the clean recording's crest factor, so normal material should not be
    // continuously compressed as it was in the first implementation.
    processor.safetyCompressor.threshold.value = -5;
    processor.safetyCompressor.knee.value = 2;
    processor.safetyCompressor.ratio.value = 8;
    processor.safetyCompressor.attack.value = 0.002;
    processor.safetyCompressor.release.value = 0.08;
    // The stronger distortion branch raises the internal RMS by roughly
    // 7 dB. Compensating here keeps comparisons honest: Hell should sound
    // different, not merely louder.
    processor.outputGain.gain.value = 0.58;

    inputNode.connect(processor.input);
    processor.input.connect(processor.subBass);
    processor.subBass.connect(processor.lowMidControl);
    processor.lowMidControl.connect(processor.bodyGain);
    processor.bodyGain.connect(processor.safetyCompressor);

    processor.lowMidControl.connect(processor.distortionDrive);
    processor.distortionDrive.connect(processor.saturation);
    processor.saturation.connect(processor.distortionHighpass);
    processor.distortionHighpass.connect(processor.distortionBite);
    processor.distortionBite.connect(processor.distortionLowpass);
    processor.distortionLowpass.connect(processor.distortionGain);
    processor.distortionGain.connect(processor.safetyCompressor);

    processor.safetyCompressor.connect(processor.outputGain);
    processor.outputGain.connect(outputNode);

    return processor;
}

export class HellEffect extends AudioEffect {
    constructor() {
        super('Hell');
        this.processor = null;
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        this.processor = createHellProcessor(audioContext, wetGainNode, mainGainNode);
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        const handleTimeUpdate = () => {
            const inRegion = isTimeInSelectedRegions(progressBar, audio.currentTime);
            const now = audioContext.currentTime;

            dryGainNode.gain.setTargetAtTime(inRegion ? 0 : 1, now, 0.045);
            wetGainNode.gain.setTargetAtTime(inRegion ? 1 : 0, now, 0.06);
        };

        audio.addEventListener('timeupdate', handleTimeUpdate);
        requestAnimationFrame(handleTimeUpdate);
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            if (this.processor) {
                try { wetGainNode.disconnect(this.processor.input); } catch {}
                Object.values(this.processor).forEach(node => node.disconnect?.());
                this.processor = null;
            }
            wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
            dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);
        };
    }
}
