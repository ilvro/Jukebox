export function setupAudioEffects(audio, progressBar) {
    let crossfadeAudio = null;
    const CROSSFADE_DURATION = 2;
    let originalPlaybackRate = 1;

    let audioContext = null;
    let sourceNode = null;
    let mainGainNode = null;
    let reverbNodes = null;
    let dryGainNode = null;
    let wetGainNode = null;
    let isAudioContextInitialized = false;
    let timeUpdateHandler = null;

    function initializeAudioContext() {
        if (!audioContext) {
            const contextOptions = {
                latencyHint: 'playback',
                sampleRate: 48000,
            };
            
            audioContext = new (window.AudioContext || window.webkitAudioContext)(contextOptions);
            sourceNode = audioContext.createMediaElementSource(audio);
            
            mainGainNode = audioContext.createGain();
            dryGainNode = audioContext.createGain();
            wetGainNode = audioContext.createGain();
            
            sourceNode.connect(dryGainNode);
            sourceNode.connect(wetGainNode);
            
            dryGainNode.connect(mainGainNode);
            mainGainNode.connect(audioContext.destination);
            isAudioContextInitialized = true;
        } else if (!isAudioContextInitialized) {
            sourceNode.connect(dryGainNode);
            sourceNode.connect(wetGainNode);
            dryGainNode.connect(mainGainNode);
            mainGainNode.connect(audioContext.destination);
            isAudioContextInitialized = true;
        }
    }

    function disconnectAudioContext() {
        if (isAudioContextInitialized) {
            try {
                if (wetGainNode) {
                    wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
                }
                if (dryGainNode) {
                    dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);
                }

                // disconnect reverb-related nodes
                if (reverbNodes) {
                    reverbNodes.delays.forEach(delay => delay.disconnect());
                    reverbNodes.gains.forEach(gain => gain.disconnect());
                    reverbNodes.output.disconnect();
                    reverbNodes = null;
                }

                // disconnect wet path but keep dry path intact
                if (sourceNode) {
                    sourceNode.disconnect(wetGainNode);
                }

                isAudioContextInitialized = false;
            } catch (error) {
                console.error("error disconnecting nodes:", error);
            }
        }
    }

    function createSyntheticReverb() {
        const nodes = {
            delays: [],
            gains: [],
            output: audioContext.createGain()
        };
    
        const delayTimes = [
            0.02, // pre-delay
            0.05, 0.08, 0.1, 0.15, 
            0.2, 0.25, 0.3, 0.35, // more points for smoother decay
            0.4
        ];
        
        const gainValues = [
            0.8, // initial reflection
            0.6, 0.5, 0.4, 0.35,
            0.3, 0.25, 0.2, 0.15, // gentler decay
            0.1
        ];
    
        for (let i = 0; i < delayTimes.length; i++) {
            const delay = audioContext.createDelay(1);
            delay.delayTime.value = delayTimes[i];
    
            const gain = audioContext.createGain();
            gain.gain.value = gainValues[i];
    
            nodes.delays.push(delay);
            nodes.gains.push(gain);
    
            if (i === 0) {
                wetGainNode.connect(delay);
            } else {
                nodes.delays[i - 1].connect(delay);
            }
            delay.connect(gain);
            gain.connect(nodes.output);
        }
    
        nodes.output.connect(mainGainNode);
        return nodes;
    }

    function createTremolo() {
        const tremolo = audioContext.createGain();
        const lfo = audioContext.createOscillator();
        const lfoGain = audioContext.createGain();
        
        lfo.frequency.value = 4.0;
        lfoGain.gain.value = 0.5;
        
        // connect LFO through gain to modulate tremolo gain
        lfo.connect(lfoGain);
        lfoGain.connect(tremolo.gain);
        lfo.start();
        
        // connect the tremolo into the audio chain
        wetGainNode.connect(tremolo);
        tremolo.connect(mainGainNode);
        
        return {
            tremolo,
            lfo
        };
    }

    function createFilter(type) {
        const filter = audioContext.createBiquadFilter();
        filter.type = type;
        
        if (type === 'highpass') {
            filter.frequency.value = 500;
            filter.Q.value = 0.7;
        } else if (type === 'lowpass') {
            filter.frequency.value = 2000;
            filter.Q.value = 0.7;
        }

        if (audioContext.sampleRate >= 96000) {
            filter.oversample = '4x';
        } else if (audioContext.sampleRate >= 48000) {
            filter.oversample = '2x';
        }

        return filter;
    }

    function createEnhancedSpeedProcessor(speed) {
        const processor = {
            delay: audioContext.createDelay(2.0),
            lowpass: audioContext.createBiquadFilter(),
            highpass: audioContext.createBiquadFilter(),
            echo: audioContext.createDelay(1.0),
            echoGain: audioContext.createGain(),
            outputGain: audioContext.createGain()
        };

        processor.lowpass.type = 'lowpass';
        processor.lowpass.frequency.value = speed < 1 ? 8000 : 12000; // warmer sound for slowed versions
        processor.lowpass.Q.value = 0.5;

        processor.highpass.type = 'highpass';
        processor.highpass.frequency.value = speed < 1 ? 20 : 40;
        processor.highpass.Q.value = 0.5;

        processor.echo.delayTime.value = speed < 1 ? 0.08 : 0.04;
        processor.echoGain.gain.value = speed < 1 ? 0.3 : 0.15;
        processor.outputGain.gain.value = 0.9;

        wetGainNode.connect(processor.highpass);
        processor.highpass.connect(processor.lowpass);
        processor.lowpass.connect(processor.delay);
        processor.delay.connect(processor.echo);
        processor.echo.connect(processor.echoGain);
        processor.echoGain.connect(processor.delay);
        processor.delay.connect(processor.outputGain);
        processor.outputGain.connect(mainGainNode);

        return processor;
    }

    function createNightcoreProcessor() {
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
    
        // adjusted compressor settings for better dynamics
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
    
        processor.presence.type = 'peaking';
        processor.presence.frequency.value = 2500;
        processor.presence.Q.value = 0.7;
        processor.presence.gain.value = 2;
    
        // light reverb for space
        processor.sparkleReverb.delayTime.value = 0.06;
        processor.reverbGain.gain.value = 0.15;
        processor.outputGain.gain.value = 1.0;
    
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
    

    const effects = {
        loop: {
            name: 'Loop',
            active: false,
            toggle: function() {
                if (progressBar.selectedStartTime === undefined || 
                    progressBar.selectedEndTime === undefined) {
                    return false;
                }
                this.active = !this.active;
                return this.active;
            },
            handler: function() {
                if (this.active && progressBar.selectedStartTime !== undefined && 
                    progressBar.selectedEndTime !== undefined) {
                    const precision = 0.01;
                    if (audio.currentTime >= progressBar.selectedEndTime - precision) {
                        audio.currentTime = progressBar.selectedStartTime;
                    }
                }
            }
        },
        smoothLoop: {
            name: 'Smooth Loop',
            active: false,
            crossfading: false,
            toggle: function() {
                if (progressBar.selectedStartTime === undefined || 
                    progressBar.selectedEndTime === undefined) {
                    return false;
                }
                this.active = !this.active;
                this.crossfading = false;
                
                // clean up previous crossfade audio
                if (!this.active && crossfadeAudio) {
                    crossfadeAudio.pause();
                    crossfadeAudio = null;
                }
                
                return this.active;
            },
            handler: function() {
                if (!this.active || !progressBar.selectedStartTime || !progressBar.selectedEndTime) return;

                const loopEndTime = progressBar.selectedEndTime;
                const timeUntilEnd = loopEndTime - audio.currentTime;

                // start crossfade when approaching the end of the loop
                if (timeUntilEnd <= CROSSFADE_DURATION && !this.crossfading && audio.volume >= 0) {
                    this.crossfading = true;

                    // create and set up the crossfade audio
                    crossfadeAudio = new Audio(audio.src);
                    crossfadeAudio.currentTime = progressBar.selectedStartTime;
                    crossfadeAudio.playbackRate = getEffectivePlaybackRate(progressBar.selectedStartTime);
                    crossfadeAudio.volume = 0;
                    
                    const startTime = performance.now();
                    const animate = () => {
                        const elapsed = (performance.now() - startTime) / 1000;
                        const progress = Math.min(elapsed / CROSSFADE_DURATION, 1);
                        
                        if (!this.active) {
                            if (crossfadeAudio) {
                                crossfadeAudio.pause();
                                crossfadeAudio = null;
                            }
                            audio.volume = 1;
                            this.crossfading = false;
                            return;
                        }

                        // fade out original audio
                        audio.volume = Math.max(0, 1 - progress);
                        // fade in crossfade audio
                        if (crossfadeAudio) {
                            crossfadeAudio.volume = Math.min(1, progress);
                        }
                        
                        if (progress < 1 && this.active) {
                            requestAnimationFrame(animate);
                        } else if (this.active) {
                            // crossfade complete - prepare for next loop
                            audio.currentTime = progressBar.selectedStartTime + CROSSFADE_DURATION;
                            audio.volume = 1;
                            if (crossfadeAudio) {
                                crossfadeAudio.pause();
                                crossfadeAudio = null;
                            }
                            this.crossfading = false;
                        }
                    };
                    
                    crossfadeAudio.play().catch(error => {
                        console.error("Error playing crossfade audio:", error);
                        this.crossfading = false;
                        if (crossfadeAudio) {
                            crossfadeAudio = null;
                        }
                        audio.volume = 1;
                    });
                    
                    requestAnimationFrame(animate);
                }
            }
        },
        echo: {
            name: 'Echo',
            active: false,
            nodes: null,
            toggle: function() {
                this.active = !this.active;
                
                if (this.active) {
                    initializeAudioContext();
                    const delay = audioContext.createDelay(2.0);
                    delay.delayTime.value = 0.3;
                    
                    const feedback = audioContext.createGain();
                    feedback.gain.value = 0.4;
                    
                    const echoGain = audioContext.createGain();
                    echoGain.gain.value = 0.5;
                    
                    wetGainNode.connect(delay);
                    delay.connect(feedback);
                    feedback.connect(delay);
                    delay.connect(echoGain);
                    echoGain.connect(mainGainNode);
                    
                    this.nodes = {
                        delay,
                        feedback,
                        echoGain
                    };
                    
                    const handleTimeUpdate = () => {
                        if (progressBar.selectedStartTime !== undefined && 
                            progressBar.selectedEndTime !== undefined) {
                            
                            const currentTime = audio.currentTime;
                            const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                                     currentTime <= progressBar.selectedEndTime;
                            
                            const transitionTime = 0.05;
                            wetGainNode.gain.setTargetAtTime(
                                isInSelectedRegion ? 0.7 : 0, 
                                audioContext.currentTime, 
                                transitionTime
                            );
                            dryGainNode.gain.setTargetAtTime(
                                isInSelectedRegion ? 0.7 : 1, 
                                audioContext.currentTime, 
                                transitionTime
                            );
                        }
                    };
                    
                    audio.addEventListener('timeupdate', handleTimeUpdate);
                    this.cleanup = () => {
                        audio.removeEventListener('timeupdate', handleTimeUpdate);
                        if (this.nodes) {
                            wetGainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.1);
                            setTimeout(() => {
                                wetGainNode.disconnect(this.nodes.delay);
                                this.nodes.delay.disconnect();
                                this.nodes.feedback.disconnect();
                                this.nodes.echoGain.disconnect();
                                this.nodes = null;
                            }, 200);
                        }
                        wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
                        dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);
                    };
                    wetGainNode.gain.value = 0;
                    dryGainNode.gain.value = 1;
                    
                } else {
                    if (this.cleanup) {
                        this.cleanup();
                    }
                }
                
                return this.active;
            },
            setDelayTime: function(value) {
                if (this.nodes && this.nodes.delay) {
                    this.nodes.delay.delayTime.setValueAtTime(value, audioContext.currentTime);
                }
            },
            setFeedback: function(value) {
                if (this.nodes && this.nodes.feedback) {
                    this.nodes.feedback.gain.setValueAtTime(value, audioContext.currentTime);
                }
            }
        },
        reverb: {
            name: 'Reverb',
            active: false,
            toggle: function() {
                this.active = !this.active;
                
                if (this.active) {
                    initializeAudioContext();
                    reverbNodes = createSyntheticReverb();

                    const handleTimeUpdate = () => {
                        if (progressBar.selectedStartTime !== undefined && 
                            progressBar.selectedEndTime !== undefined) {
                            
                            const currentTime = audio.currentTime;
                            const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                                     currentTime <= progressBar.selectedEndTime;
                            
                            // smoothly transition the wet/dry mix
                            const transitionTime = 0.05;
                            wetGainNode.gain.setTargetAtTime(
                                isInSelectedRegion ? 0.5 : 0, 
                                audioContext.currentTime, 
                                transitionTime
                            );
                            dryGainNode.gain.setTargetAtTime(
                                isInSelectedRegion ? 0.5 : 1, 
                                audioContext.currentTime, 
                                transitionTime
                            );
                        }
                    };
                    
                    audio.addEventListener('timeupdate', handleTimeUpdate);
                    this.cleanup = () => {
                        audio.removeEventListener('timeupdate', handleTimeUpdate);
                        disconnectAudioContext();
                    };
                    wetGainNode.gain.value = 0;
                    dryGainNode.gain.value = 1;
                    
                } else {
                    if (this.cleanup) {
                        this.cleanup();
                    }
                }
                
                return this.active;
            }
        },
        highpass: {
            name: 'High-Pass Filter',
            active: false,
            filter: null,
            toggle: function() {
                this.active = !this.active;
                
                if (this.active) {
                    initializeAudioContext();
                    this.filter = createFilter('highpass');
                    
                    wetGainNode.connect(this.filter);
                    this.filter.connect(mainGainNode);
                    
                    const handleTimeUpdate = () => {
                        if (progressBar.selectedStartTime !== undefined && 
                            progressBar.selectedEndTime !== undefined) {
                            
                            const currentTime = audio.currentTime;
                            const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                                     currentTime <= progressBar.selectedEndTime;
                            
                            // transition time for smoother crossfade
                            const transitionTime = 0.1;
                            wetGainNode.gain.setTargetAtTime(
                                isInSelectedRegion ? 0.9999 : 0,
                                audioContext.currentTime,
                                transitionTime
                            );
                            dryGainNode.gain.setTargetAtTime(
                                isInSelectedRegion ? 0 : 0.9999,
                                audioContext.currentTime,
                                transitionTime
                            );
                        }
                    };
                    
                    audio.addEventListener('timeupdate', handleTimeUpdate);
                    this.cleanup = () => {
                        audio.removeEventListener('timeupdate', handleTimeUpdate);
                        if (this.filter) {
                            // smooth disconnection
                            wetGainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.1);
                            setTimeout(() => {
                                wetGainNode.disconnect(this.filter);
                                this.filter.disconnect();
                                this.filter = null;
                            }, 200);
                        }
                        // reset gains smoothly
                        wetGainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.1);
                        dryGainNode.gain.setTargetAtTime(0.9999, audioContext.currentTime, 0.1);
                    };
                    
                    // initialize gains
                    wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
                    dryGainNode.gain.setValueAtTime(0.9999, audioContext.currentTime);
                    
                } else {
                    if (this.cleanup) {
                        this.cleanup();
                    }
                }
                
                return this.active;
            },
            setFrequency: function(value) {
                if (this.filter) {
                    // exponential ramp for smoother frequency changes
                    this.filter.frequency.exponentialRampToValueAtTime(
                        value,
                        audioContext.currentTime + 0.1
                    );
                }
            },
            setQ: function(value) {
                if (this.filter) {
                    // linear ramp for Q changes
                    this.filter.Q.linearRampToValueAtTime(
                        value,
                        audioContext.currentTime + 0.1
                    );
                }
            }
        },

        lowpass: {
            name: 'Low-Pass Filter',
            active: false,
            filter: null,
            toggle: function() {
                this.active = !this.active;
                
                if (this.active) {
                    initializeAudioContext();
                    this.filter = createFilter('lowpass');
                    
                    // connect filter to the audio path
                    wetGainNode.connect(this.filter);
                    this.filter.connect(mainGainNode);
                    
                    const handleTimeUpdate = () => {
                        if (progressBar.selectedStartTime !== undefined && 
                            progressBar.selectedEndTime !== undefined) {
                            
                            const currentTime = audio.currentTime;
                            const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                                     currentTime <= progressBar.selectedEndTime;
                            
                            // smoothly transition the wet/dry mix
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
                        }
                    };
                    
                    audio.addEventListener('timeupdate', handleTimeUpdate);
                    this.cleanup = () => {
                        audio.removeEventListener('timeupdate', handleTimeUpdate);
                        if (this.filter) {
                            wetGainNode.disconnect(this.filter);
                            this.filter.disconnect();
                            this.filter = null;
                        }
                        // reset gains
                        wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
                        dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);
                    };
                    
                    // initialize gains
                    wetGainNode.gain.value = 0;
                    dryGainNode.gain.value = 1;
                    
                } else {
                    if (this.cleanup) {
                        this.cleanup();
                    }
                }
                
                return this.active;
            },
            setFrequency: function(value) {
                if (this.filter) {
                    this.filter.frequency.setValueAtTime(value, audioContext.currentTime);
                }
            },
            setQ: function(value) {
                if (this.filter) {
                    this.filter.Q.setValueAtTime(value, audioContext.currentTime);
                }
            }
        },

        tremolo: {
            name: 'Tremolo',
            active: false,
            nodes: null,
            toggle: function() {
                this.active = !this.active;
                
                if (this.active) {
                    initializeAudioContext();
                    this.nodes = createTremolo();
                    
                    const handleTimeUpdate = () => {
                        if (progressBar.selectedStartTime !== undefined && 
                            progressBar.selectedEndTime !== undefined) {
                            
                            const currentTime = audio.currentTime;
                            const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                                     currentTime <= progressBar.selectedEndTime;
                            
                            // smoothly transition the wet/dry mix
                            const transitionTime = 0.05;
                            wetGainNode.gain.setTargetAtTime(
                                isInSelectedRegion ? 0.5 : 0, 
                                audioContext.currentTime, 
                                transitionTime
                            );
                            dryGainNode.gain.setTargetAtTime(
                                isInSelectedRegion ? 0.5 : 1, 
                                audioContext.currentTime, 
                                transitionTime
                            );
                        }
                    };
                    
                    audio.addEventListener('timeupdate', handleTimeUpdate);
                    this.cleanup = () => {
                        audio.removeEventListener('timeupdate', handleTimeUpdate);
                        if (this.nodes) {
                            this.nodes.lfo.stop();
                            wetGainNode.disconnect(this.nodes.tremolo);
                            this.nodes.tremolo.disconnect();
                            this.nodes = null;
                        }
                        // reset gains
                        wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
                        dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);
                    };
                    
                    // initialize gains
                    wetGainNode.gain.value = 0;
                    dryGainNode.gain.value = 1;
                    
                } else {
                    if (this.cleanup) {
                        this.cleanup();
                    }
                }
                
                return this.active;
            }
        },
        slowdown: {
            name: 'Slow Down (0.75x)',
            active: false,
            processor: null,
            toggle: function() {
                this.active = !this.active;
                effects.speedup.active = false;
                
                if (this.active) {
                    initializeAudioContext();
                    this.processor = createEnhancedSpeedProcessor(0.75);
                    
                    const handleTimeUpdate = () => {
                        if (progressBar.selectedStartTime !== undefined && 
                            progressBar.selectedEndTime !== undefined) {
                            
                            const currentTime = audio.currentTime;
                            const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                                    currentTime <= progressBar.selectedEndTime;
                            
                            audio.preservesPitch = true;
                        
                            const transitionTime = 0.1;
                            if (isInSelectedRegion) {
                                wetGainNode.gain.setTargetAtTime(0.9, audioContext.currentTime, transitionTime);
                                dryGainNode.gain.setTargetAtTime(0.1, audioContext.currentTime, transitionTime);
                                if (Math.abs(audio.playbackRate - 0.7) > 0.01) {
                                    audio.playbackRate = 0.7;
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
                            wetGainNode.disconnect(this.processor.highpass);
                            this.processor.highpass.disconnect();
                            this.processor.lowpass.disconnect();
                            this.processor.delay.disconnect();
                            this.processor.echo.disconnect();
                            this.processor.echoGain.disconnect();
                            this.processor.outputGain.disconnect();
                            this.processor = null;
                        }
                        audio.playbackRate = 1.0;
                        wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
                        dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);
                    };
                    
                } else {
                    if (this.cleanup) {
                        this.cleanup();
                    }
                }
                
                return this.active;
            }
        },
        speedup: {
            name: 'Speed Up (1.25x)',
            active: false,
            processor: null,
            toggle: function() {
                this.active = !this.active;
                effects.slowdown.active = false;
                
                if (this.active) {
                    initializeAudioContext();
                    this.processor = createEnhancedSpeedProcessor(1.25);
                    
                    const handleTimeUpdate = () => {
                        if (progressBar.selectedStartTime !== undefined && 
                            progressBar.selectedEndTime !== undefined) {
                            
                            const currentTime = audio.currentTime;
                            const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                                    currentTime <= progressBar.selectedEndTime;        
                            audio.preservesPitch = true;
                            
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
                            wetGainNode.disconnect(this.processor.highpass);
                            this.processor.highpass.disconnect();
                            this.processor.lowpass.disconnect();
                            this.processor.delay.disconnect();
                            this.processor.echo.disconnect();
                            this.processor.echoGain.disconnect();
                            this.processor.outputGain.disconnect();
                            this.processor = null;
                        }
                        audio.playbackRate = 1.0;
                        wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
                        dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);
                    };
                    
                } else {
                    if (this.cleanup) {
                        this.cleanup();
                    }
                }
                
                return this.active;
            }
        },
        nightcore: {
            name: 'Nightcore',
            active: false,
            processor: null,
            toggle: function() {
                this.active = !this.active;
                
                if (this.active) {
                    initializeAudioContext();
                    this.processor = createNightcoreProcessor();
                    
                    const handleTimeUpdate = () => {
                        if (progressBar.selectedStartTime !== undefined && 
                            progressBar.selectedEndTime !== undefined) {
                            
                            const currentTime = audio.currentTime;
                            const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                                    currentTime <= progressBar.selectedEndTime;
                            
                            audio.preservesPitch = false; // important for nightcore
                            
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
                            this.processor.pitchShifter.node.disconnect();
                            wetGainNode.disconnect(this.processor.pitchShifter.node);
                            this.processor.compressor.disconnect();
                            this.processor.lowShelf.disconnect();
                            this.processor.highShelf.disconnect();
                            this.processor.presence.disconnect();
                            this.processor.sparkleReverb.disconnect();
                            this.processor.reverbGain.disconnect();
                            this.processor.outputGain.disconnect();
                            this.processor = null;
                        }
                        audio.playbackRate = 1.0;
                        audio.preservesPitch = true;
                        wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
                        dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);
                    };
                    
                } else {
                    if (this.cleanup) {
                        this.cleanup();
                    }
                }
                
                return this.active;
            }
        }
    };

    function getEffectivePlaybackRate(currentTime) {
        if (!progressBar.selectedStartTime || !progressBar.selectedEndTime) {
            return originalPlaybackRate;
        }

        if (currentTime >= progressBar.selectedStartTime && 
            currentTime <= progressBar.selectedEndTime) {
            if (effects.slowdown.active) return 0.75;
            if (effects.speedup.active) return 1.25;
        }
        return originalPlaybackRate;
    }

    const handleTimeUpdate = () => {
        effects.loop.handler();
        effects.smoothLoop.handler();
        
        const newRate = getEffectivePlaybackRate(audio.currentTime);
        if (audio.playbackRate !== newRate) {
            audio.playbackRate = newRate;
        }
    };
    
    audio.addEventListener('timeupdate', handleTimeUpdate);

    function createContextMenu(x, y, updateProgressBarGradient, updateWaveformProgress) {
        const existingMenu = document.querySelector('.waveform-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        if (!progressBar.selectedStartTime || !progressBar.selectedEndTime) {
            Object.values(effects).forEach(effect => {
                effect.active = false;
                if (effect.crossfading !== undefined) {
                    effect.crossfading = false;
                }
            });
            if (crossfadeAudio) {
                crossfadeAudio.pause();
                crossfadeAudio = null;
            }
            audio.volume = 1;
            audio.playbackRate = originalPlaybackRate;
        }

        const menu = document.createElement('div');
        menu.className = 'waveform-context-menu';
        menu.id = 'waveform-context-menu';
        Object.assign(menu.style, {
            position: 'absolute',
            left: `${x}px`,
            top: `${y}px`,
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '5px',
            padding: '10px',
            zIndex: '1000',
            opacity: '0',
            visibility: 'hidden',
            transform: 'translateY(-10px)',
            transition: 'opacity 0.3s ease, transform 0.5s ease, visibility 0.3s',
            minWidth: '150px'
        });

        Object.entries(effects).forEach(([key, effect]) => {
            const menuItem = document.createElement('div');
            menuItem.textContent = `${effect.active ? 'Remove' : 'Apply'} ${effect.name}`;
            menuItem.style.cursor = 'default';
            menuItem.style.padding = '5px';
            menuItem.style.transition = 'border-bottom 0.3s ease';
            menuItem.style.borderBottom = '1px solid transparent';
            
            menuItem.addEventListener('mouseover', () => {
                menuItem.style.borderBottom = '1px solid rgba(43, 219, 160)';
            });
            
            menuItem.addEventListener('mouseout', () => {
                menuItem.style.borderBottom = '1px solid transparent';
            });

            menuItem.addEventListener('click', () => {
                if (key === 'loop' && effects.smoothLoop.active) {
                    effects.smoothLoop.toggle();
                } else if (key === 'smoothLoop' && effects.loop.active) {
                    effects.loop.toggle();
                }
                
                const isNowActive = effect.toggle();
                
                if (key === 'loop' || key === 'smoothLoop') {
                    if (!isNowActive) {
                        progressBar.style.background = '#333';
                    } else {
                        updateProgressBarGradient(progressBar, audio);
                    }
                    updateWaveformProgress();
                }
                audio.playbackRate = getEffectivePlaybackRate(audio.currentTime);
                
                menu.style.opacity = '0';
                menu.style.transform = 'translateY(-10px)';
                menu.style.visibility = 'hidden';
                setTimeout(() => menu.remove(), 300);
            });

            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);

        requestAnimationFrame(() => {
            menu.style.opacity = '1';
            menu.style.visibility = 'visible';
            menu.style.transform = 'translateY(0)';
        });

        const closeMenu = (event) => {
            if (!menu.contains(event.target)) {
                menu.style.opacity = '0';
                menu.style.transform = 'translateY(-10px)';
                menu.style.visibility = 'hidden';
                
                setTimeout(() => {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }, 300);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);

        menu.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });
    }

    function setupTimeUpdateHandler() {
        // remove existing handler if it exists
        if (timeUpdateHandler) {
            audio.removeEventListener('timeupdate', timeUpdateHandler);
        }

        // create new handler
        timeUpdateHandler = () => {
            effects.loop.handler();
            effects.smoothLoop.handler();
            
            const newRate = getEffectivePlaybackRate(audio.currentTime);
            if (audio.playbackRate !== newRate) {
                audio.playbackRate = newRate;
            }
        };
        audio.addEventListener('timeupdate', timeUpdateHandler);
    }
    setupTimeUpdateHandler();

    function cleanup() {
        Object.values(effects).forEach(effect => {
            if (effect.cleanup) {
                effect.cleanup();
            }
            effect.active = false;
            if (effect.crossfading !== undefined) {
                effect.crossfading = false;
            }
        });
        
        if (crossfadeAudio) {
            crossfadeAudio.pause();
            crossfadeAudio = null;
        }

        if (audioContext) {
            disconnectAudioContext();
        }

        if (timeUpdateHandler) {
            audio.removeEventListener('timeupdate', timeUpdateHandler);
            timeUpdateHandler = null;
        }

        audio.volume = 1;
        audio.playbackRate = 1; 
    }

    return {
        createContextMenu,
        cleanup,
        isLooping: () => effects.loop.active || effects.smoothLoop.active,
        resetHandlers: () => {
            setupTimeUpdateHandler();
        }
    };
}