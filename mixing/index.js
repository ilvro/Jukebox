import { initializeAudioContext, disconnectAudioContext, setTrackVolume, getTrackVolume } from './audio-context.js';
import { EffectsRegistry } from './effects-registry.js';
import { createContextMenu } from './context-menu.js';

export function setupAudioEffects(audio, progressBar, actions = {}) {
    // Defer Web Audio MediaElementSource creation until an effect or recording
    // is actually activated so plain playback uses the native low-latency path.
    setTrackVolume(audio, actions?.initialVolume ?? getTrackVolume(audio));
    const effectsRegistry = new EffectsRegistry(audio, progressBar, { lazyAudioContext: true });
    
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
        const currentVolume = audio ? getTrackVolume(audio) : 1;

        effectsRegistry.deactivateAllEffects();
        disconnectAudioContext(audio);
        
        // reset audio element properties
        if (audio) {
            setTrackVolume(audio, currentVolume);
            audio.playbackRate = 1;
        }
    }

    return {
        createContextMenu: handleContextMenu,
        cleanup,
        isLooping: () => effectsRegistry.isLooping(),
        isCrossfading: () => Boolean(effectsRegistry.effects.smoothLoop?.crossfading),
        activateEffect: (key) => effectsRegistry.activateEffect(key),
        hasEffect: (key) => Boolean(effectsRegistry.effects[effectsRegistry.normalizeEffectKey(key)]),
        getActiveEffectKeys: () => effectsRegistry.getActiveEffectKeys(),
        getActiveTailDuration: () => effectsRegistry.getActiveTailDuration(),
        getEffectSettings: () => effectsRegistry.getEffectSettings(),
        setEffectSettings: (settings = {}) => effectsRegistry.setEffectSettings(settings),
        setActiveEffectKeys: (keys = []) => {
            const requestedKeys = new Set(effectsRegistry.normalizeEffectKeys(keys));
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
