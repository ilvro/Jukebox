import { initializeAudioContext, disconnectAudioContext, getAudioContext } from '../audio-context.js';
import { AudioEffect } from './base-effect.js';

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
        this.CROSSFADE_DURATION = 2;
    }

    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {
        // no nodes needed
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        const handleTimeUpdate = () => {
            if (!this.active || !progressBar.selectedStartTime || !progressBar.selectedEndTime) return;

            const loopEndTime = progressBar.selectedEndTime;
            const timeUntilEnd = loopEndTime - audio.currentTime;

            if (timeUntilEnd <= this.CROSSFADE_DURATION && !this.crossfading && audio.volume >= 0) {
                this.startCrossfade();
            }
        };

        audio.addEventListener('timeupdate', handleTimeUpdate);
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            if (this.crossfadeAudio) {
                this.crossfadeAudio.pause();
                this.crossfadeAudio = null;
            }
            audio.volume = 1;
            this.crossfading = false;
        };
    }

    startCrossfade(audio, progressBar) {
        audio = this.audio;
        progressBar = this.progressBar; // dont ask, it works and i want to sleep
        this.crossfading = true;

        this.crossfadeAudio = new Audio(audio.src);
        this.crossfadeAudio.currentTime = progressBar.selectedStartTime;
        this.crossfadeAudio.playbackRate = audio.playbackRate;
        this.crossfadeAudio.volume = 0;

        const startTime = performance.now();
        const animate = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            const progress = Math.min(elapsed / this.CROSSFADE_DURATION, 1);

            if (!this.active) {
                if (this.crossfadeAudio) {
                    this.crossfadeAudio.pause();
                    this.crossfadeAudio = null;
                }
                audio.volume = 1;
                this.crossfading = false;
                return;
            }

            audio.volume = Math.max(0, 1 - progress);
            if (this.crossfadeAudio) {
                this.crossfadeAudio.volume = Math.min(1, progress);
            }

            if (progress < 1 && this.active) {
                requestAnimationFrame(animate);
            } else if (this.active) {
                audio.currentTime = progressBar.selectedStartTime + this.CROSSFADE_DURATION;
                audio.volume = 1;
                if (this.crossfadeAudio) {
                    this.crossfadeAudio.pause();
                    this.crossfadeAudio = null;
                }
                this.crossfading = false;
            }
        };

        this.crossfadeAudio.play().catch(error => {
            console.error("Error playing crossfade audio:", error);
            this.crossfading = false;
            if (this.crossfadeAudio) {
                this.crossfadeAudio = null;
            }
            audio.volume = 1;
        });

        requestAnimationFrame(animate);
    }

    deactivate() {
        if (this.active) {
            if (this.crossfadeAudio) {
                this.crossfadeAudio.pause();
                this.crossfadeAudio = null;
            }
            this.audio.volume = 1;
            this.crossfading = false;
            if (this.cleanup) this.cleanup();
            this.active = false;
        }
    }
}

export class PlaybackSpeedEffect extends AudioEffect {
    constructor(speedFactor) {
        super(`Speed ${speedFactor}x`);
        this.speedFactor = speedFactor;
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
    
        audio.addEventListener('timeupdate', handleTimeUpdate);
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.playbackRate = 1.0;
        };
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