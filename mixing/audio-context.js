// Each song gets its own sourceNode/dryGain/wetGain pair, all sharing one
// AudioContext and one final mainGainNode -> destination bus. This means
// effects (reverb, echo, filters, nightcore, pitch/speed...) now work
// correctly on every song, not just whichever one happened to play first.
let audioContext = null;
let mainGainNode = null;
const audioNodes = new Map(); // audio element -> { sourceNode, dryGainNode, wetGainNode, isInitialized }

function ensureAudioContext() {
    if (!audioContext) {
        const contextOptions = {
            latencyHint: 'playback',
            sampleRate: 48000,
        };

        audioContext = new (window.AudioContext || window.webkitAudioContext)(contextOptions);

        mainGainNode = audioContext.createGain();
        mainGainNode.connect(audioContext.destination);
    }
    return audioContext;
}

export function initializeAudioContext(audio) {
    if (!audio) {
        console.error("Audio element is required for initialization");
        return false;
    }

    try {
        ensureAudioContext();

        let entry = audioNodes.get(audio);

        if (!entry) {
            // createMediaElementSource can only ever be called once per audio
            // element, so each song's source node is created a single time
            // and reused for the lifetime of that audio element
            const sourceNode = audioContext.createMediaElementSource(audio);
            const dryGainNode = audioContext.createGain();
            const wetGainNode = audioContext.createGain();

            sourceNode.connect(dryGainNode);
            sourceNode.connect(wetGainNode);
            dryGainNode.connect(mainGainNode);

            entry = { sourceNode, dryGainNode, wetGainNode, isInitialized: true };
            audioNodes.set(audio, entry);

            console.log("Audio context initialized for song");
        } else if (!entry.isInitialized) {
            entry.sourceNode.connect(entry.dryGainNode);
            entry.sourceNode.connect(entry.wetGainNode);
            entry.dryGainNode.connect(mainGainNode);

            entry.isInitialized = true;
            console.log("Audio context connections restored for song");
        }

        return true;
    } catch (error) {
        console.error("Error initializing audio context:", error);
        return false;
    }
}

export function disconnectAudioContext(audio) {
    const entry = audioNodes.get(audio);
    if (!entry || !entry.isInitialized) return;

    try {
        entry.wetGainNode.gain.setValueAtTime(0, audioContext.currentTime);
        entry.dryGainNode.gain.setValueAtTime(1, audioContext.currentTime);

        // disconnect the wet path but keep the dry path intact, so the song
        // keeps playing normally once its effects are turned off
        entry.sourceNode.disconnect(entry.wetGainNode);

        entry.isInitialized = false;
        console.log("Audio context disconnected for song");
    } catch (error) {
        console.error("Error disconnecting audio context:", error);
    }
}

export function getAudioContext(audio) {
    const entry = audioNodes.get(audio) || {};
    return {
        audioContext,
        sourceNode: entry.sourceNode,
        mainGainNode,
        dryGainNode: entry.dryGainNode,
        wetGainNode: entry.wetGainNode,
        isInitialized: !!entry.isInitialized
    };
}