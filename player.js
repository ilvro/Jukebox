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
        songItem.classList.remove('playing');
        delete activeAudios[songId];
    }
}

function addClickListenerToSongItem(songItem, audio) {
    songItem.addEventListener('click', (event) => {
        if (event.target.classList.contains('title-input')) {
            return;
        }
        toggleAudio(audio, songItem);
        updatePlayerUI();
    });
}

function addSongToPlayer(songElement, audioFile) {
    const audioUrl = URL.createObjectURL(audioFile);
    songElement.dataset.audioUrl = audioUrl;
    
    const songId = `song-${Date.now()}`;
    songElement.dataset.songId = songId;
    
    const audio = createAudioElement(audioUrl);
    addClickListenerToSongItem(songElement, audio);

    updatePlayerUI();
}

export { addSongToPlayer };

// ---------------------------------------------
const playerContainer = document.getElementById('player-container');
const togglePlayerBtn = document.getElementById('show-player-button');
function togglePlayer() {
    playerContainer.style.display = playerContainer.style.display === 'none' ? 'block' : 'none';
    togglePlayerBtn.textContent = togglePlayerBtn.textContent === 'Show Player' ? 'Hide Player' : 'Show Player';
}
window.togglePlayer = togglePlayer;

function updatePlayerUI() {
    const playerContainer = document.getElementById('track-list');
    playerContainer.innerHTML = '';

    Object.entries(activeAudios).forEach(([songId, audio]) => {
        const trackDiv = document.createElement('div');
        trackDiv.className = 'track-item';
        trackDiv.dataset.songId = songId;

        const songElement = document.querySelector(`[data-song-id="${songId}`);
        const songTitle = songElement.querySelector('input').value;
        const titleSpan = document.createElement('span');
        titleSpan.textContent = songTitle;
        trackDiv.appendChild(titleSpan);

        const progressBar = document.createElement('input');
        progressBar.type = 'range';
        progressBar.min = 0;
        progressBar.max = audio.duration || 100;
        progressBar.value = audio.currentTime;
        progressBar.className = 'progress-bar';

        progressBar.addEventListener('input', () => {
            audio.currentTime = progressBar.value;
        });

        audio.addEventListener('timeupdate', () => {
            progressBar.value = audio.currentTime;
        });

        trackDiv.appendChild(progressBar);

        const volumeControl = document.createElement('input');
        volumeControl.type = 'range';
        volumeControl.min = 0;
        volumeControl.max = 1;
        volumeControl.step = 0.01;
        volumeControl.value = audio.volume;
        volumeControl.className = 'volume-control';

        volumeControl.addEventListener('input', () => {
            audio.volume = volumeControl.value;
        });

        trackDiv.appendChild(volumeControl);
        playerContainer.appendChild(trackDiv);
    });
}