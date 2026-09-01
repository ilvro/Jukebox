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
        this.removalTimer = null;
        this.pendingRemovalCleanup = null;
        this.applySettings(this.options);
    }

    activate(...args) {
        this.finishPendingDeactivation();
        super.activate(...args);
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

    deactivate(duration = 0) {
        if (!this.active) return;
        if (!(duration > 0) || !this.audioContextData?.audioContext) {
            super.deactivate();
            return;
        }

        const { audioContext, dryGainNode, wetGainNode } = this.audioContextData;
        const now = audioContext.currentTime;
        const endTime = now + duration;
        const holdParameter = param => {
            if (typeof param.cancelAndHoldAtTime === 'function') {
                param.cancelAndHoldAtTime(now);
            } else {
                param.cancelScheduledValues(now);
                param.setValueAtTime(param.value, now);
            }
        };

        // Do not crossfade the dry and filtered paths here. Biquad filters
        // rotate phase, so summing both versions can cause severe phase
        // cancellation and an audible volume hole halfway through the fade.
        // Instead, keep one signal path and move the cutoff to an inaudible,
        // effectively neutral boundary. The final dry-path switch then has
        // virtually no tonal difference.
        holdParameter(dryGainNode.gain);
        holdParameter(wetGainNode.gain);
        const neutralFrequency = this.filterType === 'highpass'
            ? 10
            : audioContext.sampleRate * 0.49;
        [this.nodes?.filter1, this.nodes?.filter2].forEach(filter => {
            if (!filter) return;
            holdParameter(filter.frequency);
            filter.frequency.exponentialRampToValueAtTime(neutralFrequency, endTime);
            holdParameter(filter.Q);
            filter.Q.linearRampToValueAtTime(0.1, endTime);
        });

        const cleanup = this.cleanup;
        this.active = false;
        this.pendingRemovalCleanup = () => {
            cleanup?.();
            this.pendingRemovalCleanup = null;
            this.removalTimer = null;
        };
        this.removalTimer = setTimeout(() => {
            this.pendingRemovalCleanup?.();
        }, duration * 1000 + 30);
        console.log(`${this.name} cutoff returning to neutral over ${duration}s`);
    }

    finishPendingDeactivation() {
        if (this.removalTimer !== null) {
            clearTimeout(this.removalTimer);
            this.removalTimer = null;
        }
        const cleanup = this.pendingRemovalCleanup;
        this.pendingRemovalCleanup = null;
        cleanup?.();
    }
}
