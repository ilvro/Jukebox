import {
    getOrderedSongStates,
    getSongState,
    reorderSongState
} from './song-state.mjs';
import { openDialog } from './scenes.js';

// Filtering + virtualized grid ================================================================================================
const songGrid = document.getElementById('song-grid');
const genreMenu = document.getElementById('filter-dropdown');
const filterDimmer = document.getElementById('filter-dimmer');
const viewModeButton = document.getElementById('view-mode-button');
const folderButton = document.getElementById('folder-dropdown-button');
const folderList = document.getElementById('folder-list');
const activeFilters = new Set();
const OVERSCAN_ROWS = 3;
const FALLBACK_ROW_HEIGHT = 221;
const COMPACT_ROW_HEIGHT = 64;
const MOBILE_COMPACT_ROW_HEIGHT = 68;
const MIN_COLUMN_WIDTH = 250;
// Versioned so the earlier auto-mobile experiment cannot leave an old
// "compact" value making the new grid-first default look broken.
const VIEW_MODE_STORAGE_KEY = 'jukebox-grid-view-mode-v2';
const mobileViewQuery = window.matchMedia('(max-width: 620px)');

let allSongs = [];
let filteredSongs = [];
let pendingFilterFrame = null;
let pendingRenderFrame = null;
let rowHeight = FALLBACK_ROW_HEIGHT;
let renderedStart = -1;
let renderedEnd = -1;
let renderedColumns = -1;
let renderedSignature = '';
let isCompactView = false;
// Folders live inside the loaded preset: each card stores its folder name in
// data-folder. Empty folders only exist for the current session.
let folders = [];
let activeFolder = null; // null shows every folder

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
    allSongs.forEach(song => {
        const folder = song.dataset.folder;
        if (folder && !folders.includes(folder)) folders.push(folder);
    });
    renderFolderMenu();
    ensureVirtualGridShell();
}

function getColumnCount() {
    if (isCompactView) return 1;
    const width = gridWindow.clientWidth || Math.max(1, songGrid.clientWidth - 40);
    return Math.max(1, Math.floor(width / MIN_COLUMN_WIDTH));
}

function readStoredViewMode() {
    try {
        const storedMode = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
        if (storedMode === 'compact') return true;
        if (storedMode === 'grid') return false;
    } catch {
        // Fall through to the default.
    }
    return false;
}

function getCompactRowHeight() {
    return mobileViewQuery.matches ? MOBILE_COMPACT_ROW_HEIGHT : COMPACT_ROW_HEIGHT;
}

function getGridPaddingTop() {
    if (mobileViewQuery.matches) return 12;
    return isCompactView ? 8 : 20;
}

function storeViewMode() {
    try {
        localStorage.setItem(VIEW_MODE_STORAGE_KEY, isCompactView ? 'compact' : 'grid');
    } catch {
        // The view still works when storage is unavailable (for example in a
        // restrictive private window); it simply will not persist.
    }
}

function setCompactView(enabled, { persist = true } = {}) {
    const previousColumns = getColumnCount();
    const previousRowHeight = rowHeight;
    const previousGridRect = songGrid.getBoundingClientRect();
    const previousPaddingTop = getGridPaddingTop();
    const previousVisibleOffset = Math.max(0, -(previousGridRect.top + previousPaddingTop));
    const anchorIndex = Math.min(
        Math.max(0, filteredSongs.length - 1),
        Math.floor(previousVisibleOffset / previousRowHeight) * previousColumns
    );

    isCompactView = enabled;
    songGrid.classList.toggle('compact-view', enabled);
    rowHeight = enabled ? getCompactRowHeight() : FALLBACK_ROW_HEIGHT;

    if (viewModeButton) {
        viewModeButton.textContent = enabled ? 'Grid View' : 'Compact View';
        viewModeButton.title = enabled
            ? 'Show songs using large artwork cards'
            : 'Show more songs using a compact list';
        viewModeButton.setAttribute('aria-pressed', String(enabled));
    }

    // The number of columns and card height change together, so recalculate
    // the window even if it happens to contain the same song IDs.
    renderedColumns = -1;
    if (persist) storeViewMode();
    scheduleVirtualRender();

    // Keep roughly the same first visible song on screen when switching far
    // down a large library instead of jumping to a different part of it.
    if (persist && previousVisibleOffset > 0) {
        const nextColumns = getColumnCount();
        const nextVisibleOffset = Math.floor(anchorIndex / nextColumns) * rowHeight;
        requestAnimationFrame(() => {
            window.scrollBy(0, nextVisibleOffset - previousVisibleOffset);
        });
    }
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
    const gridTop = gridRect.top + getGridPaddingTop();
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
        const matchesFolder = activeFolder === null || song.dataset.folder === activeFolder;
        return matchesSearch && matchesFilters && matchesFolder;
    });
    scheduleVirtualRender();
}

function refreshSongsAndFilters() {
    updateAllSongs();
    scheduleFilters();
}

// Tracked on the document instead of with mouseleave: the folder menu
// re-renders its options under the pointer, and a removed hover target never
// delivers mouseleave to the menu.
let isFilterDimmerVisible = false;
document.addEventListener('mouseover', event => {
    const overMenu = Boolean(event.target.closest?.('.filter-dropdown'));
    if (overMenu === isFilterDimmerVisible) return;
    isFilterDimmerVisible = overMenu;
    filterDimmer.style.visibility = overMenu ? 'visible' : 'hidden';
    setTimeout(() => {
        filterDimmer.style.opacity = overMenu ? '0.4' : '0';
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

// Folders =====================================================================================================================
export function getActiveFolder() {
    return activeFolder;
}

// Called when a different preset replaces the library.
export function resetFolders() {
    folders = [];
    activeFolder = null;
    closeFolderPicker();
    renderFolderMenu();
}

export function setSongFolder(song, folder) {
    if (folder) song.dataset.folder = folder;
    else delete song.dataset.folder;
    refreshSongsAndFilters();
}

function setActiveFolder(folder) {
    activeFolder = folder;
    window.scrollTo({ top: 0 });
    renderFolderMenu();
    scheduleFilters();
}

function askFolderName(options, onConfirm) {
    openDialog({
        description: '',
        placeholder: 'Folder name',
        ...options,
        onConfirm: name => {
            if (name === options.name) return;
            if (folders.includes(name)) {
                askFolderName({ ...options, description: `A folder named “${name}” already exists.` }, onConfirm);
                return;
            }
            onConfirm(name);
        }
    });
}

function createFolder(onCreate) {
    askFolderName({ title: 'New Folder', confirmText: 'Create Folder' }, name => {
        folders.push(name);
        onCreate(name);
    });
}

function renameFolder(folder) {
    askFolderName({ title: `Rename “${folder}”`, confirmText: 'Rename Folder', name: folder }, name => {
        folders[folders.indexOf(folder)] = name;
        allSongs.forEach(song => {
            if (song.dataset.folder === folder) song.dataset.folder = name;
        });
        if (activeFolder === folder) activeFolder = name;
        refreshSongsAndFilters();
    });
}

function deleteFolder(folder) {
    const removeFolder = () => {
        allSongs.forEach(song => {
            if (song.dataset.folder === folder) delete song.dataset.folder;
        });
        folders = folders.filter(name => name !== folder);
        if (activeFolder === folder) activeFolder = null;
        refreshSongsAndFilters();
    };

    if (!allSongs.some(song => song.dataset.folder === folder)) {
        removeFolder();
        return;
    }
    openDialog({
        title: `Delete “${folder}”?`,
        description: 'The songs themselves will not be deleted.',
        confirmText: 'Delete Folder',
        destructive: true,
        showInput: false,
        onConfirm: removeFolder
    });
}

function createFolderAction(label, title, callback) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', event => {
        event.stopPropagation();
        callback();
    });
    return button;
}

function createFolderOption(label, folder, onClick) {
    const option = document.createElement('div');
    option.className = 'filter-option folder-option';
    const isActive = folder !== null && folder === activeFolder;
    option.classList.toggle('selected', isActive);

    const name = document.createElement('span');
    name.className = 'folder-option-name';
    name.textContent = `${isActive ? '✓ ' : ''}${label}`;
    option.appendChild(name);
    option.addEventListener('click', onClick);
    return option;
}

function renderFolderMenu() {
    if (!folderList) return;
    const counts = new Map();
    allSongs.forEach(song => {
        const folder = song.dataset.folder;
        if (folder) counts.set(folder, (counts.get(folder) || 0) + 1);
    });

    const header = document.createElement('div');
    header.className = 'filter-category-header';
    header.textContent = 'Folders';

    const items = [header, createFolderOption('Show All', null, () => setActiveFolder(null))];
    folders.forEach(folder => {
        const option = createFolderOption(
            `${folder} (${counts.get(folder) || 0})`,
            folder,
            () => setActiveFolder(folder)
        );
        const actions = document.createElement('span');
        actions.className = 'folder-option-actions';
        actions.append(
            createFolderAction('✎', 'Rename folder', () => renameFolder(folder)),
            createFolderAction('×', 'Delete folder', () => deleteFolder(folder))
        );
        option.appendChild(actions);
        items.push(option);
    });
    items.push(createFolderOption('+ New Folder', null, () => createFolder(setActiveFolder)));
    folderList.replaceChildren(...items);

    folderButton.textContent = `${activeFolder ?? 'Folders'}  ▼`;
    folderButton.classList.toggle('selected', activeFolder !== null);
}

let folderPicker = null;

function closeFolderPicker() {
    folderPicker?.remove();
    folderPicker = null;
}

// Small menu used by the song context menu to move a card between folders.
export function showFolderPicker(song) {
    closeFolderPicker();
    const picker = document.createElement('div');
    picker.className = 'folder-picker';
    const currentFolder = song.dataset.folder || null;

    const addOption = (label, callback) => {
        const option = document.createElement('div');
        option.className = 'folder-picker-option';
        option.textContent = label;
        option.addEventListener('click', () => {
            closeFolderPicker();
            callback();
        });
        picker.appendChild(option);
    };

    if (currentFolder) addOption('Remove from folder', () => setSongFolder(song, null));
    folders.forEach(folder => {
        addOption(`${folder === currentFolder ? '✓ ' : ''}${folder}`, () => setSongFolder(song, folder));
    });
    addOption('+ New Folder', () => createFolder(name => setSongFolder(song, name)));

    document.body.appendChild(picker);
    folderPicker = picker;

    const songRect = song.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();
    const margin = 8;
    picker.style.left = `${Math.max(margin, Math.min(songRect.left + 20, window.innerWidth - pickerRect.width - margin))}px`;
    picker.style.top = `${Math.max(margin, Math.min(songRect.top + 20, window.innerHeight - pickerRect.height - margin))}px`;
}

document.addEventListener('mousedown', event => {
    if (folderPicker && !folderPicker.contains(event.target)) closeFolderPicker();
});
window.addEventListener('scroll', event => {
    if (event.target !== folderPicker) closeFolderPicker();
}, { capture: true, passive: true });

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
            const afterTarget = isCompactView
                ? event.clientY > rect.top + rect.height / 2
                : event.clientX > rect.left + rect.width / 2;
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
    setCompactView(readStoredViewMode(), { persist: false });
    updateAllSongs();
    applyFilters();
    enableDragAndDrop();

    viewModeButton?.addEventListener('click', () => {
        setCompactView(!isCompactView);
    });

    const handleMobileViewChange = event => {
        if (isCompactView) {
            rowHeight = event.matches ? MOBILE_COMPACT_ROW_HEIGHT : COMPACT_ROW_HEIGHT;
            renderedColumns = -1;
            scheduleVirtualRender();
        }
    };
    if (typeof mobileViewQuery.addEventListener === 'function') {
        mobileViewQuery.addEventListener('change', handleMobileViewChange);
    } else {
        mobileViewQuery.addListener(handleMobileViewChange);
    }

    const filterList = genreMenu.querySelectorAll('.filter-option');
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
