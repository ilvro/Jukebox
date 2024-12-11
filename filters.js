// Filtering ===================================================================================================================
let allSongs = [];
function updateAllSongs() {
    allSongs = Array.from(document.querySelectorAll('.song-item'));
}

function searchInput() {
    let searchQuery = document.getElementById('searchBar').value.toLowerCase();
    const songGrid = document.getElementById('song-grid');
    songGrid.innerHTML = '';

    allSongs.forEach(song => {
        if (song.querySelector('input').textContent.toLowerCase().includes(searchQuery)) {
            songGrid.appendChild(song);
        }
    });
}

function filterSongs(genre) {
    const songGrid = document.getElementById('song-grid');
    allSongs.forEach(song => {
        const songGenres = song.getAttribute('data-genres').split(',');
        if (genre === 'all' || songGenres.includes(genre)) {
            songGrid.appendChild(song);
        }
        else {
            try {
                songGrid.removeChild(song);
            }
            catch {
                // changing from genre1 to genre2 (fantasy to modern for example) will error because it will loop through every single song, including the ones from other genres that aren't displayed and aren't children of the grid
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

// Rearranging =========================================================================================================================
function enableDragAndDrop() {
    const songGrid = document.getElementById('song-grid');
  
    songGrid.addEventListener('dragstart', (event) => {
      if (event.target.getAttribute('data-song-id') != null) {
        const focusedInput = event.target.querySelector('.title-input:focus');
        if (focusedInput) {
            focusedInput.blur(); 
        }
        event.dataTransfer.setData('text/plain', event.target.dataset.songId);
        event.target.classList.add('dragging');
      }
    });
  
    songGrid.addEventListener('dragover', (event) => {
      if (event.target.getAttribute('data-song-id') != null) {
        const focusedInput = event.target.querySelector('.title-input:focus');
        if (focusedInput) {
            focusedInput.blur();
        }
        event.preventDefault();
        const x = event.clientX;
        const y = event.clientY;
        const afterElement = getDragAfterElement(songGrid, x, y);
        const draggingItem = document.querySelector('.dragging');

        if (!afterElement) {
            songGrid.appendChild(draggingItem); // add to the end if no element is found
        } 
        else {
            songGrid.insertBefore(draggingItem, afterElement);
        }
      }
    });
  
    songGrid.addEventListener('drop', (event) => {
      if (event.target.getAttribute('data-song-id') != null) {
        const focusedInput = event.target.querySelector('.title-input:focus');
        if (focusedInput) {
            focusedInput.blur();
        }
        event.preventDefault();
        const draggingItem = document.querySelector('.dragging');
        draggingItem.classList.remove('dragging');
        updateAllSongs();
      }
    });
  
    songGrid.addEventListener('dragend', (event) => {
      if (event.target.getAttribute('data-song-id') != null) {
        event.target.classList.remove('dragging');
      }
    });
  }
  
  function getDragAfterElement(container, x, y) {
    const draggableElements = [...container.querySelectorAll('.song-item:not(.dragging)')];

    return draggableElements.reduce(
        (closest, child) => {
            const box = child.getBoundingClientRect();
            const offsetX = x - box.left - box.width / 2;
            const offsetY = y - box.top - box.height / 2;
            const offset = Math.sqrt(offsetX ** 2 + offsetY ** 2); // combine offsets for grid logic

            if (offset < closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        },
        { offset: Number.POSITIVE_INFINITY }).element;
    }

  
  document.addEventListener('DOMContentLoaded', () => {
    enableDragAndDrop();
  });