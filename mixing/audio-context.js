let audioContext = null;
let sourceNode = null;
let mainGainNode = null;
let reverbNodes = null;
let dryGainNode = null;
let wetGainNode = null;
let isAudioContextInitialized = false;

export function initializeAudioContext(audio) {
    if (!audio) {
        console.error("Audio element is required for initialization");
        return false;
    }

    try {
        if (!audioContext) {
            // create a new audio context if one doesnt exist
            const contextOptions = {
                latencyHint: 'playback',
                sampleRate: 48000,
            };
            
            audioContext = new (window.AudioContext || window.webkitAudioContext)(contextOptions);
            
            // create source node from the audio element
            sourceNode = audioContext.createMediaElementSource(audio);
            
            // gain nodes
            mainGainNode = audioContext.createGain();
            dryGainNode = audioContext.createGain();
            wetGainNode = audioContext.createGain();
            
            sourceNode.connect(dryGainNode);
            sourceNode.connect(wetGainNode);
            
            dryGainNode.connect(mainGainNode);
            mainGainNode.connect(audioContext.destination);
            
            isAudioContextInitialized = true;
            console.log("Audio context initialized successfully");
        } else if (!isAudioContextInitialized) {
            sourceNode.connect(dryGainNode);
            sourceNode.connect(wetGainNode);
            dryGainNode.connect(mainGainNode);
            mainGainNode.connect(audioContext.destination);
            
            isAudioContextInitialized = true;
            console.log("Audio context connections restored");
        }
        
        return true;
    } catch (error) {
        console.error("Error initializing audio context:", error);
        return false;
    }
}

export function disconnectAudioContext() {
    if (isAudioContextInitialized) {
        try {
            if (wetGainNode) {
                wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
            }
            if (dryGainNode) {
                dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);
            }

            // disconnect reverb-related nodes if they exist
            if (reverbNodes) {
                reverbNodes.delays?.forEach(delay => delay.disconnect());
                reverbNodes.gains?.forEach(gain => gain.disconnect());
                reverbNodes.output?.disconnect();
                reverbNodes = null;
            }

            // disconnect wet path but keep dry path intact
            if (sourceNode && wetGainNode) {
                sourceNode.disconnect(wetGainNode);
            }

            isAudioContextInitialized = false;
            console.log("Audio context disconnected");
        } catch (error) {
            console.error("Error disconnecting audio context:", error);
        }
    }
}

export function getAudioContext() {
    return {
        audioContext,
        sourceNode, 
        mainGainNode,
        dryGainNode,
        wetGainNode,
        isInitialized: isAudioContextInitialized
    };
}