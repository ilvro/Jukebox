import { initializeAudioContext, disconnectAudioContext, getAudioContext } from '../audio-context.js';
import { AudioEffect } from './base-effect.js';

export class FilterEffect extends AudioEffect {
    constructor(type, options = {}) {
        super(`${type.charAt(0).toUpperCase() + type.slice(1)} Filter`);
        this.filterType = type;
        this.options = {
            frequency: type === 'highpass' ? 500 : 2000,
            Q: 0.7,
            ...options
        };
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        const filter = audioContext.createBiquadFilter();
        filter.type = this.filterType;
        filter.frequency.value = this.options.frequency;
        filter.Q.value = this.options.Q;
    
        if (audioContext.sampleRate >= 96000) {
            filter.oversample = '4x';
        } else if (audioContext.sampleRate >= 48000) {
            filter.oversample = '2x';
        }
    
        wetGainNode.connect(filter);
        filter.connect(mainGainNode);
    
        this.nodes = { filter };
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        const handleTimeUpdate = this.createRegionBasedHandler(
            audio, audioContext, progressBar, dryGainNode, wetGainNode
        );
        
        audio.addEventListener('timeupdate', handleTimeUpdate);
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            if (this.nodes?.filter) {
                wetGainNode.disconnect(this.nodes.filter);
                this.nodes.filter.disconnect();
            }
            // reset the gain values to restore normal audio
            dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);
            wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
        };
    }

    setFrequency(value) {
        if (this.nodes?.filter && this.audioContextData?.audioContext) {
            this.nodes.filter.frequency.setValueAtTime(value, this.audioContextData.audioContext.currentTime);
        }
    }
    
    setQ(value) {
        if (this.nodes?.filter && this.audioContextData?.audioContext) {
            this.nodes.filter.Q.setValueAtTime(value, this.audioContextData.audioContext.currentTime);
        }
    }
}