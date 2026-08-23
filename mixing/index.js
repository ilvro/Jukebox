import { initializeAudioContext, disconnectAudioContext } from './audio-context.js';
import { EffectsRegistry } from './effects-registry.js';
import { createContextMenu } from './context-menu.js';

export function setupAudioEffects(audio, progressBar, actions = {}) {
    // initialize audio context and create effects registry
    initializeAudioContext(audio);
    const effectsRegistry = new EffectsRegistry(audio, progressBar);
    
    function handleContextMenu(x, y, updateProgressBarGradient, updateWaveformProgress) {
        return createContextMenu(
            x, y, 
            effectsRegistry, 
            progressBar, 
            updateProgressBarGradient, 
            updateWaveformProgress,
            actions
        );
    }

    function cleanup() {
        // deactivate all effects and disconnect audio context
        const currentVolume = audio ? audio.volume : 1;

        effectsRegistry.deactivateAllEffects();
        disconnectAudioContext(audio);
        
        // reset audio element properties
        if (audio) {
            audio.volume = currentVolume;
            audio.playbackRate = 1;
        }
    }

    return {
        createContextMenu: handleContextMenu,
        cleanup,
        isLooping: () => effectsRegistry.isLooping(),
        activateEffect: (key) => effectsRegistry.activateEffect(key),
        getActiveEffectKeys: () => effectsRegistry.getActiveEffectKeys(),
        getActiveTailDuration: () => effectsRegistry.getActiveTailDuration(),
        setActiveEffectKeys: (keys = []) => {
            const requestedKeys = new Set(keys);
            effectsRegistry.getActiveEffectKeys().forEach(key => {
                if (!requestedKeys.has(key)) effectsRegistry.deactivateEffect(key);
            });
            requestedKeys.forEach(key => {
                if (!effectsRegistry.effects[key]?.active) effectsRegistry.activateEffect(key);
            });
            return effectsRegistry.getActiveEffectKeys();
        }
    };
}
