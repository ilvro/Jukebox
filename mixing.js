export function setupAudioEffects(audio, progressBar) {
    let audioContext = null;
    let sourceNode = null;
    let mainGainNode = null;
    let reverbNodes = null;
    let dryGainNode = null;
    let wetGainNode = null;
    let isAudioContextInitialized = false;

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

    /* to add a new effect:
        1. create a new class that extends AudioEffect
        2. add it to the effectsRegistry object
        3. add it to the appropriate category in createContextMenu
    */
    class AudioEffect {
        constructor(name) {
            this.name = name;
            this.active = false;
            this.nodes = null;
            this.cleanup = null;
        }

        activate() {
            if (!this.active) {
                initializeAudioContext();
                this.setupNodes();
                this.setupTimeUpdate();
                this.active = true;
            }
        }

        deactivate() {
            if (this.active) {
                if (this.cleanup) {
                    this.cleanup();
                }
                // ensure the dry path is restored
                if (dryGainNode && wetGainNode) {
                    dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);
                    wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
                }
                this.active = false;
            }
        }

        toggle() {
            if (this.active) {
                this.deactivate();
            } else {
                this.activate();
            }
            return this.active;
        }

        createRegionBasedHandler() {
            return () => {
                if (!this.active || !progressBar.selectedStartTime || !progressBar.selectedEndTime) {
                    return;
                }
                
                const currentTime = audio.currentTime;
                const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                        currentTime <= progressBar.selectedEndTime;
                
                const transitionTime = 0.05;
                
                if (wetGainNode && dryGainNode) {
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
        }

        // to be implemented by subclasses
        setupNodes() {}
        setupTimeUpdate() {}
    }

    class LoopEffect extends AudioEffect {
        constructor() {
            super('Loop');
        }

        setupNodes() {
            // no nodes needed
        }

        setupTimeUpdate() {
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

    class SmoothLoopEffect extends AudioEffect {
        constructor() {
            super('Smooth Loop');
            this.crossfading = false;
            this.crossfadeAudio = null;
            this.CROSSFADE_DURATION = 2;
        }

        setupNodes() {
            // no nodes needed
        }

        setupTimeUpdate() {
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

        startCrossfade() {
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
                audio.volume = 1;
                this.crossfading = false;
                if (this.cleanup) this.cleanup();
                this.active = false;
            }
        }
    }

    class PlaybackSpeedEffect extends AudioEffect {
        constructor(speedFactor) {
            super(`Speed ${speedFactor}x`);
            this.speedFactor = speedFactor;
        }

        setupNodes() {
            // no nodes needed
        }

        setupTimeUpdate() {
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

    class PitchShiftEffect extends AudioEffect {
        constructor(pitchFactor) {
            super(`Pitch ${pitchFactor}x`);
            this.pitchFactor = pitchFactor;
        }

        setupNodes() {
            audio.preservesPitch = false;
        }

        setupTimeUpdate() {
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
    
    class ReverbEffect extends AudioEffect {
        constructor(options = {}) {
            super('Reverb');
            this.options = {
                delayTime: options.delayTime ?? 0.06,
                feedback: options.feedback ?? 0.15,
                wet: options.wet ?? 0.3,
                ...options
            };
        }
    
        setupNodes() {
            const sparkleReverb = audioContext.createDelay(1.0);
            const reverbGain = audioContext.createGain();
            const outputGain = audioContext.createGain();
    
            sparkleReverb.delayTime.value = this.options.delayTime;
            reverbGain.gain.value = this.options.feedback;
            outputGain.gain.value = this.options.wet;
    
            wetGainNode.connect(sparkleReverb);
            sparkleReverb.connect(reverbGain);
            reverbGain.connect(sparkleReverb);
            sparkleReverb.connect(outputGain);
            outputGain.connect(mainGainNode);
    
            this.nodes = { sparkleReverb, reverbGain, outputGain };
        }
    
        setupTimeUpdate() {
            const handleTimeUpdate = this.createRegionBasedHandler();
            audio.addEventListener('timeupdate', handleTimeUpdate);
            this.cleanup = () => {
                audio.removeEventListener('timeupdate', handleTimeUpdate);
                if (this.nodes) {
                    wetGainNode.disconnect(this.nodes.sparkleReverb);
                    Object.values(this.nodes).forEach(node => node.disconnect());
                }
            };
        }
    }

    class EchoEffect extends AudioEffect {
        constructor(options = {}) {
            super('Echo');
            this.options = {
                delayTime: options.delayTime ?? 0.3,
                feedback: options.feedback ?? 0.4,
                ...options
            };
        }
    
        setupNodes() {
            const delay = audioContext.createDelay();
            const feedback = audioContext.createGain();
            
            delay.delayTime.value = this.options.delayTime;
            feedback.gain.value = this.options.feedback;
    
            wetGainNode.connect(delay);
            delay.connect(feedback);
            feedback.connect(delay);
            delay.connect(mainGainNode);
    
            this.nodes = { delay, feedback };
        }
    
        setupTimeUpdate() {
            const handleTimeUpdate = this.createRegionBasedHandler();
            audio.addEventListener('timeupdate', handleTimeUpdate);
            this.cleanup = () => {
                audio.removeEventListener('timeupdate', handleTimeUpdate);
                if (this.nodes) {
                    wetGainNode.disconnect(this.nodes.delay);
                    Object.values(this.nodes).forEach(node => node.disconnect());
                }
            };
        }
    }
    
    class FilterEffect extends AudioEffect {
        constructor(type, options = {}) {
            super(`${type.charAt(0).toUpperCase() + type.slice(1)} Filter`);
            this.filterType = type;
            this.options = {
                frequency: type === 'highpass' ? 500 : 2000,
                Q: 0.7,
                ...options
            };
        }
    
        setupNodes() {
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
    
        setupTimeUpdate() {
            const handleTimeUpdate = this.createRegionBasedHandler();
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
            if (this.nodes?.filter) {
                this.nodes.filter.frequency.setValueAtTime(value, audioContext.currentTime);
            }
        }
    
        setQ(value) {
            if (this.nodes?.filter) {
                this.nodes.filter.Q.setValueAtTime(value, audioContext.currentTime);
            }
        }
    }
    
    class TremoloEffect extends AudioEffect {
        constructor(options = {}) {
            super('Tremolo');
            this.options = {
                frequency: options.frequency ?? 4.0,
                depth: options.depth ?? 0.5,
                ...options
            };
        }
    
        setupNodes() {
            const tremolo = audioContext.createGain();
            const lfo = audioContext.createOscillator();
            const lfoGain = audioContext.createGain();
            
            lfo.frequency.value = this.options.frequency;
            lfoGain.gain.value = this.options.depth;
            
            lfo.connect(lfoGain);
            lfoGain.connect(tremolo.gain);
            wetGainNode.connect(tremolo);
            tremolo.connect(mainGainNode);
            
            lfo.start();
            
            this.nodes = { tremolo, lfo, lfoGain };
        }
    
        setupTimeUpdate() {
            const handleTimeUpdate = this.createRegionBasedHandler();
            audio.addEventListener('timeupdate', handleTimeUpdate);
            this.cleanup = () => {
                audio.removeEventListener('timeupdate', handleTimeUpdate);
                if (this.nodes) {
                    this.nodes.lfo.stop();
                    wetGainNode.disconnect(this.nodes.tremolo);
                    Object.values(this.nodes).forEach(node => node.disconnect());
                }
            };
        }
    }
    
    class NightcoreEffect extends AudioEffect {
        constructor() {
            super('Nightcore');
            this.processor = null;
        }
    
        setupNodes() {
            this.processor = createNightcoreProcessor();
        }
    
        setupTimeUpdate() {
            const handleTimeUpdate = () => {
                if (progressBar.selectedStartTime !== undefined && 
                    progressBar.selectedEndTime !== undefined) {
                    
                    const currentTime = audio.currentTime;
                    const isInSelectedRegion = currentTime >= progressBar.selectedStartTime && 
                                            currentTime <= progressBar.selectedEndTime;
                    
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
                }
            };
    
            audio.addEventListener('timeupdate', handleTimeUpdate);
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

    const effectsRegistry = {
        loop: new LoopEffect(),
        smoothLoop: new SmoothLoopEffect(),
        speed075: new PlaybackSpeedEffect(0.75),
        speed125: new PlaybackSpeedEffect(1.25),
        pitchUp: new PitchShiftEffect(1.3),
        pitchDown: new PitchShiftEffect(0.7),
        reverb: new ReverbEffect(),
        echo: new EchoEffect(),
        highpass: new FilterEffect('highpass'),
        lowpass: new FilterEffect('lowpass'),
        tremolo: new TremoloEffect(),
        nightcore: new NightcoreEffect()
    };

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

    function createContextMenu(x, y, updateProgressBarGradient, updateWaveformProgress) {
        const existingMenu = document.querySelector('.waveform-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
    
        // clear effects if no selection
        if (!progressBar.selectedStartTime || !progressBar.selectedEndTime) {
            Object.values(effectsRegistry).forEach(effect => effect.deactivate());
            if (crossfadeAudio) {
                crossfadeAudio.pause();
                crossfadeAudio = null;
            }
            audio.volume = 1;
            audio.playbackRate = originalPlaybackRate;
            return;
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
    
        const categories = {
            'Playback': ['loop', 'smoothLoop'],
            'Speed & Pitch': ['speed075', 'speed125', 'pitchUp', 'pitchDown'],
            'Effects': ['echo', 'reverb', 'tremolo'],
            'Filters': ['highpass', 'lowpass'],
            'Presets': ['nightcore']
        };
    
        Object.entries(categories).forEach(([categoryName, effectKeys]) => {
            const categoryHeader = document.createElement('div');
            categoryHeader.textContent = categoryName;
            categoryHeader.style.color = '#2bdba0';
            categoryHeader.style.fontSize = '0.8em';
            categoryHeader.style.textTransform = 'uppercase';
            categoryHeader.style.padding = '5px';
            categoryHeader.style.marginTop = '5px';
            menu.appendChild(categoryHeader);


            effectKeys.forEach(key => {
                const effect = effectsRegistry[key];
                if (!effect) return;
    
                const menuItem = document.createElement('div');
                menuItem.className = 'context-menu-item';
                menuItem.textContent = `${effect.active ? '✓ ' : ''}${effect.name}`;
                Object.assign(menuItem.style, {
                    cursor: 'default',
                    padding: '5px 5px 5px 15px',
                    transition: 'all 0.3s ease',
                    borderLeft: '2px solid transparent',
                    color: effect.active ? '#2bdba0' : '#fff'
                });
    
                menuItem.addEventListener('mouseover', () => {
                    menuItem.style.borderLeft = '2px solid #2bdba0';
                    menuItem.style.backgroundColor = 'rgba(43, 219, 160, 0.1)';
                });
    
                menuItem.addEventListener('mouseout', () => {
                    menuItem.style.borderLeft = '2px solid transparent';
                    menuItem.style.backgroundColor = 'transparent';
                });
    
                menuItem.addEventListener('click', () => {
                    // handle special cases for loop effects
                    if (key === 'loop' && effectsRegistry.smoothLoop?.active) {
                        effectsRegistry.smoothLoop.toggle();
                    } else if (key === 'smoothLoop' && effectsRegistry.loop?.active) {
                        effectsRegistry.loop.toggle();
                    }
    
                    const isNowActive = effect.toggle();
    
                    menuItem.textContent = `${isNowActive ? '✓ ' : ''}${effect.name}`;
                    menuItem.style.color = isNowActive ? '#2bdba0' : '#fff';
                    if (key === 'loop' || key === 'smoothLoop') {
                        if (!isNowActive) {
                            progressBar.style.background = '#333';
                        } else {
                            updateProgressBarGradient(progressBar, audio);
                        }
                        updateWaveformProgress();
                    }
    
                    menu.style.opacity = '0';
                    menu.style.transform = 'translateY(-10px)';
                    menu.style.visibility = 'hidden';
                    setTimeout(() => menu.remove(), 300);
                });
    
                menu.appendChild(menuItem);
            });
        });
    
        document.body.appendChild(menu);
    
        // animate menu appearance
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
    
        return menu;
    }


    function cleanup() {
        Object.values(effectsRegistry).forEach(effect => effect.deactivate());
        
        if (audioContext) {
            disconnectAudioContext();
        }

        audio.volume = 1;
        audio.playbackRate = 1;
    }

    return {
        createContextMenu,
        cleanup,
        isLooping: () => effectsRegistry.loop.active || effectsRegistry.smoothLoop.active
    };
}