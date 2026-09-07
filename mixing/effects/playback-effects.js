import { initializeAudioContext, disconnectAudioContext, getAudioContext } from '../audio-context.js';
import { AudioEffect } from './base-effect.js';
import { createEchoChain, createReverbChain } from './time-effects.js';

export class LoopEffect extends AudioEffect {
    constructor() {
        super('Loop');
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        // no nodes needed
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        const handleTimeUpdate = () => {
            if (this.active && progressBar.selectedStartTime !== undefined && 
                progressBar.selectedEndTime !== undefined) {
                const precision = 0.01;
                if (audio.currentTime >= progressBar.selectedEndTime - precision) {
                    audio.currentTime = progressBar.selectedStartTime;
                }
            }
        };
    
        audio.addEventListener('timeupdate', handleTimeUpdate);
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
        };
    }
}

export class SmoothLoopEffect extends AudioEffect {
    constructor() {
        super('Smooth Loop');
        this.crossfading = false;
        this.crossfadeAudio = null;
        this.crossfadeSource = null;
        this.crossfadeGain = null;
        this.CROSSFADE_DURATION = 2;
        this.monitorIntervalId = null;
        this.transitionTimeoutId = null;
        this.previousNativeLoop = false;
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        this.audioContextData = { audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode };
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        this.audio = audio;
        this.progressBar = progressBar;
        this.audioContextData.sourceGainNode = getAudioContext(audio).sourceGainNode;
        this.previousNativeLoop = audio.loop;
        this.prepareCrossfadeAudio();

        // requestAnimationFrame is fully suspended by the browser whenever
        // the document isn't visible (a different tab is active, window is
        // minimized, etc.) — it doesn't just throttle, it stops firing
        // entirely. That made the crossfade window get missed every time
        // regardless of how it was sized. setInterval keeps running while
        // hidden (only getting throttled after several minutes in the
        // background), which matches how Loop's own timeupdate-based
        // monitoring already survives being backgrounded.
        const MONITOR_INTERVAL_MS = 50;
        const monitorLoop = () => {
            if (!this.active) return;

            const start = progressBar.selectedStartTime;
            const end = progressBar.selectedEndTime;
            if (start !== undefined && end !== undefined && end > start) {
                this.updateNativeLoopSafety(start, end);
                const regionDuration = end - start;
                const crossfadeDuration = Math.min(
                    this.CROSSFADE_DURATION,
                    Math.max(0.08, regionDuration * 0.25)
                );
                const timeUntilEnd = end - audio.currentTime;

                if (!this.crossfading && timeUntilEnd <= crossfadeDuration && timeUntilEnd > 0) {
                    this.startCrossfade(crossfadeDuration);
                } else if (!this.crossfading && audio.currentTime >= end) {
                    // Last-resort protection for a delayed check (e.g. after
                    // the interval got throttled while backgrounded).
                    audio.currentTime = start;
                }
            }
        };
        monitorLoop();
        this.monitorIntervalId = setInterval(monitorLoop, MONITOR_INTERVAL_MS);

        this.cleanup = () => {
            if (this.monitorIntervalId !== null) {
                clearInterval(this.monitorIntervalId);
                this.monitorIntervalId = null;
            }
            audio.loop = this.previousNativeLoop;
            this.stopCrossfade();
        };
    }

    updateNativeLoopSafety(start, end) {
        const duration = this.audio.duration;
        const coversAlmostEntireSong = Number.isFinite(duration) &&
            start <= 0.05 && end >= duration - 0.5;
        this.audio.loop = coversAlmostEntireSong || this.previousNativeLoop;
    }

    prepareCrossfadeAudio() {
        if (this.crossfadeAudio || !this.audio?.src) return;
        const standbyAudio = new Audio(this.audio.src);
        standbyAudio.preload = 'auto';
        if (this.audio.crossOrigin) standbyAudio.crossOrigin = this.audio.crossOrigin;
        standbyAudio.load();
        this.crossfadeAudio = standbyAudio;
    }

    async startCrossfade(requestedDuration) {
        if (this.crossfading || !this.active || !this.audioContextData) return;
        
        const { audioContext, dryGainNode, sourceGainNode, mainGainNode } = this.audioContextData;
        const mainAudioGainNode = sourceGainNode || dryGainNode;
        const audio = this.audio;
        const progressBar = this.progressBar;

        this.crossfading = true;
        this.prepareCrossfadeAudio();

        const secondaryAudio = this.crossfadeAudio;
        if (!secondaryAudio) {
            this.crossfading = false;
            return;
        }

        if (secondaryAudio.readyState < HTMLMediaElement.HAVE_METADATA) {
            await Promise.race([
                new Promise(resolve => secondaryAudio.addEventListener('loadedmetadata', resolve, { once: true })),
                new Promise(resolve => setTimeout(resolve, 500))
            ]);
        }
        if (!this.active) {
            this.stopCrossfadeLogic();
            return;
        }

        try {
            secondaryAudio.currentTime = progressBar.selectedStartTime;
        } catch (error) {
            console.error('Could not seek smooth-loop standby audio:', error);
            audio.currentTime = progressBar.selectedStartTime;
            this.stopCrossfadeLogic();
            this.crossfading = false;
            this.prepareCrossfadeAudio();
            return;
        }
        secondaryAudio.playbackRate = audio.playbackRate;
        secondaryAudio.preservesPitch = audio.preservesPitch;
        secondaryAudio.volume = audio.volume;
        
        this.crossfadeSource = audioContext.createMediaElementSource(secondaryAudio);
        this.crossfadeGain = audioContext.createGain();
        this.crossfadeGain.gain.setValueAtTime(0, audioContext.currentTime);
        this.crossfadeSource.connect(this.crossfadeGain);
        this.crossfadeGain.connect(mainGainNode);

        try {
            await secondaryAudio.play();
        } catch (error) {
            console.error('crossfade error:', error);
            this.stopCrossfadeLogic();
            this.crossfading = false;
            return;
        }

        if (!this.active) {
            this.stopCrossfadeLogic();
            return;
        }

        const now = audioContext.currentTime;
        const remaining = progressBar.selectedEndTime - audio.currentTime;
        if (remaining <= 0.03) {
            audio.currentTime = progressBar.selectedStartTime;
            this.stopCrossfadeLogic();
            this.crossfading = false;
            this.prepareCrossfadeAudio();
            return;
        }
        if (remaining > requestedDuration + 0.1) {
            // The main element wrapped through the native safety loop while
            // the standby media was becoming ready. Retry at the next real
            // crossfade window instead of fading at the beginning.
            this.stopCrossfadeLogic();
            this.crossfading = false;
            this.prepareCrossfadeAudio();
            return;
        }
        const duration = Math.min(requestedDuration, remaining);
        const curveSteps = 64;
        const fadeOutCurve = new Float32Array(curveSteps);
        const fadeInCurve = new Float32Array(curveSteps);
        this.mainGainBeforeCrossfade = mainAudioGainNode.gain.value;
        for (let index = 0; index < curveSteps; index++) {
            const ratio = index / (curveSteps - 1);
            fadeOutCurve[index] = this.mainGainBeforeCrossfade * Math.cos(ratio * Math.PI / 2);
            fadeInCurve[index] = Math.sin(ratio * Math.PI / 2);
        }

        mainAudioGainNode.gain.cancelScheduledValues(now);
        mainAudioGainNode.gain.setValueCurveAtTime(fadeOutCurve, now, duration);
        this.crossfadeGain.gain.cancelScheduledValues(now);
        this.crossfadeGain.gain.setValueCurveAtTime(fadeInCurve, now, duration);

        this.transitionTimeoutId = setTimeout(() => {
            if (!this.active) return;
            this.finishCrossfade(duration, mainAudioGainNode, audioContext);
        }, duration * 1000);
    }

    async finishCrossfade(duration, mainAudioGainNode, audioContext) {
        if (!this.active || !this.crossfadeAudio || !this.crossfadeGain) return;

        // Seek the silent main element to the exact position currently heard
        // from the secondary element. Keep the secondary audible until the
        // seek completes, which removes the buffering gap from the handoff.
        const targetTime = Math.min(
            this.progressBar.selectedEndTime,
            this.crossfadeAudio.currentTime || this.progressBar.selectedStartTime + duration
        );
        this.audio.currentTime = targetTime;

        if (this.audio.seeking) {
            await Promise.race([
                new Promise(resolve => this.audio.addEventListener('seeked', resolve, { once: true })),
                new Promise(resolve => setTimeout(resolve, 80))
            ]);
        }
        if (!this.active || !this.crossfadeGain) return;

        const handoffDuration = 0.06;
        const now = audioContext.currentTime;
        mainAudioGainNode.gain.cancelScheduledValues(now);
        mainAudioGainNode.gain.setValueAtTime(0, now);
        mainAudioGainNode.gain.linearRampToValueAtTime(this.mainGainBeforeCrossfade ?? 1, now + handoffDuration);
        this.crossfadeGain.gain.cancelScheduledValues(now);
        this.crossfadeGain.gain.setValueAtTime(this.crossfadeGain.gain.value, now);
        this.crossfadeGain.gain.linearRampToValueAtTime(0, now + handoffDuration);

        this.transitionTimeoutId = setTimeout(() => {
            this.stopCrossfadeLogic();
            this.crossfading = false;
            this.prepareCrossfadeAudio();
        }, handoffDuration * 1000 + 15);
    }

    stopCrossfadeLogic() {
        if (this.crossfadeAudio) {
            this.crossfadeAudio.pause();
            this.crossfadeAudio.removeAttribute('src');
            this.crossfadeAudio.load();
            this.crossfadeAudio = null;
        }
        if (this.crossfadeSource) {
            this.crossfadeSource.disconnect();
            this.crossfadeSource = null;
        }
        if (this.crossfadeGain) {
            this.crossfadeGain.disconnect();
            this.crossfadeGain = null;
        }
        this.crossfading = false;
    }

    stopCrossfade() {
        if (this.transitionTimeoutId) {
            clearTimeout(this.transitionTimeoutId);
            this.transitionTimeoutId = null;
        }
        
        if (this.audioContextData?.dryGainNode) {
            const { sourceGainNode, dryGainNode, audioContext } = this.audioContextData;
            const mainAudioGainNode = sourceGainNode || dryGainNode;
            mainAudioGainNode.gain.cancelScheduledValues(audioContext.currentTime);
            mainAudioGainNode.gain.setValueAtTime(this.mainGainBeforeCrossfade ?? 1, audioContext.currentTime);
        }

        this.stopCrossfadeLogic();
    }

    deactivate() {
        this.stopCrossfade();
        super.deactivate();
    }
}

// builds a small, throwaway Web Audio chain that mirrors a currently active
// wet-path effect, so the reversed buffer (which otherwise bypasses the
// normal wet/dry graph entirely) can also be processed by it
function buildMirrorEffectNodes(audioContext, key, effectInstance) {
    switch (key) {
        case 'reverb': {
            const chain = createReverbChain(audioContext, effectInstance.options);
            const input = audioContext.createGain();
            const dry = audioContext.createGain();
            const output = audioContext.createGain();
            dry.gain.value = effectInstance.options.dry;
            input.connect(dry);
            dry.connect(output);
            input.connect(chain.input);
            chain.output.connect(output);
            return {
                input,
                output,
                extraNodes: [input, dry, output, ...Object.values(chain.nodes)]
            };
        }
        case 'echo': {
            const chain = createEchoChain(audioContext, effectInstance.options);
            const input = audioContext.createGain();
            const dry = audioContext.createGain();
            const output = audioContext.createGain();
            dry.gain.value = effectInstance.options.dry;
            input.connect(dry);
            dry.connect(output);
            input.connect(chain.input);
            chain.output.connect(output);
            return {
                input,
                output,
                extraNodes: [input, dry, output, ...Object.values(chain.nodes)]
            };
        }
        case 'tremolo': {
            const gainNode = audioContext.createGain();
            const lfo = audioContext.createOscillator();
            const lfoGain = audioContext.createGain();
            lfo.frequency.value = effectInstance.options.frequency;
            lfoGain.gain.value = effectInstance.options.depth;
            lfo.connect(lfoGain);
            lfoGain.connect(gainNode.gain);
            lfo.start();
            return { input: gainNode, output: gainNode, extraNodes: [gainNode, lfo, lfoGain] };
        }
        case 'highpass':
        case 'lowpass': {
            const filter1 = audioContext.createBiquadFilter();
            const filter2 = audioContext.createBiquadFilter();
            filter1.type = effectInstance.filterType;
            filter2.type = effectInstance.filterType;
            filter1.frequency.value = effectInstance.options.frequency;
            filter2.frequency.value = effectInstance.options.frequency;
            filter1.Q.value = effectInstance.options.Q;
            filter2.Q.value = effectInstance.options.Q;
            filter1.connect(filter2);
            return { input: filter1, output: filter2, extraNodes: [filter1, filter2] };
        }
        default:
            return null; // nightcore, loops, and reverse itself aren't mirrored
    }
}

export class ReverseEffect extends AudioEffect {
    constructor() {
        super('Reverse');
        this.audioBuffer = null;
        this.sourceNode = null;
        this.bufferSourceNode = null;
        this.isReversePlaying = false;
        this.lastStartTime = 0;
        this.startPosition = 0;
        this.reverseGainNode = null;
        this.currentPlaybackTime = 0;
        this.lastUpdateTime = 0;
        this.seekPosition = null;
        this.animationFrameId = null;
        this.mirrorNodes = [];
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        // store nodes for later use
        this.mainGainNode = mainGainNode;
        
        // create a gain node specifically for the reverse effect
        this.reverseGainNode = audioContext.createGain();
        this.reverseGainNode.gain.value = 1.0;
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        this.audio = audio;
        this.audioContext = audioContext;
        this.progressBar = progressBar;
        this.dryGainNode = dryGainNode;
        this.wetGainNode = wetGainNode;
        
        // create a buffer to store audio data
        this.fetchAudioData(audio.src);

        const handleTimeUpdate = () => {
            if (!this.active || progressBar.selectedStartTime === undefined || progressBar.selectedEndTime === undefined || !this.audioBuffer) {
                return;
            }

            // audio keeps genuinely playing (muted) the whole time reverse is
            // active — we deliberately never pause it, since pause() fires
            // the app's own 'pause' listener, which tears down and rebuilds
            // the whole track (including every effect) mid-reverse. so this
            // handler only cares about detecting when we've just ENTERED
            // the region; region-exit is handled by the reversed buffer's
            // own onended, not by watching this (muted) forward drift
            if (!this.isReversePlaying) {
                const currentTime = audio.currentTime;
                const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                           currentTime <= progressBar.selectedEndTime;
                if (isInSelectedRegion) {
                    this.startReversePlayback();
                }
            }
        };

        const handleSeeking = () => {
            // if the user seeks, we need to adjust the reverse playback
            // seeking is skipping to a specific part in the track
            if (this.isReversePlaying && this.active) {
                const currentTime = audio.currentTime;
                if (currentTime >= progressBar.selectedStartTime && 
                    currentTime <= progressBar.selectedEndTime) {
                    // user seeked within the selected region
                    this.seekPosition = currentTime;
                    this.stopReversePlayback();
                    this.startReversePlayback();
                } else {
                    // user seeked outside the region — audio was never
                    // paused, just muted, so no need to resume playback
                    this.stopReversePlayback();
                    audio.muted = false;
                }
            }
        };

        // update volume when user changes it
        const handleVolumeChange = () => {
            if (this.reverseGainNode && this.isReversePlaying) {
                this.reverseGainNode.gain.value = audio.volume;
            }
        };

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('seeking', handleSeeking);
        audio.addEventListener('volumechange', handleVolumeChange);
        
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('seeking', handleSeeking);
            audio.removeEventListener('volumechange', handleVolumeChange);
            this.stopReversePlayback();
            audio.muted = false;
        };
    }
    
    // fetch and decode the audio data
    fetchAudioData(url) {
        fetch(url)
            .then(response => response.arrayBuffer())
            .then(arrayBuffer => this.audioContext.decodeAudioData(arrayBuffer))
            .then(audioBuffer => {
                this.audioBuffer = audioBuffer;
                console.log('Audio data loaded for reverse effect');
            })
            .catch(error => {
                console.error('Error loading audio for reverse effect:', error);
            });
    }
    
    // start playing reversed audio
    startReversePlayback() {
        if (!this.audioBuffer || this.isReversePlaying) return;
        
        // calculate region properties
        const regionStart = this.progressBar.selectedStartTime;
        const regionEnd = this.progressBar.selectedEndTime;
        const regionDuration = regionEnd - regionStart;
        
        // determine where to start in the reversed buffer
        let currentPosition;
        if (this.seekPosition !== null) {
            // if we're responding to a seek event
            currentPosition = this.seekPosition;
            this.seekPosition = null;
        } else {
            currentPosition = this.audio.currentTime;
        }
        
        // calculate position as percentage through the region
        const positionInRegion = Math.min(1, Math.max(0, (currentPosition - regionStart) / regionDuration));
        const reversedPosition = 1 - positionInRegion; // reverse the position
        
        // create the reversed buffer
        const reversedBuffer = this.createReversedBuffer(regionStart, regionEnd);
        
        // mute the original element, but deliberately never pause() it —
        // pausing would fire the app's own 'pause' listener, which tears
        // down and rebuilds the whole track (including every effect,
        // reverse included) mid-playback. it keeps drifting forward,
        // muted, in the background, but nothing here reacts to that
        // drift anymore — only the reversed buffer's own onended below
        // decides when reverse is done, which is what actually fixes the
        // erratic "plays for a bit then gets stuck looping" bug (it used
        // to come from these two independent clocks racing each other)
        this.audio.muted = true;
        
        // create a new buffer source for reversed playback
        this.bufferSourceNode = this.audioContext.createBufferSource();
        this.bufferSourceNode.buffer = reversedBuffer;
        
        // connect through a dedicated gain node, then through equivalent
        // nodes for whichever OTHER effects are currently active, so this
        // doesn't go completely unprocessed compared to normal playback
        this.reverseGainNode.gain.value = this.audio.volume;
        this.bufferSourceNode.connect(this.reverseGainNode);

        this.mirrorNodes = [];
        let lastNode = this.reverseGainNode;
        const activeKeys = this.effectsRegistry ? this.effectsRegistry.getActiveEffectKeys() : [];
        activeKeys.forEach(key => {
            if (key === 'reverse') return;
            const effectInstance = this.effectsRegistry.effects[key];
            const mirror = buildMirrorEffectNodes(this.audioContext, key, effectInstance);
            if (mirror) {
                lastNode.connect(mirror.input);
                lastNode = mirror.output;
                this.mirrorNodes.push(...mirror.extraNodes);
            }
        });
        lastNode.connect(this.mainGainNode);

        // match the active Speed effect (see getReverseSpeedFactor for the
        // pitch-coupling caveat with a raw buffer source)
        this.bufferSourceNode.playbackRate.value = this.getReverseSpeedFactor(activeKeys);
        
        // calculate start position in the buffer
        const startOffset = reversedPosition * reversedBuffer.duration;
        
        // start playback from calculated position
        this.bufferSourceNode.start(0, startOffset);
        this.isReversePlaying = true;
        
        // set up tracking for reverse playback time
        this.lastUpdateTime = this.audioContext.currentTime;
        this.currentPlaybackTime = reversedPosition * regionDuration;
        this.reverseStartedAt = this.audioContext.currentTime;
        const maxReverseDuration = regionDuration * 1.5 + 1; // safety margin

        // drives the progress bar and keeps the reversed buffer's rate in
        // sync with the Speed effect — driven by its own rAF loop instead of
        // the audio element's 'timeupdate', since that's the only thing
        // that fired reliably during reverse before
        const tick = () => {
            if (!this.isReversePlaying) return;

            // safety net: if something goes wrong (e.g. rounding on the
            // buffer duration) and onended never fires, force a stop rather
            // than let this run forever and require a page reload
            if (this.audioContext.currentTime - this.reverseStartedAt > maxReverseDuration) {
                this.stopReversePlayback();
                this.audio.currentTime = regionStart;
                this.audio.muted = false;
                return;
            }

            if (this.bufferSourceNode) {
                const targetRate = this.getReverseSpeedFactor(
                    this.effectsRegistry ? this.effectsRegistry.getActiveEffectKeys() : []
                );
                if (this.bufferSourceNode.playbackRate.value !== targetRate) {
                    this.bufferSourceNode.playbackRate.value = targetRate;
                }
            }

            const now = this.audioContext.currentTime;
            const elapsed = now - this.lastUpdateTime;
            this.lastUpdateTime = now;

            if (this.currentPlaybackTime !== null) {
                // in reverse, subtract time rather than add
                this.currentPlaybackTime -= elapsed;
                this.progressBar.value = regionEnd - this.currentPlaybackTime;
            }

            this.animationFrameId = requestAnimationFrame(tick);
        };
        this.animationFrameId = requestAnimationFrame(tick);
        
        // when reverse playback reaches the beginning of the region, loop
        // it — restarting deterministically from the exact end of the
        // region via seekPosition. crucially, this does NOT touch
        // audio.currentTime: doing that fires a 'timeupdate' event, and
        // since stopReversePlayback() just set isReversePlaying to false,
        // handleTimeUpdate's own entry-check could react to THAT event and
        // call startReversePlayback() itself first — using the stale
        // position, before this function gets to set seekPosition. that
        // race is what caused every loop to collapse into a tiny ~0.2-1s
        // blip near the start of the region, no matter its actual size.
        // the (muted) element just keeps drifting forward in the
        // background; nothing reacts to that while isReversePlaying is true
        this.bufferSourceNode.onended = () => {
            if (this.isReversePlaying) {
                this.stopReversePlayback();
                this.seekPosition = regionEnd;
                this.startReversePlayback();
            }
        };
    }
    
    // stop playing reversed audio
    stopReversePlayback() {
        if (!this.isReversePlaying) return;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        // stop and disconnect the buffer source node
        if (this.bufferSourceNode) {
            this.bufferSourceNode.onended = null; // remove event handler
            this.bufferSourceNode.stop();
            this.bufferSourceNode.disconnect();
            this.bufferSourceNode = null;
        }

        this.reverseGainNode.disconnect();
        this.mirrorNodes.forEach(node => {
            if (typeof node.stop === 'function') {
                try { node.stop(); } catch (e) { /* already stopped */ }
            }
            node.disconnect();
        });
        this.mirrorNodes = [];
        
        this.isReversePlaying = false;
        this.currentPlaybackTime = null;
    }

    // decides the reversed buffer's playback rate from the currently active
    // Speed effect. note: a raw AudioBufferSourceNode has no equivalent to
    // the native preservesPitch, so changing its rate always changes pitch
    // a bit too — there's no way to time-stretch it without a proper pitch-
    // shifting algorithm. Speed still applies on its own though, since
    // "no effect at all unless Pitch Shift is also on" was more confusing
    // than a bit of incidental pitch change
    getReverseSpeedFactor(activeKeys) {
        const speedKey = activeKeys.find(key => key.startsWith('speed'));
        if (!speedKey) return 1;
        const factor = this.effectsRegistry?.effects[speedKey]?.speedFactor;
        return Number.isFinite(factor) ? factor : 1;
    }
    
    // create a reversed copy of the audio buffer for the selected region
    createReversedBuffer(startTime, endTime) {
        const startSample = Math.floor(startTime * this.audioBuffer.sampleRate);
        const endSample = Math.floor(endTime * this.audioBuffer.sampleRate);
        const regionLength = endSample - startSample;
        
        // create a new buffer for the reversed audio
        const reversedBuffer = this.audioContext.createBuffer(
            this.audioBuffer.numberOfChannels,
            regionLength,
            this.audioBuffer.sampleRate
        );
        
        // reverse each channel
        for (let channel = 0; channel < this.audioBuffer.numberOfChannels; channel++) {
            const originalData = this.audioBuffer.getChannelData(channel);
            const reversedData = reversedBuffer.getChannelData(channel);
            
            for (let i = 0; i < regionLength; i++) {
                // copy samples in reverse order
                reversedData[i] = originalData[endSample - 1 - i];
            }
        }
        
        return reversedBuffer;
    }
    
    // override deactivate to ensure cleanup
    deactivate() {
        if (this.active) {
            this.stopReversePlayback();
            if (this.audio) {
                // just unmute — the effect never calls pause() on this
                // element itself (that used to be the cause of a much worse
                // bug), so if it's paused here, the user paused it on
                // purpose and we must not override that
                this.audio.muted = false;
            }
            if (this.cleanup) this.cleanup();
            this.active = false;
            console.log(`${this.name} effect deactivated`);
        }
    }
}

export class PlaybackSpeedEffect extends AudioEffect {
    constructor(speedFactor) {
        super(`Speed ${speedFactor}x`);
        this.speedFactor = Math.max(0.5, Math.min(2, Number(speedFactor) || 1));
        this.applyPlaybackRate = null;
        this.speedTimeUpdateHandler = null;
        this.removalFrameId = null;
    }

    activate(...args) {
        this.finishPendingDeactivation();
        super.activate(...args);
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        // no audio nodes needed for this effect
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        const handleTimeUpdate = () => {
            if (progressBar.selectedStartTime !== undefined && 
                progressBar.selectedEndTime !== undefined) {
                
                const currentTime = audio.currentTime;
                const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                         currentTime <= progressBar.selectedEndTime;
                
                if (isInSelectedRegion) {
                    audio.playbackRate = this.speedFactor;
                } else {
                    audio.playbackRate = 1.0;
                }
            }
        };

        this.applyPlaybackRate = handleTimeUpdate;
        this.speedTimeUpdateHandler = handleTimeUpdate;
        audio.addEventListener('timeupdate', handleTimeUpdate);
        requestAnimationFrame(handleTimeUpdate);
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.playbackRate = 1.0;
            this.applyPlaybackRate = null;
            this.speedTimeUpdateHandler = null;
        };
    }

    setSpeedFactor(value) {
        this.speedFactor = Math.max(0.5, Math.min(2, Number(value) || this.speedFactor));
        this.name = `Speed ${this.speedFactor.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
        this.applyPlaybackRate?.();
        return this.speedFactor;
    }

    getSettings() {
        return { speedFactor: this.speedFactor };
    }

    applySettings(settings = {}) {
        if (settings.speedFactor !== undefined) this.setSpeedFactor(settings.speedFactor);
        return this.getSettings();
    }

    deactivate(duration = 0) {
        if (!this.active) return;
        if (!(duration > 0) || !this.audio) {
            super.deactivate();
            return;
        }

        const audio = this.audio;
        if (this.speedTimeUpdateHandler) {
            audio.removeEventListener('timeupdate', this.speedTimeUpdateHandler);
        }
        this.speedTimeUpdateHandler = null;
        this.applyPlaybackRate = null;
        this.cleanup = null;
        this.active = false;

        const startRate = audio.playbackRate;
        const startedAt = performance.now();
        const transitionMs = duration * 1000;
        const animate = timestamp => {
            const progress = Math.min(1, (timestamp - startedAt) / transitionMs);
            // Smoothstep avoids an abrupt change in acceleration at either
            // end while preserving a predictable total transition time.
            const eased = progress * progress * (3 - 2 * progress);
            audio.playbackRate = startRate + (1 - startRate) * eased;
            if (progress < 1) {
                this.removalFrameId = requestAnimationFrame(animate);
            } else {
                audio.playbackRate = 1;
                this.removalFrameId = null;
            }
        };
        this.removalFrameId = requestAnimationFrame(animate);
        console.log(`${this.name} effect returning to normal over ${duration}s`);
    }

    finishPendingDeactivation() {
        if (this.removalFrameId !== null) {
            cancelAnimationFrame(this.removalFrameId);
            this.removalFrameId = null;
        }
        if (this.audio) this.audio.playbackRate = 1;
    }
}

export class PitchShiftEffect extends AudioEffect {
    constructor() {
        super('Pitch Shift');
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        // store the audio reference for later use
        this.audioContextData = { audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode };
    }
    
    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        this.audio = audio;
        
        audio.preservesPitch = false;
        
        const handleTimeUpdate = () => {
            if (progressBar.selectedStartTime !== undefined && 
                progressBar.selectedEndTime !== undefined) {
                
                const currentTime = audio.currentTime;
                const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                         currentTime <= progressBar.selectedEndTime;
                
                audio.preservesPitch = !isInSelectedRegion;
            }
        };
    
        audio.addEventListener('timeupdate', handleTimeUpdate);
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.preservesPitch = true;
        };
    }
}