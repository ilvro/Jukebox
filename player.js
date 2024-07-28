let currentAudio = null;

function createAudioElement(audioUrl) {
    const audio = new Audio(audioUrl);
    audio.preload = 'auto';
    return audio;
}

function playAudio(audioElement, songItem) {
    if (currentAudio && currentAudio !== audioElement) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        document.querySelector('.song_item.playing').classList.remove('playing');
    }

    if (audioElement.paused) {
        audioElement.play();
        songItem.classList.add('playing');
    } else {
        audioElement.pause();
        songItem.classList.remove('playing');
    }

    currentAudio = audioElement;
}

function addClickListenerToSongItem(songItem, audio) {
    songItem.addEventListener('click', () => {
        playAudio(audio, songItem);
    });
}

function initializeExistingSongs() { // should be used when 'load preset' is done
    const songItems = document.querySelectorAll('.song_item');
    songItems.forEach((songItem) => {
        const audioUrl = songItem.dataset.audioUrl;
        if (audioUrl) {
            const audio = createAudioElement(audioUrl);
            addClickListenerToSongItem(songItem, audio);
        }
    });
}

function addSongToPlayer(songElement, audioFile) {
    const audioUrl = URL.createObjectURL(audioFile);
    songElement.dataset.audioUrl = audioUrl;
    
    const audio = createAudioElement(audioUrl);
    addClickListenerToSongItem(songElement, audio);
}

export { addSongToPlayer };