document.addEventListener('DOMContentLoaded', function() {
    const filterLinks = document.querySelectorAll('.genre_filters .filter-link');

    filterLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();

            filterLinks.forEach(l => l.classList.remove('selected'));
            this.classList.add('selected');

            const filter = this.getAttribute('data-filter');
            console.log('Selected filter:', filter);
            // 
        });
    });
});