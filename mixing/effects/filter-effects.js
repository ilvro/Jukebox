import { initializeAudioContext, disconnectAudioContext, getAudioContext } from '../audio-context.js';
import { AudioEffect } from './base-effect.js';

export class FilterEffect extends AudioEffect {
    constructor(type, options = {}) {
        super(`${type.charAt(0).toUpperCase() + type.slice(1)} Filter`);
        this.filterType = type;
        this.options = {
            frequency: type === 'highpass' ? 400 : 2000,
            Q: 1.0,
            ...options
        };
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        const filter1 = audioContext.createBiquadFilter();
        const filter2 = audioContext.createBiquadFilter();

        [filter1, filter2].forEach(f => {
            f.type = this.filterType;
            f.frequency.value = this.options.frequency;
            f.Q.value = this.options.Q;

            if (audioContext.sampleRate >= 96000) {
                f.oversample = '4x';
            } else if (audioContext.sampleRate >= 48000) {
                f.oversample = '2x';
            }
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
        if (this.nodes?.filter1 && this.nodes?.filter2 && this.audioContextData?.audioContext) {
            const time = this.audioContextData.audioContext.currentTime;
            this.nodes.filter1.frequency.setValueAtTime(value, time);
            this.nodes.filter2.frequency.setValueAtTime(value, time);
        }
    }
    
    setQ(value) {
        if (this.nodes?.filter1 && this.nodes?.filter2 && this.audioContextData?.audioContext) {
            const time = this.audioContextData.audioContext.currentTime;
            this.nodes.filter1.Q.setValueAtTime(value, time);
            this.nodes.filter2.Q.setValueAtTime(value, time);
        }
    }
}