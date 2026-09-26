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

const isSpeedEffectKey = key => key.startsWith('speed');

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
function isValidHexColor(color) {
    return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
}

function hexToHsl(color) {
    const value = Number.parseInt(color.slice(1), 16);
    const r = (value >> 16) / 255;
    const g = ((value >> 8) & 255) / 255;
    const b = (value & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;
    let hue = 0;
    let saturation = 0;

    if (delta !== 0) {
        saturation = delta / (1 - Math.abs(2 * lightness - 1));
        if (max === r) hue = 60 * (((g - b) / delta) % 6);
        else if (max === g) hue = 60 * ((b - r) / delta + 2);
        else hue = 60 * ((r - g) / delta + 4);
    }

    return {
        h: Math.round((hue + 360) % 360),
        s: Math.round(saturation * 100),
        l: Math.round(lightness * 100)
    };
}

function hslToHex(hue, saturation, lightness) {
    const h = ((Number(hue) % 360) + 360) % 360;
    const s = Number(saturation) / 100;
    const l = Number(lightness) / 100;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const section = h / 60;
    const secondary = chroma * (1 - Math.abs((section % 2) - 1));
    let [r, g, b] = section < 1 ? [chroma, secondary, 0]
        : section < 2 ? [secondary, chroma, 0]
        : section < 3 ? [0, chroma, secondary]
        : section < 4 ? [0, secondary, chroma]
        : section < 5 ? [secondary, 0, chroma]
        : [chroma, 0, secondary];
    const offset = l - chroma / 2;
    return `#${[r, g, b]
        .map(channel => Math.round((channel + offset) * 255).toString(16).padStart(2, '0'))
        .join('')}`;
}

function createRegionColorControls(initialColor, defaultColor, onChange, repositionMenu) {
    const normalizedDefault = isValidHexColor(defaultColor) ? defaultColor.toLowerCase() : '#4a9eff';
    let currentColor = isValidHexColor(initialColor) ? initialColor.toLowerCase() : normalizedDefault;

    const control = document.createElement('div');
    control.className = 'marker-color-control region-color-control';

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'marker-color-swatch';
    swatch.title = 'Choose region color';
    swatch.setAttribute('aria-label', 'Choose region color');
    swatch.setAttribute('aria-expanded', 'false');

    const valueLabel = document.createElement('span');
    valueLabel.className = 'marker-color-value';

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'marker-color-reset';
    resetButton.textContent = 'Default';

    const picker = document.createElement('div');
    picker.className = 'marker-color-picker region-color-picker';
    picker.hidden = true;

    const createSlider = (labelText, min, max) => {
        const row = document.createElement('label');
        row.className = 'marker-color-slider-row';
        const label = document.createElement('span');
        label.textContent = labelText;
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'marker-color-slider';
        slider.min = String(min);
        slider.max = String(max);
        slider.step = '1';
        row.append(label, slider);
        picker.appendChild(row);
        return slider;
    };

    const hueSlider = createSlider('Hue', 0, 359);
    hueSlider.classList.add('marker-color-hue');
    const saturationSlider = createSlider('Saturation', 0, 100);
    const lightnessSlider = createSlider('Lightness', 0, 100);

    const hexRow = document.createElement('label');
    hexRow.className = 'marker-color-hex-row';
    const hexLabel = document.createElement('span');
    hexLabel.textContent = 'Hex';
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'marker-color-hex';
    hexInput.maxLength = 7;
    hexInput.spellcheck = false;
    hexRow.append(hexLabel, hexInput);
    picker.appendChild(hexRow);

    const updateSliderBackgrounds = () => {
        const h = hueSlider.value;
        const s = saturationSlider.value;
        const l = lightnessSlider.value;
        saturationSlider.style.background =
            `linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`;
        lightnessSlider.style.background =
            `linear-gradient(to right, #000, hsl(${h} ${s}% 50%), #fff)`;
    };

    const syncControls = color => {
        const hsl = hexToHsl(color);
        hueSlider.value = String(hsl.h);
        saturationSlider.value = String(hsl.s);
        lightnessSlider.value = String(hsl.l);
        hexInput.value = color.toUpperCase();
        updateSliderBackgrounds();
    };

    const applyColor = (color, sync = true) => {
        if (!isValidHexColor(color)) return;
        currentColor = color.toLowerCase();
        swatch.style.backgroundColor = currentColor;
        valueLabel.textContent = currentColor.toUpperCase();
        if (sync) syncControls(currentColor);
        else hexInput.value = currentColor.toUpperCase();
        onChange(currentColor);
    };

    swatch.addEventListener('click', event => {
        event.stopPropagation();
        picker.hidden = !picker.hidden;
        swatch.setAttribute('aria-expanded', String(!picker.hidden));
        requestAnimationFrame(repositionMenu);
    });
    [hueSlider, saturationSlider, lightnessSlider].forEach(slider => {
        slider.addEventListener('input', () => {
            updateSliderBackgrounds();
            applyColor(hslToHex(hueSlider.value, saturationSlider.value, lightnessSlider.value), false);
        });
    });
    hexInput.addEventListener('input', () => {
        const value = hexInput.value.startsWith('#') ? hexInput.value : `#${hexInput.value}`;
        if (isValidHexColor(value)) applyColor(value);
    });
    hexInput.addEventListener('blur', () => {
        if (!isValidHexColor(hexInput.value)) hexInput.value = currentColor.toUpperCase();
    });
    hexInput.addEventListener('keydown', event => event.stopPropagation());
    resetButton.addEventListener('click', event => {
        event.stopPropagation();
        applyColor(normalizedDefault);
    });

    [control, picker].forEach(element => {
        element.addEventListener('click', event => event.stopPropagation());
        element.addEventListener('pointerdown', event => event.stopPropagation());
    });
    syncControls(currentColor);
    swatch.style.backgroundColor = currentColor;
    valueLabel.textContent = currentColor.toUpperCase();
    control.append(swatch, valueLabel, resetButton);
    return { control, picker };
}


function createFilterControls(effect, key, repositionMenu, onChange) {
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
        onChange?.(settings);
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

function createSpeedControls(effect, repositionMenu, onChange) {
    const controls = document.createElement('div');
    controls.className = 'filter-effect-controls speed-effect-controls';

    const speedRow = document.createElement('label');
    speedRow.className = 'filter-control-row';
    const speedHeader = document.createElement('span');
    speedHeader.className = 'filter-control-header';
    const speedName = document.createElement('span');
    speedName.textContent = 'Playback speed';
    const speedValue = document.createElement('output');
    const speedSlider = document.createElement('input');
    speedSlider.type = 'range';
    speedSlider.min = '0.5';
    speedSlider.max = '2';
    speedSlider.step = '0.01';
    speedHeader.append(speedName, speedValue);
    speedRow.append(speedHeader, speedSlider);

    const presetRow = document.createElement('div');
    presetRow.className = 'filter-preset-row speed-preset-row';

    const refresh = () => {
        speedSlider.value = String(effect.speedFactor);
        speedValue.textContent = `${effect.speedFactor.toFixed(2)}x`;
        onChange?.();
    };

    speedSlider.addEventListener('input', event => {
        effect.setSpeedFactor(event.target.value);
        refresh();
    });

    [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].forEach(speed => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${speed}x`;
        button.addEventListener('click', event => {
            event.stopPropagation();
            effect.setSpeedFactor(speed);
            refresh();
        });
        presetRow.appendChild(button);
    });

    controls.append(speedRow, presetRow);
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

        if (typeof actions.removeSelectedRegion === 'function') {
            const removeSelectionItem = document.createElement('div');
            removeSelectionItem.className = 'context-menu-item';
            removeSelectionItem.textContent = 'Remove This Selection';
            Object.assign(removeSelectionItem.style, {
                cursor: 'default',
                padding: '5px 5px 5px 15px',
                transition: 'all 0.3s ease',
                borderLeft: '2px solid transparent',
                color: '#ffc46b'
            });
            removeSelectionItem.addEventListener('mouseover', () => {
                removeSelectionItem.style.borderLeft = '2px solid #ffaa00';
                removeSelectionItem.style.backgroundColor = 'rgba(255, 170, 0, 0.12)';
            });
            removeSelectionItem.addEventListener('mouseout', () => {
                removeSelectionItem.style.borderLeft = '2px solid transparent';
                removeSelectionItem.style.backgroundColor = 'transparent';
            });
            removeSelectionItem.addEventListener('click', () => {
                actions.removeSelectedRegion();
                destroyMenu();
            });
            menu.appendChild(removeSelectionItem);
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
    if (typeof actions.setRegionColor === 'function') {
        const colorHeader = document.createElement('div');
        colorHeader.textContent = 'Region color';
        colorHeader.className = 'marker-option-header';
        const { control, picker } = createRegionColorControls(
            actions.getRegionColor?.(),
            actions.defaultRegionColor,
            color => actions.setRegionColor(color),
            repositionMenu
        );
        menu.append(colorHeader, control, picker);
    }


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
            const isRegionEffectActive = () =>
                actions.isRegionEffectActive?.(key) ?? effect.active;
            actions.loadRegionEffectSettings?.(key, effect);

            const menuItem = document.createElement('div');
            menuItem.className = 'context-menu-item';
            menuItem.dataset.effectKey = key;
            menuItem.textContent = `${isRegionEffectActive() ? '✓ ' : ''}${effect.name}`;
            Object.assign(menuItem.style, {
                cursor: 'default',
                padding: '5px 5px 5px 15px',
                transition: 'all 0.3s ease',
                borderLeft: '2px solid transparent',
                color: isRegionEffectActive() ? '#2bdba0' : '#fff'
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
                const isNowActive = actions.toggleRegionEffect
                    ? actions.toggleRegionEffect(key) : effectsRegistry.activateEffect(key);
                menuItem.textContent = `${isNowActive ? '✓ ' : ''}${effect.name}`;
                menuItem.style.color = isNowActive ? '#2bdba0' : '#fff';

                if (FILTER_CONTROL_CONFIG[key]) {
                    const oldControls = menuItem.nextElementSibling?.classList.contains('filter-effect-controls')
                        ? menuItem.nextElementSibling
                        : null;
                    oldControls?.remove();
                    if (isNowActive) {
                        menuItem.after(createFilterControls(effect, key, repositionMenu, settings => {
                            actions.saveRegionEffectSettings?.(key, settings);
                        }));
                    }
                    requestAnimationFrame(repositionMenu);
                    return;
                }

                if (isSpeedEffectKey(key)) {
                    menu.querySelectorAll('.context-menu-item[data-effect-key^="speed"]').forEach(speedItem => {
                        const speedKey = speedItem.dataset.effectKey;
                        const speedEffect = effectsRegistry.effects[speedKey];
                        const active = actions.isRegionEffectActive?.(speedKey) ?? Boolean(speedEffect?.active);
                        speedItem.textContent = `${active ? '✓ ' : ''}${speedEffect.name}`;
                        speedItem.style.color = active ? '#2bdba0' : '#fff';
                        if (!active && speedItem.nextElementSibling?.classList.contains('speed-effect-controls')) {
                            speedItem.nextElementSibling.remove();
                        }
                    });

                    if (isNowActive && !menuItem.nextElementSibling?.classList.contains('speed-effect-controls')) {
                        menuItem.after(createSpeedControls(effect, repositionMenu, () => {
                            menuItem.textContent = `✓ ${effect.name}`;
                            actions.saveRegionEffectSettings?.(key, effect.getSettings?.() || {});
                        }));
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
            if (isRegionEffectActive() && FILTER_CONTROL_CONFIG[key]) {
                menu.appendChild(createFilterControls(effect, key, repositionMenu, settings => {
                    actions.saveRegionEffectSettings?.(key, settings);
                }));
            } else if (isRegionEffectActive() && isSpeedEffectKey(key)) {
                menu.appendChild(createSpeedControls(effect, repositionMenu, () => {
                    menuItem.textContent = `✓ ${effect.name}`;
                    actions.saveRegionEffectSettings?.(key, effect.getSettings?.() || {});
                }));
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
