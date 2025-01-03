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
    }
});

playerContainer.addEventListener('mouseout', () => {
    if (playerContainer.classList.contains('active') && !playerContainer.classList.contains('showBtn')) {
        playerContainer.classList.remove('active');
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
        // audio loop selection
        let rightClickTimer = null;
        progressBar.addEventListener('mousedown', (event) => {
            if (event.button === 2) {
                event.preventDefault();
                if (rightClickTimer) { // reset loop times on rmb double click
                    progressBar.startLoopTime = undefined;
                    progressBar.endLoopTime = undefined;
                    progressBar.style.background = '#333';
                    rightClickTimer = null;
                } else {
                    rightClickTimer = setTimeout(() => {
                        rightClickTimer = null;
                    }, 300);
                }
        
                const rect = progressBar.getBoundingClientRect();
                const clickPosition = (event.clientX - rect.left) / rect.width;
                const selectedTime = clickPosition * audio.duration;
        
                if (!progressBar.startLoopTime) {
                    progressBar.startLoopTime = selectedTime; // set loop start point
                } 
                else if (!progressBar.endLoopTime) {
                    progressBar.endLoopTime = selectedTime; // set loop end point
                    // ensure start is always before end
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
        
                    // dynamic dragging
                    const onMouseMove = (moveEvent) => {
                    const movePosition = (moveEvent.clientX - rect.left) / rect.width;
                    progressBar.endLoopTime = movePosition * audio.duration;
        
                    if (progressBar.startLoopTime > progressBar.endLoopTime) {
                        [progressBar.startLoopTime, progressBar.endLoopTime] = [
                            progressBar.endLoopTime,
                            progressBar.startLoopTime,
                        ];
                    }
        
                    // highlight the range
                    progressBar.style.background = `linear-gradient(to right, 
                        #333 ${progressBar.startLoopTime / audio.duration * 100}%, 
                        #2bdbb0 ${progressBar.startLoopTime / audio.duration * 100}%, 
                        #2bdbb0 ${progressBar.endLoopTime / audio.duration * 100}%, 
                        #333 ${progressBar.endLoopTime / audio.duration * 100}%)`;
                };
        
                const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            }
        });

        audio.addEventListener('timeupdate', () => {
            if (progressBar.startLoopTime !== undefined && progressBar.endLoopTime !== undefined) {
                const precision = 0.1; // weird thing to make it a bit more precise, it doesnt loop at the exact end point due to how audio is processed in browsers
                if (audio.currentTime >= progressBar.endLoopTime - precision) {
                    audio.currentTime = progressBar.startLoopTime;
                }
            }
        });

        progressBar.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        })
    });
}