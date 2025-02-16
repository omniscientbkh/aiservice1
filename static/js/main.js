document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('service-modal');
    const closeBtn = document.getElementsByClassName('close')[0];
    const searchInput = document.getElementById('search');
    const searchInputMobile = document.getElementById('search-mobile');
    const filterForm = document.getElementById('filter-form');
    const servicesGrid = document.querySelector('.services-grid');
    
    let searchTimeout;

    // Добавляем кэширование запросов
    const cache = new Map();

    async function fetchWithCache(url, options = {}) {
        const cacheKey = url + JSON.stringify(options);
        
        if (cache.has(cacheKey)) {
            const { data, timestamp } = cache.get(cacheKey);
            // Кэш валиден 5 минут
            if (Date.now() - timestamp < 5 * 60 * 1000) {
                return data;
            }
            cache.delete(cacheKey);
        }
        
        const response = await fetch(url, options);
        const data = await response.json();
        cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    }

    // Добавляем дебаунсинг для поиска
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    async function fetchAndDisplayServices(value) {
        const formData = new FormData(filterForm);
        const params = new URLSearchParams(formData);
        
        if (value) {
            params.append('search', value);
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

    // Делаем функции глобальными
    window.closeModal = function() {
        document.querySelector('.modal').style.display = 'none';
    };

    window.toggleFavorite = async function(serviceId) {
        const favoriteBtn = document.querySelector(`.favorite-btn[data-id="${serviceId}"]`);
        const isFavorite = favoriteBtn?.classList.contains('active');
        
        const method = isFavorite ? 'DELETE' : 'POST';
        const response = await fetch(`/api/favorites/${serviceId}`, { method });
        const data = await response.json();
        
        if (data.status === 'added' || data.status === 'removed') {
            // Обновляем все кнопки избранного для этого сервиса
            document.querySelectorAll(`.favorite-btn[data-id="${serviceId}"]`).forEach(btn => {
                btn.classList.toggle('active');
                // Обновляем иконку
                const icon = btn.querySelector('i');
                if (icon) {
                    icon.className = btn.classList.contains('active') ? 'fas fa-heart' : 'far fa-heart';
                }
            });

            // Если мы на странице избранного и удалили из избранного
            if (window.location.pathname.includes('favorites') && data.status === 'removed') {
                const serviceCard = document.querySelector(`.service-card[data-id="${serviceId}"]`);
                if (serviceCard) {
                    serviceCard.remove();
                    
                    // Проверяем, остались ли еще карточки
                    const remainingCards = document.querySelectorAll('.service-card');
                    if (remainingCards.length === 0) {
                        const container = document.querySelector('.container');
                        const catalogUrl = container.dataset.catalogUrl;
                        const servicesGrid = document.querySelector('.services-grid');
                        servicesGrid.innerHTML = `
                            <div class="empty-state">
                                <i class="far fa-heart mb-3" style="font-size: 2rem; color: var(--text-secondary)"></i>
                                <p class="text-secondary mb-3">У вас пока нет избранных сервисов</p>
                                <a href="${catalogUrl}" class="btn btn-primary">
                                    Перейти к каталогу
                                </a>
                            </div>
                        `;
                    }
                }
            }
        }
    };

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
            <div class="review-item">
                <div class="review-header">
                    <span class="review-author">${review.user_email}</span>
                    <div class="review-rating">
                        <i class="fas fa-star"></i>
                        ${review.rating}
                    </div>
                </div>
                <div class="review-content">${review.comment || ''}</div>
                <div class="review-date">${new Date(review.created_at).toLocaleDateString()}</div>
            </div>
        `).join('');
    }

    function initializeModalHandlers() {
        const serviceCards = document.querySelectorAll('.service-card');
        serviceCards.forEach(card => {
            card.addEventListener('click', async (e) => {
                if (e.target.closest('.favorite-btn')) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }

                const serviceId = card.dataset.id;
                const response = await fetch(`/service/${serviceId}`);
                const data = await response.json();

                const modalContent = `
                    <div class="modal-header">
                        <h3 class="modal-title">${data.title}</h3>
                        <button type="button" class="modal-close" onclick="closeModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="modal-description">${data.detailed_description}</div>
                        
                        <div class="modal-info-section">
                            <div class="modal-info-title">Тарифы</div>
                            <div class="modal-pricing">
                                ${formatPricing(data.pricing)}
                            </div>
                        </div>
                        
                        <div class="modal-actions">
                            <a href="${data.link}" class="modal-link" target="_blank">
                                <i class="fas fa-external-link-alt"></i>
                                Перейти к сервису
                            </a>
                            <button class="favorite-btn ${data.is_favorite ? 'active' : ''}" 
                                    data-id="${serviceId}"
                                    onclick="toggleFavorite(${serviceId})">
                                <i class="fas ${data.is_favorite ? 'fa-heart' : 'fa-heart'}"></i>
                                ${data.is_favorite ? 'В избранном' : 'В избранное'}
                            </button>
                        </div>
                        
                        <div class="modal-reviews">
                            <div class="modal-info-title">Отзывы</div>
                            <div class="review-list" id="modal-reviews"></div>
                        </div>
                    </div>
                `;

                const modalElement = document.querySelector('.modal');
                modalElement.querySelector('.modal-content').innerHTML = modalContent;
                modalElement.style.display = 'block';

                // Закрытие по клику вне модального окна
                modalElement.addEventListener('click', function(e) {
                    if (e.target === modalElement) {
                        closeModal();
                    }
                });

                // Закрытие по нажатию Escape
                document.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape') {
                        closeModal();
                    }
                });
                
                // Загружаем отзывы
                await loadReviews(serviceId);
            });
        });
    }

    // Функция форматирования тарифов
    function formatPricing(pricing) {
        return pricing.split('\n')
            .filter(line => line.trim())
            .map(line => {
                const [label, value] = line.split(':').map(s => s.trim());
                return `
                    <div class="pricing-item">
                        <span class="pricing-label">${label}</span>
                        <span class="pricing-value">${value}</span>
                    </div>
                `;
            })
            .join('');
    }

    // Ленивая загрузка сервисов
    function lazyLoadServices() {
        const options = {
            root: null,
            rootMargin: '50px',
            threshold: 0.1
        };
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const card = entry.target;
                    if (card.dataset.loading === 'true') return;
                    
                    card.dataset.loading = 'true';
                    fetchServiceDetails(card.dataset.id)
                        .then(data => updateServiceCard(card, data));
                }
            });
        }, options);
        
        document.querySelectorAll('.service-card').forEach(card => {
            observer.observe(card);
        });
    }

    // Оптимизированная функция обновления карточек
    const updateServiceCard = (() => {
        const template = document.createElement('template');
        
        return (card, data) => {
            template.innerHTML = `
                <h2>${data.title}</h2>
                <p class="description">${data.description}</p>
                <div class="rating">
                    <span class="stars">★★★★★</span>
                    <span class="rating-value">${data.rating}</span>
                </div>
            `;
            
            // Используем DocumentFragment для оптимизации DOM операций
            const fragment = template.content.cloneNode(true);
            card.innerHTML = '';
            card.appendChild(fragment);
        };
    })();

    // Функция для синхронизации поисковых полей
    function syncSearchInputs(value) {
        searchInput.value = value;
        searchInputMobile.value = value;
        // Выполняем поиск
        handleSearch(value);
    }

    // Обработка категорий
    const categoryButtons = document.querySelectorAll('.category-item');
    let activeCategory = null;

    categoryButtons.forEach(button => {
        button.addEventListener('click', async () => {
            // Убираем активный класс у всех кнопок
            categoryButtons.forEach(btn => btn.classList.remove('active'));
            
            // Если кликнули по той же категории - сбрасываем фильтр
            if (activeCategory === button.textContent.trim()) {
                activeCategory = null;
                await fetchAndDisplayServices('');
                return;
            }

            // Добавляем активный класс к выбранной кнопке
            button.classList.add('active');
            activeCategory = button.textContent.trim();

            // Получаем текущий поисковый запрос
            const searchQuery = document.getElementById('search').value;
            
            // Формируем параметры запроса
            const params = new URLSearchParams();
            if (searchQuery) params.append('search', searchQuery);
            if (activeCategory) params.append('category', activeCategory);

            // Загружаем отфильтрованные сервисы
            const response = await fetch(`/api/services?${params.toString()}`);
            const services = await response.json();
            
            // Обновляем отображение
            servicesGrid.innerHTML = services.map(service => `
                <div class="service-card" data-id="${service.id}">
                    <div class="service-card-header">
                        <h2 class="service-title">${service.title}</h2>
                        <button class="favorite-btn ${service.is_favorite ? 'active' : ''}" 
                                data-id="${service.id}"
                                onclick="toggleFavorite(${service.id})">
                            <i class="fas ${service.is_favorite ? 'fa-heart' : 'fa-heart'}"></i>
                        </button>
                    </div>
                    
                    <div class="service-category">
                        <span class="category-badge">${service.category}</span>
                        ${service.subcategory ? `
                            <span class="subcategory-badge">${service.subcategory}</span>
                        ` : ''}
                    </div>
                    
                    <p class="service-description">${service.description}</p>
                    
                    ${service.tags ? `
                        <div class="tags">
                            ${service.tags.split(',').map(tag => `
                                <span class="tag">${tag.trim()}</span>
                            `).join('')}
                        </div>
                    ` : ''}
                    
                    <div class="service-footer">
                        <div class="rating">
                            <i class="fas fa-star"></i>
                            <span>${parseFloat(service.rating).toFixed(1)}</span>
                        </div>
                        <div class="pricing-type">${service.pricing_type}</div>
                    </div>
                </div>
            `).join('');

            // Переинициализируем обработчики модальных окон
            initializeModalHandlers();
        });
    });

    // Обновляем функцию поиска для учета активной категории
    async function handleSearch(value) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            const params = new URLSearchParams();
            if (value) params.append('search', value);
            if (activeCategory) params.append('category', activeCategory);
            
            const response = await fetch(`/api/services?${params.toString()}`);
            const services = await response.json();
            
            // Обновляем отображение сервисов
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
            
            // Переинициализируем обработчики
            initializeModalHandlers();
        }, 300);
    }

    // Инициализация с оптимизациями
    document.addEventListener('DOMContentLoaded', () => {
        // Отложенная инициализация неприоритетных функций
        setTimeout(() => {
            initializeModalHandlers();
            lazyLoadServices();
        }, 0);
        
        // Обработчики для обоих полей поиска
        searchInput.addEventListener('input', (e) => syncSearchInputs(e.target.value));
        searchInputMobile.addEventListener('input', (e) => syncSearchInputs(e.target.value));
        
        // Предзагрузка данных для следующей страницы
        if ('IntersectionObserver' in window) {
            const prefetchObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const nextPage = entry.target.dataset.nextPage;
                        if (nextPage) {
                            fetchWithCache(`/api/services?page=${nextPage}`);
                        }
                    }
                });
            });
            
            document.querySelectorAll('[data-next-page]').forEach(el => {
                prefetchObserver.observe(el);
            });
        }
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

    // Включаем валидацию форм Bootstrap
    (function () {
        'use strict'
        
        const forms = document.querySelectorAll('.needs-validation')
        
        Array.from(forms).forEach(form => {
            form.addEventListener('submit', event => {
                if (!form.checkValidity()) {
                    event.preventDefault()
                    event.stopPropagation()
                }
                form.classList.add('was-validated')
            })
        })
    })()

    // Плавный скролл для якорных ссылок
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault()
            const target = document.querySelector(this.getAttribute('href'))
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                })
            }
        })
    })

    // Автоматическое скрытие уведомлений
    document.querySelectorAll('.alert').forEach(alert => {
        setTimeout(() => {
            alert.style.opacity = '0'
            setTimeout(() => {
                alert.remove()
            }, 300)
        }, 5000)
    })

    // Добавление анимации загрузки для кнопок при отправке форм
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', function() {
            const button = this.querySelector('button[type="submit"]')
            if (button) {
                button.disabled = true
                button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Загрузка...'
            }
        })
    })
}); 