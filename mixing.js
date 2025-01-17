export function setupAudioEffects(audio, progressBar) {
    let crossfadeAudio = null;
    const CROSSFADE_DURATION = 2;
    let originalPlaybackRate = 1;

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
                if (timeUntilEnd <= CROSSFADE_DURATION && !this.crossfading && audio.volume > 0) {
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
        slowdown: {
            name: 'Slow Down (0.5x)',
            active: false,
            toggle: function() {
                this.active = !this.active;
                effects.speedup.active = false;
                return this.active;
            }
        },
        speedup: {
            name: 'Speed Up (1.5x)',
            active: false,
            toggle: function() {
                this.active = !this.active;
                effects.slowdown.active = false;
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
            if (effects.slowdown.active) return 0.5;
            if (effects.speedup.active) return 1.5;
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

    function cleanup() {
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
        audio.removeEventListener('timeupdate', handleTimeUpdate);
    }

    return {
        createContextMenu,
        cleanup,
        isLooping: () => effects.loop.active || effects.smoothLoop.active
    };
}