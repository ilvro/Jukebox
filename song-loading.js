// loop through every item in tracks: get the mp3, assign a jpg that has the same name to it
class Song {
    constructor(title, file, image, genre, type) {
        this.title = title;
        this.file = file;
        this.image = image;
        this.genre = genre;
        this.type = type;
    }
}

var songList = [];


function displaySongs() {
    /* a song element is displayed as:

    <div class="song_item">
        <h3>Antiquarian Study</h3>
        <p>ambience + music</p>
        <img src="tracks/Antiquarian Study.jpg" alt="Antiquarian Study">
    </div>
    */
    const songGrid = document.querySelector('.song_grid');

    songList.forEach((song, index) => {
        const songElement = document.createElement('div');
        songElement.classList.add('song-item');
        songElement.innerHTML = `
            <img src="${song.image}" alt="${song.title}">
            <h3>${song.title}</h3>
            <p>${song.genre}</p>
            <button class="play-btn" data-index="${index}">Play</button>
        `;
        songGrid.appendChild(songElement);
    });
}