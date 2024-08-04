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

function searchInput() {
    let searchQuery = document.getElementById('searchBar').value.toLowerCase();
    const songs = document.querySelectorAll('.song-item');


    for (let i = 0; i < songs.length; i++) {
        if (songs[i].querySelector('h3').textContent.toLowerCase().includes(searchQuery.toLowerCase())) {
            songs[i].style.display = 'block';
        }
        else {
            songs[i].style.display = 'none';
        }
    }
}

function filterSongs(genre) {
    const songs = document.querySelectorAll('.song-item');
    songs.forEach(song => {
        const songGenres = song.getAttribute('data-genres').split(',');
        if (genre === 'all' || songGenres.includes(genre)) {
            song.style.display = 'block';
        }
        else {
            song.style.display = 'none';
        }
    })
}