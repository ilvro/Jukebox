export function setupAudioEffects(audio, progressBar) {
    let audioContext = null;
    let sourceNode = null;
    let gainNode1 = null;
    let gainNode2 = null;
    let bufferSource = null;
    let audioBuffer = null;

    async function initializeAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            sourceNode = audioContext.createMediaElementSource(audio);
            gainNode1 = audioContext.createGain();
            gainNode2 = audioContext.createGain();
            sourceNode.connect(gainNode1);
            gainNode1.connect(audioContext.destination);
            gainNode2.connect(audioContext.destination);
        }

        if (!audioBuffer) {
            try {
                const response = await fetch(audio.src);
                const arrayBuffer = await response.arrayBuffer();
                audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            } catch (error) {
                console.error("Error loading audio buffer:", error);
            }
        }
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
        slowdown: {
            name: 'Slow Down (0.5x)',
            active: false,
            toggle: function() {
                this.active = !this.active;
                audio.playbackRate = this.active ? 0.5 : 1;
                return this.active;
            }
        },
        speedup: {
            name: 'Speed Up (1.5x)',
            active: false,
            toggle: function() {
                this.active = !this.active;
                audio.playbackRate = this.active ? 1.5 : 1;
                return this.active;
            }
        },
        crossfadeLoop: {
            name: 'Loop with Crossfade',
            active: false,
            crossfadeDuration: 2,
            isTransitioning: false,
            async toggle() {
                if (progressBar.selectedStartTime === undefined || 
                    progressBar.selectedEndTime === undefined) {
                    return false;
                }

                this.active = !this.active;

                if (this.active) {
                    await initializeAudioContext();
                    gainNode1.gain.value = 1;
                    gainNode2.gain.value = 0;
                } else {
                    if (bufferSource) {
                        bufferSource.stop();
                        bufferSource = null;
                    }
                    gainNode1.gain.value = 1;
                    gainNode2.gain.value = 0;
                }

                return this.active;
            },
            handler: function() {
                if (!this.active || !audioContext || !audioBuffer || 
                    progressBar.selectedStartTime === undefined || 
                    progressBar.selectedEndTime === undefined) {
                    return;
                }

                const currentTime = audio.currentTime;
                const startTime = progressBar.selectedStartTime;
                const endTime = progressBar.selectedEndTime;
                
                if (currentTime >= endTime - this.crossfadeDuration && !this.isTransitioning) {
                    this.isTransitioning = true;

                    bufferSource = audioContext.createBufferSource();
                    bufferSource.buffer = audioBuffer;
                    bufferSource.connect(gainNode2);
                    
                    const startOffset = startTime;
                    const now = audioContext.currentTime;
                    
                    gainNode1.gain.setValueAtTime(1, now);
                    gainNode1.gain.linearRampToValueAtTime(0, now + this.crossfadeDuration);
                    
                    gainNode2.gain.setValueAtTime(0, now);
                    gainNode2.gain.linearRampToValueAtTime(1, now + this.crossfadeDuration);

                    bufferSource.start(now, startOffset);

                    setTimeout(() => {
                        audio.currentTime = startTime;
                        [gainNode1, gainNode2] = [gainNode2, gainNode1];
                        this.isTransitioning = false;
                    }, this.crossfadeDuration * 1000);
                }
            }
        }
    };

    const handlerFunction = () => {
        effects.loop.handler();
        effects.crossfadeLoop.handler();
    };
    audio.addEventListener('timeupdate', handlerFunction);

    audio.addEventListener('pause', () => {
        if (effects.crossfadeLoop.active) {
            effects.crossfadeLoop.toggle();
        }
    });

    function cleanup() {
        Object.values(effects).forEach(effect => {
            if (effect.active) {
                effect.toggle();
            }
        });

        audio.removeEventListener('timeupdate', handlerFunction);

        if (bufferSource) {
            bufferSource.stop();
            bufferSource = null;
        }
        if (gainNode1) {
            gainNode1.disconnect();
        }
        if (gainNode2) {
            gainNode2.disconnect();
        }
        if (sourceNode) {
            sourceNode.disconnect();
        }
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
    }

    function createContextMenu(x, y, updateProgressBarGradient, updateWaveformProgress) {
        const existingMenu = document.querySelector('.waveform-context-menu');
        if (existingMenu) {
            existingMenu.remove();
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
                const isNowActive = effect.toggle();
                
                if (key === 'loop' || key === 'crossfadeLoop') {
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

    return {
        createContextMenu,
        cleanup,
        isLooping: () => effects.loop.active || effects.crossfadeLoop.active
    };
}