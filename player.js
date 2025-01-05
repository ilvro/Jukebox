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
// player container/controller
const playerContainer = document.getElementById('player-container');
const showPlayerBtn = document.getElementById('show-player-button');
let animationFrameId = null;
let isDragging = false;
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

    Object.entries(activeAudios).forEach(([songId, audio]) => {
        const trackDiv = document.createElement('div');
        trackDiv.className = 'track-item';
        trackDiv.dataset.songId = songId;

        const songElement = document.querySelector(`[data-song-id="${songId}"]`);
        const songTitle = songElement.querySelector('input').value;
        const titleSpan = document.createElement('span');
        titleSpan.textContent = songTitle;
        trackDiv.appendChild(titleSpan);

        const progressContainer = document.createElement('div');
        progressContainer.className = 'progress-container';

        const waveformCanvas = document.createElement('canvas');
        waveformCanvas.className = 'waveform-canvas';
        progressContainer.appendChild(waveformCanvas);

        const progressBar = document.createElement('input');
        progressBar.type = 'range';
        progressBar.min = 0;
        progressBar.max = audio.duration || 100;
        progressBar.value = audio.currentTime;
        progressBar.className = 'progress-bar';
        progressContainer.appendChild(progressBar);

        trackDiv.appendChild(progressContainer);

        const volumeControl = document.createElement('input');
        volumeControl.type = 'range';
        volumeControl.min = 0;
        volumeControl.max = 1;
        volumeControl.step = 0.01;
        volumeControl.value = audio.volume;
        volumeControl.className = 'volume-control';
        trackDiv.appendChild(volumeControl);

        progressBar.addEventListener('input', () => {
            audio.currentTime = progressBar.value;
        });

        volumeControl.addEventListener('input', () => {
            audio.volume = volumeControl.value;
        });

        generateWaveform(audio, waveformCanvas);
        
        audio.addEventListener('timeupdate', () => {
            progressBar.value = audio.currentTime;
            updateWaveformProgress(audio, waveformCanvas, progressBar);

            // check loop
            if (progressBar.startLoopTime !== undefined && progressBar.endLoopTime !== undefined) {
                const precision = 0.1; // weird thing to make it a bit more precise, it doesnt loop at the exact end point due to how audio is processed in browsers
                if (audio.currentTime >= progressBar.endLoopTime - precision) {
                    audio.currentTime = progressBar.startLoopTime;
                }
            }
        });

        // loop selection
        let rightClickTimer = null;
        progressBar.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });
        
        progressBar.addEventListener('mousedown', (event) => { 
            if (event.button === 2) {
                isDragging = true;
                event.preventDefault();
                const rect = progressBar.getBoundingClientRect();
                const clickPosition = (event.clientX - rect.left) / rect.width;
                const selectedTime = clickPosition * audio.duration;
        
                if (!progressBar.startLoopTime) { // set loop start point if there isnt one
                    progressBar.startLoopTime = selectedTime;
                } 
                else if (!progressBar.endLoopTime) { // set loop end point if there isnt one
                    progressBar.endLoopTime = selectedTime;
        
                    // ensure start is always before end
                    if (progressBar.startLoopTime > progressBar.endLoopTime) {
                        [progressBar.startLoopTime, progressBar.endLoopTime] = [
                            progressBar.endLoopTime,
                            progressBar.startLoopTime,
                        ];
                    }
                } else { // handle special cases
                    if (selectedTime < progressBar.startLoopTime) { // set new start loop time if clicked
                        progressBar.startLoopTime = selectedTime;
                    } else if (selectedTime > progressBar.endLoopTime) { // set new end loop time if clicked
                        progressBar.endLoopTime = selectedTime;

                    } else if (selectedTime < progressBar.endLoopTime && selectedTime > progressBar.startLoopTime) { // if selection is between the two points, make it the new start point
                        progressBar.startLoopTime = selectedTime;
                    }
                }

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
        
                // highlight the selected loop range
                progressBar.style.background = `linear-gradient(to right, 
                    #333 ${progressBar.startLoopTime / audio.duration * 100}%, 
                    #2bdbb0 ${progressBar.startLoopTime / audio.duration * 100}%, 
                    #2bdbb0 ${progressBar.endLoopTime / audio.duration * 100}%, 
                    #333 ${progressBar.endLoopTime / audio.duration * 100}%)`;
        
                // dragging selection
                const onMouseMove = (moveEvent) => {
                    if (!isDragging) return;
                    
                    const movePosition = (moveEvent.clientX - rect.left) / rect.width;
                    const movedTime = movePosition * audio.duration;
                    progressBar.endLoopTime = movedTime;
    
                    if (progressBar.startLoopTime > progressBar.endLoopTime) {
                        [progressBar.startLoopTime, progressBar.endLoopTime] = [
                            progressBar.endLoopTime,
                            progressBar.startLoopTime,
                        ];
                    }
    
                    // cancel any pending animation frame
                    if (animationFrameId) {
                        cancelAnimationFrame(animationFrameId);
                    }
    
                    // schedule a new frame
                    animationFrameId = requestAnimationFrame(() => {
                        updateWaveformProgress(audio, waveformCanvas, progressBar);
                        updateProgressBarGradient(progressBar, audio);
                    });
                };
        
                const onMouseUp = () => {
                    isDragging = false;
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    // Final update after drag ends
                    requestAnimationFrame(() => {
                        updateWaveformProgress(audio, waveformCanvas, progressBar);
                        updateProgressBarGradient(progressBar, audio);
                    });
                };
        
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            }
        });

        playerContainer.appendChild(trackDiv);
    });
}

// this part might look weird, theres some optimization involved, waveforms are hard to work with
function drawWaveform(canvas, waveformData) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    canvas.waveformData = waveformData;
    ctx.clearRect(0, 0, width, height);
    
    // draw background waveform
    const barWidth = 2;
    const gap = 1;
    
    for (let i = 0; i < waveformData.length; i++) {
        const x = i * (barWidth + gap);
        const barHeight = Math.max(2, waveformData[i] * height * 0.8);
        const y = (height - barHeight) / 2;
        ctx.fillStyle = '#333';
        ctx.fillRect(x, y, barWidth, barHeight);
    }
}

function updateProgressBarGradient(progressBar, audio) {
    if (progressBar.startLoopTime === undefined || progressBar.endLoopTime === undefined) {
        progressBar.style.background = '#333';
        return;
    }

    const startPercent = (progressBar.startLoopTime / audio.duration * 100).toFixed(2);
    const endPercent = (progressBar.endLoopTime / audio.duration * 100).toFixed(2);
    
    progressBar.style.background = `linear-gradient(to right, 
        #333 ${startPercent}%, 
        #2bdbb0 ${startPercent}%, 
        #2bdbb0 ${endPercent}%, 
        #333 ${endPercent}%)`;
}

function updateWaveformProgress(audio, canvas, progressBar) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    const waveformData = canvas.waveformData;
    
    if (!waveformData) return;

    ctx.clearRect(0, 0, width, height);
    
    const barWidth = 2;
    const gap = 1;
    const progress = audio.currentTime / audio.duration;
    const progressPixel = Math.floor(width * progress);
    const loopStartPixel = progressBar.startLoopTime ? Math.floor((progressBar.startLoopTime / audio.duration) * width) : -1;
    const loopEndPixel = progressBar.endLoopTime ? Math.floor((progressBar.endLoopTime / audio.duration) * width) : -1;

    // draw in batches for better performance
    const batchSize = 50;
    for (let i = 0; i < waveformData.length; i += batchSize) {
        const endIndex = Math.min(i + batchSize, waveformData.length);
        
        ctx.beginPath();
        for (let j = i; j < endIndex; j++) {
            const x = j * (barWidth + gap);
            const barHeight = Math.max(2, waveformData[j] * height * 0.8);
            const y = (height - barHeight) / 2;

            if (x <= progressPixel) {
                ctx.fillStyle = '#2bdbb0';
            } else if (loopStartPixel !== -1 && loopEndPixel !== -1 && 
                      x >= loopStartPixel && x <= loopEndPixel) {
                ctx.fillStyle = '#4a9eff';
            } else {
                ctx.fillStyle = '#333';
            }
            
            ctx.fillRect(x, y, barWidth, barHeight);
        }
        ctx.fill();
    }

    // draw loop points if they exist
    if (progressBar.startLoopTime !== undefined && progressBar.endLoopTime !== undefined) {
        ctx.fillStyle = '#4a9eff';
        const startX = (progressBar.startLoopTime / audio.duration) * width;
        const endX = (progressBar.endLoopTime / audio.duration) * width;
        
        ctx.fillRect(startX - 1, 0, 2, height);
        ctx.fillRect(endX - 1, 0, 2, height);
    }
}

async function generateWaveform(audio, canvas) {
    try {
        canvas.width = 500;
        canvas.height = 30;
        
        const response = await fetch(audio.src);
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        const rawData = audioBuffer.getChannelData(0);
        const samplesPerPixel = Math.floor(rawData.length / canvas.width);
        const waveformData = new Float32Array(canvas.width);
        
        // process audio data more efficiently
        for (let i = 0; i < canvas.width; i++) {
            const start = i * samplesPerPixel;
            const end = start + samplesPerPixel;
            let max = 0;
            
            for (let j = start; j < end; j++) {
                const amplitude = Math.abs(rawData[j]);
                if (amplitude > max) max = amplitude;
            }
            
            waveformData[i] = max;
        }

        drawWaveform(canvas, waveformData);

    } catch (error) {
        console.error("Error generating waveform:", error);
    }
}