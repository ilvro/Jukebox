import {
    getOrderedSongStates,
    getSongState,
    reorderSongState
} from './song-state.mjs';

// Filtering + virtualized grid ================================================================================================
const songGrid = document.getElementById('song-grid');
const genreMenu = document.getElementById('filter-dropdown');
const filterDimmer = document.getElementById('filter-dimmer');
const activeFilters = new Set();
const OVERSCAN_ROWS = 3;
const FALLBACK_ROW_HEIGHT = 221;
const MIN_COLUMN_WIDTH = 250;

let allSongs = [];
let filteredSongs = [];
let pendingFilterFrame = null;
let pendingRenderFrame = null;
let rowHeight = FALLBACK_ROW_HEIGHT;
let renderedStart = -1;
let renderedEnd = -1;
let renderedColumns = -1;
let renderedSignature = '';

const topSpacer = document.createElement('div');
topSpacer.className = 'virtual-grid-spacer virtual-grid-spacer-top';
topSpacer.setAttribute('aria-hidden', 'true');

const gridWindow = document.createElement('div');
gridWindow.className = 'virtual-grid-window';

const bottomSpacer = document.createElement('div');
bottomSpacer.className = 'virtual-grid-spacer virtual-grid-spacer-bottom';
bottomSpacer.setAttribute('aria-hidden', 'true');

function ensureVirtualGridShell() {
    if (
        topSpacer.parentElement === songGrid &&
        gridWindow.parentElement === songGrid &&
        bottomSpacer.parentElement === songGrid
    ) return;

    // Songs are owned by the central registry. Detaching a card only removes
    // its rendering cost; its element, audio and settings remain available.
    songGrid.replaceChildren(topSpacer, gridWindow, bottomSpacer);
}

function cacheSongFilterData(song) {
    song.dataset.searchTitle = (song.querySelector('.title-input')?.value || '').toLowerCase();
    song._filterTokens = new Set([
        ...(song.getAttribute('data-genres') || '').split(','),
        ...(song.getAttribute('data-tags') || '').split(',')
    ].filter(Boolean));
}

function updateAllSongs() {
    allSongs = getOrderedSongStates()
        .map(state => state.element)
        .filter(song => song?.classList.contains('song-item'));
    allSongs.forEach(cacheSongFilterData);
    ensureVirtualGridShell();
}

function getColumnCount() {
    const width = gridWindow.clientWidth || Math.max(1, songGrid.clientWidth - 40);
    return Math.max(1, Math.floor(width / MIN_COLUMN_WIDTH));
}

function scheduleVirtualRender() {
    if (pendingRenderFrame !== null) return;
    pendingRenderFrame = requestAnimationFrame(() => {
        pendingRenderFrame = null;
        renderVirtualGrid();
    });
}

function renderVirtualGrid() {
    ensureVirtualGridShell();

    const columns = getColumnCount();
    const totalRows = Math.ceil(filteredSongs.length / columns);
    const totalHeight = totalRows * rowHeight;
    const gridRect = songGrid.getBoundingClientRect();
    const gridTop = gridRect.top + 20;
    const visibleTop = Math.max(0, Math.min(totalHeight, -gridTop));
    const visibleBottom = Math.max(visibleTop, Math.min(totalHeight, window.innerHeight - gridTop));
    const firstVisibleRow = Math.floor(visibleTop / rowHeight);
    const lastVisibleRow = Math.ceil(visibleBottom / rowHeight);
    const startRow = Math.min(totalRows, Math.max(0, firstVisibleRow - OVERSCAN_ROWS));
    const endRow = Math.min(totalRows, lastVisibleRow + OVERSCAN_ROWS);
    const start = startRow * columns;
    const end = Math.min(filteredSongs.length, endRow * columns);
    const songsToRender = filteredSongs.slice(start, end);
    const signature = songsToRender.map(song => song.dataset.songId).join('|');

    topSpacer.style.height = `${startRow * rowHeight}px`;
    bottomSpacer.style.height = `${Math.max(0, totalRows - endRow) * rowHeight}px`;

    if (
        start === renderedStart &&
        end === renderedEnd &&
        columns === renderedColumns &&
        signature === renderedSignature
    ) return;

    renderedStart = start;
    renderedEnd = end;
    renderedColumns = columns;
    renderedSignature = signature;
    gridWindow.replaceChildren(...songsToRender);

    // Measure the real card height after the first render. Titles and images
    // keep a stable row size, but this avoids relying on a magic CSS height.
    requestAnimationFrame(() => {
        const firstRow = [...gridWindow.children].slice(0, columns);
        const measuredHeight = Math.max(0, ...firstRow.map(item => item.offsetHeight));
        if (measuredHeight > 0 && Math.abs(measuredHeight - rowHeight) > 1) {
            rowHeight = measuredHeight;
            scheduleVirtualRender();
        }
    });
}

function scheduleFilters() {
    if (pendingFilterFrame !== null) cancelAnimationFrame(pendingFilterFrame);
    pendingFilterFrame = requestAnimationFrame(() => {
        pendingFilterFrame = null;
        applyFilters();
    });
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
    filteredSongs = allSongs.filter(song => {
        const matchesSearch = (song.dataset.searchTitle || '').includes(searchQuery);
        const matchesFilters = activeFilters.size === 0 || songMatchesActiveFilters(song, activeFilters);
        return matchesSearch && matchesFilters;
    });
    scheduleVirtualRender();
}

function refreshSongsAndFilters() {
    updateAllSongs();
    scheduleFilters();
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

document.addEventListener('songsUpdated', refreshSongsAndFilters);
document.addEventListener('genresUpdated', event => {
    const song = event.detail?.songItem;
    if (song?.classList.contains('song-item')) cacheSongFilterData(song);
    else updateAllSongs();
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

// Scroll may happen on the document or on a future nested grid container.
window.addEventListener('scroll', () => scheduleVirtualRender(), { capture: true, passive: true });
window.addEventListener('resize', () => scheduleVirtualRender(), { passive: true });
let observedGridWidth = 0;
new ResizeObserver(entries => {
    const nextWidth = entries[0]?.contentRect.width || 0;
    if (Math.abs(nextWidth - observedGridWidth) < 1) return;
    observedGridWidth = nextWidth;
    scheduleVirtualRender();
}).observe(songGrid);

// Rearranging =================================================================================================================
let draggedSongId = null;
let dropTarget = null;
let editingDragCard = null;

function clearDropTarget() {
    dropTarget?.classList.remove('virtual-drop-target');
    dropTarget = null;
}

function enableDragAndDrop() {
    // A draggable ancestor can steal the pointer gesture from a text input.
    // Disable card dragging only for the duration of an edit/selection gesture.
    songGrid.addEventListener('pointerdown', event => {
        const titleInput = event.target.closest('.title-input');
        if (!titleInput) return;
        const songItem = titleInput.closest('.song-item');
        if (songItem) {
            editingDragCard = songItem;
            songItem.draggable = false;
        }
    });

    // Disable native card dragging before the press begins, as soon as the
    // pointer enters a title. Some browsers decide the drag source before a
    // bubbling pointerdown handler gets a chance to change it.
    songGrid.addEventListener('pointerover', event => {
        const titleInput = event.target.closest('.title-input');
        if (!titleInput) return;
        const songItem = titleInput.closest('.song-item');
        if (songItem) {
            editingDragCard = songItem;
            songItem.draggable = false;
        }
    });

    songGrid.addEventListener('focusin', event => {
        if (!event.target.classList.contains('title-input')) return;
        editingDragCard = event.target.closest('.song-item');
        if (editingDragCard) editingDragCard.draggable = false;
    });

    songGrid.addEventListener('focusout', event => {
        if (!event.target.classList.contains('title-input')) return;
        const songItem = event.target.closest('.song-item');
        if (songItem) songItem.draggable = true;
        if (editingDragCard === songItem) editingDragCard = null;
    });

    const restoreCardDragging = () => {
        const focusedTitle = editingDragCard?.querySelector('.title-input:focus');
        if (editingDragCard && !focusedTitle) {
            editingDragCard.draggable = true;
            editingDragCard = null;
        }
    };
    document.addEventListener('pointerup', restoreCardDragging);
    document.addEventListener('pointercancel', restoreCardDragging);

    songGrid.addEventListener('dragstart', event => {
        if (event.target.closest('.title-input')) {
            event.preventDefault();
            return;
        }
        const songItem = event.target.closest('.song-item');
        if (!songItem?.dataset.songId) return;
        draggedSongId = songItem.dataset.songId;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedSongId);
        songItem.classList.add('dragging');
    });

    songGrid.addEventListener('dragover', event => {
        if (!draggedSongId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const target = event.target.closest('.song-item');
        if (target === dropTarget) return;
        clearDropTarget();
        if (target?.dataset.songId !== draggedSongId) {
            dropTarget = target;
            dropTarget?.classList.add('virtual-drop-target');
        }
    });

    songGrid.addEventListener('drop', event => {
        if (!draggedSongId) return;
        event.preventDefault();
        const target = event.target.closest('.song-item');
        const orderedWithoutDragged = getOrderedSongStates().filter(state => state.id !== draggedSongId);
        let targetIndex = orderedWithoutDragged.length;

        if (target?.dataset.songId && target.dataset.songId !== draggedSongId) {
            targetIndex = orderedWithoutDragged.findIndex(state => state.id === target.dataset.songId);
            const rect = target.getBoundingClientRect();
            const afterTarget = event.clientX > rect.left + rect.width / 2;
            if (afterTarget) targetIndex += 1;
        }

        reorderSongState(draggedSongId, targetIndex);
        getSongState(draggedSongId)?.element?.classList.remove('dragging');
        clearDropTarget();
        refreshSongsAndFilters();
    });

    songGrid.addEventListener('dragend', event => {
        event.target.closest('.song-item')?.classList.remove('dragging');
        getSongState(draggedSongId)?.element?.classList.remove('dragging');
        draggedSongId = null;
        clearDropTarget();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    ensureVirtualGridShell();
    updateAllSongs();
    applyFilters();
    enableDragAndDrop();

    const filterList = document.querySelectorAll('.filter-option');
    filterList.forEach(filter => {
        const filterName = filter.textContent.replace('✓ ', '');
        filter.addEventListener('click', event => {
            event.preventDefault();
            if (filterName === 'Show All') {
                activeFilters.clear();
                filterList.forEach(option => {
                    option.classList.remove('selected');
                    option.textContent = option.textContent.replace('✓ ', '');
                });
            } else if (activeFilters.has(filterName)) {
                activeFilters.delete(filterName);
                filter.classList.remove('selected');
                filter.textContent = filterName;
            } else {
                activeFilters.add(filterName);
                filter.classList.add('selected');
                filter.textContent = `✓ ${filterName}`;
            }
            scheduleFilters();
        });
    });

    document.getElementById('searchBar').addEventListener('input', scheduleFilters);
});
