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
// song player
const playerContainer = document.getElementById('player-container');
const showPlayerBtn = document.getElementById('show-player-button');
function showPlayer() {
    playerContainer.classList.toggle('active');
    playerContainer.classList.toggle('showBtn')
    showPlayerBtn.textContent = showPlayerBtn.textContent === 'Show Player' ? 'Hide Player' : 'Show Player';
}
window.showPlayer = showPlayer;

playerContainer.addEventListener('mouseover', () => {
    if (!playerContainer.classList.contains('active')) {
        playerContainer.classList.add('active');
        showPlayerBtn.textContent = showPlayerBtn.textContent === 'Show Player' ? 'Hide Player' : 'Show Player';
    }
});

playerContainer.addEventListener('mouseout', () => {
    if (playerContainer.classList.contains('active') && !playerContainer.classList.contains('showBtn')) {
        playerContainer.classList.remove('active');
        showPlayerBtn.textContent = showPlayerBtn.textContent === 'Show Player' ? 'Hide Player' : 'Show Player';
    }
});

function updatePlayerUI() {
    const playerContainer = document.getElementById('track-list');
    playerContainer.innerHTML = '';

    Object.entries(activeAudios).forEach(([songId, audio]) => { // add songs that are being played to the player
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

        // -----------------------------------------------------------------------
        // loop selection
        progressBar.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            const rect = progressBar.getBoundingClientRect();
            const clickPosition = (event.clientX - rect.left) / rect.width;
            const selectedTime = clickPosition * audio.duration;
        
            if (!progressBar.startLoopTime) {
                progressBar.startLoopTime = selectedTime; // set start point
            } else {
                // set the end point
                progressBar.endLoopTime = selectedTime; // set end point
        
                // ensure start is before end
                if (progressBar.startLoopTime > progressBar.endLoopTime) {
                    [progressBar.startLoopTime, progressBar.endLoopTime] = [
                        progressBar.endLoopTime,
                        progressBar.startLoopTime,
                    ];
                }
        
                // highlight the selected range
                progressBar.style.background = `linear-gradient(to right, 
                    #333 ${progressBar.startLoopTime / audio.duration * 100}%, 
                    #2bdbb0 ${progressBar.startLoopTime / audio.duration * 100}%, 
                    #2bdbb0 ${progressBar.endLoopTime / audio.duration * 100}%, 
                    #333 ${progressBar.endLoopTime / audio.duration * 100}%)`;
            }
        });

        audio.addEventListener('timeupdate', () => { // apply loop (different function to make it more organized)
            if (progressBar.startLoopTime !== undefined && progressBar.endLoopTime !== undefined) {
                if (audio.currentTime >= progressBar.endLoopTime) {
                    audio.currentTime = progressBar.startLoopTime;
                }
            }
        });

        progressBar.addEventListener('dblclick', () => { // reset loop times on double click
            progressBar.startLoopTime = undefined;
            progressBar.endLoopTime = undefined;
            progressBar.style.background = '#333';
        });
    });
}