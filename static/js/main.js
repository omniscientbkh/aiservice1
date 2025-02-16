document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('service-modal');
    const closeBtn = document.getElementsByClassName('close')[0];
    const searchInput = document.getElementById('search');
    const filterForm = document.getElementById('filter-form');
    const servicesGrid = document.querySelector('.services-grid');
    
    let searchTimeout;

    async function fetchAndDisplayServices() {
        const formData = new FormData(filterForm);
        const params = new URLSearchParams(formData);
        
        if (searchInput.value) {
            params.append('search', searchInput.value);
        }

        const response = await fetch(`/api/services?${params.toString()}`);
        const services = await response.json();
        
        servicesGrid.innerHTML = services.map(service => `
            <div class="service-card" data-id="${service.id}" data-category="${service.category}">
                <h2>${service.title}</h2>
                <p class="category">${service.category} ${service.subcategory ? `/ ${service.subcategory}` : ''}</p>
                <p class="description">${service.description}</p>
                <div class="tags">
                    ${service.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                </div>
                <div class="pricing-type">${service.pricing_type}</div>
                <div class="rating">
                    <span class="stars">★★★★★</span>
                    <span class="rating-value">${service.rating}</span>
                </div>
            </div>
        `).join('');

        // Reinitialize modal handlers for new cards
        initializeModalHandlers();
    }

    async function toggleFavorite(serviceId) {
        const isFavorite = document.querySelector(`.favorite-btn[data-id="${serviceId}"]`)
            .classList.contains('active');
        
        const method = isFavorite ? 'DELETE' : 'POST';
        const response = await fetch(`/api/favorites/${serviceId}`, { method });
        const data = await response.json();
        
        if (data.status === 'added' || data.status === 'removed') {
            document.querySelectorAll(`.favorite-btn[data-id="${serviceId}"]`)
                .forEach(btn => btn.classList.toggle('active'));
        }
    }

    async function submitReview(serviceId, rating, comment) {
        const response = await fetch(`/api/reviews/${serviceId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ rating, comment })
        });
        
        if (response.ok) {
            await loadReviews(serviceId);
            // Обновить среднюю оценку на карточке
            const serviceCard = document.querySelector(`.service-card[data-id="${serviceId}"]`);
            if (serviceCard) {
                const ratingValue = serviceCard.querySelector('.rating-value');
                const data = await fetch(`/service/${serviceId}`).then(r => r.json());
                ratingValue.textContent = data.rating.toFixed(1);
            }
        }
    }

    async function loadReviews(serviceId) {
        const response = await fetch(`/api/reviews/${serviceId}`);
        const reviews = await response.json();
        
        const reviewsContainer = document.getElementById('modal-reviews');
        reviewsContainer.innerHTML = reviews.map(review => `
            <div class="review">
                <div class="review-header">
                    <span class="review-author">${review.user_email}</span>
                    <span class="review-rating">★ ${review.rating}</span>
                    <span class="review-date">${new Date(review.created_at).toLocaleDateString()}</span>
                </div>
                <p class="review-comment">${review.comment || ''}</p>
            </div>
        `).join('');
    }

    function initializeModalHandlers() {
        const serviceCards = document.querySelectorAll('.service-card');
        serviceCards.forEach(card => {
            card.addEventListener('click', async (e) => {
                if (e.target.classList.contains('favorite-btn') || 
                    e.target.classList.contains('remove-favorite')) {
                    e.preventDefault();
                    e.stopPropagation();
                    await toggleFavorite(card.dataset.id);
                    return;
                }

                const serviceId = card.dataset.id;
                const response = await fetch(`/service/${serviceId}`);
                const data = await response.json();

                document.getElementById('modal-title').textContent = data.title;
                document.getElementById('modal-description').textContent = data.detailed_description;
                document.getElementById('modal-pricing').innerHTML = data.pricing;
                document.getElementById('modal-link').href = data.link;
                
                // Добавляем кнопку избранного в модальное окно
                const favoriteBtn = document.createElement('button');
                favoriteBtn.className = `favorite-btn ${data.is_favorite ? 'active' : ''}`;
                favoriteBtn.dataset.id = serviceId;
                favoriteBtn.innerHTML = data.is_favorite ? '★ В избранном' : '☆ В избранное';
                favoriteBtn.onclick = (e) => {
                    e.stopPropagation();
                    toggleFavorite(serviceId);
                };
                
                document.getElementById('modal-actions').innerHTML = '';
                document.getElementById('modal-actions').appendChild(favoriteBtn);
                
                // Загружаем отзывы
                await loadReviews(serviceId);
                
                modal.style.display = 'block';
            });
        });
    }

    // Search with debouncing
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(fetchAndDisplayServices, 300);
    });

    // Filter form submission
    filterForm.addEventListener('change', fetchAndDisplayServices);

    // Modal close handlers
    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    };

    // Initial load
    fetchAndDisplayServices();
}); 