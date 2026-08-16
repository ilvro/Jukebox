// Each song gets its own sourceNode/dryGain/wetGain pair, all sharing one
// AudioContext and one final mainGainNode -> destination bus. This means
// effects (reverb, echo, filters, nightcore, pitch/speed...) now work
// correctly on every song, not just whichever one happened to play first.
let audioContext = null;
let mainGainNode = null;
let masterVolume = 1;
const audioNodes = new Map(); // audio element -> { sourceNode, dryGainNode, wetGainNode, isInitialized }

function ensureAudioContext() {
    if (!audioContext) {
        const contextOptions = {
            latencyHint: 'playback',
            sampleRate: 48000,
        };

        audioContext = new (window.AudioContext || window.webkitAudioContext)(contextOptions);

        mainGainNode = audioContext.createGain();
        mainGainNode.gain.value = masterVolume;
        mainGainNode.connect(audioContext.destination);
    }
    return audioContext;
}

// master volume affects every song at once, applied after each song's own
// dry/wet mix, right before the final output
export function setMasterVolume(value) {
    masterVolume = value;
    if (mainGainNode) {
        mainGainNode.gain.value = value;
    }
}

export function getMasterVolume() {
    return masterVolume;
}

// taps the shared output bus into a MediaStream, so whatever is currently
// playing (with its effects applied) can be captured with a MediaRecorder.
// call release() once done to disconnect the tap.
export function createRecordingTap() {
    ensureAudioContext();
    const destination = audioContext.createMediaStreamDestination();
    mainGainNode.connect(destination);
    return {
        stream: destination.stream,
        release: () => {
            try {
                mainGainNode.disconnect(destination);
            } catch (error) {
                // already disconnected, nothing to do
            }
        }
    };
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
            const sourceGainNode = audioContext.createGain();
            const dryGainNode = audioContext.createGain();
            const wetGainNode = audioContext.createGain();

            sourceNode.connect(sourceGainNode);
            sourceGainNode.connect(dryGainNode);
            sourceGainNode.connect(wetGainNode);
            dryGainNode.connect(mainGainNode);

            entry = { sourceNode, sourceGainNode, dryGainNode, wetGainNode, isInitialized: true };
            audioNodes.set(audio, entry);

            console.log("Audio context initialized for song");
        } else if (!entry.isInitialized) {
            entry.sourceGainNode.connect(entry.wetGainNode);

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
        entry.sourceGainNode.disconnect(entry.wetGainNode);

        entry.isInitialized = false;
        console.log("Audio context disconnected for song");
    } catch (error) {
        console.error("Error disconnecting audio context:", error);
    }
}

// Permanently releases a song that was removed from the jukebox. Pausing a
// song uses disconnectAudioContext() because its MediaElementSource must be
// reused; deletion uses this so the internal map cannot retain abandoned
// audio elements after a new preset is loaded.
export function releaseAudioContext(audio) {
    const entry = audioNodes.get(audio);
    if (!entry) return;

    try {
        entry.sourceNode.disconnect();
        entry.sourceGainNode.disconnect();
        entry.dryGainNode.disconnect();
        entry.wetGainNode.disconnect();
    } catch (error) {
        console.warn('Error releasing audio context:', error);
    } finally {
        audioNodes.delete(audio);
    }
}

export function getAudioContext(audio) {
    const entry = audioNodes.get(audio) || {};
    return {
        audioContext,
        sourceNode: entry.sourceNode,
        mainGainNode,
        sourceGainNode: entry.sourceGainNode,
        dryGainNode: entry.dryGainNode,
        wetGainNode: entry.wetGainNode,
        isInitialized: !!entry.isInitialized
    };
}
