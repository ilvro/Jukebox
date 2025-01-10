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
        Object.assign(menu.style, {
            position: 'absolute',
            left: `${x}px`,
            top: `${y}px`,
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '5px',
            padding: '10px',
            zIndex: '1000'
        });

        Object.entries(effects).forEach(([key, effect]) => {
            const menuItem = document.createElement('div');
            menuItem.textContent = `${effect.active ? 'Remove' : 'Apply'} ${effect.name}`;
            menuItem.style.cursor = 'pointer';
            menuItem.style.padding = '5px';
            menuItem.style.borderRadius = '3px';
            
            menuItem.addEventListener('mouseover', () => {
                menuItem.style.backgroundColor = 'rgba(43, 219, 160, 0.3)';
            });
            
            menuItem.addEventListener('mouseout', () => {
                menuItem.style.backgroundColor = 'transparent';
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
                
                menu.remove();
            });

            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);

        const closeMenu = (event) => {
            if (!menu.contains(event.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };

        menu.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });
        
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
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