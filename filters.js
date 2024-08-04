let allSongs = [];
function updateAllSongs() {
    allSongs = Array.from(document.querySelectorAll('.song-item'));
}

function searchInput() {
    let searchQuery = document.getElementById('searchBar').value.toLowerCase();
    const songGrid = document.getElementById('song-grid');
    songGrid.innerHTML = '';

    allSongs.forEach(song => {
        if (song.querySelector('h3').textContent.toLowerCase().includes(searchQuery)) {
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
            songGrid.removeChild(song);
        }
    })
}

/*
function filterSongs(genre) {
    const songs = document.querySelectorAll('.song-item');
    songs.forEach(song => {
        const songGenres = song.getAttribute('data-genres').split(',');
        if (genre === 'all' || songGenres.includes(genre)) {
            song.style.opacity = '1';
            song.style.visibility = 'visible';
            //song.style.position = 'relative';
        }
        else {
            song.style.opacity = '0';
            song.style.visibility = 'hidden';
            //song.style.position = 'absolute';
        }
    })
}*/

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