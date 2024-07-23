const uploadSongBtn = document.getElementById('upload-song-btn');
const uploadPopup = document.getElementById('upload-popup');
const uploadSubmit = document.getElementById('upload-submit');
const uploadCancel = document.getElementById('upload-cancel')

uploadSongBtn.addEventListener('click', () => {
    uploadPopup.style.display = 'block';
});

uploadCancel.addEventListener('click', () => {
    uploadPopup.style.display = 'none';
});

uploadSubmit.addEventListener('click', () => {

});