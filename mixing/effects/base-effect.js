export class AudioEffect {
    constructor(name, category) {
        this.name = name;
        this.category = category || 'Misc';
        this.active = false;
        this.nodes = null;
        this.cleanup = null;
        this.audioContextData = null;
        this.audio = null;
        this.progressBar = null;
    }

    activate(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode, audio, progressBar) { // this has to be called on every audio effect. without this function it wont be applied to the audio context menu and the effect wont work
        if (!this.active && audioContext) {
            // store audio context data and audio element for later use
            this.audioContextData = { 
                audioContext, 
                sourceNode, 
                dryGainNode, 
                wetGainNode, 
                mainGainNode 
            };
            this.audio = audio;
            this.progressBar = progressBar;
            
            // set up nodes and event listeners
            this.setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode);
            this.setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode);
            
            this.active = true;
            console.log(`${this.name} effect activated`);
        }
    }

    deactivate() {
        if (this.active && this.audioContextData?.audioContext) {
            if (this.cleanup) {
                this.cleanup();
            }
            
            // ensure the dry path is restored
            if (this.audioContextData.dryGainNode && this.audioContextData.wetGainNode) {
                this.audioContextData.dryGainNode.gain.setValueAtTime(
                    1, 
                    this.audioContextData.audioContext.currentTime
                );
                this.audioContextData.wetGainNode.gain.setValueAtTime(
                    0, 
                    this.audioContextData.audioContext.currentTime
                );
            }
            
            this.active = false;
            console.log(`${this.name} effect deactivated`);
        }
    }

    toggle(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode, audio, progressBar) {
        if (this.active) {
            this.deactivate();
        } else {
            this.activate(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode, audio, progressBar);
        }
        return this.active;
    }

    // handler to make effects region-based
    createRegionBasedHandler(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        return () => {
            if (!this.active || !progressBar.selectedStartTime || !progressBar.selectedEndTime) {
                return;
            }
            
            const currentTime = audio.currentTime;
            const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                     currentTime <= progressBar.selectedEndTime;
            
            const transitionTime = 0.05;
            
            wetGainNode.gain.setTargetAtTime(
                isInSelectedRegion ? 1 : 0,
                audioContext.currentTime,
                transitionTime
            );
            
            dryGainNode.gain.setTargetAtTime(
                isInSelectedRegion ? 0 : 1,
                audioContext.currentTime,
                transitionTime
            );
        };
    }

    // to be implemented by subclasses
    setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) {}
    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {}
}

export class RegionBasedEffect extends AudioEffect {
    constructor(name, category) {
        super(name, category);
    }

    setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) {
        const handleTimeUpdate = this.createRegionBasedHandler(
            audio, audioContext, progressBar, dryGainNode, wetGainNode
        );
        
        audio.addEventListener('timeupdate', handleTimeUpdate);
        
        this.cleanup = () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            if (this.nodes) {
                Object.values(this.nodes).forEach(node => {
                    if (node && typeof node.disconnect === 'function') {
                        node.disconnect();
                    }
                });
            }
        };
    }
}

export class PlaybackEffect extends AudioEffect {
    constructor(name) {
        super(name, 'Playback');
    }
}

export class FilterEffect extends RegionBasedEffect {
    constructor(name, type) {
        super(name, 'Filters');
        this.filterType = type;
    }
}