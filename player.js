import { setupAudioEffects } from './mixing/index.js';
let activeAudios = {};
let sharedAudioContext;
const playerContainer = document.getElementById('player-container');
const showPlayerBtn = document.getElementById('show-player-button');
const doubleClickDelay = 300;
let lastRightClickTime = 0;
let isDragging = false;

const songMarkers = {};

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
    
    if (!songMarkers[songId]) {
        songMarkers[songId] = [];
    }
    
    const audio = createAudioElement(audioUrl);
    addClickListenerToSongItem(songElement, audio);

    updatePlayerUI();
}

function addMarker(songId, time) {
    if (!songMarkers[songId]) {
        songMarkers[songId] = [];
    }
    
    const exists = songMarkers[songId].some(marker => Math.abs(marker - time) < 0.5);
    if (!exists) {
        songMarkers[songId].push(time);
        songMarkers[songId].sort((a, b) => a - b); // mantém ordenado
        return true;
    }
    return false;
}

function removeMarker(songId, time) {
    if (!songMarkers[songId]) return false;
    
    const index = songMarkers[songId].findIndex(marker => Math.abs(marker - time) < 0.5);
    if (index !== -1) {
        songMarkers[songId].splice(index, 1);
        return true;
    }
    return false;
}

function getMarkers(songId) {
    return songMarkers[songId] || [];
}

function setMarkers(songId, markers) {
    songMarkers[songId] = markers || [];
}

export { addSongToPlayer, getMarkers, setMarkers };

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
    if (playerContainer.classList.contains('active') && !playerContainer.classList.contains('showBtn') && !document.getElementById('waveform-context-menu')) {
        playerContainer.classList.remove('active');
    }
});

function isPointInSelectedRegion(time, progressBar) {
    return progressBar.selectedStartTime !== undefined && 
           progressBar.selectedEndTime !== undefined &&
           time >= progressBar.selectedStartTime && 
           time <= progressBar.selectedEndTime;
}

playerContainer.addEventListener('contextmenu', (event) => {
    event.preventDefault();
})

function updatePlayerUI() {
    const playerContainer = document.getElementById('track-list');
    playerContainer.innerHTML = '';

    Object.entries(activeAudios).forEach(([songId, audio]) => {
        const getExactTime = (event, element) => {
            const rect = element.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            return (mouseX / rect.width) * audio.duration;
        };

        // UI
        const trackDiv = document.createElement('div');
        trackDiv.className = 'track-item';
        trackDiv.dataset.songId = songId;

        const songElement = document.querySelector(`[data-song-id="${songId}"]`);
        const titleSpan = document.createElement('span');
        let songTitle = songElement.querySelector('input').value;
        if (songTitle.length > 15) {
            songTitle = songTitle.substring(0, 15) + "...";
        }
        titleSpan.textContent = songTitle;
        trackDiv.appendChild(titleSpan);

        const progressContainer = document.createElement('div');
        progressContainer.className = 'progress-container';

        const timeTooltip = document.createElement('div');
        timeTooltip.className = 'time-tooltip';
        timeTooltip.style.display = 'none';
        progressContainer.appendChild(timeTooltip);

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
        volumeControl.className = 'volume-slider';
        trackDiv.appendChild(volumeControl);

        const formatTime = (timeInSeconds) => {
            const minutes = Math.floor(timeInSeconds / 60);
            const seconds = Math.floor(timeInSeconds % 60);
            return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        };

        progressBar.addEventListener('input', () => {
            audio.currentTime = progressBar.value;
        });

        volumeControl.addEventListener('input', () => {
            audio.volume = volumeControl.value;
            updateVolumeSlider(volumeControl);
        });

        // hover effect
        let hoveredBar = -1;
        let hoveredTime = -1;
        let hoveredMarker = -1;
        let lastMoveTime = 0;
        const moveThrottle = 16;
        progressContainer.addEventListener('mousemove', (event) => {
            const currentTime = Date.now();
            if (currentTime - lastMoveTime < moveThrottle) return;
            lastMoveTime = currentTime;

            const rect = waveformCanvas.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            hoveredTime = (mouseX / rect.width) * audio.duration;
            timeTooltip.textContent = formatTime(hoveredTime);

            const tooltipWidth = timeTooltip.offsetWidth;
            let tooltipLeft = mouseX - (tooltipWidth / 2);
            const containerWidth = progressContainer.offsetWidth;
            if (tooltipLeft < 0) {
                tooltipLeft = 0;
            } else if (tooltipLeft + tooltipWidth > containerWidth) {
                tooltipLeft = containerWidth - tooltipWidth;
            }

            timeTooltip.style.display = 'block';
            timeTooltip.style.left = `${tooltipLeft}px`;
            timeTooltip.style.bottom = '100%';
            
            const canvasX = (mouseX / rect.width) * waveformCanvas.width;
            const barWidth = 2;
            const gap = 1;
            const totalBarWidth = barWidth + gap;
            const newHoveredBar = Math.floor(canvasX / totalBarWidth);
            
            // check if hovering over a marker (2 second tolerance for better UX)
            const markers = songMarkers[songId] || [];
            let newHoveredMarker = -1;
            for (let i = 0; i < markers.length; i++) {
                if (Math.abs(hoveredTime - markers[i]) < 2.0) {
                    newHoveredMarker = i;
                    break;
                }
            }
            
            if (newHoveredBar !== hoveredBar || newHoveredMarker !== hoveredMarker) {
                if (newHoveredBar >= 0 && newHoveredBar < waveformCanvas.waveformData?.length) {
                    hoveredBar = newHoveredBar;
                }
                hoveredMarker = newHoveredMarker;
                requestAnimationFrame(() => {
                    updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime, hoveredMarker);
                });
            }
        });

        progressContainer.addEventListener('click', (event) => {
            if (hoveredTime >= 0 && hoveredTime <= audio.duration) {
                audio.currentTime = hoveredTime;
                progressBar.value = hoveredTime;
            }
        });

        // middle mouse button to add markers
        progressContainer.addEventListener('mousedown', (event) => {
            if (event.button === 1) {
                event.preventDefault();
                const clickTime = getExactTime(event, waveformCanvas);
                
                // try to remove the marker first, if there isnt one, add one
                const removed = removeMarker(songId, clickTime);
                if (!removed) {
                    const added = addMarker(songId, clickTime);
                    if (added) {
                        console.log(`Marcador adicionado em ${formatTime(clickTime)}`);
                    }
                } else {
                    console.log(`Marcador removido de ${formatTime(clickTime)}`);
                }
                
                requestAnimationFrame(() => {
                    updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime);
                });
            }
        });

        progressContainer.addEventListener('mouseleave', () => {
            hoveredBar = -1;
            hoveredTime = -1;
            hoveredMarker = -1;
            timeTooltip.style.display = 'none';
            requestAnimationFrame(() => {
                updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime, hoveredMarker);
            });
        });
        
        generateWaveform(audio, waveformCanvas);
        
        audio.addEventListener('timeupdate', () => {
            progressBar.value = audio.currentTime;
            requestAnimationFrame(() => {
                updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime);
            });
        });

        progressBar.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });
        
        const audioEffects = setupAudioEffects(audio, progressBar);
        progressBar.addEventListener('mousedown', (event) => {
            if (event.button === 2) {
                event.preventDefault();
                const selectedTime = getExactTime(event, waveformCanvas);
        
                if (isDragging) {
                    return;
                }
        
                const currentTime = Date.now();
                const isDoubleClick = (currentTime - lastRightClickTime) < doubleClickDelay;
                lastRightClickTime = currentTime;
        
                if (isPointInSelectedRegion(selectedTime, progressBar)) {
                    audioEffects.createContextMenu(
                        event.pageX, 
                        event.pageY,
                        (progressBar, audio) => {
                            updateProgressBarGradient(progressBar, audio);
                        },
                        () => {
                            updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime);
                        }
                    );
                } else if (isDoubleClick) {
                    audioEffects.cleanup();
                    setTimeout(() => {
                        progressBar.selectedStartTime = undefined;
                        progressBar.selectedEndTime = undefined;
                        progressBar.style.background = '#333';
                        const existingMenu = document.querySelector('.waveform-context-menu');
                        if (existingMenu) {
                            existingMenu.remove();
                        }
                        requestAnimationFrame(() => {
                            updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime);
                        });
                    }, 50);
                } else if (!progressBar.selectedStartTime || !progressBar.selectedEndTime) {
                    isDragging = true;
                    progressBar.selectedStartTime = selectedTime;
                    
                    const onMouseMove = (moveEvent) => {
                        if (!isDragging) return;
                        const movedTime = getExactTime(moveEvent, waveformCanvas);
                        progressBar.selectedEndTime = movedTime;
        
                        if (progressBar.selectedStartTime > progressBar.selectedEndTime) {
                            [progressBar.selectedStartTime, progressBar.selectedEndTime] = [
                                progressBar.selectedEndTime,
                                progressBar.selectedStartTime,
                            ];
                        }
        
                        updateProgressBarGradient(progressBar, audio);
                        requestAnimationFrame(() => {
                            updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime, hoveredMarker);
                        });
                    };
        
                    const onMouseUp = () => {
                        isDragging = false;
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                    };
        
                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                } else {
                    const existingMenu = document.querySelector('.waveform-context-menu');
                    if (existingMenu) {
                        existingMenu.remove();
                    }
                }
            }
        });

        playerContainer.appendChild(trackDiv);
    });
}

function updateProgressBarGradient(progressBar, audio) {
    if (progressBar.selectedStartTime === undefined || progressBar.selectedEndTime === undefined) {
        progressBar.style.background = '#333';
        return;
    }

    const startPercent = (progressBar.selectedStartTime / audio.duration * 100).toFixed(4);
    const endPercent = (progressBar.selectedEndTime / audio.duration * 100).toFixed(4);
    
    progressBar.style.background = `linear-gradient(to right, 
        #333 ${startPercent}%, 
        #2bdbb0 ${startPercent}%, 
        #2bdbb0 ${endPercent}%, 
        #333 ${endPercent}%)`;
}

async function generateWaveform(audio, canvas) {
    try {
        canvas.width = 500;
        canvas.height = 30;

        if (!sharedAudioContext) {
            sharedAudioContext = new AudioContext();
        }
        
        const response = await fetch(audio.src);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await sharedAudioContext.decodeAudioData(arrayBuffer);
        
        const rawData = audioBuffer.getChannelData(0);
        const samplesPerPixel = Math.floor(rawData.length / canvas.width);
        const waveformData = new Array(canvas.width);
        
        const chunkSize = 1000;
        for (let i = 0; i < canvas.width; i += chunkSize) {
            await new Promise(resolve => setTimeout(resolve, 0));
            
            const endChunk = Math.min(i + chunkSize, canvas.width);
            for (let j = i; j < endChunk; j++) {
                const start = j * samplesPerPixel;
                const end = start + samplesPerPixel;
                let sum = 0;
                let peakPositive = 0;
                let peakNegative = 0;
                
                for (let k = start; k < end; k++) {
                    const amplitude = rawData[k];
                    sum += Math.abs(amplitude);
                    if (amplitude > peakPositive) peakPositive = amplitude;
                    if (amplitude < peakNegative) peakNegative = amplitude;
                }
                
                waveformData[j] = {
                    average: sum / samplesPerPixel,
                    peak: Math.max(Math.abs(peakPositive), Math.abs(peakNegative))
                };
            }
        }

        let maxPeak = 0;
        let maxAverage = 0;
        waveformData.forEach(point => {
            maxPeak = Math.max(maxPeak, point.peak);
            maxAverage = Math.max(maxAverage, point.average);
        });

        waveformData.forEach(point => {
            point.peak /= maxPeak;
            point.average /= maxAverage;
        });

        canvas.waveformData = waveformData;
        drawWaveform(canvas, waveformData);

    } catch (error) {
        console.error("Error generating waveform:", error);
    }
}

function drawWaveform(canvas, waveformData) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    canvas.waveformData = waveformData;
    ctx.clearRect(0, 0, width, height);
    
    const barWidth = 2;
    const gap = 1;
    const centerY = height / 2;
    
    for (let i = 0; i < waveformData.length; i++) {
        const x = i * (barWidth + gap);
        
        const avgHeight = waveformData[i].average * height * 0.8;
        const avgY = centerY - (avgHeight / 2);
        ctx.fillStyle = '#333';
        ctx.fillRect(x, avgY, barWidth, avgHeight);
        
        const peakHeight = waveformData[i].peak * height * 0.8;
        const peakTopY = centerY - (peakHeight / 2);
        const peakBottomY = centerY + (peakHeight / 2) - 1;
        
        ctx.fillStyle = '#444';
        ctx.fillRect(x, peakTopY, barWidth, 1);
        ctx.fillRect(x, peakBottomY, barWidth, 1);
    }
}

function updateWaveformProgress(audio, canvas, progressBar, hoveredBar = -1, hoveredTime = -1, hoveredMarker = -1) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    const waveformData = canvas.waveformData;
    
    if (!waveformData) return;

    ctx.clearRect(0, 0, width, height);
    
    const barWidth = 2;
    const gap = 1;
    const totalBarWidth = barWidth + gap;
    const centerY = height / 2;
    const progress = audio.currentTime / audio.duration;
    const progressPixel = Math.floor(width * progress);
    const selectedStartPixel = progressBar.selectedStartTime ? Math.floor((progressBar.selectedStartTime / audio.duration) * width) : -1;
    const selectedEndPixel = progressBar.selectedEndTime ? Math.floor((progressBar.selectedEndTime / audio.duration) * width) : -1;

    if (hoveredTime >= 0) {
        const hoverPixel = Math.floor((hoveredTime / audio.duration) * width);
        ctx.fillStyle = 'rgba(74, 255, 219, 0.3)';
        ctx.fillRect(hoverPixel - 1, 0, 2, height);
    }

    const batchSize = 50;
    for (let i = 0; i < waveformData.length; i += batchSize) {
        const endIndex = Math.min(i + batchSize, waveformData.length);
        
        for (let j = i; j < endIndex; j++) {
            const x = j * totalBarWidth;
            const barTime = (x / width) * audio.duration;
            
            let mainColor, peakColor;
            if (j === hoveredBar || 
                (hoveredTime >= 0 && 
                 barTime <= hoveredTime && 
                 barTime + (totalBarWidth / width * audio.duration) >= hoveredTime)) {
                mainColor = '#4affdb';
                peakColor = '#2affdb';
            } else if (x <= progressPixel) {
                mainColor = '#2bdbb0';
                peakColor = '#1a9977';
            } else if (selectedStartPixel !== -1 && selectedEndPixel !== -1 && 
                      x >= selectedStartPixel && x <= selectedEndPixel) {
                mainColor = '#4a9eff';
                peakColor = '#3a7ecc';
            } else {
                mainColor = '#333';
                peakColor = '#444';
            }
            
            const avgHeight = waveformData[j].average * height * 0.8;
            const avgY = centerY - (avgHeight / 2);
            ctx.fillStyle = mainColor;
            ctx.fillRect(x, avgY, barWidth, avgHeight);
            
            const peakHeight = waveformData[j].peak * height * 0.8;
            const peakTopY = centerY - (peakHeight / 2);
            const peakBottomY = centerY + (peakHeight / 2) - 1;
            
            ctx.fillStyle = peakColor;
            ctx.fillRect(x, peakTopY, barWidth, 1);
            ctx.fillRect(x, peakBottomY, barWidth, 1);  
        }
    }

    if (progressBar.selectedStartTime !== undefined && progressBar.selectedEndTime !== undefined) {
        ctx.fillStyle = '#4a9eff';
        const startX = (progressBar.selectedStartTime / audio.duration) * width;
        const endX = (progressBar.selectedEndTime / audio.duration) * width;
        
        ctx.fillRect(startX - 1, 0, 2, height);
        ctx.fillRect(endX - 1, 0, 2, height);
    }

    // draw markers
    const trackDiv = canvas.closest('.track-item');
    const songId = trackDiv?.dataset.songId;
    if (songId && songMarkers[songId]) {
        songMarkers[songId].forEach((markerTime, index) => {
            const markerX = (markerTime / audio.duration) * width;
            // change color if hovering over this marker
            ctx.fillStyle = index === hoveredMarker ? '#ffdd00' : '#ffaa00';
            ctx.fillRect(markerX - 1.5, 0, 3, height);
        });
    }
}

function updateVolumeSlider(slider) {
    const value = slider.value;
    const min = slider.min || 0;
    const max = slider.max || 100;
    const percentage = ((value - min) / (max - min)) * 100;
    
    slider.style.background = `linear-gradient(to right, 
        rgb(43, 219, 160) 0%, 
        rgb(43, 219, 160) ${percentage}%, 
        rgba(255, 255, 255, 0.2) ${percentage}%, 
        rgba(255, 255, 255, 0.2) 100%)`;
}