export function createContextMenu(x, y, effectsRegistry, progressBar, updateProgressBarGradient, updateWaveformProgress) {
    const existingMenu = document.querySelector('.waveform-context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const audio = effectsRegistry.audio;

    // clear effects if no selection
    if (!progressBar.selectedStartTime || !progressBar.selectedEndTime) {
        effectsRegistry.deactivateAllEffects();
        audio.volume = 1;
        audio.playbackRate = 1.0;
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

    const categories = effectsRegistry.getEffectsByCategory();

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