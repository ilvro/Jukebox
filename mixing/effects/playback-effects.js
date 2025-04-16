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

// not gonna lie this one was entirely vibe coded
// i dont really know how this effect works
// the comments are me trying to understand each line
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
            if (!this.active || !progressBar.selectedStartTime || !progressBar.selectedEndTime || !this.audioBuffer) {
                return;
            }

            const currentTime = audio.currentTime;
            const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                       currentTime <= progressBar.selectedEndTime;
            
            // if we just entered the region
            if (isInSelectedRegion && !this.isReversePlaying) {
                this.startReversePlayback();
                console.log('looping? maybe')
            } 
            // if we just left the region
            else if (!isInSelectedRegion && this.isReversePlaying) {
                this.stopReversePlayback();
                audio.muted = false;
                audio.play(); // Resume normal playback
            }
            
            // update progress bar when playing in reverse
            if (this.isReversePlaying) {
                // calculate elapsed time since last update
                const now = this.audioContext.currentTime;
                const elapsed = now - this.lastUpdateTime;
                this.lastUpdateTime = now;
                
                // update our internal tracker for position in reverse
                if (this.currentPlaybackTime !== null) {
                    // In ueverse, subtract time rather than add
                    this.currentPlaybackTime -= elapsed;
                    
                    // calculate position in the original timeline
                    const regionDuration = progressBar.selectedEndTime - progressBar.selectedStartTime;
                    const reversedPosition = progressBar.selectedEndTime - 
                        ((this.currentPlaybackTime / regionDuration) * regionDuration);
                    
                    // update the progress bar without triggering 'timeupdate'
                    progressBar.value = reversedPosition;
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
                    // user seeked outside the region
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
        const positionInRegion = (currentPosition - regionStart) / regionDuration;
        const reversedPosition = 1 - positionInRegion; // reverse the position
        
        // create the reversed buffer
        const reversedBuffer = this.createReversedBuffer(regionStart, regionEnd);
        
        // mute the original audio but don't pause it (for progress tracking)
        this.audio.muted = true;
        
        // create a new buffer source for reversed playback
        this.bufferSourceNode = this.audioContext.createBufferSource();
        this.bufferSourceNode.buffer = reversedBuffer;
        
        // connect through dedicated gain node for volume control
        this.bufferSourceNode.connect(this.reverseGainNode);
        this.reverseGainNode.connect(this.mainGainNode);
        
        // set the gain to match current volume
        this.reverseGainNode.gain.value = this.audio.volume;
        
        // calculate start position in the buffer
        const startOffset = reversedPosition * reversedBuffer.duration;
        
        // start playback from calculated position
        this.bufferSourceNode.start(0, startOffset);
        this.isReversePlaying = true;
        
        // set up tracking for reverse playback time
        this.lastUpdateTime = this.audioContext.currentTime;
        this.currentPlaybackTime = reversedPosition * regionDuration;
        
        // when reverse playback reaches the beginning of the region,
        // resume normal playback from the beginning of the region
        this.bufferSourceNode.onended = () => {
            if (this.isReversePlaying) {
                this.stopReversePlayback();
                this.audio.currentTime = regionStart;
                this.audio.muted = false;
                this.audio.play();
            }
        };
    }
    
    // stop playing reversed audio
    stopReversePlayback() {
        if (!this.isReversePlaying) return;
        
        // stop and disconnect the buffer source node
        if (this.bufferSourceNode) {
            this.bufferSourceNode.onended = null; // remove event handler
            this.bufferSourceNode.stop();
            this.bufferSourceNode.disconnect();
            this.bufferSourceNode = null;
        }
        
        this.isReversePlaying = false;
        this.currentPlaybackTime = null;
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
                this.audio.muted = false;
                // ensure audio is still playable after deactivation
                if (this.audio.paused) {
                    this.audio.play().catch(e => console.error("Failed to resume audio:", e));
                }
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