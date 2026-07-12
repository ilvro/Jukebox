/* to add a new effect:
    1. add the effect class code to a new or an existing file, using a new class that extends AudioEffect
       the effect must always have the following line of code: 
           setupNodes(audioContext, sourceNode, dryGainNode, wetGainNode, mainGainNode) { // }
           setupTimeUpdate(audio, audioContext, progressBar, dryGainNode, wetGainNode) { // }
        to be able to be connect to the audio context. otherwise, they wont be heard. look into any effect code for examples


    2. import the file as seen below
    3. add it to the appropriate category in initializeEffects and getEffectsByCategory
*/

import { initializeAudioContext, disconnectAudioContext, getAudioContext } from './audio-context.js';
import { LoopEffect, SmoothLoopEffect, PlaybackSpeedEffect, PitchShiftEffect, ReverseEffect } from './effects/playback-effects.js';
import { ReverbEffect, EchoEffect, TremoloEffect } from './effects/time-effects.js';
import { FilterEffect } from './effects/filter-effects.js';
import { NightcoreEffect } from './effects/preset-effects.js';

export class EffectsRegistry {
    constructor(audioElement, progressBar) {
        this.audio = audioElement;
        this.progressBar = progressBar;
        this.effects = this.initializeEffects();
        
        initializeAudioContext(this.audio);
    }

    initializeEffects() {
        return {
            loop: new LoopEffect(),
            smoothLoop: new SmoothLoopEffect(),
            reverse: new ReverseEffect(),
            speed075: new PlaybackSpeedEffect(0.75),
            speed090: new PlaybackSpeedEffect(0.90),
            speed125: new PlaybackSpeedEffect(1.25),
            speed110: new PlaybackSpeedEffect(1.10),
            pitchShift: new PitchShiftEffect(),
            reverb: new ReverbEffect(),
            echo: new EchoEffect(),
            tremolo: new TremoloEffect(),
            highpass: new FilterEffect('Highpass', 'highpass'),
            lowpass: new FilterEffect('Lowpass', 'lowpass'),
            nightcore: new NightcoreEffect()
        };
    }

    getEffectsByCategory() {
        const categories = {
            'Playback': ['loop', 'smoothLoop', 'reverse'],
            'Speed & Pitch': ['speed075', 'speed090', 'speed110', 'speed125', 'pitchShift'],
            'Effects': ['echo', 'reverb', 'tremolo'],
            'Filters': ['highpass', 'lowpass'],
            'Presets': ['nightcore']
        };

        return categories;
    }

    activateEffect(effectKey) {
        const effect = this.effects[effectKey];
        if (!effect) return false;

        // special cases for mutually exclusive effects (loops)
        if (effectKey === 'loop' && this.effects.smoothLoop?.active) {
            this.deactivateEffect('smoothLoop');
        } else if (effectKey === 'smoothLoop' && this.effects.loop?.active) {
            this.deactivateEffect('loop');
        }

        // ensure audio context is initialized before activating effects
        const initialized = initializeAudioContext(this.audio);
        if (!initialized) {
            console.error("Failed to initialize audio context for effect:", effectKey);
            return false;
        }
        
        const context = getAudioContext(this.audio);
        
        // check all required nodes
        if (!context.audioContext || !context.sourceNode || 
            !context.dryGainNode || !context.wetGainNode || !context.mainGainNode) {
            console.error("Missing required audio nodes for effect:", effectKey);
            return false;
        }
        
        return effect.toggle(
            context.audioContext,
            context.sourceNode,
            context.dryGainNode,
            context.wetGainNode,
            context.mainGainNode,
            this.audio,
            this.progressBar,
            this
        );
    }
    
    deactivateEffect(effectKey) {
        const effect = this.effects[effectKey];
        if (effect && effect.active) {
            effect.deactivate();
            return true;
        }
        return false;
    }

    deactivateAllEffects() {
        Object.values(this.effects).forEach(effect => {
            if (effect.active) {
                effect.deactivate();
            }
        });
    }

    isLooping() {
        return this.effects.loop?.active || this.effects.smoothLoop?.active;
    }

    getActiveEffectKeys() {
        return Object.entries(this.effects)
            .filter(([, effect]) => effect.active)
            .map(([key]) => key);
    }
}