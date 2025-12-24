import { addSongToPlayer, getMarkers, setMarkers } from "./player.js";
//const API_URL = 'https://jukebox-backend-16sx.onrender.com'
const API_URL = 'http://localhost:3000';

const uploadSongBtn = document.getElementById('upload-song-btn');
const uploadPopup = document.getElementById('upload-popup');
const uploadSubmit = document.getElementById('upload-submit');
const uploadCancel = document.getElementById('upload-cancel');
const youtubeLinkInput = document.getElementById('youtube-link');
const songFileInput = document.getElementById('song-file');
const thumbnailFileInput = document.getElementById('thumbnail-file');

const savePresetBtn = document.getElementById('save-preset-btn');
const loadPresetBtn = document.getElementById('load-preset-btn');
const loadSampleBtn = document.getElementById('load-sample-btn');
const supportsFileSystemAccess = 'showDirectoryPicker' in window;

const dimmer = document.getElementById('dimmer');
const songGrid = document.getElementById('song-grid');

async function downloadVideo(youtubeLink) {
    try {
        const audioPromise = fetch(`${API_URL}/download/youtube/audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: youtubeLink })
        });

        const thumbnailPromise = fetch(`${API_URL}/download/youtube/thumbnail`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: youtubeLink })
        });

        const [audioResponse, thumbnailResponse] = await Promise.all([audioPromise, thumbnailPromise]);
        
	// handle audio response
        if (!audioResponse.ok) {
            throw new Error(`audio download failed: ${audioResponse.statusText}`);
        }
        const contentDisposition = audioResponse.headers.get('Content-Disposition');
        if (!contentDisposition) {
            throw new Error('missing Content-Disposition header in audio response');
        }
        const videoTitle = contentDisposition.split('filename=')[1].replace(/"/g, '').slice(0, -4).replace("inquote", 'â€™');
        const audioBlob = await audioResponse.blob();
        const audioFile = new File([audioBlob], `${videoTitle}.mp3`, { type: "audio/mpeg" });

	// handle thumbnail response
        if (!thumbnailResponse.ok) {
            throw new Error(`thumbnail download failed: ${thumbnailResponse.statusText}`);
        }
        const thumbnailBlob = await thumbnailResponse.blob();
        const thumbnailFile = new File([thumbnailBlob], `${videoTitle}.jpg`, {
            type: thumbnailResponse.headers.get('Content-Type')
        });

	// populate input forms
        const audioDataTransfer = new DataTransfer();
        audioDataTransfer.items.add(audioFile);
        songFileInput.files = audioDataTransfer.files;

        const thumbnailDataTransfer = new DataTransfer();
        thumbnailDataTransfer.items.add(thumbnailFile);
        thumbnailFileInput.files = thumbnailDataTransfer.files;

    } catch (error) {
        console.error('download failed:', error);
    }
}

async function savePreset() {
    if (!supportsFileSystemAccess) {
        alert("Your browser doesn't support the File System Access API. Switch to a desktop environment.");
        return;
    }

    try {
        const directoryHandle = await window.showDirectoryPicker();
        const songItems = document.querySelectorAll('.song-item');
        let presetData = [];

	// load preset_metadata.json if it exists, create one if it doesnt
        try {
            const presetMetadataHandle = await directoryHandle.getFileHandle('preset_metadata.json');
            const metadataFile = await presetMetadataHandle.getFile();
            const metadataText = await metadataFile.text();
            presetData = metadataText.trim() ? JSON.parse(metadataText) : [];
        } catch (err) {
            if (err.name === 'NotFoundError') {
                console.log('no existing preset_metadata.json, starting fresh');
            } else {
                throw err;
            }
        }

	// remove queued deleted songs from metadata and files
        presetData = presetData.filter(
            song => !deletedSongs.includes(decodeURIComponent(song.currentTitle))
        );

        for (let title of deletedSongs) {
            title = encodeURIComponent(title);
            try {
                await directoryHandle.removeEntry(`${title}.mp3`);
                console.log(`deleted audio file: ${title}.mp3`);
            } catch (err) {
                console.warn(`could not delete audio file for ${title}:`, err);
            }

            try {
                await directoryHandle.removeEntry(`${title}.jpg`);
                console.log(`deleted image file: ${title}.jpg`);
            } catch (err) {
                console.warn(`could not delete image file for ${title}:`, err);
            }
        }
        deletedSongs.length = 0;

        let updatedData = [];
        for (const songItem of songItems) {
            const currentTitle = encodeURIComponent(songItem.querySelector('input').value);
            const originalTitle = encodeURIComponent(songItem.querySelector('input').defaultValue);
            const audioUrl = songItem.dataset.audioUrl;
            const imageUrl = songItem.querySelector('img').src;
            const genres = songItem.getAttribute('data-genres').split(',');
            const tags = songItem.querySelector('p').textContent.split(' + ');
            
            const songId = songItem.dataset.songId;
            const markers = getMarkers(songId);

	    // check for title changes
            const existingIndex = presetData.findIndex(item => item.currentTitle === originalTitle);
            if (existingIndex !== -1) {
                console.log(`updating existing song: ${decodeURIComponent(originalTitle)} to ${decodeURIComponent(currentTitle)}`);
                const updatedSong = {
                    currentTitle,
                    genres,
                    tags,
                    markers
                };

                presetData[existingIndex] = updatedSong;

		// rename audio and image files if the title changed
                if (currentTitle !== originalTitle) {
                    try {
                        const oldAudioHandle = await directoryHandle.getFileHandle(`${originalTitle}.mp3`);
                        const newAudioHandle = await directoryHandle.getFileHandle(`${currentTitle}.mp3`, { create: true });
                        const writable = await newAudioHandle.createWritable();
                        const oldFile = await oldAudioHandle.getFile();
                        await writable.write(await oldFile.arrayBuffer());
                        await writable.close();
                        await directoryHandle.removeEntry(`${originalTitle}.mp3`);
                    } catch (err) {
                        console.warn(`audio file rename failed for ${decodeURIComponent(originalTitle)}:`, err);
                    }

                    try {
                        const oldImageHandle = await directoryHandle.getFileHandle(`${originalTitle}.jpg`);
                        const newImageHandle = await directoryHandle.getFileHandle(`${currentTitle}.jpg`, { create: true });
                        const writable = await newImageHandle.createWritable();
                        const oldFile = await oldImageHandle.getFile();
                        await writable.write(await oldFile.arrayBuffer());
                        await writable.close();
                        await directoryHandle.removeEntry(`${originalTitle}.jpg`);
                    } catch (err) {
                        console.warn(`image file rename failed for ${decodeURIComponent(originalTitle)}:`, err);
                    }
                }

                updatedData.push(updatedSong);
            } else {
                console.log(`adding new song: ${decodeURIComponent(currentTitle)}`);
                const newSong = { currentTitle, genres, tags, markers };
                presetData.push(newSong);
                updatedData.push(newSong);
            }

            try {
                await directoryHandle.getFileHandle(`${currentTitle}.mp3`);
            } catch (err) {
                const audioResponse = await fetch(audioUrl);
                const audioBlob = await audioResponse.blob();
                const audioFileHandle = await directoryHandle.getFileHandle(`${currentTitle}.mp3`, { create: true });
                const audioWritable = await audioFileHandle.createWritable();
                await audioWritable.write(audioBlob);
                await audioWritable.close();
            }

            try {
                await directoryHandle.getFileHandle(`${currentTitle}.jpg`);
            } catch (err) {
                const imageResponse = await fetch(imageUrl);
                const imageBlob = await imageResponse.blob();
                const imageFileHandle = await directoryHandle.getFileHandle(`${currentTitle}.jpg`, { create: true });
                const imageWritable = await imageFileHandle.createWritable();
                await imageWritable.write(imageBlob);
                await imageWritable.close();
            }

            console.log(`saved ${currentTitle}`);
        }

        const presetMetadataHandle = await directoryHandle.getFileHandle('preset_metadata.json', { create: true });
        const presetMetadataWritable = await presetMetadataHandle.createWritable();
        await presetMetadataWritable.write(JSON.stringify(updatedData, null, 2));
        await presetMetadataWritable.close();

        console.log('saved preset');
    } catch (error) {
        console.error('error saving preset:', error);
    }
}

async function loadPreset() {
    if (!window.showDirectoryPicker) {
    	// android user, use alternate fallback function
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.zip,application/json,audio/mpeg,image/jpeg';
        fileInput.multiple = true;
        fileInput.addEventListener('change', async (event) => {
            const files = event.target.files;
            await handleFilesFallback(files);
        });
        fileInput.click();
        return;
    }

    try {
        const directoryHandle = await window.showDirectoryPicker();
        songGrid.innerHTML = '';

        const presetMetadataHandle = await directoryHandle.getFileHandle('preset_metadata.json');
        const presetMetadataFile = await presetMetadataHandle.getFile();
        const presetMetadata = JSON.parse(await presetMetadataFile.text());

        for (const songMetadata of presetMetadata) {
            let { currentTitle, genres, tags, markers } = songMetadata;

            genres = genres.map(genre => genre === 'modern' ? 'mystery' : genre);
            songMetadata.genres = genres;

            let audioFile, thumbnailFile;
            try {
                // first try with the _ encoding (more common because google drive turns it into underscore)
                const underscoreTitle = currentTitle.replace(/%/g, '_');
                const audioEntry = await directoryHandle.getFileHandle(`${underscoreTitle}.mp3`);
                const thumbnailEntry = await directoryHandle.getFileHandle(`${underscoreTitle}.jpg`);
                audioFile = await audioEntry.getFile();
                thumbnailFile = await thumbnailEntry.getFile();
            } catch (error) {
            	// try with the original % encoding
                try {
                    const revertedTitle = revertUnderscoreEncoding(currentTitle);
                    const audioEntry = await directoryHandle.getFileHandle(`${revertedTitle}.mp3`);
                    const thumbnailEntry = await directoryHandle.getFileHandle(`${revertedTitle}.jpg`);
                    audioFile = await audioEntry.getFile();
                    thumbnailFile = await thumbnailEntry.getFile();
                } catch (finalError) {
                    console.error(`could not load files for ${decodeURIComponent(currentTitle)}`);
                    continue;
                }
            }

	    // create song item
            const songItem = document.createElement('div');
            songItem.classList.add('song-item');
            songItem.setAttribute('draggable', 'true');
            songItem.setAttribute('data-genres', genres.join(','));
            songItem.setAttribute('data-tags', tags.join(','));
            songItem.innerHTML = `
                <input spellcheck='false' class='title-input' value="${decodeURIComponent(currentTitle)}"></input>
                <p>${tags.join(' + ')}</p>
                <img src="${URL.createObjectURL(thumbnailFile)}" alt="${decodeURIComponent(currentTitle)}">
            `;

	    // disables input and audio blob links from being dragged to the title input
            const titleInput = songItem.querySelector('.title-input');
            titleInput.addEventListener('dragover', (event) => {
                event.preventDefault();
            });
            titleInput.addEventListener('drop', (event) => {
                event.preventDefault();
                event.stopPropagation();
            });

            songGrid.appendChild(songItem);
            addSongToPlayer(songItem, audioFile);
            
            // load markers
            if (markers && markers.length > 0) {
                setMarkers(songItem.dataset.songId, markers);
            }
        }
        console.log('loaded preset');
        document.dispatchEvent(new Event('songsUpdated'));
    } catch (error) {
        console.error('error loading preset: ', error);
    }
}

async function loadSamplePreset() {
    try {
        console.log('Loading sample preset...');
        songGrid.innerHTML = '';
        
        const sampleFolderPath = './sample/';
        const metadataResponse = await fetch(`${sampleFolderPath}preset_metadata.json`);
        if (!metadataResponse.ok) {
            throw new Error(`Failed to fetch sample preset metadata: ${metadataResponse.status}`);
        }
        
        const presetMetadata = await metadataResponse.json();
        console.log('Loaded preset metadata:', presetMetadata);
        
        // promises for all songs
        const songPromises = presetMetadata.map(async (songMetadata) => {
            const { currentTitle, genres, tags, markers } = songMetadata;
            const decodedTitle = decodeURIComponent(currentTitle);
            const updatedGenres = genres.map(genre => genre === 'modern' ? 'mystery' : genre);
            const fixedTitle = currentTitle.replace(/%/g, '%25');
            
            const audioPath = `${sampleFolderPath}${fixedTitle}.mp3`;
            const imagePath = `${sampleFolderPath}${fixedTitle}.jpg`;
            
            // fetch audio and image in parallel for faster processing
            const [audioResponse, thumbnailResponse] = await Promise.all([
                fetch(audioPath),
                fetch(imagePath)
            ]);
            
            if (!audioResponse.ok) {
                throw new Error(`Failed to fetch audio file: ${audioResponse.status}`);
            }
            
            if (!thumbnailResponse.ok) {
                throw new Error(`Failed to fetch thumbnail file: ${thumbnailResponse.status}`);
            }
            
            const [audioBlob, thumbnailBlob] = await Promise.all([
                audioResponse.blob(),
                thumbnailResponse.blob()
            ]);
            
            return {
                currentTitle,
                decodedTitle,
                updatedGenres,
                tags,
                markers,
                audioFile: new File([audioBlob], `${currentTitle}.mp3`, { type: 'audio/mpeg' }),
                thumbnailFile: new File([thumbnailBlob], `${currentTitle}.jpg`, { type: 'image/jpeg' })
            };
        });
        
        // processes batches of song to avoid overwhelming the browser (way faster this way)
        const BATCH_SIZE = 5;
        const totalSongs = songPromises.length;
        
        for (let i = 0; i < totalSongs; i += BATCH_SIZE) {
            const batch = songPromises.slice(i, i + BATCH_SIZE);
            const songBatch = await Promise.all(batch);

            songBatch.forEach(song => {
                const songItem = document.createElement('div');
                songItem.classList.add('song-item');
                songItem.setAttribute('draggable', 'true');
                songItem.setAttribute('data-genres', song.updatedGenres.join(','));
                songItem.setAttribute('data-tags', song.tags.join(','));
                songItem.innerHTML = `
                    <input spellcheck='false' class='title-input' value="${song.decodedTitle}"></input>
                    <p>${song.tags.join(' + ')}</p>
                    <img src="${URL.createObjectURL(song.thumbnailFile)}" alt="${song.decodedTitle}">
                `;
                
                const titleInput = songItem.querySelector('.title-input');
                titleInput.addEventListener('dragover', (event) => {
                    event.preventDefault();
                });
                titleInput.addEventListener('drop', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                });
                
                songGrid.appendChild(songItem);
                addSongToPlayer(songItem, song.audioFile);
                
                if (song.markers && song.markers.length > 0) {
                    setMarkers(songItem.dataset.songId, song.markers);
                }
            });
            
            // give the browser a break
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        console.log('Loaded sample preset');
        document.dispatchEvent(new Event('songsUpdated'));
    } catch (error) {
        console.error('Error loading sample preset:', error);
    }
}

async function handleFilesFallback(files) {
    const fileMap = {};
    for (const file of files) {
        fileMap[file.name] = file;
    }

    if (!fileMap['preset_metadata.json']) {
        alert('preset_metadata.json is missing');
        return;
    }

    const presetMetadataFile = fileMap['preset_metadata.json'];
    const presetMetadata = JSON.parse(await presetMetadataFile.text());

    for (const songMetadata of presetMetadata) {
        let { currentTitle, genres, tags, markers } = songMetadata;
        genres = genres.map(genre => genre === 'modern' ? 'mystery' : genre);

        const audioFile = fileMap[`${currentTitle}.mp3`];
        const thumbnailFile = fileMap[`${currentTitle}.jpg`];

        if (!audioFile || !thumbnailFile) {
            console.error(`missing files for ${currentTitle}`);
            continue;
        }

        const songItem = document.createElement('div');
        songItem.classList.add('song-item');
        songItem.setAttribute('draggable', 'true');
        songItem.setAttribute('data-genres', genres.join(','));
        songItem.innerHTML = `
            <input spellcheck='false' class='title-input' value="${decodeURIComponent(currentTitle)}"></input>
            <p>${tags.join(' + ')}</p>
            <img src="${URL.createObjectURL(thumbnailFile)}" alt="${decodeURIComponent(currentTitle)}">
        `;

        const titleInput = songItem.querySelector('.title-input');
        titleInput.addEventListener('dragover', (event) => {
            event.preventDefault();
        });
        titleInput.addEventListener('drop', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        songGrid.appendChild(songItem);
        addSongToPlayer(songItem, audioFile);
        
        if (markers && markers.length > 0) {
            setMarkers(songItem.dataset.songId, markers);
        }
    }
    console.log('loaded files via fallback');
    document.dispatchEvent(new Event('songsUpdated'));
}

function getSelectedTags() {
    const tags = document.querySelectorAll('input[name="tag"]');
    const selectedTags = [];
    
    tags.forEach(tag => {
        if (tag.checked) {
            selectedTags.push(tag.value);
        }
    })
    return selectedTags;
}

function getSelectedGenres() {
    const genres = document.querySelectorAll('input[name="genre"]');
    const selectedGenres = [];
    
    genres.forEach(genre => {
        if (genre.checked) {
            selectedGenres.push(genre.value);
        }
    })
    return selectedGenres;
}

function revertUnderscoreEncoding(title) { // because google drive turns presets into .zips and extracting them changes the name, so we have to revert to the normal name to make the preset work again
    return title.replace(/_([0-9A-F]{2})/g, '%$1');
}

savePresetBtn.addEventListener('click', savePreset);
loadPresetBtn.addEventListener('click', loadPreset);
loadSampleBtn.addEventListener('click', loadSamplePreset);

youtubeLinkInput.addEventListener('paste', async (event) => {
    let youtubeLink = event.clipboardData.getData("text");
    if (youtubeLink.includes('youtube.com/watch?v=')) {
        await downloadVideo(youtubeLink);
    } else {
        console.log('invalid url');
    }
});

uploadSubmit.addEventListener('click', () => {
    // remember to loop through added genres later
    const thumbnail = thumbnailFileInput.files[0];
    const audio = songFileInput.files[0];
    let title;
    try {
        title = decodeURIComponent(thumbnail.name.toString().slice(0, -4));
    } catch {
        title = thumbnail.name.toString().slice(0, -4);
    }
    
    const genres = getSelectedGenres();
    const tags = getSelectedTags();

    const songItem = document.createElement('div');
    songItem.classList.add('song-item');
    songItem.setAttribute('draggable', 'true');
    songItem.setAttribute('data-genres', genres.join(','));
    songItem.innerHTML = `
        <input class="title-input" value="${title}"</input>
        <p>${tags.join(' + ')}</p>
        <img src="${URL.createObjectURL(thumbnail)}" alt="${title}">
    `;
    songGrid.appendChild(songItem);
    addSongToPlayer(songItem, audio);
    document.dispatchEvent(new Event('songsUpdated'));

    // fade out the ui
    thumbnailFileInput.value = null;
    songFileInput.value = null;
    youtubeLinkInput.value = null;
    
    uploadPopup.style.opacity = '0';
    dimmer.style.opacity = '0';
    setTimeout(() => {
        uploadPopup.style.visibility = 'hidden';
        dimmer.style.visibility = 'hidden'; 
    }, 10);
});

// right click functions
const deletedSongs = [];

document.addEventListener('DOMContentLoaded', () => {
    const songGrid = document.getElementById('song-grid');
    const contextMenu = document.createElement('div');

    contextMenu.id = 'custom-context-menu';
    contextMenu.style.position = 'absolute';
    contextMenu.style.display = 'none';
    contextMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
    contextMenu.style.color = '#fff';
    contextMenu.style.padding = '10px';
    contextMenu.style.borderRadius = '5px';
    contextMenu.style.zIndex = '1000';

    const deleteOption = document.createElement('div');
    deleteOption.innerText = 'Delete';
    deleteOption.style.cursor = 'pointer';

    const editGenresOption = document.createElement('div');
    editGenresOption.innerText = 'Edit Genres';
    editGenresOption.style.cursor = 'pointer';

    contextMenu.appendChild(editGenresOption);
    contextMenu.appendChild(deleteOption);
    document.body.appendChild(contextMenu);

    let currentSongItem = null;

    songGrid.addEventListener('contextmenu', (event) => {
        event.preventDefault();

        const songItem = event.target.closest('.song-item');
        if (!songItem) return;

        currentSongItem = songItem;
        contextMenu.style.top = `${event.pageY}px`;
        contextMenu.style.left = `${event.pageX}px`;
        contextMenu.style.display = 'block';
    });

    document.addEventListener('click', () => {
        contextMenu.style.display = 'none';
    });

    // delete functionality
    deleteOption.addEventListener('click', async () => {
        if (currentSongItem) {
            const title = currentSongItem.querySelector('.title-input').defaultValue;
            deletedSongs.push(title);
            currentSongItem.remove();

            document.dispatchEvent(new Event('songsUpdated'));
            console.log(`queued ${title} for deletion`)
        }

        contextMenu.style.display = 'none';
    });

    editGenresOption.addEventListener('click', () => {
        if (currentSongItem) {
            showEditGenresPopup(currentSongItem);
        }
        contextMenu.style.display = 'none';
    });
});

function showEditGenresPopup(songItem) {
    const existingPopup = document.getElementById('edit-genres-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    const popup = document.createElement('div');
    popup.id = 'edit-genres-popup';
    popup.className = 'popup';
    
    // ensure proper positioning and z-index
    Object.assign(popup.style, {
        position: 'fixed',
        left: '50%',
        top: '45%',
        transform: 'translate(-50%, -50%)',
        zIndex: '4',
        pointerEvents: 'auto'
    });

    const header = document.createElement('header');
    header.className = 'popup-header';
    
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'upload-end-btns';
    
    const saveButton = document.createElement('button');
    saveButton.id = 'edit-submit';
    saveButton.className = 'button';
    saveButton.textContent = 'Save';
    
    const cancelButton = document.createElement('button');
    cancelButton.id = 'edit-cancel';
    cancelButton.className = 'red-button';
    cancelButton.textContent = 'X';
    
    buttonsContainer.appendChild(saveButton);
    buttonsContainer.appendChild(cancelButton);
    header.appendChild(buttonsContainer);
    popup.appendChild(header);

    const content = document.createElement('div');
    content.className = 'popup-content';
    content.innerHTML = '<br><br>';

    const currentGenres = songItem.getAttribute('data-genres').split(',').filter(g => g);
    const currentTags = songItem.getAttribute('data-tags').split(',').filter(t => t);

    const allGenres = ['fun', 'hopeful', 'mystery', 'suspense', 'horror', 'sfx'];
    const allTags = ['ambient', 'investigation', 'event', 'battle', 'emotional'];

    const uploadStep = document.createElement('div');
    uploadStep.className = 'upload-step';
    
    const label = document.createElement('label');
    label.textContent = 'Select the song\'s genres:';
    uploadStep.appendChild(label);

    const tagCheckboxes = document.createElement('div');
    tagCheckboxes.className = 'genre-checkboxes';
    tagCheckboxes.id = 'edit-tag-checkboxes';
    
    allTags.forEach(tag => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `edit-tag-${tag}`;
        checkbox.name = 'edit-tag';
        checkbox.value = tag;
        checkbox.checked = currentTags.includes(tag);

        const checkboxLabel = document.createElement('label');
        checkboxLabel.htmlFor = `edit-tag-${tag}`;
        checkboxLabel.className = 'genre-btn';
        checkboxLabel.textContent = tag;

        tagCheckboxes.appendChild(checkbox);
        tagCheckboxes.appendChild(checkboxLabel);
    });
    
    uploadStep.appendChild(tagCheckboxes);

    const genreCheckboxes = document.createElement('div');
    genreCheckboxes.className = 'genre-checkboxes';
    genreCheckboxes.id = 'edit-genre-checkboxes';

    allGenres.forEach(genre => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `edit-genre-${genre}`;
        checkbox.name = 'edit-genre';
        checkbox.value = genre;
        checkbox.checked = currentGenres.includes(genre);

        const checkboxLabel = document.createElement('label');
        checkboxLabel.htmlFor = `edit-genre-${genre}`;
        checkboxLabel.className = 'genre-btn';
        checkboxLabel.textContent = genre;

        genreCheckboxes.appendChild(checkbox);
        genreCheckboxes.appendChild(checkboxLabel);
    });

    uploadStep.appendChild(genreCheckboxes);
    content.appendChild(uploadStep);
    popup.appendChild(content);

    saveButton.addEventListener('click', () => {
        const selectedTags = [];
        const selectedGenres = [];

        allTags.forEach(tag => {
            const checkbox = document.getElementById(`edit-tag-${tag}`);
            if (checkbox && checkbox.checked) {
                selectedTags.push(tag);
            }
        });

        allGenres.forEach(genre => {
            const checkbox = document.getElementById(`edit-genre-${genre}`);
            if (checkbox && checkbox.checked) {
                selectedGenres.push(genre);
            }
        });

        songItem.setAttribute('data-genres', selectedGenres.join(','));
        songItem.setAttribute('data-tags', selectedTags.join(','));
        songItem.querySelector('p').textContent = selectedTags.join(' + ');

        popup.style.opacity = '0';
        dimmer.style.opacity = '0';
        setTimeout(() => {
            popup.style.visibility = 'hidden';
            dimmer.style.visibility = 'hidden';
        }, 300);
    });

    cancelButton.addEventListener('click', () => {
        popup.style.opacity = '0';
        dimmer.style.opacity = '0';
        setTimeout(() => {
            popup.style.visibility = 'hidden';
            dimmer.style.visibility = 'hidden';
        }, 300);
    });

    const dimmer = document.getElementById('dimmer');
    document.body.appendChild(popup);
    
    // trigger transition after element is added to DOM
    popup.style.visibility = 'visible';
    dimmer.style.visibility = 'visible';
    setTimeout(() => {
        popup.style.opacity = '1';
        dimmer.style.opacity = '0.6';
    }, 10);
}

// ------------------- styling ------------------------------
uploadSongBtn.addEventListener('click', () => {
    uploadPopup.style.visibility = 'visible';
    dimmer.style.visibility = 'visible';
    setTimeout(() => {
        uploadPopup.style.opacity = '1';
        dimmer.style.opacity = '0.6';
    }, 10);
});

uploadCancel.addEventListener('click', () => {
    uploadPopup.style.opacity = '0';
    dimmer.style.opacity = '0';
    setTimeout(() => {
    uploadPopup.style.visibility = 'hidden';
    dimmer.style.visibility = 'hidden'; 
    }, 10);
});