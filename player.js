let activeAudios = {};

function createAudioElement(audioUrl) {
    const audio = new Audio(audioUrl);
    audio.preload = 'auto';
    return audio;
}

function toggleAudio(audioElement, songItem) {
    const songId = songItem.dataset.songId;

    if (audioElement.paused) {
        audioElement.play();
        songItem.classList.add('playing');
        activeAudios[songId] = audioElement;
    } else {
        audioElement.pause();
        //audioElement.currentTime = 0;
        songItem.classList.remove('playing');
        delete activeAudios[songId];
    }
}

function addClickListenerToSongItem(songItem, audio) {
    songItem.addEventListener('click', () => {
        toggleAudio(audio, songItem);
    });
}

/*
should be used when 'load preset' is done

function initializeExistingSongs() {
    const songItems = document.querySelectorAll('.song_item');
    songItems.forEach((songItem, index) => {
        const audioUrl = songItem.dataset.audioUrl;
        if (audioUrl) {
            const audio = createAudioElement(audioUrl);
            songItem.dataset.songId = `song-${index}`;
            addClickListenerToSongItem(songItem, audio);
        }
    });
}
*/

function addSongToPlayer(songElement, audioFile) {
    const audioUrl = URL.createObjectURL(audioFile);
    songElement.dataset.audioUrl = audioUrl;
    
    const songId = `song-${Date.now()}`;
    songElement.dataset.songId = songId;
    
    const audio = createAudioElement(audioUrl);
    addClickListenerToSongItem(songElement, audio);
}

export { addSongToPlayer };