const FILTER_CONTROL_CONFIG = {
    highpass: {
        min: 40,
        max: 4000,
        presets: [
            ['Subtle', 180, 0.7],
            ['Thin', 500, 0.9],
            ['Tiny', 1400, 1.1]
        ]
    },
    lowpass: {
        min: 250,
        max: 16000,
        presets: [
            ['Warm', 5000, 0.5],
            ['Wall', 1500, 0.8],
            ['Underwater', 650, 1.1]
        ]
    }
};

function frequencyToSlider(frequency, min, max) {
    return Math.log(Math.max(min, Math.min(max, frequency)) / min) / Math.log(max / min) * 1000;
}

function sliderToFrequency(value, min, max) {
    return min * Math.pow(max / min, Number(value) / 1000);
}

function formatFrequency(frequency) {
    return frequency >= 1000
        ? `${(frequency / 1000).toFixed(frequency >= 10000 ? 0 : 1)} kHz`
        : `${Math.round(frequency)} Hz`;
}

function createFilterControls(effect, key, repositionMenu) {
    const config = FILTER_CONTROL_CONFIG[key];
    const controls = document.createElement('div');
    controls.className = 'filter-effect-controls';

    const cutoffRow = document.createElement('label');
    cutoffRow.className = 'filter-control-row';
    const cutoffHeader = document.createElement('span');
    cutoffHeader.className = 'filter-control-header';
    const cutoffName = document.createElement('span');
    cutoffName.textContent = 'Cutoff';
    const cutoffValue = document.createElement('output');
    const cutoffSlider = document.createElement('input');
    cutoffSlider.type = 'range';
    cutoffSlider.min = '0';
    cutoffSlider.max = '1000';
    cutoffSlider.step = '1';
    cutoffHeader.append(cutoffName, cutoffValue);
    cutoffRow.append(cutoffHeader, cutoffSlider);

    const resonanceRow = document.createElement('label');
    resonanceRow.className = 'filter-control-row';
    const resonanceHeader = document.createElement('span');
    resonanceHeader.className = 'filter-control-header';
    const resonanceName = document.createElement('span');
    resonanceName.textContent = 'Resonance';
    const resonanceValue = document.createElement('output');
    const resonanceSlider = document.createElement('input');
    resonanceSlider.type = 'range';
    resonanceSlider.min = '0.1';
    resonanceSlider.max = '12';
    resonanceSlider.step = '0.1';
    resonanceHeader.append(resonanceName, resonanceValue);
    resonanceRow.append(resonanceHeader, resonanceSlider);

    const presetRow = document.createElement('div');
    presetRow.className = 'filter-preset-row';

    const refresh = () => {
        const settings = effect.getSettings();
        cutoffSlider.value = String(frequencyToSlider(settings.frequency, config.min, config.max));
        resonanceSlider.value = String(settings.Q);
        cutoffValue.textContent = formatFrequency(settings.frequency);
        resonanceValue.textContent = settings.Q.toFixed(1);
    };

    cutoffSlider.addEventListener('input', event => {
        effect.setFrequency(sliderToFrequency(event.target.value, config.min, config.max));
        refresh();
    });
    resonanceSlider.addEventListener('input', event => {
        effect.setQ(event.target.value);
        refresh();
    });

    config.presets.forEach(([name, frequency, Q]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = name;
        button.addEventListener('click', event => {
            event.stopPropagation();
            effect.applySettings({ frequency, Q });
            refresh();
        });
        presetRow.appendChild(button);
    });

    controls.append(cutoffRow, resonanceRow, presetRow);
    controls.addEventListener('click', event => event.stopPropagation());
    controls.addEventListener('pointerdown', event => event.stopPropagation());
    refresh();
    requestAnimationFrame(repositionMenu);
    return controls;
}

export function createContextMenu(x, y, effectsRegistry, progressBar, updateProgressBarGradient, updateWaveformProgress, actions = {}) {
    const existingMenu = document.querySelector('.waveform-context-menu');
    if (existingMenu) {
        existingMenu._destroyWaveformMenu?.();
        existingMenu.remove();
    }

    const audio = effectsRegistry.audio;

    // clear effects if no selection
    if (progressBar.selectedStartTime === undefined || progressBar.selectedEndTime === undefined) {
        effectsRegistry.deactivateAllEffects();
        audio.volume = 1;
        audio.playbackRate = 1.0;
        return;
    }

    const menu = document.createElement('div');
    menu.className = 'waveform-context-menu';
    menu.id = 'waveform-context-menu';
    Object.assign(menu.style, {
        position: 'fixed',
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

    const categories = effectsRegistry.getEffectsByCategory();

    if (typeof actions.togglePlayAndFadeOut === 'function') {
        const categoryHeader = document.createElement('div');
        categoryHeader.textContent = 'Selection';
        categoryHeader.style.color = '#2bdba0';
        categoryHeader.style.fontSize = '0.8em';
        categoryHeader.style.textTransform = 'uppercase';
        categoryHeader.style.padding = '5px';
        menu.appendChild(categoryHeader);

        const playAndFadeItem = document.createElement('div');
        playAndFadeItem.className = 'context-menu-item';
        const updatePlayAndFadeLabel = () => {
            const active = Boolean(actions.isPlayAndFadeOutActive?.());
            playAndFadeItem.textContent = `${active ? '✓ ' : ''}Play & Fade Out`;
            playAndFadeItem.style.color = active ? '#2bdba0' : '#fff';
        };
        Object.assign(playAndFadeItem.style, {
            cursor: 'default',
            padding: '5px 5px 5px 15px',
            transition: 'all 0.3s ease',
            borderLeft: '2px solid transparent',
            color: '#fff'
        });
        updatePlayAndFadeLabel();
        playAndFadeItem.addEventListener('mouseover', () => {
            playAndFadeItem.style.borderLeft = '2px solid #2bdba0';
            playAndFadeItem.style.backgroundColor = 'rgba(43, 219, 160, 0.1)';
        });
        playAndFadeItem.addEventListener('mouseout', () => {
            playAndFadeItem.style.borderLeft = '2px solid transparent';
            playAndFadeItem.style.backgroundColor = 'transparent';
        });
        playAndFadeItem.addEventListener('click', () => {
            actions.togglePlayAndFadeOut();
            updatePlayAndFadeLabel();
            menu.style.opacity = '0';
            menu.style.transform = 'translateY(-10px)';
            menu.style.visibility = 'hidden';
            setTimeout(() => destroyMenu(), 300);
        });
        menu.appendChild(playAndFadeItem);

        if (typeof actions.togglePlayAndStop === 'function') {
            const playAndStopItem = document.createElement('div');
            playAndStopItem.className = 'context-menu-item';
            const updatePlayAndStopLabel = () => {
                const active = Boolean(actions.isPlayAndStopActive?.());
                playAndStopItem.textContent = `${active ? '✓ ' : ''}Play & Stop`;
                playAndStopItem.style.color = active ? '#2bdba0' : '#fff';
            };
            Object.assign(playAndStopItem.style, {
                cursor: 'default',
                padding: '5px 5px 5px 15px',
                transition: 'all 0.3s ease',
                borderLeft: '2px solid transparent',
                color: '#fff'
            });
            updatePlayAndStopLabel();
            playAndStopItem.addEventListener('mouseover', () => {
                playAndStopItem.style.borderLeft = '2px solid #2bdba0';
                playAndStopItem.style.backgroundColor = 'rgba(43, 219, 160, 0.1)';
            });
            playAndStopItem.addEventListener('mouseout', () => {
                playAndStopItem.style.borderLeft = '2px solid transparent';
                playAndStopItem.style.backgroundColor = 'transparent';
            });
            playAndStopItem.addEventListener('click', () => {
                actions.togglePlayAndStop();
                updatePlayAndStopLabel();
                menu.style.opacity = '0';
                menu.style.transform = 'translateY(-10px)';
                menu.style.visibility = 'hidden';
                setTimeout(() => destroyMenu(), 300);
            });
            menu.appendChild(playAndStopItem);
        }

        if (typeof actions.deleteSelectedRegion === 'function') {
            const deleteRegionItem = document.createElement('div');
            deleteRegionItem.className = 'context-menu-item';
            deleteRegionItem.textContent = 'Delete Selected Region…';
            Object.assign(deleteRegionItem.style, {
                cursor: 'default',
                padding: '5px 5px 5px 15px',
                transition: 'all 0.3s ease',
                borderLeft: '2px solid transparent',
                color: '#ff8a72'
            });
            deleteRegionItem.addEventListener('mouseover', () => {
                deleteRegionItem.style.borderLeft = '2px solid #ee420e';
                deleteRegionItem.style.backgroundColor = 'rgba(238, 66, 14, 0.12)';
            });
            deleteRegionItem.addEventListener('mouseout', () => {
                deleteRegionItem.style.borderLeft = '2px solid transparent';
                deleteRegionItem.style.backgroundColor = 'transparent';
            });
            deleteRegionItem.addEventListener('click', () => {
                actions.deleteSelectedRegion();
                destroyMenu();
            });
            menu.appendChild(deleteRegionItem);
        }
    }

    let repositionMenu = () => {};

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
            const effect = effectsRegistry.effects[key];
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
                const isNowActive = effectsRegistry.activateEffect(key);
                menuItem.textContent = `${isNowActive ? '✓ ' : ''}${effect.name}`;
                menuItem.style.color = isNowActive ? '#2bdba0' : '#fff';

                if (FILTER_CONTROL_CONFIG[key]) {
                    const oldControls = menuItem.nextElementSibling?.classList.contains('filter-effect-controls')
                        ? menuItem.nextElementSibling
                        : null;
                    oldControls?.remove();
                    if (isNowActive) {
                        menuItem.after(createFilterControls(effect, key, repositionMenu));
                    }
                    requestAnimationFrame(repositionMenu);
                    return;
                }
                
                // special handling for loop effects
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
                setTimeout(() => destroyMenu(), 300);
            });

            menu.appendChild(menuItem);
            if (effect.active && FILTER_CONTROL_CONFIG[key]) {
                menu.appendChild(createFilterControls(effect, key, repositionMenu));
            }
        });
    });

    document.body.appendChild(menu);

    const openingRect = progressBar.getBoundingClientRect();
    const anchor = {
        offsetX: x - window.scrollX - openingRect.left,
        offsetY: y - window.scrollY - openingRect.top,
        adjustX: 0,
        adjustY: 0
    };
    const positionMenu = (setViewportAdjustment = false) => {
        if (!progressBar.isConnected || !menu.isConnected) return;
        const anchorRect = progressBar.getBoundingClientRect();
        const desiredLeft = anchorRect.left + anchor.offsetX;
        const desiredTop = anchorRect.top + anchor.offsetY;

        if (setViewportAdjustment) {
            const menuRect = menu.getBoundingClientRect();
            const margin = 8;
            const clampedLeft = Math.max(margin, Math.min(desiredLeft, window.innerWidth - menuRect.width - margin));
            const clampedTop = Math.max(margin, Math.min(desiredTop, window.innerHeight - menuRect.height - margin));
            anchor.adjustX = clampedLeft - desiredLeft;
            anchor.adjustY = clampedTop - desiredTop;
        }

        menu.style.left = `${desiredLeft + anchor.adjustX}px`;
        menu.style.top = `${desiredTop + anchor.adjustY}px`;
    };
    repositionMenu = () => positionMenu(true);
    const handleAnchorScroll = () => positionMenu();
    const handleAnchorResize = () => positionMenu(true);
    window.addEventListener('scroll', handleAnchorScroll, { capture: true, passive: true });
    window.addEventListener('resize', handleAnchorResize);
    positionMenu(true);

    // animate menu appearance
    requestAnimationFrame(() => {
        menu.style.opacity = '1';
        menu.style.visibility = 'visible';
        menu.style.transform = 'translateY(0)';
    });

    let closeMenu = null;
    const destroyMenu = () => {
        window.removeEventListener('scroll', handleAnchorScroll, true);
        window.removeEventListener('resize', handleAnchorResize);
        if (closeMenu) document.removeEventListener('click', closeMenu);
        menu.remove();
    };
    menu._destroyWaveformMenu = destroyMenu;

    closeMenu = (event) => {
        if (!menu.contains(event.target)) {
            menu.style.opacity = '0';
            menu.style.transform = 'translateY(-10px)';
            menu.style.visibility = 'hidden';
            
            setTimeout(() => {
                destroyMenu();
            }, 300);
        }
    };
    
    setTimeout(() => {
        if (menu.isConnected) document.addEventListener('click', closeMenu);
    }, 0);

    menu.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });

    return menu;
}
