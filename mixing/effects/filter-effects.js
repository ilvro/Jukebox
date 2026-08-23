import { initializeAudioContext, disconnectAudioContext, getAudioContext } from '../audio-context.js';
import { AudioEffect } from './base-effect.js';

export class FilterEffect extends AudioEffect {
    constructor(type, options = {}) {
        const normalizedType = String(type).toLowerCase();
        const filterType = normalizedType === 'highpass' ? 'highpass' : 'lowpass';
        super(`${filterType.charAt(0).toUpperCase() + filterType.slice(1)} Filter`);
        this.filterType = filterType;
        this.options = {
            frequency: filterType === 'highpass' ? 350 : 2400,
            Q: 0.7,
            ...options
        };
        this.applySettings(this.options);
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        const filter1 = audioContext.createBiquadFilter();
        const filter2 = audioContext.createBiquadFilter();

        [filter1, filter2].forEach(f => {
            f.type = this.filterType;
            f.frequency.value = this.options.frequency;
            f.Q.value = this.options.Q;

        });
    
        wetGainNode.connect(filter1);
        filter1.connect(filter2);
        filter2.connect(mainGainNode);
    
        this.nodes = { filter1, filter2 };
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        const handleTimeUpdate = this.createRegionBasedHandler(
            audio, audioContext, progressBar, dryGainNode, wetGainNode
        );
        
        audio.addEventListener('timeupdate', handleTimeUpdate);
        requestAnimationFrame(handleTimeUpdate);
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            
            if (this.nodes?.filter1 && this.nodes?.filter2) {
                wetGainNode.disconnect(this.nodes.filter1);
                this.nodes.filter1.disconnect();
                this.nodes.filter2.disconnect();
            }
            
            // reset the gain values to restore normal audio
            dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);
            wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
        };
    }

    setFrequency(value) {
        const frequency = Math.max(20, Math.min(20000, Number(value) || this.options.frequency));
        this.options.frequency = frequency;
        if (this.nodes?.filter1 && this.nodes?.filter2 && this.audioContextData?.audioContext) {
            const time = this.audioContextData.audioContext.currentTime;
            [this.nodes.filter1.frequency, this.nodes.filter2.frequency].forEach(param => {
                param.cancelScheduledValues?.(time);
                param.setTargetAtTime(frequency, time, 0.015);
            });
        }
    }
    
    setQ(value) {
        const Q = Math.max(0.1, Math.min(12, Number(value) || this.options.Q));
        this.options.Q = Q;
        if (this.nodes?.filter1 && this.nodes?.filter2 && this.audioContextData?.audioContext) {
            const time = this.audioContextData.audioContext.currentTime;
            [this.nodes.filter1.Q, this.nodes.filter2.Q].forEach(param => {
                param.cancelScheduledValues?.(time);
                param.setTargetAtTime(Q, time, 0.015);
            });
        }
    }

    getSettings() {
        return { frequency: this.options.frequency, Q: this.options.Q };
    }

    applySettings(settings = {}) {
        if (settings.frequency !== undefined) this.setFrequency(settings.frequency);
        if (settings.Q !== undefined) this.setQ(settings.Q);
        return this.getSettings();
    }
}
