from flask import Flask, render_template, jsonify, request, flash, redirect, url_for, make_response, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from flask_mail import Mail, Message
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv
from functools import wraps
from flask import after_this_request
import gzip
import io

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///services.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Mail settings
app.config['MAIL_SERVER'] = os.getenv('MAIL_SERVER')
app.config['MAIL_PORT'] = int(os.getenv('MAIL_PORT', 587))
app.config['MAIL_USE_TLS'] = os.getenv('MAIL_USE_TLS', 'True') == 'True'
app.config['MAIL_USERNAME'] = os.getenv('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.getenv('MAIL_PASSWORD')

db = SQLAlchemy(app)
mail = Mail(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(20), default='user')  # user, moderator, admin
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    favorites = db.relationship('Favorite', backref='user', lazy=True)
    view_history = db.relationship('ViewHistory', backref='user', lazy=True)
    reviews = db.relationship('Review', backref='user', lazy=True)
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
        
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Service(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(50), nullable=False)
    subcategory = db.Column(db.String(50))
    tags = db.Column(db.String(200))  # Store tags as comma-separated string
    detailed_description = db.Column(db.Text)
    pricing_type = db.Column(db.String(20))  # 'free', 'paid', 'freemium'
    pricing = db.Column(db.Text)
    link = db.Column(db.String(200))
    rating = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=db.func.current_timestamp())
    favorites = db.relationship('Favorite', backref='service', lazy=True)
    views = db.relationship('ViewHistory', backref='service', lazy=True)
    reviews = db.relationship('Review', backref='service', lazy=True)

class Favorite(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    service_id = db.Column(db.Integer, db.ForeignKey('service.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class ViewHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True) 
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    service_id = db.Column(db.Integer, db.ForeignKey('service.id'), nullable=False)
    viewed_at = db.Column(db.DateTime, default=datetime.utcnow)

class Review(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    service_id = db.Column(db.Integer, db.ForeignKey('service.id'), nullable=False)
    rating = db.Column(db.Float, nullable=False)
    comment = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

def send_reset_email(user):
    serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])
    token = serializer.dumps(user.email, salt='password-reset-salt')
    
    reset_url = url_for('reset_password', token=token, _external=True)
    msg = Message('Сброс пароля',
                  sender=app.config['MAIL_USERNAME'],
                  recipients=[user.email])
    msg.body = f'Для сброса пароля перейдите по ссылке: {reset_url}'
    mail.send(msg)

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        
        if User.query.filter_by(email=email).first():
            flash('Email уже зарегистрирован')
            return redirect(url_for('register'))
        
        user = User(email=email)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        
        login_user(user)
        return redirect(url_for('index'))
    
    return render_template('register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        user = User.query.filter_by(email=email).first()
        
        if user and user.check_password(password):
            login_user(user)
            return redirect(url_for('index'))
            
        flash('Неверный email или пароль')
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

@app.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    if request.method == 'POST':
        email = request.form.get('email')
        user = User.query.filter_by(email=email).first()
        
        if user:
            send_reset_email(user)
            flash('Инструкции по сбросу пароля отправлены на email')
            return redirect(url_for('login'))
            
        flash('Email не найден')
    return render_template('forgot_password.html')

@app.route('/reset-password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    try:
        serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])
        email = serializer.loads(token, salt='password-reset-salt', max_age=3600)
    except:
        flash('Ссылка для сброса пароля недействительна или устарела')
        return redirect(url_for('login'))
    
    if request.method == 'POST':
        user = User.query.filter_by(email=email).first()
        user.set_password(request.form.get('password'))
        db.session.commit()
        flash('Пароль успешно изменен')
        return redirect(url_for('login'))
        
    return render_template('reset_password.html')

@app.route('/service/<int:service_id>')
def get_service(service_id):
    service = Service.query.get_or_404(service_id)
    
    if current_user.is_authenticated:
        view = ViewHistory(user_id=current_user.id, service_id=service_id)
        db.session.add(view)
        db.session.commit()
    
    return jsonify({
        'title': service.title,
        'description': service.description,
        'detailed_description': service.detailed_description,
        'pricing': service.pricing,
        'link': service.link,
        'rating': service.rating,
        'is_favorite': bool(current_user.is_authenticated and 
            Favorite.query.filter_by(
                user_id=current_user.id, 
                service_id=service_id
            ).first())
    })

# Декоратор для кэширования
def cache_control(max_age=3600):
    def decorator(view_function):
        @wraps(view_function)
        def wrapped_function(*args, **kwargs):
            response = make_response(view_function(*args, **kwargs))
            response.headers['Cache-Control'] = f'public, max-age={max_age}'
            response.headers['Expires'] = (datetime.utcnow() + timedelta(seconds=max_age))\
                .strftime('%a, %d %b %Y %H:%M:%S GMT')
            return response
        return wrapped_function
    return decorator

# Применяем кэширование к API эндпоинтам
@app.route('/api/services')
@cache_control(max_age=300)  # Кэш на 5 минут
def get_services():
    category = request.args.get('category')
    subcategory = request.args.get('subcategory')
    pricing_type = request.args.get('pricing_type')
    min_rating = request.args.get('min_rating', type=float)
    sort_by = request.args.get('sort_by', 'created_at')
    search = request.args.get('search', '').lower()

    query = Service.query

    if category:
        query = query.filter_by(category=category)
    if subcategory:
        query = query.filter_by(subcategory=subcategory)
    if pricing_type:
        query = query.filter_by(pricing_type=pricing_type)
    if min_rating:
        query = query.filter(Service.rating >= min_rating)
    if search:
        query = query.filter(
            db.or_(
                Service.title.ilike(f'%{search}%'),
                Service.description.ilike(f'%{search}%'),
                Service.tags.ilike(f'%{search}%')
            )
        )

    if sort_by == 'rating':
        query = query.order_by(Service.rating.desc())
    elif sort_by == 'created_at':
        query = query.order_by(Service.created_at.desc())

    services = query.all()
    return jsonify([{
        'id': s.id,
        'title': s.title,
        'description': s.description,
        'category': s.category,
        'subcategory': s.subcategory,
        'tags': s.tags.split(',') if s.tags else [],
        'pricing_type': s.pricing_type,
        'rating': s.rating,
        'created_at': s.created_at.isoformat()
    } for s in services])

@app.route('/static/<path:filename>')
@cache_control(max_age=86400)  # Кэш на 24 часа
def serve_static(filename):
    return send_from_directory('static', filename)

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or current_user.role != 'admin':
            flash('Доступ запрещен. Требуются права администратора.')
            return redirect(url_for('index'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/admin')
@login_required
@admin_required
def admin_dashboard():
    users = User.query.all()
    services = Service.query.all()
    return render_template('admin/dashboard.html', users=users, services=services)

@app.route('/admin/users')
@login_required
@admin_required
def admin_users():
    users = User.query.all()
    return render_template('admin/users.html', users=users)

@app.route('/admin/users/<int:user_id>', methods=['POST'])
@login_required
@admin_required
def update_user_role(user_id):
    user = User.query.get_or_404(user_id)
    new_role = request.form.get('role')
    if new_role in ['user', 'moderator', 'admin']:
        user.role = new_role
        db.session.commit()
        flash('Роль пользователя обновлена')
    return redirect(url_for('admin_users'))

@app.route('/admin/services')
@login_required
@admin_required
def admin_services():
    services = Service.query.all()
    return render_template('admin/services.html', services=services)

@app.route('/admin/services/new', methods=['GET', 'POST'])
@login_required
@admin_required
def add_service():
    if request.method == 'POST':
        service = Service(
            title=request.form.get('title'),
            description=request.form.get('description'),
            category=request.form.get('category'),
            subcategory=request.form.get('subcategory'),
            tags=request.form.get('tags'),
            detailed_description=request.form.get('detailed_description'),
            pricing_type=request.form.get('pricing_type'),
            pricing=request.form.get('pricing'),
            link=request.form.get('link'),
            rating=float(request.form.get('rating', 0))
        )
        db.session.add(service)
        db.session.commit()
        flash('Сервис успешно добавлен')
        return redirect(url_for('admin_services'))
    return render_template('admin/service_form.html')

@app.route('/admin/services/<int:service_id>/edit', methods=['GET', 'POST'])
@login_required
@admin_required
def edit_service(service_id):
    service = Service.query.get_or_404(service_id)
    if request.method == 'POST':
        service.title = request.form.get('title')
        service.description = request.form.get('description')
        service.category = request.form.get('category')
        service.subcategory = request.form.get('subcategory')
        service.tags = request.form.get('tags')
        service.detailed_description = request.form.get('detailed_description')
        service.pricing_type = request.form.get('pricing_type')
        service.pricing = request.form.get('pricing')
        service.link = request.form.get('link')
        service.rating = float(request.form.get('rating', 0))
        db.session.commit()
        flash('Сервис успешно обновлен')
        return redirect(url_for('admin_services'))
    return render_template('admin/service_form.html', service=service)

@app.route('/admin/services/<int:service_id>/delete', methods=['POST'])
@login_required
@admin_required
def delete_service(service_id):
    service = Service.query.get_or_404(service_id)
    db.session.delete(service)
    db.session.commit()
    flash('Сервис успешно удален')
    return redirect(url_for('admin_services'))

@app.route('/api/favorites/<int:service_id>', methods=['POST', 'DELETE'])
@login_required
def toggle_favorite(service_id):
    service = Service.query.get_or_404(service_id)
    favorite = Favorite.query.filter_by(user_id=current_user.id, service_id=service_id).first()
    
    if request.method == 'POST' and not favorite:
        favorite = Favorite(user_id=current_user.id, service_id=service_id)
        db.session.add(favorite)
        db.session.commit()
        return jsonify({'status': 'added'})
    elif request.method == 'DELETE' and favorite:
        db.session.delete(favorite)
        db.session.commit()
        return jsonify({'status': 'removed'})
    
    return jsonify({'error': 'Invalid request'}), 400

@app.route('/api/reviews/<int:service_id>', methods=['POST'])
@login_required
def add_review(service_id):
    service = Service.query.get_or_404(service_id)
    data = request.get_json()
    
    existing_review = Review.query.filter_by(
        user_id=current_user.id, 
        service_id=service_id
    ).first()
    
    if existing_review:
        existing_review.rating = data['rating']
        existing_review.comment = data.get('comment', '')
    else:
        review = Review(
            user_id=current_user.id,
            service_id=service_id,
            rating=data['rating'],
            comment=data.get('comment', '')
        )
        db.session.add(review)
    
    # Update service average rating
    service_reviews = Review.query.filter_by(service_id=service_id).all()
    if service_reviews:
        service.rating = sum(r.rating for r in service_reviews) / len(service_reviews)
    
    db.session.commit()
    return jsonify({'status': 'success'})

@app.route('/api/reviews/<int:service_id>', methods=['GET'])
def get_reviews(service_id):
    reviews = Review.query.filter_by(service_id=service_id).order_by(Review.created_at.desc()).all()
    return jsonify([{
        'id': r.id,
        'user_email': r.user.email,
        'rating': r.rating,
        'comment': r.comment,
        'created_at': r.created_at.isoformat()
    } for r in reviews])

@app.route('/user/favorites')
@login_required
def user_favorites():
    favorites = Favorite.query.filter_by(user_id=current_user.id).all()
    return render_template('user/favorites.html', favorites=favorites)

@app.route('/user/history')
@login_required
def user_history():
    history = ViewHistory.query.filter_by(user_id=current_user.id)\
        .order_by(ViewHistory.viewed_at.desc()).all()
    return render_template('user/history.html', history=history)

@app.route('/profile', methods=['GET', 'POST'])
@login_required
def profile():
    if request.method == 'POST':
        # Проверка текущего пароля
        if not current_user.check_password(request.form.get('current_password')):
            flash('Неверный текущий пароль')
            return redirect(url_for('profile'))
        
        # Обновление пароля
        if request.form.get('new_password'):
            current_user.set_password(request.form.get('new_password'))
            flash('Пароль успешно обновлен')
        
        # Обновление email
        new_email = request.form.get('email')
        if new_email and new_email != current_user.email:
            if User.query.filter_by(email=new_email).first():
                flash('Этот email уже используется')
                return redirect(url_for('profile'))
            current_user.email = new_email
            flash('Email успешно обновлен')
        
        db.session.commit()
        return redirect(url_for('profile'))
    
    # Получаем статистику
    favorites_count = Favorite.query.filter_by(user_id=current_user.id).count()
    reviews_count = Review.query.filter_by(user_id=current_user.id).count()
    recent_views = ViewHistory.query.filter_by(user_id=current_user.id)\
        .order_by(ViewHistory.viewed_at.desc())\
        .limit(5)\
        .all()
    
    return render_template('user/profile.html',
                         favorites_count=favorites_count,
                         reviews_count=reviews_count,
                         recent_views=recent_views)

# Добавляем Gzip компрессию
def gzipped(f):
    @wraps(f)
    def view_func(*args, **kwargs):
        @after_this_request
        def zipper(response):
            accept_encoding = request.headers.get('Accept-Encoding', '')
            
            if 'gzip' not in accept_encoding.lower():
                return response
            
            response.direct_passthrough = False
            
            if (response.status_code < 200 or
                response.status_code >= 300 or
                'Content-Encoding' in response.headers):
                return response
            
            gzip_buffer = io.BytesIO()
            gzip_file = gzip.GzipFile(mode='wb', fileobj=gzip_buffer)
            gzip_file.write(response.data)
            gzip_file.close()
            
            response.data = gzip_buffer.getvalue()
            response.headers['Content-Encoding'] = 'gzip'
            response.headers['Content-Length'] = len(response.data)
            
            return response
        return f(*args, **kwargs)
    return view_func

# Применяем Gzip к тяжелым ответам
@app.route('/')
@gzipped
def index():
    services = Service.query.all()
    categories = db.session.query(Service.category).distinct()
    return render_template('index.html', services=services, categories=categories)

if __name__ == '__main__':
    with app.app_context():
        # Delete existing database file
        if os.path.exists('services.db'):
            os.remove('services.db')
        
        # Drop all tables and create new ones
        db.drop_all()
        db.create_all()
        
        # Add some sample data
        sample_services = [
            Service(
                title='ChatGPT',
                description='Мощный разговорный AI-ассистент',
                category='Чат-боты',
                subcategory='Общение',
                tags='ai,chat,gpt',
                detailed_description='Продвинутый AI-ассистент для общения и решения задач',
                pricing_type='freemium',
                pricing='Базовый: Бесплатно\nPlus: $20/мес',
                link='https://chat.openai.com',
                rating=4.8
            ),
            Service(
                title='Midjourney',
                description='Генерация изображений по текстовому описанию',
                category='Генерация изображений',
                subcategory='Арт',
                tags='ai,images,art',
                detailed_description='AI-сервис для создания высококачественных изображений',
                pricing_type='paid',
                pricing='Basic: $10/мес\nPro: $30/мес',
                link='https://midjourney.com',
                rating=4.9
            )
        ]
        
        for service in sample_services:
            db.session.add(service)
        
        try:
            db.session.commit()
            print("Database initialized successfully!")
        except Exception as e:
            db.session.rollback()
            print(f"Error initializing database: {e}")
            raise
        
        # Create admin user if doesn't exist
        admin_email = os.getenv('ADMIN_EMAIL')
        admin_password = os.getenv('ADMIN_PASSWORD')
        
        admin = User.query.filter_by(email=admin_email).first()
        if not admin:
            admin = User(email=admin_email, role='admin')
            admin.set_password(admin_password)
            db.session.add(admin)
            db.session.commit()
        
    app.run(debug=True) 