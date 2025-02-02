// filtering ===================================================================================================================
let allSongs = [];
function updateAllSongs() {
    allSongs = Array.from(document.querySelectorAll('.song-item'));
}

function searchInput() {
    let searchQuery = document.getElementById('searchBar').value.toLowerCase();
    const songGrid = document.getElementById('song-grid');
    songGrid.innerHTML = '';

    allSongs.forEach(song => {
        if (song.querySelector('input').value.toString().toLowerCase().includes(searchQuery)) {
            songGrid.appendChild(song);
        }
    });
}

function filterSongs(genre) {
    const songGrid = document.getElementById('song-grid');
    allSongs.forEach(song => {
        const songGenres = song.getAttribute('data-genres').split(',');
        const songTags = song.getAttribute('data-tags').split(',');
        if (genre === 'all' || songGenres.includes(genre) || songTags.includes(genre)) {
            songGrid.appendChild(song);
        }
        else {
            try {
                songGrid.removeChild(song);
            }
            catch {
                // changing from genre1 to genre2 (fantasy to mystery for example) will error because it will loop through every single song, including the ones from other genres that aren't displayed and aren't children of the grid
            }
        }
    })
}

document.addEventListener('songsUpdated', updateAllSongs);
document.addEventListener('DOMContentLoaded', function() {
    const filterLinks = document.querySelectorAll('.genre-filters .filter-link');

    filterLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();

            filterLinks.forEach(l => l.classList.remove('selected'));
            this.classList.add('selected');

            const filter = this.getAttribute('data-filter');
            console.log('selected filter: ', filter);
            filterSongs(filter);
        });
    });
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