import { setupAudioEffects } from './mixing/index.js';
import { setMasterVolume } from './mixing/audio-context.js';
let activeAudios = {};
let allAudios = {};
let audioVolumes = {};
let audioTimes = {};
let sharedAudioContext;
const playerContainer = document.getElementById('player-container');
const showPlayerBtn = document.getElementById('show-player-button');
const masterVolumeSlider = document.getElementById('master-volume-slider');
const stopAllBtn = document.getElementById('stop-all-button');
const doubleClickDelay = 300;
let lastRightClickTime = 0;
let isDragging = false;

const songMarkers = {};
const waveformCache = new Map();
const waveformGenerationQueue = new Map();
const MAX_WAVEFORM_WIDTH = 500;
const MAX_WAVEFORM_WIDTH_LONG = 150;
const MAX_CONCURRENT_GENERATIONS = 1;
let currentGenerations = 0;

const MARKER_SNAP_TOLERANCE = 2.5;
const SMOOTH_SKIP_DURATION = 2.5;

if (masterVolumeSlider) {
    masterVolumeSlider.addEventListener('input', () => {
        setMasterVolume(parseFloat(masterVolumeSlider.value));
    });
}

if (stopAllBtn) {
    // an instant, full stop for every playing song at once — separate from
    // the per-song "Fade Out", meant for when you need silence immediately
    stopAllBtn.addEventListener('click', () => {
        Object.keys(activeAudios).forEach(id => {
            const audio = activeAudios[id];
            audio.pause();
            const item = document.querySelector(`.song-item[data-song-id="${id}"]`);
            item?.classList.remove('playing');
            delete activeAudios[id];
        });
        updatePlayerUI();
    });
}

function createAudioElement(audioUrl) {
    const audio = new Audio(audioUrl);
    audio.preload = 'metadata';
    audio.volume = 0;
    
    audio.addEventListener('pause', () => {
        updatePlayerUI();
    });
    
    audio.addEventListener('ended', () => {
        updatePlayerUI();
    });
    
    audio.addEventListener('play', () => {
        updatePlayerUI();
    });
    
    return audio;
}

function toggleAudio(audioElement, songItem) {
    const songId = songItem.dataset.songId;

    if (audioElement.paused) {
        // restore saved time when resuming
        if (audioTimes[songId] !== undefined) {
            audioElement.currentTime = audioTimes[songId];
        }
        // restore saved volume
        if (audioVolumes[songId] !== undefined) {
            audioElement.volume = audioVolumes[songId];
        }
        audioElement.play();
        songItem.classList.add('playing');
        activeAudios[songId] = audioElement;
    } else {
        // save time and volume when pausing
        audioTimes[songId] = audioElement.currentTime;
        audioVolumes[songId] = audioElement.volume;
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
    
    const songId = `song-${Date.now()}-${Math.random()}`;
    songElement.dataset.songId = songId;
    
    if (!songMarkers[songId]) {
        songMarkers[songId] = [];
    }
    
    const audio = createAudioElement(audioUrl);
    allAudios[songId] = audio;
    audioVolumes[songId] = 1;
    audioTimes[songId] = 0;
    addClickListenerToSongItem(songElement, audio);

    updatePlayerUI();
}

function snapToMarker(songId, time) {
    const markers = songMarkers[songId] || [];
    for (let marker of markers) {
        if (Math.abs(marker - time) < MARKER_SNAP_TOLERANCE) {
            return marker;
        }
    }
    return time;
}

function addMarker(songId, time) {
    if (!songMarkers[songId]) {
        songMarkers[songId] = [];
    }
    
    const exists = songMarkers[songId].some(marker => Math.abs(marker - time) < 0.5);
    if (!exists) {
        songMarkers[songId].push(time);
        songMarkers[songId].sort((a, b) => a - b);
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

function smoothSkipToMarker(audio, targetTime) {
    const originalVolume = audio.volume;
    
    const crossfadeAudio = new Audio(audio.src);
    crossfadeAudio.currentTime = targetTime;
    crossfadeAudio.playbackRate = audio.playbackRate;
    crossfadeAudio.preservesPitch = audio.preservesPitch;
    crossfadeAudio.volume = 0;
    
    crossfadeAudio.load();
    
    let animationFrameId;
    const startTime = performance.now();
    
    const animate = () => {
        const elapsed = (performance.now() - startTime) / 1000;
        const progress = Math.min(elapsed / SMOOTH_SKIP_DURATION, 1);
        
        const fadeOutCurve = Math.cos(progress * Math.PI * 0.5);
        const fadeInCurve = Math.sin(progress * Math.PI * 0.5);
        
        audio.volume = originalVolume * fadeOutCurve;
        crossfadeAudio.volume = originalVolume * fadeInCurve;
        
        if (progress < 1) {
            animationFrameId = requestAnimationFrame(animate);
        } else {
            audio.currentTime = targetTime + SMOOTH_SKIP_DURATION;
            audio.volume = originalVolume;
            crossfadeAudio.pause();
        }
    };
    
    crossfadeAudio.play().then(() => {
        animationFrameId = requestAnimationFrame(animate);
    }).catch(error => {
        console.error("Error playing crossfade audio:", error);
        audio.volume = originalVolume;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
    });
}

function createMarkerContextMenu(x, y, songId, markerTime, audio) {
    const existingMenu = document.querySelector('.marker-context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    const menu = document.createElement('div');
    menu.className = 'marker-context-menu';
    Object.assign(menu.style, {
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        borderRadius: '5px',
        padding: '10px',
        zIndex: '1001',
        opacity: '0',
        visibility: 'hidden',
        transform: 'translateY(-10px)',
        transition: 'opacity 0.3s ease, transform 0.5s ease, visibility 0.3s',
        minWidth: '150px'
    });
    
    const formatTime = (timeInSeconds) => {
        const minutes = Math.floor(timeInSeconds / 60);
        const seconds = Math.floor(timeInSeconds % 60);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };
    
    const header = document.createElement('div');
    header.textContent = `Marker at ${formatTime(markerTime)}`;
    header.style.color = '#2bdba0';
    header.style.fontSize = '0.8em';
    header.style.textTransform = 'uppercase';
    header.style.padding = '5px';
    header.style.marginBottom = '5px';
    menu.appendChild(header);
    
    const smoothSkipItem = document.createElement('div');
    smoothSkipItem.className = 'context-menu-item';
    smoothSkipItem.textContent = 'Smooth Skip';
    Object.assign(smoothSkipItem.style, {
        cursor: 'default',
        padding: '5px 5px 5px 15px',
        transition: 'all 0.3s ease',
        borderLeft: '2px solid transparent',
        color: '#fff'
    });
    
    smoothSkipItem.addEventListener('mouseover', () => {
        smoothSkipItem.style.borderLeft = '2px solid #2bdba0';
        smoothSkipItem.style.backgroundColor = 'rgba(43, 219, 160, 0.1)';
    });
    
    smoothSkipItem.addEventListener('mouseout', () => {
        smoothSkipItem.style.borderLeft = '2px solid transparent';
        smoothSkipItem.style.backgroundColor = 'transparent';
    });
    
    smoothSkipItem.addEventListener('click', () => {
        smoothSkipToMarker(audio, markerTime);
        menu.style.opacity = '0';
        menu.style.transform = 'translateY(-10px)';
        menu.style.visibility = 'hidden';
        setTimeout(() => menu.remove(), 300);
    });
    
    menu.appendChild(smoothSkipItem);

    const cutToItem = document.createElement('div');
    cutToItem.className = 'context-menu-item';
    cutToItem.textContent = 'Cut To';
    Object.assign(cutToItem.style, {
        cursor: 'default',
        padding: '5px 5px 5px 15px',
        transition: 'all 0.3s ease',
        borderLeft: '2px solid transparent',
        color: '#fff'
    });
    
    cutToItem.addEventListener('mouseover', () => {
        cutToItem.style.borderLeft = '2px solid #2bdba0';
        cutToItem.style.backgroundColor = 'rgba(43, 219, 160, 0.1)';
    });
    
    cutToItem.addEventListener('mouseout', () => {
        cutToItem.style.borderLeft = '2px solid transparent';
        cutToItem.style.backgroundColor = 'transparent';
    });
    
    cutToItem.addEventListener('click', () => {
        audio.currentTime = markerTime;
        audio.volume = 1.0;
        menu.style.opacity = '0';
        menu.style.transform = 'translateY(-10px)';
        menu.style.visibility = 'hidden';
        setTimeout(() => menu.remove(), 300);
    });
    
    menu.appendChild(cutToItem);
    
    document.body.appendChild(menu);
    
    requestAnimationFrame(() => {
        menu.style.opacity = '1';
        menu.style.visibility = 'visible';
        menu.style.transform = 'translateY(0)';
    });
    
    const closeMenu = (event) => {
        if (!menu.contains(event.target)) {
            menu.style.opacity = '0';
            menu.style.transform = 'translateY(-10px)';
            menu.style.visibility = 'hidden';
            
            setTimeout(() => {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }, 300);
        }
    };
    
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 0);
    
    menu.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });
    
    return menu;
}

export { addSongToPlayer, getMarkers, setMarkers };

document.addEventListener('genresUpdated', () => {
    updatePlayerUI();
});

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

const renderedTracks = new Map(); // songId -> { trackDiv, refresh, cleanup }

function updatePlayerUI() {
    const playerContainer = document.getElementById('track-list');

    const currentActiveIds = new Set();
    Object.entries(activeAudios).forEach(([songId, audio]) => {
        if (!audio.paused) {
            currentActiveIds.add(songId);
        }
    });

    // tear down tracks that are no longer playing: remove the listener we
    // attached to the (long-lived) audio element and deactivate its effects,
    // otherwise both keep piling up in memory every time this runs
    renderedTracks.forEach((track, songId) => {
        if (!currentActiveIds.has(songId)) {
            track.cleanup();
            renderedTracks.delete(songId);
        }
    });

    // create tracks that just started playing, lightly refresh ones already rendered
    currentActiveIds.forEach(songId => {
        const audio = activeAudios[songId];
        if (renderedTracks.has(songId)) {
            renderedTracks.get(songId).refresh();
        } else {
            const track = createTrackUI(songId, audio, playerContainer);
            renderedTracks.set(songId, track);
        }
    });
}

function createTrackUI(songId, audio, playerContainer) {
    const getExactTime = (event, element) => {
        const rect = element.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        return (mouseX / rect.width) * audio.duration;
    };

    const trackDiv = document.createElement('div');
    trackDiv.className = 'track-item';
    trackDiv.dataset.songId = songId;

    const songElement = document.querySelector(`[data-song-id="${songId}"]`);
    
    const titleContainer = document.createElement('div');
    titleContainer.style.display = 'flex';
    titleContainer.style.flexDirection = 'column';
    titleContainer.style.gap = '2px';
    
    const getSongTitle = () => {
        let songTitle = songElement.querySelector('input').value;
        if (songTitle.length > 15) {
            songTitle = songTitle.substring(0, 15) + "...";
        }
        return songTitle;
    };

    const titleSpan = document.createElement('span');
    titleSpan.textContent = getSongTitle();
    titleContainer.appendChild(titleSpan);
    
    const tags = songElement.getAttribute('data-tags');
    if (tags && tags.trim() !== '') {
        const tagsSpan = document.createElement('span');
        tagsSpan.textContent = tags.split(',').join(' + ');
        tagsSpan.style.fontSize = '0.7em';
        tagsSpan.style.color = '#888';
        titleContainer.appendChild(tagsSpan);
    }
    
    trackDiv.appendChild(titleContainer);

    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';

    const timeTooltip = document.createElement('div');
    timeTooltip.className = 'time-tooltip';
    timeTooltip.style.display = 'none';
    progressContainer.appendChild(timeTooltip);

    const waveformCanvas = document.createElement('canvas');
    waveformCanvas.className = 'waveform-canvas';
    waveformCanvas.width = MAX_WAVEFORM_WIDTH;
    waveformCanvas.height = 30;
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
    
    updateVolumeSlider(volumeControl);

    const formatTime = (timeInSeconds) => {
        const minutes = Math.floor(timeInSeconds / 60);
        const seconds = Math.floor(timeInSeconds % 60);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    progressBar.addEventListener('input', () => {
        audio.currentTime = progressBar.value;
    });

    volumeControl.addEventListener('input', () => {
        const newVolume = parseFloat(volumeControl.value);
        // if a fade is running on this audio, aim it at the new value instead
        // of setting volume directly, otherwise the fade overwrites this on
        // its very next animation frame
        const redirected = redirectFadeTarget(audio, newVolume);
        if (!redirected) {
            audio.volume = newVolume;
        }
        if (songId) {
            audioVolumes[songId] = newVolume;
        }
        updateVolumeSlider(volumeControl);
    });

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
        
        const markers = songMarkers[songId] || [];
        let newHoveredMarker = -1;
        for (let i = 0; i < markers.length; i++) {
            if (Math.abs(hoveredTime - markers[i]) < MARKER_SNAP_TOLERANCE) {
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
        let clickTime = hoveredTime;
        if (clickTime >= 0 && clickTime <= audio.duration) {
            clickTime = snapToMarker(songId, clickTime);
            audio.currentTime = clickTime;
            progressBar.value = clickTime;
        }
    });

    progressContainer.addEventListener('mousedown', (event) => {
        if (event.button === 1) {
            event.preventDefault();
            let clickTime = getExactTime(event, waveformCanvas);
            
            const snappedTime = snapToMarker(songId, clickTime);
            
            const removed = removeMarker(songId, snappedTime);
            if (!removed) {
                const added = addMarker(songId, snappedTime);
                if (added) {
                    console.log(`Marker added at ${formatTime(snappedTime)}`);
                }
            } else {
                console.log(`Marker removed from ${formatTime(snappedTime)}`);
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
    
    const isLongTrack = audio.duration > 1200;
    if (isLongTrack) {
        generateWaveformLazy(audio, waveformCanvas, songId);
    } else {
        generateWaveformDirect(audio, waveformCanvas, songId);
    }
    
    // stored so we can remove it in cleanup() instead of stacking a new one every render
    const handleTimeUpdate = () => {
        progressBar.value = audio.currentTime;
        requestAnimationFrame(() => {
            updateWaveformProgress(audio, waveformCanvas, progressBar, hoveredBar, hoveredTime);
        });
    };
    audio.addEventListener('timeupdate', handleTimeUpdate);

    progressBar.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });
    
    // only set up once per playing session now, instead of on every UI refresh
    const audioEffects = setupAudioEffects(audio, progressBar);
    
    let rightClickStartPos = null;
    let hasMovedMouse = false;
    
    progressBar.addEventListener('mousedown', (event) => {
        if (event.button === 2) {
            event.preventDefault();
            let selectedTime = getExactTime(event, waveformCanvas);
    
            if (isDragging) {
                return;
            }
            
            rightClickStartPos = { x: event.clientX, y: event.clientY, time: selectedTime };
            hasMovedMouse = false;
    
            const currentTime = Date.now();
            const isDoubleClick = (currentTime - lastRightClickTime) < doubleClickDelay;
            lastRightClickTime = currentTime;

            const markers = songMarkers[songId] || [];
            let isOverMarker = false;
            for (let marker of markers) {
                if (Math.abs(selectedTime - marker) < MARKER_SNAP_TOLERANCE) {
                    isOverMarker = true;
                    break;
                }
            }
            if (isPointInSelectedRegion(selectedTime, progressBar) && !isOverMarker) {
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
            } else if ((!progressBar.selectedStartTime || !progressBar.selectedEndTime) || isOverMarker) {
                // don't commit to a new selection on mousedown alone — a plain
                // right-click on a marker (no movement) should only open the
                // marker menu and must NOT wipe out the existing region.
                // the previous selection is only overwritten once real
                // dragging is detected below.
                const pendingStartTime = selectedTime;
                let dragCommitted = false;
                
                const onMouseMove = (moveEvent) => {
                    const moveDistance = Math.sqrt(
                        Math.pow(moveEvent.clientX - rightClickStartPos.x, 2) + 
                        Math.pow(moveEvent.clientY - rightClickStartPos.y, 2)
                    );
                    
                    if (moveDistance > 5) {
                        hasMovedMouse = true;
                    }
                    
                    if (!hasMovedMouse) return;
                    
                    if (!dragCommitted) {
                        dragCommitted = true;
                        isDragging = true;
                        progressBar.selectedStartTime = pendingStartTime;
                    }
                    
                    let movedTime = getExactTime(moveEvent, waveformCanvas);
                    movedTime = snapToMarker(songId, movedTime);
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
    
                const onMouseUp = (upEvent) => {
                    isDragging = false;
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    
                    if (!hasMovedMouse && rightClickStartPos) {
                        const markers = songMarkers[songId] || [];
                        let clickedMarker = null;
                        for (let marker of markers) {
                            if (Math.abs(rightClickStartPos.time - marker) < MARKER_SNAP_TOLERANCE) {
                                clickedMarker = marker;
                                break;
                            }
                        }
                        
                        if (clickedMarker !== null) {
                            createMarkerContextMenu(
                                upEvent.pageX,
                                upEvent.pageY,
                                songId,
                                clickedMarker,
                                audio
                            );
                        }
                    }
                    
                    rightClickStartPos = null;
                    hasMovedMouse = false;
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

    return {
        trackDiv,
        // called on every updatePlayerUI() while the track keeps playing;
        // deliberately does NOT touch listeners, effects, or the waveform
        refresh() {
            volumeControl.value = audio.volume;
            updateVolumeSlider(volumeControl);
            progressBar.max = audio.duration || 100;
            titleSpan.textContent = getSongTitle();
        },
        // called once, when the track actually stops playing
        cleanup() {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audioEffects.cleanup();
            trackDiv.remove();
        }
    };
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

async function generateWaveformDirect(audio, canvas, songId) {
    if (waveformCache.has(songId)) {
        const cachedData = waveformCache.get(songId);
        canvas.waveformData = cachedData;
        drawWaveform(canvas, cachedData);
        return;
    }
    
    try {
        if (!sharedAudioContext) {
            sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const response = await fetch(audio.src);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await sharedAudioContext.decodeAudioData(arrayBuffer);
        
        canvas.width = MAX_WAVEFORM_WIDTH;
        
        const rawData = audioBuffer.getChannelData(0);
        const samplesPerPixel = Math.floor(rawData.length / MAX_WAVEFORM_WIDTH);
        const waveformData = new Array(MAX_WAVEFORM_WIDTH);
        
        const chunkSize = 2000;
        for (let i = 0; i < MAX_WAVEFORM_WIDTH; i += chunkSize) {
            await new Promise(resolve => setTimeout(resolve, 0));
            
            const endChunk = Math.min(i + chunkSize, MAX_WAVEFORM_WIDTH);
            for (let j = i; j < endChunk; j++) {
                const start = j * samplesPerPixel;
                const end = Math.min(start + samplesPerPixel, rawData.length);
                
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

        let maxPeak = 0.001;
        let maxAverage = 0.001;
        waveformData.forEach(point => {
            maxPeak = Math.max(maxPeak, point.peak);
            maxAverage = Math.max(maxAverage, point.average);
        });

        waveformData.forEach(point => {
            point.peak /= maxPeak;
            point.average /= maxAverage;
        });

        waveformCache.set(songId, waveformData);
        canvas.waveformData = waveformData;
        drawWaveform(canvas, waveformData);

    } catch (error) {
        console.error("Direct waveform generation error:", error);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

function generateWaveformLazy(audio, canvas, songId) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#666';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Loading...', canvas.width / 2, canvas.height / 2);
    
    if (waveformCache.has(songId)) {
        const cachedData = waveformCache.get(songId);
        canvas.waveformData = cachedData;
        drawWaveform(canvas, cachedData);
        return;
    }
    
    if (waveformGenerationQueue.has(songId)) {
        return;
    }
    
    waveformGenerationQueue.set(songId, { audio, canvas });
    processWaveformQueue();
}

async function processWaveformQueue() {
    if (currentGenerations >= MAX_CONCURRENT_GENERATIONS) {
        return;
    }
    
    const nextEntry = Array.from(waveformGenerationQueue.entries())[0];
    if (!nextEntry) {
        return;
    }
    
    const [songId, { audio, canvas }] = nextEntry;
    waveformGenerationQueue.delete(songId);
    currentGenerations++;
    
    try {
        await generateWaveformActual(audio, canvas, songId);
    } catch (error) {
        console.error('Waveform generation failed:', error);
    } finally {
        currentGenerations--;
        if (waveformGenerationQueue.size > 0) {
            setTimeout(() => processWaveformQueue(), 100);
        }
    }
}

async function generateWaveformActual(audio, canvas, songId) {
    try {
        if (!sharedAudioContext) {
            sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const response = await fetch(audio.src);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await sharedAudioContext.decodeAudioData(arrayBuffer);
        
        const duration = audioBuffer.duration;
        const targetWidth = duration > 600 ? MAX_WAVEFORM_WIDTH_LONG : MAX_WAVEFORM_WIDTH;
        canvas.width = targetWidth;
        
        const rawData = audioBuffer.getChannelData(0);
        const samplesPerPixel = Math.floor(rawData.length / targetWidth);
        const waveformData = new Array(targetWidth);
        
        const chunkSize = Math.max(1, Math.floor(targetWidth / 10));
        for (let i = 0; i < targetWidth; i += chunkSize) {
            await new Promise(resolve => setTimeout(resolve, 50));
            
            const endChunk = Math.min(i + chunkSize, targetWidth);
            for (let j = i; j < endChunk; j++) {
                const start = j * samplesPerPixel;
                const end = Math.min(start + samplesPerPixel, rawData.length);
                
                const sampleStep = samplesPerPixel > 50000 ? Math.floor(samplesPerPixel / 500) : Math.max(1, Math.floor(samplesPerPixel / 5000));
                
                let sum = 0;
                let peakPositive = 0;
                let peakNegative = 0;
                let sampleCount = 0;
                
                for (let k = start; k < end; k += sampleStep) {
                    const amplitude = rawData[k];
                    sum += Math.abs(amplitude);
                    if (amplitude > peakPositive) peakPositive = amplitude;
                    if (amplitude < peakNegative) peakNegative = amplitude;
                    sampleCount++;
                }
                
                waveformData[j] = {
                    average: sampleCount > 0 ? sum / sampleCount : 0,
                    peak: Math.max(Math.abs(peakPositive), Math.abs(peakNegative))
                };
            }
        }

        let maxPeak = 0.001;
        let maxAverage = 0.001;
        waveformData.forEach(point => {
            maxPeak = Math.max(maxPeak, point.peak);
            maxAverage = Math.max(maxAverage, point.average);
        });

        waveformData.forEach(point => {
            point.peak /= maxPeak;
            point.average /= maxAverage;
        });

        waveformCache.set(songId, waveformData);
        canvas.waveformData = waveformData;
        drawWaveform(canvas, waveformData);

    } catch (error) {
        console.error("Waveform generation error:", error);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
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

    const batchSize = 100;
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

    const trackDiv = canvas.closest('.track-item');
    const songId = trackDiv?.dataset.songId;
    if (songId && songMarkers[songId]) {
        songMarkers[songId].forEach((markerTime, index) => {
            const markerX = (markerTime / audio.duration) * width;
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

// smoothly animates volume using a curve that matches how we perceive loudness
// (loudness is logarithmic, not linear) instead of stepping volume in fixed linear increments.
// fading in eases in (starts slow, speeds up near the end) and fading out eases out
// (drops quickly at first, tapers off gently near silence) - this avoids the "sudden jump"
// feeling you get with a plain linear ramp.
const activeFadeTargets = new Map(); // audio -> { value: targetVolume }, kept live so a manual volume change mid-fade can redirect it

function animateVolume(audio, startVolume, endVolume, duration, onComplete) {
    const startTime = performance.now();
    const targetRef = { value: endVolume };
    activeFadeTargets.set(audio, targetRef);

    const step = () => {
        // if another animateVolume call took over this audio, stop here
        if (activeFadeTargets.get(audio) !== targetRef) return;

        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const target = targetRef.value; // read live: may have been redirected
        const isFadingIn = target > startVolume;

        const eased = isFadingIn
            ? progress * progress
            : 1 - Math.pow(1 - progress, 2);

        audio.volume = startVolume + (target - startVolume) * eased;

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            audio.volume = target;
            if (activeFadeTargets.get(audio) === targetRef) {
                activeFadeTargets.delete(audio);
            }
            if (onComplete) onComplete();
        }
    };

    requestAnimationFrame(step);
}

// called from the volume slider: if a fade is currently running on this
// audio, redirect its target instead of letting the fade silently
// overwrite the manual adjustment on the next animation frame
function redirectFadeTarget(audio, newVolume) {
    const targetRef = activeFadeTargets.get(audio);
    if (targetRef) {
        targetRef.value = newVolume;
        return true;
    }
    return false;
}

export function fadeOut(targetSongId) {
    const fadeDuration = 5
    const audio = activeAudios[targetSongId];
    if (!audio || audio.paused) return;
    
    const startVolume = audio.volume;

    animateVolume(audio, startVolume, 0, fadeDuration * 1000, () => {
        audio.pause();
        audio.volume = startVolume;

        // remove from activeAudios
        delete activeAudios[targetSongId];

        // remove playing class from grid (to remove the green color)
        const songElement = document.querySelector(`.song-item[data-song-id="${targetSongId}"]`);
        if (songElement) {
            songElement.classList.remove('playing');
        }

        updatePlayerUI();
    });
}

// instant stop for a single song, no fade — the "cut" counterpart to fadeOut
export function stopSong(targetSongId) {
    const audio = activeAudios[targetSongId];
    if (!audio) return;

    audio.pause();
    delete activeAudios[targetSongId];

    const songElement = document.querySelector(`.song-item[data-song-id="${targetSongId}"]`);
    if (songElement) {
        songElement.classList.remove('playing');
    }

    updatePlayerUI();
}

export function fadeTo(targetSongId) {
    const fadeDuration = 3500; // 3.5 seconds
    const targetItem = document.querySelector(`.song-item[data-song-id="${targetSongId}"]`);
    
    if (!targetItem) return;

    const targetAudio = allAudios[targetSongId];
    if (!targetAudio) {
        console.error(`No audio found for song ${targetSongId}`);
        return;
    }

    const savedVolume = audioVolumes[targetSongId] || 1;
    const savedTime = audioTimes[targetSongId] || 0;

    // fade out and stop all other active audios
    Object.keys(activeAudios).forEach(id => {
        if (id !== targetSongId) {
            const audio = activeAudios[id];
            const item = document.querySelector(`.song-item[data-song-id="${id}"]`);
            
            audioVolumes[id] = audio.volume;
            audioTimes[id] = audio.currentTime;
            const startVol = audio.volume;
            animateVolume(audio, startVol, 0, fadeDuration, () => {
                audio.pause();
                audio.volume = audioVolumes[id];
                item?.classList.remove('playing');
                delete activeAudios[id];
                updatePlayerUI();
            });
        }
    });

    // if target audio is already playing, just fade volume
    if (!targetAudio.paused && activeAudios[targetSongId]) {
        targetAudio.volume = 0;
        animateVolume(targetAudio, 0, savedVolume, fadeDuration);
        updatePlayerUI();
        return;
    }

    if (targetAudio.paused) {
        targetAudio.muted = true;
        targetAudio.volume = 0;
        
        targetAudio.pause();
        
        targetAudio.currentTime = savedTime;
        
        (async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            
            try {
                await targetAudio.play();
                activeAudios[targetSongId] = targetAudio;
                targetItem.classList.add('playing');
                updatePlayerUI();
                
                await new Promise(resolve => setTimeout(resolve, 100));
                
                targetAudio.muted = false;
                animateVolume(targetAudio, 0, savedVolume, fadeDuration);
                
            } catch (error) {
                console.error("Error playing audio:", error);
                targetAudio.muted = false;
            }
        })();
    }
}

// instant transition to selected audio
export function cutTo(targetSongId) {
    const targetItem = document.querySelector(`.song-item[data-song-id="${targetSongId}"]`);
    
    if (!targetItem) return;

    const targetAudio = allAudios[targetSongId];
    if (!targetAudio) {
        console.error(`No audio found for song ${targetSongId}`);
        return;
    }
    const savedVolume = audioVolumes[targetSongId] || 1;
    const savedTime = audioTimes[targetSongId] || 0;

    // stop everything else immediately
    Object.keys(activeAudios).forEach(id => {
        if (id !== targetSongId) {
            const audio = activeAudios[id];
            const item = document.querySelector(`.song-item[data-song-id="${id}"]`);
            
            audioVolumes[id] = audio.volume;
            audioTimes[id] = audio.currentTime;
            
            audio.pause();
            audio.volume = audioVolumes[id];
            item?.classList.remove('playing');
            delete activeAudios[id];
        }
    });

    // play target immediately
    if (targetAudio.paused) {
        targetAudio.currentTime = savedTime;
        targetAudio.volume = savedVolume;
        
        targetAudio.play().then(() => {
            activeAudios[targetSongId] = targetAudio;
            targetItem.classList.add('playing');
            updatePlayerUI();
        }).catch(error => {
            console.error("Error playing audio:", error);
        });
    } else {
        updatePlayerUI();
    }
}

export function removeSongAudio(songId) {
    if (allAudios[songId]) {
        const audio = allAudios[songId];
        audio.pause();
        audio.currentTime = 0;
        // release the blob URL created on upload, otherwise it stays in
        // memory for the rest of the page's life even after the song is gone
        URL.revokeObjectURL(audio.src);
        delete allAudios[songId];
    }
    if (activeAudios[songId]) {
        delete activeAudios[songId];
    }
    if (audioVolumes[songId]) {
        delete audioVolumes[songId];
    }
    if (audioTimes[songId]) {
        delete audioTimes[songId];
    }
    delete songMarkers[songId];
    waveformCache.delete(songId);

    // in case the song was actively playing, make sure its track panel
    // (and the listener/effects tied to it) gets torn down right away
    updatePlayerUI();
}

export function resetSong(songId) {
    const audio = allAudios[songId];
    if (!audio) return;
    
    const item = document.querySelector(`.song-item[data-song-id="${songId}"]`);

    if (!audio.paused) {
        audio.pause();
        item?.classList.remove('playing');
        delete activeAudios[songId];
    }

    audio.currentTime = 0;
    audio.volume = 1;
    audioTimes[songId] = 0;
    audioVolumes[songId] = 1;
    
    updatePlayerUI();
}