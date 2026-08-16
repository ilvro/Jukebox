import { getSongState } from './song-state.mjs';

// filtering ===================================================================================================================
let allSongs = [];
const genreMenu = document.getElementById('filter-dropdown');
const filterDimmer = document.getElementById('filter-dimmer');
let activeFilters = new Set();
let pendingFilterFrame = null;

function updateAllSongs() {
    allSongs = Array.from(document.querySelectorAll('.song-item'));
    allSongs.forEach(cacheSongFilterData);
}

function cacheSongFilterData(song) {
    song.dataset.searchTitle = (song.querySelector('.title-input')?.value || '').toLowerCase();
    song._filterTokens = new Set([
        ...(song.getAttribute('data-genres') || '').split(','),
        ...(song.getAttribute('data-tags') || '').split(',')
    ].filter(Boolean));
}

function scheduleFilters() {
    if (pendingFilterFrame !== null) cancelAnimationFrame(pendingFilterFrame);
    pendingFilterFrame = requestAnimationFrame(() => {
        pendingFilterFrame = null;
        applyFilters();
    });
}

function searchInput() {
    scheduleFilters();
}

function songMatchesActiveFilters(song, filters) {
    if (!song._filterTokens) cacheSongFilterData(song);
    for (const filter of filters) {
        if (filter === 'Now Playing') {
            if (getSongState(song.dataset.songId)?.status !== 'playing') return false;
            continue;
        }
        if (!song._filterTokens.has(filter)) return false;
    }
    return true;
}

function applyFilters() {
    const searchQuery = document.getElementById('searchBar').value.toLowerCase();
    
    allSongs.forEach(song => {
        const matchesSearch = (song.dataset.searchTitle || '').includes(searchQuery);
        const matchesFilters = activeFilters.size === 0 || 
            songMatchesActiveFilters(song, activeFilters);
        
        song.style.display = (matchesSearch && matchesFilters) ? '' : 'none';
    });
}

genreMenu.addEventListener('mouseover', () => {
    filterDimmer.style.visibility = 'visible';
    setTimeout(() => {
        filterDimmer.style.opacity = '0.4';
    }, 10);
});

genreMenu.addEventListener('mouseleave', () => {
    filterDimmer.style.visibility = 'hidden';
    setTimeout(() => {
        filterDimmer.style.opacity = '0';
    }, 10);
});

document.addEventListener('songsUpdated', () => {
    updateAllSongs();
    scheduleFilters();
});
document.addEventListener('genresUpdated', event => {
    const song = event.detail?.songItem;
    if (song?.classList.contains('song-item')) {
        cacheSongFilterData(song);
    } else {
        updateAllSongs();
    }
    scheduleFilters();
});
document.addEventListener('playbackUpdated', scheduleFilters);
document.addEventListener('input', event => {
    const input = event.target;
    if (!input.classList?.contains('title-input')) return;
    const song = input.closest('.song-item');
    if (song) {
        song.dataset.searchTitle = input.value.toLowerCase();
        scheduleFilters();
    }
});
document.addEventListener('DOMContentLoaded', function() {
    updateAllSongs();
    
    const filterList = document.querySelectorAll('.filter-option');
    filterList.forEach(filter => {
        const filterName = filter.textContent.replace('✓ ', '');
        
        filter.addEventListener('click', function(f) {
            f.preventDefault();
            
            if (filterName === 'Show All') {
                // clear all filters when "Show All" is clicked
                activeFilters.clear();
                filterList.forEach(f => {
                    f.classList.remove('selected');
                    f.textContent = f.textContent.replace('✓ ', '');
                });
            } else {
                if (activeFilters.has(filterName)) {
                    activeFilters.delete(filterName);
                    filter.classList.remove('selected');
                    filter.textContent = filterName;
                } else {
                    activeFilters.add(filterName);
                    filter.classList.add('selected');
                    filter.textContent = `✓ ${filterName}`;
                }
            }
            
            scheduleFilters();
        });
    });
    
    document.getElementById('searchBar').addEventListener('input', searchInput);
});

// rearranging =========================================================================================================================
function enableDragAndDrop() {
    const songGrid = document.getElementById('song-grid');
    
    songGrid.addEventListener('dragstart', (event) => {
        const songItem = event.target.closest('.song-item');
        if (songItem && songItem.getAttribute('data-song-id') != null) {
            const focusedInput = songItem.querySelector('.title-input:focus');
            if (focusedInput) {
                focusedInput.blur();
            }
            event.dataTransfer.setData('text/plain', songItem.dataset.songId);
            songItem.classList.add('dragging');
        }
    });

    songGrid.addEventListener('dragover', (event) => {
        event.preventDefault();
        const draggable = document.querySelector('.dragging');
        if (!draggable) return;

        const afterElement = getDragAfterElement(songGrid, event.clientX, event.clientY);
        if (afterElement === null) {
            songGrid.appendChild(draggable);
        } else {
            songGrid.insertBefore(draggable, afterElement);
        }
    });

    songGrid.addEventListener('dragend', (event) => {
        const songItem = event.target.closest('.song-item');
        if (songItem) {
            songItem.classList.remove('dragging');
            updateAllSongs();
        }
    });
}

function getDragAfterElement(container, x, y) {
    const draggableElements = [...container.querySelectorAll('.song-item:not(.dragging)')];
    if (!draggableElements.length) return null;

    const containerRect = container.getBoundingClientRect();
    const itemRect = draggableElements[0].getBoundingClientRect();
    const itemWidth = itemRect.width;
    const itemHeight = itemRect.height;

    const relativeX = x - containerRect.left;
    const relativeY = y - containerRect.top;

    const itemsPerRow = Math.floor(containerRect.width / itemWidth);
    const currentRow = Math.floor(relativeY / itemHeight);
    const currentCol = Math.floor(relativeX / itemWidth);

    const targetIndex = (currentRow * itemsPerRow) + currentCol;
    if (targetIndex >= draggableElements.length) {
        return null;
    }
    const targetElement = draggableElements[targetIndex];
    const targetBox = targetElement.getBoundingClientRect();

    if (x > targetBox.left + targetBox.width / 2) {
        return targetElement.nextElementSibling;
    }
    
    return targetElement;
}

document.addEventListener('DOMContentLoaded', () => {
    enableDragAndDrop();
});
