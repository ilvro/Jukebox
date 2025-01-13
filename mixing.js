export function setupAudioEffects(audio, progressBar) {
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
        }
    };

    audio.addEventListener('timeupdate', () => effects.loop.handler());

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
                
                if (key === 'loop') {
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
        })
    }

    function cleanup() {
        Object.values(effects).forEach(effect => {
            if (effect.active) {
                effect.toggle();
            }
        });
        audio.removeEventListener('timeupdate', effects.loop.handler);
    }

    return {
        createContextMenu,
        cleanup,
        isLooping: () => effects.loop.active
    };
}