import { initializeAudioContext, disconnectAudioContext } from './audio-context.js';
import { EffectsRegistry } from './effects-registry.js';
import { createContextMenu } from './context-menu.js';

export function setupAudioEffects(audio, progressBar) {
    // initialize audio context and create effects registry
    initializeAudioContext(audio);
    const effectsRegistry = new EffectsRegistry(audio, progressBar);
    
    function handleContextMenu(x, y, updateProgressBarGradient, updateWaveformProgress) {
        return createContextMenu(
            x, y, 
            effectsRegistry, 
            progressBar, 
            updateProgressBarGradient, 
            updateWaveformProgress
        );
    }

    function cleanup() {
        // deactivate all effects and disconnect audio context
        effectsRegistry.deactivateAllEffects();
        disconnectAudioContext();
        
        // reset audio element properties
        if (audio) {
            audio.volume = 1;
            audio.playbackRate = 1;
        }
    }

    return {
        createContextMenu: handleContextMenu,
        cleanup,
        isLooping: () => effectsRegistry.isLooping()
    };
}