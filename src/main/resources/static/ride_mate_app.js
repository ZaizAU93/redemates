'use strict';

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();


const BOT_USERNAME = 'ridemates_bot';
// ---------- ТЕСТОВЫЙ РЕЖИМ (обычный браузер без Telegram) ----------
const TEST_USERS = [
    { id: 111111, name: 'Вася — водитель', firstName: 'Вася' },
    { id: 222222, name: 'Мария — пассажир', firstName: 'Мария' }
];
let tgInitData = tg.initData || '';
let isTestMode = !(tg.initData && tg.initData.length > 0);
let subscribeRadiusKm = 5
let createMode = 'ride'; // 'ride' или 'subscribe'
// Глобальная валюта пользователя (обновляется при registerUser)
let userCurrency = 'BYN';

const CURRENCY_SYMBOLS = {
    'BYN': 'BYN',
    'RUB': '₽',
    'KZT': '₸',
    'UZS': 'сум',
    'USD': '$'
};

function formatPrice(amount) {
    if (amount == null) return '';
    const symbol = CURRENCY_SYMBOLS[userCurrency] || userCurrency;
    // Для узбекского сума и тенге округляем до целых, для остальных — как есть
    const formatted = ['UZS', 'KZT'].includes(userCurrency)
        ? Math.round(amount).toLocaleString('ru-RU')
        : amount.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return `${formatted} ${symbol}`;
}

function switchTestUser(id) {
    const url = new URL(location.href);
    url.searchParams.set('as', id);
    location.href = url.toString();
}

function ensureTestPanel(activeId) {
    if (document.getElementById('testPanel')) return;
    const panel = document.createElement('div');
    panel.id = 'testPanel';
    panel.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2000;background:#1e1e1e;color:#fff;padding:6px 10px;font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
    panel.innerHTML = '<strong>ТЕСТ:</strong><span style="opacity:.7;">активен: ' + (activeId || '—') + '</span>';
    TEST_USERS.forEach(u => {
        const b = document.createElement('button');
        b.textContent = u.name;
        b.style.cssText = 'background:#0088cc;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;'
            + (String(u.id) === String(activeId) ? 'outline:2px solid #ffc107;' : '');
        b.onclick = () => switchTestUser(u.id);
        panel.appendChild(b);
    });
    const seedBtn = document.createElement('button');
    seedBtn.textContent = '🧪 Засеять данные';
    seedBtn.style.cssText = 'background:#4CAF50;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;';
    seedBtn.onclick = async () => {
        const r = await fetch('/debug/seed');
        if (r.ok) showMessage('Тестовые данные созданы', 'Готово');
    };
    panel.appendChild(seedBtn);
    const resetBtn = document.createElement('button');
    resetBtn.textContent = '✕ Выйти из теста';
    resetBtn.style.cssText = 'background:#666;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;';
    resetBtn.onclick = () => {
        localStorage.removeItem('ridemateTestUser');
        const url = new URL(location.href);
        url.searchParams.delete('as');
        location.href = url.toString();
    };
    panel.appendChild(resetBtn);
    document.body.prepend(panel);
    document.body.style.paddingTop = '44px';
}

// ---------- Состояние ----------

let currentUser = null;
let selectedFrom = null;
let selectedTo = null;
let currentRideId = null;
let selectedRating = 0;
let reviewTargetTelegramId = null;
let reviewRideRequestId = null;
let currentMatchId = null;
let currentPeerName = 'Собеседник';
let chatPollingInterval = null;
let unreadPollingInterval = null;
let currentRidesTab = 'myRides';
let showAllRides = true;

let map = null;
let tempMarker = null;
let selectedMapPoint = null;
let choosingFor = null;

let mainMap = null;
let mainMapLayers = [];
let userLocation = null;
let userMarker = null;
let accuracyCircle = null;

let waypoints = [];
let waypointSearchResult = null;
let searchRadiusKm = 10;
let editingRideId = null;

// Уведомления об откликах
let respondedRideIds = new Set();
let lastPendingCount = null;
let lastConfirmingCount = null;
let rideMarkers = []; // массив маркеров чужих заявок

// ---------- Утилиты ----------

function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function showMessage(message, title = 'Информация') {
    // В тест-режиме (браузер) tg.showPopup молча не работает → используем alert
    if (isTestMode || !window.Telegram?.WebApp?.showPopup) {
        alert(message);
        return;
    }
    try {
        window.Telegram.WebApp.showPopup({ title, message });
    } catch (e) {
        alert(message);
    }
}

function roleEmoji(role) { return role === 'DRIVER' ? '🚗' : '🚶'; }
function translateMatchStatus(s) {
    const map = {
        PENDING: 'Ожидает', CONFIRMING: 'Ждёт подтв.', CONFIRMED: 'Подтв.',
        COMPLETED: 'Состоялась', NO_SHOW_PASSENGER: 'Пасс. не пришёл',
        NO_SHOW_DRIVER: 'Вод. не выехал', DISPUTED: 'Спор', REJECTED: 'Отклонено'
    };
    return map[s] || s;
}

function translateRideStatus(s) {
    const map = {
        ACTIVE: 'Активна', MATCHED: 'Есть бронь',
        COMPLETED: 'Завершена', CANCELLED: 'Отменена', EXPIRED: 'Истекла'
    };
    return map[s] || s;
}
function oppositeRole(role) { return role === 'PASSENGER' ? 'DRIVER' : 'PASSENGER'; }

// Цветовая индикация статусов
const STATUS_COLORS = {
    'ACTIVE': '#4CAF50',
    'MATCHED': '#2196F3',
    'COMPLETED': '#9E9E9E',
    'CANCELLED': '#F44336',
    'EXPIRED': '#FF9800',
    'PENDING': '#FF9800',
    'CONFIRMING': '#2196F3',
    'CONFIRMED': '#4CAF50',
    'REJECTED': '#F44336',
    'DISPUTED': '#9C27B0',
    'NO_SHOW_PASSENGER': '#F44336',
    'NO_SHOW_DRIVER': '#F44336'
};

// Группировка заявок по статусам
function groupRidesByStatus(rides) {
    const groups = {
        active: rides.filter(r => r.status === 'ACTIVE' || r.status === 'MATCHED'),
        completed: rides.filter(r => r.status === 'COMPLETED'),
        cancelled: rides.filter(r => r.status === 'CANCELLED' || r.status === 'EXPIRED')
    };
    // Сортировка внутри групп: новые сверху
    Object.values(groups).forEach(g => g.sort((a, b) =>
        new Date(b.createdAt || b.departureTime) - new Date(a.createdAt || a.departureTime)
    ));
    return groups;
}

// Группировка откликов по статусам
function groupMatchesByStatus(matches) {
    const groups = {
        confirmed: matches.filter(m => m.status === 'CONFIRMED' || m.status === 'COMPLETED'),
        pending: matches.filter(m => m.status === 'PENDING' || m.status === 'CONFIRMING'),
        cancelled: matches.filter(m => m.status === 'REJECTED' || m.status === 'EXPIRED')
    };
    Object.values(groups).forEach(g => g.sort((a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt)
    ));
    return groups;
}

// Заголовок секции
function renderSectionHeader(title, count, color) {
    return `<h3 style="margin:16px 0 8px;font-size:15px;color:${color};display:flex;align-items:center;gap:6px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};"></span>
        ${title} <span style="color:var(--text-secondary);font-weight:400;">(${count})</span>
    </h3>`;
}

// ---------- Навигация ----------

function switchScreen(screenId) {
    if (!['profileScreen', 'responsesScreen'].includes(screenId)) {
        document.querySelector('.app-container').classList.remove('hide-header');
    }

    if (screenId !== 'chatsScreen') {
        document.querySelector('.app-container').classList.remove('chat-open');
    }

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-screen="${screenId}"]`);
    if (navItem) navItem.classList.add('active');
    if (screenId === 'mapScreen') { setTimeout(initMainMap, 100); loadSubscriptions(); }
    if (screenId === 'createScreen') onOpenCreateScreen();
   // if (screenId === 'myRidesScreen') switchRidesTab(currentRidesView);
    if (screenId === 'chatsScreen') {
        loadChats();
        document.getElementById('chatWindow').classList.add('hidden');
        document.getElementById('chatsListCard').classList.remove('hidden');
    }
    if (screenId === 'myRidesScreen') {
        document.getElementById('responsesScreen')?.classList.remove('active');
        switchRidesTab(currentRidesView);
    }
}

// ---------- Геолокация ----------

function requestUserLocation() {
    return new Promise((resolve) => {
        if (tg?.requestLocation) {
            const handler = (eventData) => {
                tg.offEvent('locationRequested', handler);
                if (eventData?.response?.location_available) {
                    resolve({ lat: eventData.response.location.latitude, lon: eventData.response.location.longitude });
                } else resolve(null);
            };
            tg.onEvent('locationRequested', handler);
            tg.requestLocation();
        } else if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
                () => resolve(null)
            );
        } else resolve(null);
    });
}

function updateUserMarker(lat, lon, accuracy, flyTo) {
    // Удаляем только маркер пользователя, если он есть
    if (userMarker) {
        mainMap.removeLayer(userMarker);
        userMarker = null;
    }

    userMarker = L.circleMarker([lat, lon], {
        radius: 8,
        color: '#1976d2',
        fillColor: '#2196f3',
        fillOpacity: 0.9,
        weight: 3
    }).addTo(mainMap).bindPopup('📍 Вы здесь');

    // Круг точности (если accuracy передан)
    if (accuracy) {
        L.circle([lat, lon], {
            radius: accuracy,
            color: '#2196f3',
            weight: 1,
            fillOpacity: 0.1
        }).addTo(mainMap);
    }

    if (flyTo) {
        mainMap.setView([lat, lon], 12);
    }
}

// ---------- Регистрация ----------

async function registerUser() {
    try {
        const resp = await fetch('/api/users/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tgInitData },
            body: JSON.stringify({})
        });
        if (!resp.ok) throw new Error(await resp.text());
        currentUser = await resp.json();

        if (!currentUser.chatId) {
            // НЕ показываем при входе. Только обновляем статус в профиле.
            try { updateNotifyBannerState(); } catch (e) { console.warn(e); }
        } else {
            // chatId есть — скрываем баннер, если он был
            document.getElementById('notifyBanner')?.classList.add('hidden');
        }



        userCurrency = currentUser.currency || 'BYN';
        updatePricePlaceholder();

        let greeting = `Привет, ${escapeHtml(currentUser.firstName || 'друг')}!`;
        if (currentUser.rating) greeting += ` <small>⭐ ${escapeHtml(currentUser.rating.toFixed(1))}</small>`;
        document.getElementById('greetingText').innerHTML = greeting;
        applyRole(currentUser.role);
    } catch (e) {
        showMessage(e.message, 'Ошибка');
    }
}

function applyRole(role) {
    const banner = document.getElementById('roleBanner');
    if (!role) { banner.classList.remove('hidden'); return; }
    banner.classList.add('hidden');
    showRoleBadge(role);
    const isDriver = role === 'DRIVER';
    document.getElementById('availableSeatsField').classList.toggle('hidden', !isDriver);
    document.getElementById('priceField').classList.toggle('hidden', !isDriver);
    document.getElementById('timeFlexibilityField').classList.toggle('hidden', !isDriver);
    document.getElementById('waypointsField').classList.toggle('hidden', !isDriver);
    document.getElementById('seatsLabel').textContent = isDriver ? 'Количество мест в машине (информация)' : 'Количество пассажиров';
}

function showRoleBadge(role) {
    const badge = document.getElementById('roleBadge');
    badge.classList.remove('hidden');
    if (role === 'PASSENGER') { badge.textContent = '🚶 Пассажир'; badge.className = 'role-badge passenger'; }
    else { badge.textContent = '🚗 Водитель'; badge.className = 'role-badge driver'; }
}

async function selectRole(role) {
    const resp = await fetch('/api/users/role', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tgInitData },
        body: JSON.stringify({ role })
    });
    if (resp.ok) {
        currentUser = await resp.json();
        applyRole(role);
        loadNearbyRides();
    } else {
        showMessage(await resp.text(), 'Ошибка');
    }
}

// ---------- Карта ----------

function initMainMap() {
    if (mainMap) { mainMap.invalidateSize(); loadNearbyRides(); return; }
    mainMap = L.map('mainMap', { center: [53.9, 27.56], zoom: 10, attributionControl: true });
    mainMap.attributionControl.setPrefix(false);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(mainMap);

    const LocateControl = L.Control.extend({
        options: { position: 'bottomright' },
        onAdd: function () {
            const btn = L.DomUtil.create('button', 'locate-btn');
            btn.innerHTML = '📍';
            btn.style.cssText = 'width:44px;height:44px;border-radius:50%;border:none;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-size:20px;cursor:pointer;z-index:1000;';
            L.DomEvent.on(btn, 'click', function (e) {
                L.DomEvent.stop(e);
                if (userLocation) {
                    updateUserMarker(userLocation.lat, userLocation.lon, 50, false);
                    mainMap.setView([userLocation.lat, userLocation.lon], 12);
                    loadNearbyRides();
                } else {
                    requestUserLocation().then(loc => {
                        if (loc) {
                            userLocation = loc;
                            updateUserMarker(loc.lat, loc.lon, 50, true);
                            loadNearbyRides();
                        } else {
                            showMessage('Не удалось получить местоположение', 'Ошибка');
                        }
                    });
                }
            });
            return btn;
        }
    });
    new LocateControl().addTo(mainMap);

    requestUserLocation().then(loc => {
        if (loc) {
            userLocation = loc;
            updateUserMarker(loc.lat, loc.lon, 50, true);
            loadNearbyRides();
        }
    });
}

async function loadNearbyRides() {
    const list = document.getElementById('mapRideList');
    if (!userLocation) {
        if (list) list.innerHTML = '<p class="muted" style="text-align:center;padding:12px;">📍 Геолокация не определена. Нажмите 📍 на карте.</p>';
        return;
    }
    const radius = searchRadiusKm * 1000;
    const resp = await fetch(`/api/rides/nearby?lat=${userLocation.lat}&lon=${userLocation.lon}&radius=${radius}`, {
        headers: { 'X-Telegram-Init-Data': tgInitData }
    });
    if (!resp.ok) {
        console.warn('Не удалось загрузить поездки рядом:', resp.status);
        if (list) list.innerHTML = '<p class="muted" style="text-align:center;padding:12px;">❌ Не удалось загрузить поездки</p>';
        return;
    }
    const rides = await resp.json();

    // Маркеры рисуем ВСЕГДА
    drawRideMarkers(rides);

    if (!list) return; // списка в HTML нет — ограничиваемся маркерами
    list.innerHTML = '';

    const hint = document.getElementById('mapRadiusHint');
    if (hint) hint.textContent = searchRadiusKm;

    if (rides.length === 0) {
        list.innerHTML = `
            <div style="text-align:center;padding:20px;">
                <div style="font-size:48px;margin-bottom:12px;">🔍</div>
                <div style="font-weight:600;margin-bottom:8px;">Рядом никого нет</div>
                <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">
                    В радиусе ${searchRadiusKm} км нет активных попутчиков.<br>
                    Создайте заявку или подпишитесь на маршрут.
                </div>
                <button class="btn btn-sm" style="margin-top:12px;" onclick="switchScreen('createScreen')">Создать заявку</button>
            </div>`;
        return;
    }

    rides.forEach(ride => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;cursor:pointer;';
        item.onclick = () => {
            mainMap.flyTo([ride.fromLat, ride.fromLon], 14);
            const m = rideMarkers.find(mk => {
                const ll = mk.getLatLng();
                return ll.lat === ride.fromLat && ll.lng === ride.fromLon;
            });
            if (m) m.openPopup();
        };
        const roleIcon = ride.role === 'DRIVER' ? '🚗' : '🚶';
        const timeStr = ride.departureTime ? new Date(ride.departureTime).toLocaleString('ru-RU') : '—';
        item.innerHTML = `
            <div style="font-weight:600;margin-bottom:4px;">${roleIcon} ${ride.role === 'DRIVER' ? 'Водитель' : 'Пассажир'}</div>
            <div style="font-size:13px;margin-bottom:4px;">
                ${ride.fromAddress || `${ride.fromLat.toFixed(4)}, ${ride.fromLon.toFixed(4)}`} → 
                ${ride.toAddress || `${ride.toLat.toFixed(4)}, ${ride.toLon.toFixed(4)}`}
            </div>
            <div style="font-size:12px;color:var(--text-secondary);">
                🕒 ${timeStr} · Мест: ${ride.availableSeats || ride.passengerCount || '?'}
            </div>`;
        list.appendChild(item);
    });
}

// Функция отклика из карты
async function respondToRideFromMap(rideId) {
    // Закрываем попап
    mainMap.closePopup();
    // Переходим к отклику
    await respondToRide(rideId);
}




function renderMapRides(rides) {
    const list = document.getElementById('mapRideList');
    // Сначала чистим список и служебные надписи — иначе карточки накапливаются при каждом обновлении
    list.innerHTML = '';
    mainMapLayers.forEach(l => mainMap.removeLayer(l));
    mainMapLayers = [];

    // Один пользователь — одна активная заявка: дедуп по человеку на случай дублей с бэкенда
    const seen = new Set();
    const unique = (rides || []).filter(r => {
        const key = r.userTelegramId ?? r.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    if (unique.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                Пока нет поездок рядом с вами.<br>
                Создайте заявку — мы предупредим, когда кто-то поедет по вашему маршруту.
                <button class="btn btn-sm" onclick="switchScreen('createScreen')">Создать заявку</button>
            </div>`;
        return;
    }

    unique.forEach(ride => {
        const marker = L.marker([ride.fromLat, ride.fromLon]).addTo(mainMap);
        marker.bindPopup(`<b>${roleEmoji(ride.role)} ${escapeHtml(ride.userName)}</b><br>Совпадение: ${Math.round(ride.score)}%`);
        mainMapLayers.push(marker);

        const card = document.createElement('div');
        card.className = 'ride-card';
        card.innerHTML = `
            <div class="ride-header">
                <span class="role-icon">${roleEmoji(ride.role)}</span>
                <span class="role-name">${escapeHtml(ride.userName)}</span>
                <span class="ride-score">🔥 ${Math.round(ride.score)}%</span>
            </div>
            <div class="time">${ride.departureTime ? escapeHtml(new Date(ride.departureTime).toLocaleString()) : 'Время не указано'}${ride.availableSeats ? ` · мест: ${ride.availableSeats}` : ''}</div>
            ${ride.pricePerSeat ? `<div class="details">💰 ${formatPrice(ride.pricePerSeat)}</div>` : ''}
            ${ride.note ? `<div class="details">${escapeHtml(ride.note)}</div>` : ''}
            <div class="score-bar"><i style="width:${Math.min(100, Math.round(ride.score))}%"></i></div>
        `;

        const respondBtn = document.createElement('button');
        if (respondedRideIds.has(ride.id)) {
            respondBtn.className = 'btn btn-sm btn-secondary';
            respondBtn.textContent = 'Отправлено ✓';
            respondBtn.disabled = true;
        } else {
            respondBtn.className = 'btn btn-sm';
            respondBtn.textContent = 'Откликнуться';
            respondBtn.onclick = () => respondToRide(ride.id, respondBtn, ride);
        }
        card.appendChild(respondBtn);
        const detailsBtn = document.createElement('button');
        detailsBtn.className = 'btn btn-sm btn-secondary';
        detailsBtn.textContent = 'ℹ️ Детали';
        detailsBtn.onclick = () => openRideDetails(ride.id);
        card.appendChild(detailsBtn);
        list.appendChild(card);
    });

    if (mainMapLayers.length > 0) {
        mainMap.fitBounds(L.featureGroup(mainMapLayers).getBounds().pad(0.2), { maxZoom: 13 });
    }
}




// ---------- Геокодинг ----------

async function searchPlace(type) {
    const input = type === 'from' ? document.getElementById('fromInput') : document.getElementById('toInput');
    const resultsDiv = type === 'from' ? document.getElementById('fromResults') : document.getElementById('toResults');
    const query = input.value.trim();
    if (!query) return;
    resultsDiv.innerHTML = '';
    const resp = await fetch(`/api/geocoding?q=${encodeURIComponent(query)}`);
    const places = await resp.json();
    if (places.length === 0) { resultsDiv.innerHTML = '<p>Ничего не найдено</p>'; return; }
    places.forEach(place => {
        const item = document.createElement('div');
        item.className = 'search-item';
        item.innerHTML = `<div class="place-name">${escapeHtml(place.displayName)}</div>`;
        item.onclick = () => { assignPlace(type, place); resultsDiv.innerHTML = ''; };
        resultsDiv.appendChild(item);
    });
}

/* function assignPlace(type, place) {
    if (type === 'from') selectedFrom = place;
    if (type === 'to') selectedTo = place;
    const inp = document.getElementById(type === 'from' ? 'fromInput' : 'toInput');
    if (inp) inp.value = place.displayName;
    const disp = document.getElementById(type === 'from' ? 'fromDisplay' : 'toDisplay');
    if (disp) { disp.textContent = place.displayName; disp.className = 'route-value'; }

    // 🔥 Проверяем, есть ли уже подписка на этот маршрут
    if (createMode === 'subscribe') {
        checkExistingSubscription();
    }
} */

//------------------------
// ---------- Пикер адреса ----------

let pickerType = null;
let pickerDebounceTimer = null;

function openAddressPicker(type) {
    pickerType = type;
    document.getElementById('pickerTitle').textContent = type === 'from' ? 'Откуда поедем?' : 'Куда поедем?';
    document.getElementById('addressPickerModal').classList.add('active');
    const input = document.getElementById('pickerSearchInput');
    input.value = '';
    renderPickerStatic();
    setTimeout(() => input.focus(), 100);
}

function closeAddressPicker() {
    document.getElementById('addressPickerModal').classList.remove('active');
    pickerType = null;
}

function renderPickerStatic() {
    const box = document.getElementById('pickerResults');
    let html = '';
    if (pickerType === 'from') {
        html += `
            <div class="search-item" onclick="pickerUseMyLocation()">
                <div class="place-name">📍 Моё местоположение</div>
            </div>`;
    }
    html += `
        <div class="search-item" onclick="openAddressPickerMap()">
            <div class="place-name">🗺️ Выбрать на карте</div>
        </div>`;
    box.innerHTML = html;
}

function renderPickerResults(places) {
    const box = document.getElementById('pickerResults');
    let html = '';
    if (pickerType === 'from') {
        html += `
            <div class="search-item" onclick="pickerUseMyLocation()">
                <div class="place-name">📍 Моё местоположение</div>
            </div>`;
    }
    if (places.length === 0) {
        html += '<p style="font-size:14px;color:var(--text-secondary);padding:8px 4px;">Ничего не найдено</p>';
    } else {
        places.forEach(place => {
            html += `
                <div class="search-item" onclick='pickPlace(${JSON.stringify(place).replaceAll("'", "&#039;")})'>
                    <div class="place-name">${escapeHtml(place.displayName)}</div>
                </div>`;
        });
    }
    html += `
        <div class="search-item" onclick="openAddressPickerMap()">
            <div class="place-name">🗺️ Выбрать на карте</div>
        </div>`;
    box.innerHTML = html;
}

async function pickerSearch() {
    const query = document.getElementById('pickerSearchInput').value.trim();
    if (!query) { renderPickerStatic(); return; }
    try {
        const resp = await fetch(`/api/geocoding?q=${encodeURIComponent(query)}`);
        renderPickerResults(await resp.json());
    } catch (e) {
        renderPickerResults([]);
    }
}

function pickPlace(place) {
    assignPlace(pickerType, place);
    closeAddressPicker();
}

async function pickerUseMyLocation() {
    const loc = await requestUserLocation();
    if (!loc) { showMessage('Не удалось получить местоположение', 'Ошибка'); return; }
    userLocation = loc;
    let name = `Моё местоположение (${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)})`;
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${loc.lat}&lon=${loc.lon}&format=json&accept-language=ru`);
        const data = await r.json();
        if (data?.display_name) name = data.display_name;
    } catch (e) { /* остаётся запасное имя */ }
    assignPlace(pickerType, { displayName: name, latitude: loc.lat, longitude: loc.lon });
    closeAddressPicker();
}

function openAddressPickerMap() {
    const type = pickerType;
    closeAddressPicker();
    openMapModal(type);
}



async function useMyLocationAsFrom() {
    const loc = await requestUserLocation();
    if (!loc) { showMessage('Не удалось получить местоположение', 'Ошибка'); return; }
    userLocation = loc;
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${loc.lat}&lon=${loc.lon}&format=json&accept-language=ru`);
        const data = await r.json();
        const name = data?.display_name || `Моё местоположение (${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)})`;
        assignPlace('from', { displayName: name, latitude: loc.lat, longitude: loc.lon });
    } catch (e) {
        assignPlace('from', { displayName: `Моё местоположение (${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)})`, latitude: loc.lat, longitude: loc.lon });
    }
}

// ---------- Быстрое время ----------

function toLocalISO(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setQuickTime(kind) {
    const el = document.getElementById('departureTimeInput');
    const now = new Date();

    if (kind === 'now') {
        // Добавляем 15 минут к текущему времени, чтобы успеть найти попутчика
        now.setMinutes(now.getMinutes() + 15);
        el.value = toLocalISO(now);
    }
    else if (kind === 'hour') { now.setHours(now.getHours() + 1); el.value = toLocalISO(now); }
    else if (kind === 'morning') { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); el.value = toLocalISO(d); }
    else if (kind === 'evening') { const d = new Date(now); if (now.getHours() >= 19) d.setDate(d.getDate() + 1); d.setHours(19, 0, 0, 0); el.value = toLocalISO(d); }
    else if (kind === 'custom') { el.showPicker?.(); el.focus(); }
    highlightChip(kind);
}

function highlightChip(kind) {
    document.querySelectorAll('#timeChips .time-chip').forEach(c => c.classList.remove('active'));
    if (kind) {
        const chip = document.querySelector(`#timeChips .time-chip[onclick*="'${kind}'"]`);
        if (chip) chip.classList.add('active');
    }
}

function setRadius(km) {
    searchRadiusKm = km;
    document.querySelectorAll('#radiusChips .time-chip').forEach(c =>
        c.classList.toggle('active', parseInt(c.dataset.km) === km));
}

function markChips(containerId, chipEl) {
    document.querySelectorAll(`#${containerId} .time-chip`).forEach(c => c.classList.remove('active'));
    if (chipEl) chipEl.classList.add('active');
}

function setPassengerCount(n, chip) {
    document.getElementById('passengerCountSelect').value = String(n);
    markChips('passengerCountChips', chip);
}

function setAvailableSeats(n, chip) {
    document.getElementById('availableSeatsSelect').value = String(n);
    markChips('availableSeatsChips', chip);
}

function setPriceChip(mode, chip) {
    const input = document.getElementById('priceInput');
    if (mode === 'custom') {
        input.classList.remove('hidden');
        input.focus();
    } else {
        input.classList.add('hidden');
        input.value = mode === 'free' ? '' : mode;
    }
    markChips('priceChips', chip);
}


function onOpenCreateScreen() {
    if (!selectedFrom) useMyLocationAsFrom();
    loadActiveRide();
    searchMatchesForActiveRide();
}

// ---------- Промежуточные точки ----------

async function searchWaypoint() {
    const query = document.getElementById('waypointInput').value.trim();
    if (!query) return;
    const resp = await fetch(`/api/geocoding?q=${encodeURIComponent(query)}`);
    const places = await resp.json();
    const resultsDiv = document.getElementById('waypointResults');
    resultsDiv.innerHTML = '';

    if (places.length === 0) {
        resultsDiv.innerHTML = '<p style="font-size:13px; color:var(--text-secondary);">Ничего не найдено</p>';
        return;
    }

    places.slice(0, 5).forEach(place => {
        const item = document.createElement('div');
        item.className = 'search-item';
        item.innerHTML = `<div class="place-name">${escapeHtml(place.displayName)}</div>`;

        // ПРИ КЛИКЕ СРАЗУ ДОБАВЛЯЕМ В СПИСОК
        item.onclick = () => {
            document.getElementById('waypointInput').value = '';
            resultsDiv.innerHTML = '';
            addWaypoint(place); // Сразу вызываем добавление
        };
        resultsDiv.appendChild(item);
    });
}

function addWaypoint(place) {
    if (!place) place = waypointSearchResult;
    if (!place) { showMessage('Сначала найдите или выберите точку', 'Подсказка'); return; }
    if (waypoints.length >= 5) { showMessage('Максимум 5 промежуточных точек'); return; }
    waypoints.push(place);
    waypointSearchResult = null;
    document.getElementById('waypointInput').value = '';
    renderWaypoints();
}

function renderWaypoints() {
    const list = document.getElementById('waypointsList');
    list.innerHTML = '';
    waypoints.forEach((wp, i) => {
        const item = document.createElement('div');
        item.className = 'waypoint-item';
        item.innerHTML = `<span>📍 ${escapeHtml(wp.displayName)}</span>`;
        const del = document.createElement('button');
        del.textContent = '✕';
        del.onclick = () => { waypoints.splice(i, 1); renderWaypoints(); };
        item.appendChild(del);
        list.appendChild(item);
    });
}

// ---------- Создание / редактирование заявки ----------

async function createRideRequest() {
    if (!selectedFrom || !selectedTo) { showMessage('Выберите обе точки маршрута'); return; }
    if (!currentUser?.role) { showMessage('Сначала выберите роль'); return; }

    const departureTime = document.getElementById('departureTimeInput').value;
    if (!departureTime) { showMessage('Укажите время выезда'); return; }

    const passengerCount = parseInt(document.getElementById('passengerCountSelect').value);
    let availableSeats = null, timeFlexibility = 30, pricePerSeat = null;
    if (currentUser.role === 'DRIVER') {
        availableSeats = parseInt(document.getElementById('availableSeatsSelect').value);
        timeFlexibility = parseInt(document.getElementById('timeFlexibilitySelect').value);
        const priceVal = document.getElementById('priceInput').value;
        if (priceVal) {
            pricePerSeat = parseFloat(priceVal);
            if (isNaN(pricePerSeat) || pricePerSeat < 0) { showMessage('Цена должна быть числом не меньше нуля', 'Ошибка'); return; }
        }
    }
    const note = document.getElementById('noteInput').value.trim();

    const isEdit = !!editingRideId;
    const url = isEdit ? `/api/rides/${editingRideId}` : '/api/rides';
    const method = isEdit ? 'PUT' : 'POST';
    const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tgInitData },
        body: JSON.stringify({
            role: currentUser.role,
            fromLat: selectedFrom.latitude, fromLon: selectedFrom.longitude,
            toLat: selectedTo.latitude, toLon: selectedTo.longitude,
            departureTime, passengerCount, availableSeats, note,
            timeFlexibilityMinutes: timeFlexibility, pricePerSeat,
            waypoints: waypoints.map(wp => ({
                lat: wp.latitude,
                lon: wp.longitude,
                name: wp.displayName
            })),
            routeIndex: chosenRouteIndex ?? null
        })
    });
    if (resp.ok) {
        const created = await resp.json();
        currentRideId = created.id;
        editingRideId = null;
        document.getElementById('cancelEditBtn').classList.add('hidden');
        document.getElementById('createSubmitBtn').textContent = 'Создать и найти попутчиков';

        // 🔥 Компактный баннер вместо раздутой карточки
        loadActiveRide();

        // 🔥 Попутчики — только если реально есть
        searchMatches(
            selectedFrom.latitude, selectedFrom.longitude,
            selectedTo.latitude, selectedTo.longitude,
            departureTime, timeFlexibility, searchRadiusKm * 1000
        );

        clearAltRoutes();
        loadNearbyRides();

        // 🔥 Тост вместо старого баннера
        showToast('✅ Заявка создана. Уведомим, когда появится попутчик.', 'ok');
    } else {
        showMessage(await resp.text(), 'Ошибка');
    }
}


async function searchMatches(fromLat, fromLon, toLat, toLon, departureTime = null, flexibilityMinutes = 30, radius = 5000) {
    const listEl = document.getElementById('matchesList');
    const containerEl = document.getElementById('matchesBlock');
    const opposite = oppositeRole(currentUser.role);
    let url = `/api/rides/matches?role=${opposite}&fromLat=${fromLat}&fromLon=${fromLon}&toLat=${toLat}&toLon=${toLon}&fromRadiusMeters=${radius}&toRadiusMeters=${radius}&flexibilityMinutes=${flexibilityMinutes}&limit=10`;
    if (departureTime) url += `&departureTime=${encodeURIComponent(departureTime)}`;
    const resp = await fetch(url, { headers: { 'X-Telegram-Init-Data': tgInitData } });
    const matches = await resp.json();
    listEl.innerHTML = '';
    if (matches.length === 0) {
        containerEl.classList.add('hidden'); // не показываем пустой блок
        return;
    }
    containerEl.classList.remove('hidden');
    matches.forEach(match => {
        const card = document.createElement('div');
        card.className = 'match-item';
        let vehicleInfo = '';
        if (match.vehicleBrand) vehicleInfo = `<div class="details">🚗 ${escapeHtml(match.vehicleBrand)} ${escapeHtml(match.vehicleModel || '')}</div>`;
        card.innerHTML = `
            <strong>${roleEmoji(match.role)} ${escapeHtml(match.userName)}</strong>
            ${vehicleInfo}
            <div style="color:#ff6f00;font-weight:600;">🔥 Совпадение: ${Math.round(match.score)}%</div>
            <div class="time">${match.departureTime ? escapeHtml(new Date(match.departureTime).toLocaleString()) : 'Время не указано'}${match.availableSeats ? ` · мест: ${match.availableSeats}` : ''}</div>
            ${match.pricePerSeat ? `<div class="details">💰 ${formatPrice(match.pricePerSeat)}</div>` : ''}
            ${match.note ? `<div class="details">${escapeHtml(match.note)}</div>` : ''}
        `;
        const respondBtn = document.createElement('button');
        if (respondedRideIds.has(match.id)) {
            respondBtn.className = 'btn btn-sm btn-secondary';
            respondBtn.textContent = 'Отправлено ✓';
            respondBtn.disabled = true;
        } else {
            respondBtn.className = 'btn btn-sm';
            respondBtn.textContent = 'Откликнуться';
            respondBtn.onclick = () => respondToRide(match.id, respondBtn, match);
        }
        card.appendChild(respondBtn);
        const detailsBtn = document.createElement('button');
        detailsBtn.className = 'btn btn-sm btn-secondary';
        detailsBtn.textContent = 'ℹ️ Детали';
        detailsBtn.onclick = () => openRideDetails(match.id);
        card.appendChild(detailsBtn);
        const reportBtn = document.createElement('button');
        reportBtn.className = 'btn btn-sm btn-secondary';
        reportBtn.textContent = 'Пожаловаться';
        reportBtn.onclick = () => {
            const reason = prompt('Причина жалобы:');
            if (reason) {
                fetch('/api/safety/report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tgInitData },
                    body: JSON.stringify({ reportedTelegramId: match.userTelegramId, reason, details: '' })
                }).then(() => showMessage('Жалоба отправлена'));
            }
        };
        card.appendChild(reportBtn);
        listEl.appendChild(card);
    });
}

/** Поиск по активной заявке — для авто-запуска при открытии вкладки и кнопки «Обновить». */
async function searchMatchesForActiveRide() {
    const resp = await fetch('/api/rides/my?status=ACTIVE', { headers: { 'X-Telegram-Init-Data': tgInitData } });
    if (!resp.ok) return;
    const rides = await resp.json();
    if (rides.length === 0) return;
    const ride = rides[0];
    searchMatches(
        ride.fromLat, ride.fromLon,
        ride.toLat, ride.toLon,
        ride.departureTime,
        ride.timeFlexibilityMinutes || 30,
        searchRadiusKm * 1000
    );
}

async function respondToRide(rideId, btn, match = null) {
    let seatsParam = '';
    if (match && match.role === 'DRIVER' && match.availableSeats > 1) {
        const seats = prompt(`Сколько мест забронировать? (1–${match.availableSeats})`, '1');
        if (seats === null) return;
        const n = parseInt(seats);
        if (isNaN(n) || n < 1 || n > match.availableSeats) { showMessage(`Укажите число от 1 до ${match.availableSeats}`, 'Ошибка'); return; }
        seatsParam = `?seats=${n}`;
    }
    const resp = await fetch(`/api/matches/${rideId}/respond${seatsParam}`, {
        method: 'POST', headers: { 'X-Telegram-Init-Data': tgInitData }
    });
    if (resp.ok) {
        const result = await resp.json();
        showMessage(result.message || 'Запрос брони отправлен');
        respondedRideIds.add(rideId);
        if (btn) {
            btn.textContent = 'Отправлено ✓';
            btn.className = 'btn btn-sm btn-secondary';
            btn.disabled = true;
            showNotifyBanner();
        }
    } else {
        showMessage(await resp.text(), 'Ошибка');
    }
}

// ---------- Активная заявка: просмотр, редактирование, отмена ----------

async function loadActiveRide() {
    const resp = await fetch('/api/rides/my?status=ACTIVE', { headers: { 'X-Telegram-Init-Data': tgInitData } });
    if (!resp.ok) return;
    const rides = await resp.json();
    const banner = document.getElementById('activeRideBanner');
    if (!banner) return;

    if (rides.length === 0) {
        if (!editingRideId) banner.classList.add('hidden');
        return;
    }

    const ride = rides[0];
    currentRideId = ride.id;
    window.activeRideDepartureTime = ride.departureTime || null;
    window.activeRideFlexibility = ride.timeFlexibilityMinutes || 30;
    window.activeRideFrom = { latitude: ride.fromLat, longitude: ride.fromLon };
    window.activeRideTo = { latitude: ride.toLat, longitude: ride.toLon };

    // Одна строка: маршрут + время
    banner.classList.remove('hidden');
    document.getElementById('activeRideTitle').textContent =
        ride.role === 'DRIVER' ? '🚗 Водитель · активна' : '🚶 Пассажир · активна';
    document.getElementById('activeRideRoute').textContent =
        `${ride.fromLat.toFixed(3)}, ${ride.fromLon.toFixed(3)} → ${ride.toLat.toFixed(3)}, ${ride.toLon.toFixed(3)}`
        + (ride.departureTime ? ` · ${new Date(ride.departureTime).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}` : '');

    drawMyRoute();
}

function editActiveRide() {
    const resp = fetch('/api/rides/my?status=ACTIVE', { headers: { 'X-Telegram-Init-Data': tgInitData } });
    resp.then(r => r.json()).then(rides => {
        if (rides[0]) startEditRide(rides[0]);
    });
}


function startEditRide(ride) {
    editingRideId = ride.id;
    selectedFrom = { displayName: `${ride.fromLat.toFixed(4)}, ${ride.fromLon.toFixed(4)}`, latitude: ride.fromLat, longitude: ride.fromLon };
    selectedTo = { displayName: `${ride.toLat.toFixed(4)}, ${ride.toLon.toFixed(4)}`, latitude: ride.toLat, longitude: ride.toLon };

    // ДОБАВЛЯЕМ ВОССТАНОВЛЕНИЕ ПРОМЕЖУТОЧНЫХ ТОЧЕК
    waypoints = (ride.waypoints || []).map(w => ({
        displayName: w.name || `Точка (${w.lat.toFixed(4)}, ${w.lon.toFixed(4)})`,
        latitude: w.lat,
        longitude: w.lon
    }));
    renderWaypoints();

   // document.getElementById('fromSelected').classList.remove('hidden');
   // document.getElementById('fromSelected').innerHTML = `📍 ${escapeHtml(selectedFrom.displayName)}`;
   // document.getElementById('toSelected').classList.remove('hidden');
   // document.getElementById('toSelected').innerHTML = `📍 ${escapeHtml(selectedTo.displayName)}`;
    const fd = document.getElementById('fromDisplay'), td = document.getElementById('toDisplay');
    if (fd) { fd.textContent = selectedFrom.displayName; fd.className = 'route-value'; }
    if (td) { td.textContent = selectedTo.displayName; td.className = 'route-value'; }

    if (ride.departureTime) document.getElementById('departureTimeInput').value = toLocalISO(new Date(ride.departureTime));
    if (ride.passengerCount) document.getElementById('passengerCountSelect').value = String(ride.passengerCount);
    if (ride.availableSeats) document.getElementById('availableSeatsSelect').value = String(ride.availableSeats);
    if (ride.timeFlexibilityMinutes) document.getElementById('timeFlexibilitySelect').value = String(ride.timeFlexibilityMinutes);
    document.getElementById('priceInput').value = ride.pricePerSeat ?? '';
    if (ride.pricePerSeat) {
        document.getElementById('priceInput').classList.remove('hidden');
        markChips('priceChips', null);
    }
    document.getElementById('noteInput').value = ride.note || '';
    document.getElementById('cancelEditBtn').classList.remove('hidden');
    document.getElementById('createSubmitBtn').textContent = 'Сохранить изменения';
    switchScreen('createScreen');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetCreateForm() {
    editingRideId = null;
    document.getElementById('cancelEditBtn').classList.add('hidden');
    document.getElementById('createSubmitBtn').textContent = 'Создать и найти попутчиков';
}

async function cancelMyRide() {
    if (!currentRideId) return;
    if (!confirm('Отменить заявку?')) return;
    const resp = await fetch(`/api/rides/${currentRideId}/cancel`, {
        method: 'PUT', headers: { 'X-Telegram-Init-Data': tgInitData }
    });
    if (resp.ok) {
        currentRideId = null;
        window.activeRideDepartureTime = null;
        window.activeRideFlexibility = null;
        window.activeRideFrom = null;
        window.activeRideTo = null;


        resetCreateForm();
        ['fromDisplay', 'toDisplay'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent = id === 'fromDisplay' ? 'Откуда?' : 'Куда?'; el.className = 'route-placeholder'; }
        });

        document.getElementById('myRide').classList.add('hidden');
        document.getElementById('matchesBlock').classList.add('hidden');
        selectedFrom = selectedTo = null;
        waypoints = [];
        renderWaypoints();
        document.getElementById('fromSelected').classList.add('hidden');
        document.getElementById('toSelected').classList.add('hidden');
        document.getElementById('fromInput').value = '';
        document.getElementById('toInput').value = '';
        document.getElementById('departureTimeInput').value = '';
        document.getElementById('noteInput').value = '';
        document.getElementById('priceInput').value = '';
        highlightChip(null);
        showMessage('Заявка отменена');
    } else {
        showMessage(await resp.text(), 'Ошибка');
    }
}

// ---------- Мои заявки / отклики ----------

let currentRidesView = 'now'; // 'now' или 'history'
let currentNowFilter = 'all'; // 'all', 'rides', 'responses'

function switchRidesTab(view) {
    currentRidesView = view;

    // Безопасное переключение вкладок с проверкой существования элементов
    const tabNow = document.getElementById('tabNow');
    const tabHistory = document.getElementById('tabHistory');
    const nowSubTabs = document.getElementById('nowSubTabs');

    if (tabNow) tabNow.classList.toggle('active-tab', view === 'now');
    if (tabHistory) tabHistory.classList.toggle('active-tab', view === 'history');
    if (nowSubTabs) nowSubTabs.classList.toggle('hidden', view !== 'now');

    if (view === 'now') {
        loadNowView();
    } else {
        loadHistoryView();
    }
}


async function loadNowView() {
    const list = document.getElementById('myRidesList');
    list.innerHTML = '';

    const [ridesResp, matchesResp] = await Promise.all([
        fetch('/api/rides/my', { headers: { 'X-Telegram-Init-Data': tgInitData } }),
        fetch('/api/matches/my', { headers: { 'X-Telegram-Init-Data': tgInitData } })
    ]);

    const rides = ridesResp.ok ? await ridesResp.json() : [];
    const matches = matchesResp.ok ? await matchesResp.json() : [];

    const activeRides = rides.filter(r => r.status === 'ACTIVE' || r.status === 'MATCHED');
    const activeMatches = matches.filter(m =>
        m.status === 'PENDING' || m.status === 'CONFIRMING' || m.status === 'CONFIRMED'
    );

    // Если ничего нет — одно сообщение
    if (activeRides.length === 0 && activeMatches.length === 0) {
        list.innerHTML = '<p class="muted" style="text-align:center;padding:24px;">🎉 Нет активных поездок. Создайте заявку или откликнитесь.</p>';
        return;
    }

    // Собираем всё в один массив с метками
    const items = [
        ...activeRides.map(r => ({ type: 'ride', data: r })),
        ...activeMatches.map(m => ({ type: 'match', data: m }))
    ];

    // Сортировка: сначала подтверждённые, потом ожидающие
    items.sort((a, b) => {
        const priority = { CONFIRMED: 0, MATCHED: 1, CONFIRMING: 2, PENDING: 3, ACTIVE: 4 };
        const aStatus = a.type === 'ride' ? a.data.status : a.data.status;
        const bStatus = b.type === 'ride' ? b.data.status : b.data.status;
        return (priority[aStatus] || 99) - (priority[bStatus] || 99);
    });

    // Рендерим
    items.forEach(item => {
        if (item.type === 'ride') {
            list.appendChild(renderRideCardUnified(item.data));
        } else {
            list.appendChild(renderMatchCardUnified(item.data));
        }
    });
}

// Карточка заявки (я водитель)
function renderRideCardUnified(ride) {
    const card = document.createElement('div');
    card.className = 'ride-card';
    card.style.cssText = `border-left: 4px solid ${STATUS_COLORS[ride.status] || '#9E9E9E'};`;

    const timeStr = ride.departureTime ? new Date(ride.departureTime).toLocaleString() : 'Время не указано';
    const seatsInfo = ride.availableSeats ? ` · мест: ${ride.availableSeats}` : '';

    card.innerHTML = `
        <div class="ride-header">
            <span class="role-icon">🚗</span>
            <span class="role-name">Я ищу попутчиков</span>
            <span class="status-badge ${ride.status.toLowerCase()}">${escapeHtml(translateRideStatus(ride.status))}</span>
        </div>
        <div class="details" style="font-weight:600; margin: 6px 0; font-size: 13px;">
            <span id="ride_${ride.id}_from">📍 Загрузка...</span> → <span id="ride_${ride.id}_to">📍 Загрузка...</span>
        </div>
        <div class="time">${escapeHtml(timeStr)}${escapeHtml(seatsInfo)}</div>
        <div class="actions"></div>
    `;

    reverseGeocodeShort(ride.fromLat, ride.fromLon).then(addr => {
        const el = document.getElementById(`ride_${ride.id}_from`);
        if (el) el.textContent = addr;
    });
    reverseGeocodeShort(ride.toLat, ride.toLon).then(addr => {
        const el = document.getElementById(`ride_${ride.id}_to`);
        if (el) el.textContent = addr;
    });

    const actions = card.querySelector('.actions');

    if (ride.status === 'ACTIVE') {
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-sm';
        editBtn.textContent = '✏️ Изменить';
        editBtn.onclick = () => startEditRide(ride);
        actions.appendChild(editBtn);

        const responsesBtn = document.createElement('button');
        responsesBtn.className = 'btn btn-sm btn-secondary';
        responsesBtn.textContent = pendingResponsesCount > 0 ? `Отклики (${pendingResponsesCount})` : 'Отклики';
        responsesBtn.onclick = () => openResponsesForRide(ride.id);
        actions.appendChild(responsesBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-sm btn-secondary';
        cancelBtn.textContent = 'Отменить';
        cancelBtn.onclick = async () => {
            if (confirm('Отменить поездку?')) {
                await fetch(`/api/rides/${ride.id}/cancel`, { method: 'PUT', headers: { 'X-Telegram-Init-Data': tgInitData } });
                loadNowView();
            }
        };
        actions.appendChild(cancelBtn);
    } else if (ride.status === 'MATCHED') {
        const chatBtn = document.createElement('button');
        chatBtn.className = 'btn btn-sm';
        chatBtn.textContent = '💬 Чат';
        chatBtn.onclick = () => { switchScreen('chatsScreen'); openChat(ride.acceptedMatchId); };
        actions.appendChild(chatBtn);

        const responsesBtn = document.createElement('button');
        responsesBtn.className = 'btn btn-sm btn-secondary';
        responsesBtn.textContent = 'Отклики';
        responsesBtn.onclick = () => openResponsesForRide(ride.id);
        actions.appendChild(responsesBtn);
    }

    return card;
}

// Карточка отклика (я пассажир)
function renderMatchCardUnified(match) {
    const card = document.createElement('div');
    card.className = 'ride-card';
    card.style.cssText = `border-left: 4px solid ${STATUS_COLORS[match.status] || '#9E9E9E'};`;

    const timeStr = match.departureTime ? new Date(match.departureTime).toLocaleString() : 'Время не указано';
    const seatsStr = match.seats ? ` · мест: ${match.seats}` : '';

    let statusText = '';
    if (match.status === 'PENDING') statusText = '⏳ Жду ответа';
    else if (match.status === 'CONFIRMING') statusText = '⏳ Ждёт подтверждения';
    else if (match.status === 'CONFIRMED') statusText = '✅ Еду';

    card.innerHTML = `
        <div class="ride-header">
            <span class="role-icon">🚶</span>
            <span class="role-name">${statusText} · ${escapeHtml(match.ownerName)}</span>
        </div>
        <div class="details" style="font-weight:600; margin: 6px 0; font-size: 13px;">
            <span id="match_${match.id}_from">📍 Загрузка...</span> → <span id="match_${match.id}_to">📍 Загрузка...</span>
        </div>
        <div class="time">${escapeHtml(timeStr)}${escapeHtml(seatsStr)}</div>
        <div class="actions"></div>
    `;

    reverseGeocodeShort(match.fromLat, match.fromLon).then(addr => {
        const el = document.getElementById(`match_${match.id}_from`);
        if (el) el.textContent = addr;
    });
    reverseGeocodeShort(match.toLat, match.toLon).then(addr => {
        const el = document.getElementById(`match_${match.id}_to`);
        if (el) el.textContent = addr;
    });

    const actions = card.querySelector('.actions');

    if (match.status === 'PENDING') {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-sm btn-secondary';
        cancelBtn.textContent = 'Отменить отклик';
        cancelBtn.onclick = async () => {
            await fetch(`/api/matches/${match.id}/cancel`, { method: 'PUT', headers: { 'X-Telegram-Init-Data': tgInitData } });
            loadNowView();
        };
        actions.appendChild(cancelBtn);
    } else if (match.status === 'CONFIRMING') {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-sm';
        confirmBtn.textContent = '✅ Подтвердить';
        confirmBtn.onclick = async () => {
            await fetch(`/api/matches/${match.id}/confirm`, { method: 'PUT', headers: { 'X-Telegram-Init-Data': tgInitData } });
            loadNowView();
        };
        actions.appendChild(confirmBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-sm btn-secondary';
        cancelBtn.textContent = 'Отменить';
        cancelBtn.onclick = async () => {
            if (confirm('Отменить бронь?')) {
                await fetch(`/api/matches/${match.id}/cancel`, { method: 'PUT', headers: { 'X-Telegram-Init-Data': tgInitData } });
                loadNowView();
            }
        };
        actions.appendChild(cancelBtn);
    } else if (match.status === 'CONFIRMED') {
        const chatBtn = document.createElement('button');
        chatBtn.className = 'btn btn-sm';
        chatBtn.textContent = '💬 Чат';
        chatBtn.onclick = () => { switchScreen('chatsScreen'); openChat(match.id, match.ownerName); };
        actions.appendChild(chatBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-sm btn-secondary';
        cancelBtn.textContent = 'Отменить';
        cancelBtn.onclick = async () => {
            if (confirm('Отменить поездку?')) {
                await fetch(`/api/matches/${match.id}/cancel`, { method: 'PUT', headers: { 'X-Telegram-Init-Data': tgInitData } });
                loadNowView();
            }
        };
        actions.appendChild(cancelBtn);
    }

    return card;
}

async function loadHistoryView() {
    const list = document.getElementById('myRidesList');
    if (!list) return;
    list.innerHTML = '';

    const [ridesResp, matchesResp] = await Promise.all([
        fetch('/api/rides/my?all=true', { headers: { 'X-Telegram-Init-Data': tgInitData } }),
        fetch('/api/matches/my', { headers: { 'X-Telegram-Init-Data': tgInitData } })
    ]);

    const rides = ridesResp.ok ? await ridesResp.json() : [];
    const allMatches = matchesResp.ok ? await matchesResp.json() : [];
    const doneMatches = allMatches.filter(m =>
        ['COMPLETED', 'NO_SHOW_PASSENGER', 'NO_SHOW_DRIVER'].includes(m.status)
    );

    // Единый поток событий: заявки + завершённые отклики
    const events = [
        ...rides.map(r => ({ kind: 'ride',  date: new Date(r.departureTime || r.createdAt || 0), data: r })),
        ...doneMatches.map(m => ({ kind: 'match', date: new Date(m.departureTime || m.createdAt || 0), data: m }))
    ];

    if (events.length === 0) {
        list.innerHTML = '<p class="muted" style="text-align:center;padding:20px;">История пуста</p>';
        return;
    }

    // Группировка по неделям
    const weeks = {};
    events.forEach(ev => {
        const key = getWeekStart(ev.date).toISOString().split('T')[0];
        if (!weeks[key]) weeks[key] = [];
        weeks[key].push(ev);
    });

    // Недели: новые сверху
    const sortedWeeks = Object.keys(weeks).sort((a, b) => new Date(b) - new Date(a));

    sortedWeeks.forEach(weekKey => {
        // Внутри недели — по дате по убыванию (заявки и отклики вместе)
        const weekEvents = weeks[weekKey].sort((a, b) => b.date - a.date);
        list.innerHTML += `<h3 style="margin:16px 0 8px;font-size:14px;color:var(--text-secondary);font-weight:600;">${formatWeekLabel(weekKey)}</h3>`;
        weekEvents.forEach(ev => {
            list.appendChild(ev.kind === 'ride' ? renderRideCard(ev.data) : renderResponseCard(ev.data));
        });
    });
}

function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

function formatWeekLabel(weekKey) {
    const date = new Date(weekKey);
    const now = new Date();
    const diff = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diff === 0) return 'Эта неделя';
    if (diff <= 7) return 'Прошлая неделя';
    if (diff <= 14) return '2 недели назад';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function toggleShowAllRides() {
    showAllRides = !showAllRides;
    loadMyRides();
}


async function loadMyRides() {
    let url = '/api/rides/my';
    if (!showAllRides) url += '?status=ACTIVE';
    const resp = await fetch(url, { headers: { 'X-Telegram-Init-Data': tgInitData } });
    if (!resp.ok) return;
    const rides = await resp.json();
    const list = document.getElementById('myRidesList');
    list.innerHTML = '';

    const toggleBtn = document.querySelector('#showAllRidesBtn button');
    if (toggleBtn) toggleBtn.textContent = showAllRides ? 'Показать только активные' : 'Показать все';

    if (rides.length === 0) {
        list.innerHTML = showAllRides
            ? '<p class="muted" style="text-align:center;padding:20px;">У вас пока нет заявок</p>'
            : '<p class="muted" style="text-align:center;padding:20px;">Активных заявок нет. Нажмите «Показать все», чтобы увидеть завершённые и отменённые.</p>';
        return;
    }

    const groups = groupRidesByStatus(rides);

    // Активные
    if (groups.active.length > 0) {
        list.innerHTML += renderSectionHeader('Активные', groups.active.length, '#4CAF50');
        groups.active.forEach(ride => list.appendChild(renderRideCard(ride)));
    }

    // Завершённые
    if (groups.completed.length > 0) {
        list.innerHTML += renderSectionHeader('Завершённые', groups.completed.length, '#9E9E9E');
        groups.completed.forEach(ride => list.appendChild(renderRideCard(ride)));
    }

    // Отменённые / Истекшие
    if (groups.cancelled.length > 0) {
        list.innerHTML += renderSectionHeader('Отменённые / Истекшие', groups.cancelled.length, '#F44336');
        groups.cancelled.forEach(ride => list.appendChild(renderRideCard(ride)));
    }
}

function renderRideCard(ride) {
    const card = document.createElement('div');
    card.className = 'ride-card';
    card.style.cssText = `border-left: 4px solid ${STATUS_COLORS[ride.status] || '#9E9E9E'};`;

    const roleIcon = ride.role === 'PASSENGER' ? '🚶' : '🚗';
    const timeStr = ride.departureTime ? new Date(ride.departureTime).toLocaleString() : 'Время не указано';
    const seatsInfo = ride.availableSeats ? ` · мест: ${ride.availableSeats}` : (ride.passengerCount ? ` · пассажиров: ${ride.passengerCount}` : '');
    const priceInfo = ride.pricePerSeat ? ` · 💰 ${ride.pricePerSeat} BYN` : '';
    const routeId = `ride_${ride.id}`;

    card.innerHTML = `
        <div class="ride-header">
            <span class="role-icon">${roleIcon}</span>
            <span class="role-name">Моя заявка (${ride.role === 'PASSENGER' ? 'Пассажир' : 'Водитель'})</span>
            <span class="status-badge ${ride.status.toLowerCase()}">${escapeHtml(translateRideStatus(ride.status))}</span>
        </div>
        <div class="details" style="font-weight:600; margin: 6px 0; font-size: 13px;">
            <span id="${routeId}_from">📍 Загрузка...</span> → <span id="${routeId}_to">📍 Загрузка...</span>
        </div>
        <div class="time">${escapeHtml(timeStr)}${escapeHtml(seatsInfo)}${escapeHtml(priceInfo)}</div>
        ${ride.note ? `<div class="details" style="color:var(--text-secondary);">${escapeHtml(ride.note)}</div>` : ''}
        ${ride.status === 'MATCHED' ? '<div class="details" style="color:#1565c0;font-weight:600; margin-top:4px;">🤝 Есть бронь. Подтверждение — во вкладке «Мои отклики»</div>' : ''}
    `;

    reverseGeocodeShort(ride.fromLat, ride.fromLon).then(addr => {
        const el = document.getElementById(`${routeId}_from`);
        if (el) el.textContent = addr;
    });
    reverseGeocodeShort(ride.toLat, ride.toLon).then(addr => {
        const el = document.getElementById(`${routeId}_to`);
        if (el) el.textContent = addr;
    });

    const actions = document.createElement('div');
    actions.className = 'actions';

    if (ride.status === 'ACTIVE') {
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-sm';
        editBtn.textContent = '✏️ Редактировать';
        editBtn.onclick = () => startEditRide(ride);
        actions.appendChild(editBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-sm btn-secondary';
        cancelBtn.textContent = 'Отменить';
        cancelBtn.onclick = async () => {
            if (confirm('Отменить заявку?')) {
                await fetch(`/api/rides/${ride.id}/cancel`, { method: 'PUT', headers: { 'X-Telegram-Init-Data': tgInitData } });
                loadMyRides();
                loadActiveRide();
            }
        };
        actions.appendChild(cancelBtn);

        const responsesBtn = document.createElement('button');
        responsesBtn.className = 'btn btn-sm';
        responsesBtn.textContent = pendingResponsesCount > 0 ? `Отклики (${pendingResponsesCount}) 🔔` : 'Отклики';
        responsesBtn.onclick = () => openResponsesForRide(ride.id);
        actions.appendChild(responsesBtn);
    } else if (ride.status === 'MATCHED') {
        const responsesBtn = document.createElement('button');
        responsesBtn.className = 'btn btn-sm btn-secondary';
        responsesBtn.textContent = 'Отклики на заявку';
        responsesBtn.onclick = () => openResponsesForRide(ride.id);
        actions.appendChild(responsesBtn);

        if (ride.acceptedMatchId) {
            const chatBtn = document.createElement('button');
            chatBtn.className = 'btn btn-sm btn-secondary';
            chatBtn.textContent = 'Чат';
            chatBtn.onclick = () => { switchScreen('chatsScreen'); openChat(ride.acceptedMatchId); };
            actions.appendChild(chatBtn);
        }
    } else if (ride.status === 'COMPLETED') {
        if (ride.hasReviewed) {
            const reviewedText = document.createElement('div');
            reviewedText.style.cssText = 'font-size:13px; color:var(--text-secondary); margin-top:8px; font-weight:600;';
            reviewedText.textContent = '✅ Отзыв оставлен';
            actions.appendChild(reviewedText);
        } else {
            const reviewBtn = document.createElement('button');
            reviewBtn.className = 'btn btn-sm btn-secondary';
            reviewBtn.textContent = 'Оставить отзыв';
            reviewBtn.onclick = async () => {
                const r = await fetch(`/api/reviews/counterparty/${ride.id}`, { headers: { 'X-Telegram-Init-Data': tgInitData } });
                if (r.ok) openReviewModal(ride.id, Number(await r.json()));
                else showMessage(await r.text(), 'Ошибка');
            };
            actions.appendChild(reviewBtn);
        }
    }

    if (actions.children.length > 0) card.appendChild(actions);
    return card;
}



/*async function loadResponsesForRide(rideId) {
    try {
        const resp = await fetch(`/api/matches/for-request?rideRequestId=${rideId}`, {headers: {'X-Telegram-Init-Data': tgInitData}});

        if (!resp.ok) {
            const err = await resp.text();
            showMessage('Ошибка сервера: ' + err.slice(0, 100), 'Ошибка');
            return;
        }

        const matches = await resp.json();
        const block = document.getElementById('responsesBlock');
        block.classList.remove('hidden');

        setTimeout(() => {
            block.scrollIntoView({behavior: 'smooth', block: 'center'});
        }, 100);

        const list = document.getElementById('responsesList');
        list.innerHTML = '';
        if (matches.length === 0) {
            list.innerHTML = '<p>Откликов нет</p>';
            return;
        }

        for (const match of matches) {
            const item = document.createElement('div');
            item.className = 'match-item';
            let contactInfo = '';
            if (match.status === 'CONFIRMED' && match.contactUsername) {
                contactInfo = `<div style="margin-top:4px;">📞 @${escapeHtml(match.contactUsername)}</div>`;
            }
            const seatsNote = match.seats ? ` · мест: ${match.seats}` : '';
            const reviewsId = `rev_resp_${match.id}`;

            const ratingVal = match.responderRating ? Number(match.responderRating) : null;
            const ratingStr = ratingVal ? `⭐ ${ratingVal.toFixed(1)}` : '⭐ Нет оценок';
            const tripsStr = `Поездок: ${match.responderTripCount || 0}`;

            item.innerHTML = `
            <div class="ride-header">
                <span class="role-icon">👤</span>
                <span class="role-name" style="flex:1;">${escapeHtml(match.responderName)}</span>
                <span class="match-status ${match.status.toLowerCase()}">${escapeHtml(translateMatchStatus(match.status))}${escapeHtml(seatsNote)}</span>
            </div>
            <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">
                ${ratingStr} · ${tripsStr}
            </div>
            <div class="time">Отклик отправлен: ${escapeHtml(new Date(match.createdAt).toLocaleString())}</div>
            <div id="${reviewsId}" style="margin-top: 10px;"></div>
            ${contactInfo}
        `;

            try {
                loadUserReviews(match.responderTelegramId, document.getElementById(reviewsId));
            } catch(err) {
                console.warn("Не удалось загрузить отзывы", err);
            }

            // ===== КНОПКИ УПРАВЛЕНИЯ =====
            if (match.status === 'PENDING') {
                const acceptBtn = document.createElement('button');
                acceptBtn.className = 'btn btn-sm';
                acceptBtn.textContent = 'Принять';
                acceptBtn.onclick = async () => {
                    const r2 = await fetch(`/api/matches/${match.id}/accept`, {
                        method: 'PUT',
                        headers: {'X-Telegram-Init-Data': tgInitData}
                    });
                    if (r2.ok) {
                        showMessage('Бронь принята. Ждём подтверждения от второй стороны.');
                    } else {
                        const errText = await r2.text();
                        if (errText.includes('Свободных мест больше нет')) {
                            showMessage('Места только что закончились. Список обновлён.', 'Внимание');
                        } else {
                            showMessage('Ошибка: ' + errText.slice(0, 100), 'Ошибка');
                        }
                    }
                    loadResponsesForRide(rideId);
                };

                // 🔥 ВОТ ЭТОТ БЛОК БЫЛ ПОТЕРЯН — создаём rejectBtn
                const rejectBtn = document.createElement('button');
                rejectBtn.className = 'btn btn-sm btn-secondary';
                rejectBtn.textContent = 'Отклонить';
                rejectBtn.onclick = async () => {
                    await fetch(`/api/matches/${match.id}/reject`, {
                        method: 'PUT',
                        headers: {'X-Telegram-Init-Data': tgInitData}
                    });
                    loadResponsesForRide(rideId);
                };

                item.appendChild(acceptBtn);
                item.appendChild(rejectBtn);
            }

            if (match.status === 'CONFIRMING') {
                const cancelBtn = document.createElement('button');
                cancelBtn.className = 'btn btn-sm btn-secondary';
                cancelBtn.textContent = 'Отменить бронь';
                cancelBtn.onclick = async () => {
                    if (confirm('Отменить бронь? Места вернутся в пул.')) {
                        await fetch(`/api/matches/${match.id}/cancel`, { method: 'PUT', headers: {'X-Telegram-Init-Data': tgInitData} });
                        loadResponsesForRide(rideId);
                    }
                };
                item.appendChild(cancelBtn);
            }

            if (match.status === 'CONFIRMED') {
                const counterpart = currentUser.role === 'PASSENGER' ? 'NO_SHOW_DRIVER' : 'NO_SHOW_PASSENGER';

                const okBtn = document.createElement('button');
                okBtn.className = 'btn btn-sm';
                okBtn.textContent = '✅ Состоялась';
                okBtn.onclick = () => reportOutcome(match.id, 'COMPLETED');
                item.appendChild(okBtn);

                const noBtn = document.createElement('button');
                noBtn.className = 'btn btn-sm btn-secondary';
                noBtn.textContent = counterpart === 'NO_SHOW_PASSENGER' ? '⚠️ Пассажир не пришёл' : '⚠️ Водитель не выехал';
                noBtn.onclick = () => reportOutcome(match.id, counterpart);
                item.appendChild(noBtn);
            }

            if (match.status === 'COMPLETED') {
                if (match.hasReviewed) {
                    const reviewedText = document.createElement('div');
                    reviewedText.style.cssText = 'font-size:13px; color:var(--text-secondary); margin-top:8px; font-weight:600;';
                    reviewedText.textContent = '✅ Отзыв оставлен';
                    item.appendChild(reviewedText);
                } else {
                    const reviewBtn = document.createElement('button');
                    reviewBtn.className = 'btn btn-sm';
                    reviewBtn.textContent = '⭐ Оставить отзыв';
                    reviewBtn.onclick = async () => {
                        const r = await fetch(`/api/reviews/counterparty/${match.rideRequestId}`, { headers: { 'X-Telegram-Init-Data': tgInitData } });
                        if (r.ok) openReviewModal(match.rideRequestId, Number(await r.json()));
                        else showMessage(await r.text(), 'Ошибка');
                    };
                    item.appendChild(reviewBtn);
                }
            }

            list.appendChild(item);
        }
    } catch (e) {
        console.error("Ошибка при загрузке откликов:", e);
        showMessage("Ошибка интерфейса: " + e.message, "Ошибка");
    }
} */

async function loadResponsesForRide(rideId) {
    // Старый выпадающий блок удалён. Если экран откликов открыт — обновляем его.
    if (currentResponsesRideId === rideId && typeof renderResponsesList === 'function') {
        await renderResponsesList(rideId);
    }
}

let currentResponsesRideId = null;

// Открыть экран откликов по заявке
async function openResponsesForRide(rideId) {
    document.querySelector('.app-container').classList.add('hide-header');
    console.log('🎯 Открытие откликов для заявки:', rideId);
    currentResponsesRideId = rideId;

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('responsesScreen');
    if (target) target.classList.add('active');

    await renderResponsesRideCard(rideId);
    await renderResponsesList(rideId);
}

function closeResponsesScreen() {
    document.querySelector('.app-container').classList.remove('hide-header');
    currentResponsesRideId = null;
    switchScreen('myRidesScreen');
}

async function reloadResponses() {
    if (currentResponsesRideId) await renderResponsesList(currentResponsesRideId);
}

// Карточка заявки сверху — в стиле openRideDetails
async function renderResponsesRideCard(rideId) {
    const card = document.getElementById('responsesRideCard');
    if (!card) return;            // ← защита
    card.innerHTML = '<p class="muted">Загрузка…</p>';
    try {
        const resp = await fetch(`/api/rides/${rideId}`, { headers: { 'X-Telegram-Init-Data': tgInitData } });
        if (!resp.ok) { card.innerHTML = '<p class="muted">Не удалось загрузить заявку</p>'; return; }
        const d = await resp.json();

        const fromId = 'rr_from_' + rideId, toId = 'rr_to_' + rideId;
        const timeStr = d.departureTime ? new Date(d.departureTime).toLocaleString('ru-RU') : 'время не указано';
        const seatsLine = d.role === 'DRIVER'
            ? `Свободно мест: ${d.availableSeats ?? '—'}${d.vehicleSeats ? ` (в машине ${d.vehicleSeats})` : ''}`
            : `Пассажиров: ${d.passengerCount ?? '—'}`;

        card.innerHTML = `
            <div class="ride-header">
                <span class="role-icon">${roleEmoji(d.role)}</span>
                <span class="role-name">${d.role === 'DRIVER' ? 'Водитель' : 'Пассажир'}</span>
                <span class="status-badge ${d.status.toLowerCase()}">${escapeHtml(translateRideStatus(d.status))}</span>
            </div>
            <div class="responses-ride-route">
                <span id="${fromId}">📍 …</span> → <span id="${toId}">📍 …</span>
            </div>
            <div class="responses-ride-meta">
                🕒 ${escapeHtml(timeStr)} · ±${d.timeFlexibilityMinutes || 30} мин<br>
                ${escapeHtml(seatsLine)}${d.pricePerSeat ? ` · 💰 ${d.pricePerSeat} BYN/место` : ''}<br>
                ${d.note ? `💬 ${escapeHtml(d.note)}` : ''}
            </div>`;

        reverseGeocodeShort(d.fromLat, d.fromLon).then(a => { const e = document.getElementById(fromId); if (e) e.textContent = a; });
        reverseGeocodeShort(d.toLat, d.toLon).then(a => { const e = document.getElementById(toId); if (e) e.textContent = a; });
    } catch (e) {
        card.innerHTML = '<p class="muted">Ошибка загрузки заявки</p>';
    }
}

// Список откликов снизу
async function renderResponsesList(rideId) {
    const list = document.getElementById('responsesList');
    if (!list) return;            // ← защита
    console.log('🔍 Загружаем отклики для заявки:', rideId);

    list.innerHTML = '<p class="muted">Загрузка…</p>';
    try {
        const resp = await fetch(`/api/matches/for-request?rideRequestId=${rideId}`, {
            headers: { 'X-Telegram-Init-Data': tgInitData }
        });
        console.log('📡 Ответ сервера:', resp.status);
        if (!resp.ok) {
            list.innerHTML = '<p class="muted">Не удалось загрузить отклики</p>';
            return;
        }
        const matches = await resp.json();
        console.log('📦 Получено откликов:', matches.length);

        if (matches.length === 0) {
            list.innerHTML = '<p class="muted" style="text-align:center;padding:16px;">Пока никто не откликнулся. Заявка активна — уведомим, когда кто-то появится.</p>';
            return;
        }

        matches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        list.innerHTML = '';
        matches.forEach(m => list.appendChild(buildResponseCard(m, rideId)));
    } catch (e) {
        console.error('❌ Ошибка загрузки откликов:', e);
        list.innerHTML = '<p class="muted">Ошибка загрузки откликов</p>';
    }
}

function buildResponseCard(match, rideId) {
    const card = document.createElement('div');
    card.className = 'response-card';
    card.style.borderLeft = `4px solid ${STATUS_COLORS[match.status] || '#9E9E9E'}`;

    const initial = (match.responderName || '?').trim().charAt(0).toUpperCase();
    const ratingStr = match.responderRating ? `⭐ ${Number(match.responderRating).toFixed(1)}` : '⭐ нет оценок';
    const tripsStr = `Поездок: ${match.responderTripCount || 0}`;
    const seatsStr = match.seats ? `мест: ${match.seats}` : '';
    const aboutStr = match.responderAboutMe
        ? `<div class="peer-about">${escapeHtml(match.responderAboutMe)}</div>` : '';
    const dateStr = new Date(match.createdAt).toLocaleString('ru-RU');

    card.innerHTML = `
        <div class="response-head">
            <div class="response-avatar">${escapeHtml(initial)}</div>
            <div class="response-name">${escapeHtml(match.responderName || 'Пользователь')}</div>
            <span class="match-status ${match.status.toLowerCase()}">${escapeHtml(translateMatchStatus(match.status))}</span>
        </div>
        <div class="response-meta">${ratingStr} · ${tripsStr}${seatsStr ? ' · ' + seatsStr : ''}</div>
        ${aboutStr}
        <div class="response-meta">Отклик: ${escapeHtml(dateStr)}</div>
        <div class="response-actions"></div>`;

    // Клик по карточке (кроме кнопок) → профиль откликнувшегося
    card.addEventListener('click', (ev) => {
        if (ev.target.closest('button')) return;
        openPeerProfile(match);
    });

    const actions = card.querySelector('.response-actions');

    if (match.status === 'PENDING') {
        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'btn btn-sm';
        acceptBtn.textContent = 'Принять';
        acceptBtn.onclick = async () => {
            const r = await fetch(`/api/matches/${match.id}/accept`, { method: 'PUT', headers: { 'X-Telegram-Init-Data': tgInitData } });
            if (r.ok) showToast('Бронь принята. Ждём подтверждения от второй стороны.', 'ok');
            else { const t = await r.text(); showToast(t.slice(0, 120), 'err'); }
            renderResponsesList(rideId);
        };
        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'btn btn-sm btn-secondary';
        rejectBtn.textContent = 'Отклонить';
        rejectBtn.onclick = async () => {
            await fetch(`/api/matches/${match.id}/reject`, { method: 'PUT', headers: { 'X-Telegram-Init-Data': tgInitData } });
            renderResponsesList(rideId);
        };
        actions.appendChild(acceptBtn); actions.appendChild(rejectBtn);
    }

    if (match.status === 'CONFIRMING') {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-sm btn-secondary';
        cancelBtn.textContent = 'Отменить бронь';
        cancelBtn.onclick = async () => {
            if (!confirm('Отменить бронь? Места вернутся в пул.')) return;
            await fetch(`/api/matches/${match.id}/cancel`, { method: 'PUT', headers: { 'X-Telegram-Init-Data': tgInitData } });
            renderResponsesList(rideId);
        };
        actions.appendChild(cancelBtn);
    }

    if (match.status === 'CONFIRMED') {
        const chatBtn = document.createElement('button');
        chatBtn.className = 'btn btn-sm';
        chatBtn.textContent = '💬 Чат';
        chatBtn.onclick = () => { switchScreen('chatsScreen'); openChat(match.id, match.responderName); };
        const counterpart = currentUser.role === 'PASSENGER' ? 'NO_SHOW_DRIVER' : 'NO_SHOW_PASSENGER';
        const okBtn = document.createElement('button');
        okBtn.className = 'btn btn-sm btn-secondary';
        okBtn.textContent = '✅ Состоялась';
        okBtn.onclick = () => reportOutcome(match.id, 'COMPLETED');
        const noBtn = document.createElement('button');
        noBtn.className = 'btn btn-sm btn-secondary';
        noBtn.textContent = counterpart === 'NO_SHOW_PASSENGER' ? '⚠️ Пасс. не пришёл' : '⚠️ Вод. не выехал';
        noBtn.onclick = () => reportOutcome(match.id, counterpart);
        actions.appendChild(chatBtn); actions.appendChild(okBtn); actions.appendChild(noBtn);
    }

    if (match.status === 'COMPLETED' && !match.hasReviewed) {
        const reviewBtn = document.createElement('button');
        reviewBtn.className = 'btn btn-sm';
        reviewBtn.textContent = '⭐ Оставить отзыв';
        reviewBtn.onclick = async () => {
            const r = await fetch(`/api/reviews/counterparty/${match.rideRequestId}`, { headers: { 'X-Telegram-Init-Data': tgInitData } });
            if (r.ok) openReviewModal(match.rideRequestId, Number(await r.json()));
            else showToast(await r.text(), 'err');
        };
        actions.appendChild(reviewBtn);
    }

    return card;
}

// Модалка профиля откликнувшегося
function openPeerProfile(match) {
    document.getElementById('peerAvatar').textContent = (match.responderName || '?').trim().charAt(0).toUpperCase();
    document.getElementById('peerName').textContent = match.responderName || 'Пользователь';
    document.getElementById('peerUsername').textContent = match.responderUsername ? `@${match.responderUsername}` : '';
    document.getElementById('peerRating').textContent = match.responderRating ? Number(match.responderRating).toFixed(1) : '—';
    document.getElementById('peerTrips').textContent = match.responderTripCount || 0;
    document.getElementById('peerSeats').textContent = match.seats || '—';

    const aboutEl = document.getElementById('peerAbout');
    if (match.responderAboutMe) { aboutEl.textContent = match.responderAboutMe; aboutEl.classList.remove('empty'); }
    else { aboutEl.textContent = ''; aboutEl.classList.add('empty'); }

    document.getElementById('peerProfileModal').classList.add('active');
    loadUserReviews(match.responderTelegramId, document.getElementById('peerReviews'));
}

function closePeerProfile() {
    document.getElementById('peerProfileModal').classList.remove('active');
}

async function loadMyResponses() {
    const resp = await fetch('/api/matches/my', { headers: { 'X-Telegram-Init-Data': tgInitData } });
    if (!resp.ok) return;
    const matches = await resp.json();
    const list = document.getElementById('myResponsesList');
    list.innerHTML = '';
    if (matches.length === 0) {
        list.innerHTML = '<p class="muted" style="text-align:center;padding:20px;">Вы ещё не откликались</p>';
        return;
    }

    const groups = groupMatchesByStatus(matches);

    // Подтверждённые / Завершённые
    if (groups.confirmed.length > 0) {
        list.innerHTML += renderSectionHeader('Подтверждённые / Завершённые', groups.confirmed.length, '#4CAF50');
        groups.confirmed.forEach(match => list.appendChild(renderResponseCard(match)));
    }

    // Ожидают ответа
    if (groups.pending.length > 0) {
        list.innerHTML += renderSectionHeader('Ожидают ответа', groups.pending.length, '#FF9800');
        groups.pending.forEach(match => list.appendChild(renderResponseCard(match)));
    }

    // Отклонённые
    if (groups.cancelled.length > 0) {
        list.innerHTML += renderSectionHeader('Отклонённые', groups.cancelled.length, '#F44336');
        groups.cancelled.forEach(match => list.appendChild(renderResponseCard(match)));
    }
}

function renderResponseCard(match) {
    const item = document.createElement('div');
    item.className = 'match-item';
    item.style.cssText = `border-left: 4px solid ${STATUS_COLORS[match.status] || '#9E9E9E'};`;

    let contactInfo = '';
    if (match.status === 'CONFIRMED' && match.contactUsername) {
        contactInfo = `<div style="margin-top:4px;">📞 @${escapeHtml(match.contactUsername)}</div>`;
    }
    const seatsNote = match.seats ? ` · мест: ${match.seats}` : '';
    const routeId = `resp_${match.id}`;
    const reviewsId = `rev_owner_${match.id}`;
    const ratingStr = match.ownerRating ? `⭐ ${Number(match.ownerRating).toFixed(1)}` : '⭐ Нет оценок';
    const tripsStr = `Поездок: ${match.ownerTripCount || 0}`;
    const aboutMeStr = match.ownerAboutMe
        ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;font-style:italic;">"${escapeHtml(match.ownerAboutMe)}"</div>` : '';
    const timeStr = match.departureTime ? new Date(match.departureTime).toLocaleString() : 'Время не указано';
    const priceStr = match.pricePerSeat
        ? `<div style="color:var(--primary);font-weight:600;margin-top:2px;">💰 ${match.pricePerSeat} BYN</div>` : '';

    item.innerHTML = `
        <div class="ride-header">
            <span class="role-icon">👤</span>
            <span class="role-name" style="flex:1;">Отклик на заявку ${escapeHtml(match.ownerName)}</span>
            <span class="match-status ${match.status.toLowerCase()}">${escapeHtml(translateMatchStatus(match.status))}${escapeHtml(seatsNote)}</span>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">
            ${ratingStr} · ${tripsStr}
        </div>
        ${aboutMeStr}
        <div class="details" style="font-weight:600; margin: 6px 0; font-size:13px;">
            <span id="${routeId}_from">📍 Загрузка...</span> → <span id="${routeId}_to">📍 Загрузка...</span>
        </div>
        <div class="time">🕒 ${escapeHtml(timeStr)}</div>
        ${priceStr}
        ${match.note ? `<div class="details" style="color:var(--text-secondary); margin-top:4px;">${escapeHtml(match.note)}</div>` : ''}
        <div id="${reviewsId}" style="margin-top: 10px;"></div>
        ${contactInfo}
    `;

    reverseGeocodeShort(match.fromLat, match.fromLon).then(addr => {
        const el = document.getElementById(`${routeId}_from`); if (el) el.textContent = addr;
    });
    reverseGeocodeShort(match.toLat, match.toLon).then(addr => {
        const el = document.getElementById(`${routeId}_to`); if (el) el.textContent = addr;
    });
    loadUserReviews(match.ownerTelegramId, document.getElementById(reviewsId));

    if (match.status === 'PENDING') {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-sm btn-secondary';
        cancelBtn.textContent = 'Отменить отклик';
        cancelBtn.onclick = async () => {
            await fetch(`/api/matches/${match.id}/cancel`, { method: 'PUT', headers: { 'X-Telegram-Init-Data': tgInitData } });
            respondedRideIds.delete(match.rideRequestId);
            loadMyResponses();
        };
        item.appendChild(cancelBtn);
    }
    if (match.status === 'CONFIRMING') {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-sm';
        confirmBtn.textContent = '✅ Подтвердить бронь';
        confirmBtn.onclick = async () => {
            const r2 = await fetch(`/api/matches/${match.id}/confirm`, { method: 'PUT', headers: { 'X-Telegram-Init-Data': tgInitData } });
            if (r2.ok) showMessage('Бронь подтверждена! Контакты в приложении.');
            else showMessage(await r2.text(), 'Ошибка');
            loadMyResponses();
        };
        item.appendChild(confirmBtn);
    }
    if (match.status === 'CONFIRMED') {
        const counterpart = currentUser.role === 'PASSENGER' ? 'NO_SHOW_DRIVER' : 'NO_SHOW_PASSENGER';
        const okBtn = document.createElement('button');
        okBtn.className = 'btn btn-sm';
        okBtn.textContent = '✅ Состоялась';
        okBtn.onclick = () => reportOutcome(match.id, 'COMPLETED');
        item.appendChild(okBtn);
        const noBtn = document.createElement('button');
        noBtn.className = 'btn btn-sm btn-secondary';
        noBtn.textContent = counterpart === 'NO_SHOW_PASSENGER' ? '⚠️ Пассажир не пришёл' : '⚠️ Водитель не выехал';
        noBtn.onclick = () => reportOutcome(match.id, counterpart);
        item.appendChild(noBtn);
    }
    if (match.status === 'COMPLETED') {
        if (match.hasReviewed) {
            const reviewedText = document.createElement('div');
            reviewedText.style.cssText = 'font-size:13px; color:var(--text-secondary); margin-top:8px; font-weight:600;';
            reviewedText.textContent = '✅ Отзыв оставлен';
            item.appendChild(reviewedText);
        } else {
            const reviewBtn = document.createElement('button');
            reviewBtn.className = 'btn btn-sm';
            reviewBtn.textContent = '⭐ Оставить отзыв';
            reviewBtn.onclick = async () => {
                const r = await fetch(`/api/reviews/counterparty/${match.rideRequestId}`, { headers: { 'X-Telegram-Init-Data': tgInitData } });
                if (r.ok) openReviewModal(match.rideRequestId, Number(await r.json()));
                else showMessage(await r.text(), 'Ошибка');
            };
            item.appendChild(reviewBtn);
        }
    }
    return item;
}

// ---------- Чаты ----------

async function loadChats() {
    const resp = await fetch('/api/messages/chats', { headers: { 'X-Telegram-Init-Data': tgInitData } });
    if (!resp.ok) { document.getElementById('chatsList').innerHTML = '<p>Не удалось загрузить чаты</p>'; return; }
    const chats = await resp.json();
    const list = document.getElementById('chatsList');
    list.innerHTML = '';
    if (chats.length === 0) { list.innerHTML = '<p>Нет активных переписок. Чат откроется после подтверждения брони.</p>'; return; }
    chats.forEach(chat => {
        const item = document.createElement('div');
        item.className = 'chat-item';
        const timeStr = chat.lastMessageTime ? new Date(chat.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const initial = (chat.peerName || '?').trim().charAt(0).toUpperCase();
        item.innerHTML = `
            <div class="avatar">${escapeHtml(initial)}</div>
            <div class="chat-mid">
                <div class="chat-name">${escapeHtml(chat.peerName)}</div>
                <div class="chat-preview">${chat.lastMessageText ? escapeHtml(chat.lastMessageText) : 'Нет сообщений — напишите первым'}</div>
            </div>
            <div class="chat-side">
                <div class="chat-time">${escapeHtml(timeStr)}</div>
                ${chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount}</span>` : ''}
            </div>
        `;

        item.onclick = () => openChat(chat.matchId, chat.peerName);
        list.appendChild(item);
    });
}

function openChat(matchId, peerName) {
    currentMatchId = matchId;
    currentPeerName = peerName || 'Собеседник';

    // Ищем имя в списке чатов, если не передано
    if (!peerName || peerName === 'Собеседник') {
        const chatItem = document.querySelector(`.chat-item[data-match-id="${matchId}"]`);
        if (chatItem) {
            const nameEl = chatItem.querySelector('.chat-name');
            if (nameEl) currentPeerName = nameEl.textContent;
        }
    }

    document.querySelector('.app-container').classList.add('chat-open');
    document.getElementById('chatWindow').classList.remove('hidden');
    document.getElementById('chatsListCard').classList.add('hidden');
    document.getElementById('chatTitle').textContent = currentPeerName;
    document.getElementById('messageInput').value = '';
    refreshMessages();

    if (chatPollingInterval) clearInterval(chatPollingInterval);
    chatPollingInterval = setInterval(refreshMessages, 3000);

    // Фокус на поле ввода
    setTimeout(() => document.getElementById('messageInput').focus(), 100);
    syncChatHeight();
    scrollChatToBottom();
}

function closeChatWindow() {
    currentMatchId = null;
    if (chatPollingInterval) clearInterval(chatPollingInterval);
    document.querySelector('.app-container').classList.remove('chat-open');
    document.getElementById('chatWindow').classList.add('hidden');
    document.getElementById('chatsListCard').classList.remove('hidden');
    loadChats();
    updateUnreadBadge();
    document.getElementById('chatWindow').style.removeProperty('--chat-h');
}

async function refreshMessages() {
    if (!currentMatchId) return;
    const resp = await fetch(`/api/messages/${currentMatchId}`, { headers: { 'X-Telegram-Init-Data': tgInitData } });
    if (resp.ok) {
        const messages = await resp.json();
        const container = document.getElementById('chatMessages');
        const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
        container.innerHTML = '';
        messages.forEach(m => {
            const row = document.createElement('div');
            row.className = 'msg-row' + (m.fromMe ? ' mine' : '');
            const meta = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                + (m.fromMe ? (m.read ? ' ✓✓' : ' ✓') : '');
            row.innerHTML = `<div class="bubble">${escapeHtml(m.text)}<span class="meta">${escapeHtml(meta)}</span></div>`;
            container.appendChild(row);
        });
        scrollChatToBottom();
    }
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text || !currentMatchId) return;
    const resp = await fetch(`/api/messages/${currentMatchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tgInitData },
        body: JSON.stringify({ text })
    });
    if (resp.ok) {
        input.value = '';
        await refreshMessages();
        scrollChatToBottom();
    } else {
        const err = await resp.text();
        showMessage(err.replace(/["{}]/g, '').slice(0, 120), 'Ошибка');
    }
}

// ---------- Бейдж непрочитанных ----------

async function updateUnreadBadge() {
    try {
        const resp = await fetch('/api/messages/unread', { headers: { 'X-Telegram-Init-Data': tgInitData } });
        if (!resp.ok) return;
        const data = await resp.json();
        const badge = document.getElementById('msgBadge');
        const n = data.unread || 0;
        if (n > 0) { badge.textContent = n > 99 ? '99+' : n; badge.classList.remove('hidden'); }
        else badge.classList.add('hidden');
    } catch (e) { /* тихо */ }
}

function startUnreadPolling() {
    updateUnreadBadge();
    unreadPollingInterval = setInterval(updateUnreadBadge, 10000);
}

// ---------- Уведомления об откликах ----------

let pendingResponsesCount = 0;

async function loadMatchNotifications() {
    try {
        if (currentUser && !currentUser.chatId) {
            await checkChatIdSilently();
        }
        const resp = await fetch('/api/matches/notifications', { headers: { 'X-Telegram-Init-Data': tgInitData } });
        if (!resp.ok) return;
        const data = await resp.json();
        respondedRideIds = new Set(data.respondedRideIds || []);

        const pending = data.pendingResponsesCount ?? 0;
        const confirming = data.confirmingCount ?? 0;

        // Бейдж на вкладке «Заявки»: новые отклики + брони в подтверждении
        const badge = document.getElementById('ridesBadge');
        if (badge) {
            const total = pending + confirming;
            if (total > 0) { badge.textContent = total > 9 ? '9+' : total; badge.classList.remove('hidden'); }
            else badge.classList.add('hidden');
        }

        // Попап: кто-то принял вашу бронь (пока страница открыта)
        if (lastConfirmingCount !== null && confirming > lastConfirmingCount) {
            showMessage('✅ Вашу бронь приняли! Подтвердите её: «Заявки» → «Мои отклики».', 'Бронь принята');
            loadMyResponses();
        }
        // Попап: новый отклик на вашу заявку
        if (lastPendingCount !== null && pending > lastPendingCount) {
            showMessage('🔔 Новый отклик на вашу заявку! Откройте вкладку «Заявки».', 'Новый отклик');
            loadActiveRide();
            if (currentRidesTab === 'myRides') loadMyRides();
        }
        lastPendingCount = pending;
        lastConfirmingCount = confirming;
    } catch (e) { /* тихо */ }
}




function startMatchNotifications() {
    loadMatchNotifications();
    setInterval(loadMatchNotifications, 15000);
}

// ---------- Подписки ----------

async function loadSubscriptions() {
    const resp = await fetch('/api/subscriptions', { headers: { 'X-Telegram-Init-Data': tgInitData } });
    if (!resp.ok) return;
    const subs = await resp.json();
    const list = document.getElementById('subsList');
    if (!list) return;
    list.innerHTML = '';

    if (subs.length === 0) {
        const roleHint = currentUser?.role === 'DRIVER'
            ? 'Подписка работает в фоне: как только пассажир создаст заявку по вашему маршруту — бот пришлёт уведомление.'
            : 'Подписка работает в фоне: как только водитель создаст заявку по вашему маршруту — бот пришлёт уведомление.';
        list.innerHTML = `
            <div class="empty-state" style="text-align:left;padding:12px 4px;">
                <div style="font-weight:600;margin-bottom:6px;">🔔 Подписок пока нет</div>
                <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">${roleHint}</div>
            </div>`;
    } else {
        subs.forEach(sub => {
            const item = document.createElement('div');
            item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--border);border-radius:12px;margin-bottom:8px;background:#fff;';
            const fromId = `sub_from_${sub.id}`;
            const toId = `sub_to_${sub.id}`;
            item.innerHTML = `
                <div style="flex:1;min-width:0;">
                    <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        📍 <span id="${fromId}">…</span> → <span id="${toId}">…</span>
                    </div>
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">
                        радиус ${sub.radiusMeters / 1000} км · ${sub.createdAt ? new Date(sub.createdAt).toLocaleDateString('ru-RU') : ''}
                    </div>
                </div>
                <button onclick="deleteSubscription(${sub.id})" style="background:none;border:none;color:var(--danger);font-size:20px;cursor:pointer;padding:4px 8px;">✕</button>`;
            list.appendChild(item);

            reverseGeocodeShort(sub.fromLat, sub.fromLon).then(addr => {
                const el = document.getElementById(fromId); if (el) el.textContent = addr;
            });
            reverseGeocodeShort(sub.toLat, sub.toLon).then(addr => {
                const el = document.getElementById(toId); if (el) el.textContent = addr;
            });
        });
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-sm btn-secondary';
    addBtn.textContent = '➕ Подписаться на мой текущий маршрут';
    addBtn.style.cssText = 'width:100%;margin-top:12px;';
    addBtn.onclick = () => { switchScreen('createScreen'); switchCreateMode('subscribe'); };
    list.appendChild(addBtn);
}

async function deleteSubscription(id) {
    if (!confirm('Удалить эту подписку?')) return;
    try {
        const resp = await fetch(`/api/subscriptions/${id}`, {
            method: 'DELETE',
            headers: { 'X-Telegram-Init-Data': tgInitData }
        });
        if (resp.ok) {
            showMessage('Подписка удалена', 'Готово');
            loadSubscriptions();
        } else {
            showMessage('Ошибка при удалении', 'Ошибка');
        }
    } catch (e) {
        showMessage('Сервер недоступен', 'Ошибка');
    }
}

async function subscribeFromCurrent() {
    // 1. Ищем активную заявку на сервере — это надёжный источник координат
    let ride = null;
    try {
        const r = await fetch('/api/rides/my?status=ACTIVE', { headers: { 'X-Telegram-Init-Data': tgInitData } });
        if (r.ok) {
            const rides = await r.json();
            ride = rides[0] || null;
        }
    } catch (e) { /* не критично */ }

    // 2. Если активной заявки нет — берём маршрут из формы создания, если он там заполнен
    let from, to;
    if (ride) {
        from = { latitude: ride.fromLat, longitude: ride.fromLon };
        to   = { latitude: ride.toLat,   longitude: ride.toLon };
    } else if (selectedFrom && selectedTo) {
        from = selectedFrom;
        to   = selectedTo;
    } else {
        // 3. Понятная подсказка без страшного попапа
        showToast('Сначала создайте заявку во вкладке «Создать» — и тогда сможете подписаться на этот маршрут.', 'warn');
        switchScreen('createScreen');
        return;
    }

    // 4. Защита от дубля: не подписываемся на уже существующий маршрут
    try {
        const existing = await fetch('/api/subscriptions', { headers: { 'X-Telegram-Init-Data': tgInitData } });
        if (existing.ok) {
            const subs = await existing.json();
            const dup = subs.some(s =>
                Math.abs(s.fromLat - from.latitude) < 0.001 && Math.abs(s.fromLon - from.longitude) < 0.001 &&
                Math.abs(s.toLat   - to.latitude)   < 0.001 && Math.abs(s.toLon   - to.longitude)   < 0.001);
            if (dup) { showToast('Вы уже подписаны на этот маршрут 👍', 'info'); return; }
        }
    } catch (e) { /* не критично */ }

    // 5. Создаём подписку
    const resp = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tgInitData },
        body: JSON.stringify({
            fromLat: from.latitude, fromLon: from.longitude,
            toLat: to.latitude,     toLon: to.longitude,
            radiusMeters: 5000
        })
    });
    if (resp.ok) {
        showToast('🔔 Готово! Пришлём уведомление, когда по этому маршруту поедет попутчик.', 'ok');
        loadSubscriptions();
        showNotifyBanner();
    } else {
        showToast('Не удалось создать подписку. Попробуйте позже.', 'err');
    }
}

// ---------- Модалка карты ----------

function openMapModal(mode) {
    choosingFor = mode;
    const doneBtn = document.getElementById('mapConfirmBtn');
    if (doneBtn) doneBtn.classList.toggle('hidden', mode === 'alternatives');
    document.getElementById('mapModal').classList.add('active');
    const titleMap = { from: 'Откуда', to: 'Куда', waypoint: 'Точка по пути' };
    document.getElementById('mapModalTitle').textContent = titleMap[mode] || 'Выберите точку';
    setTimeout(() => {
        if (!map) {
            map = L.map('mapContainer', { center: [53.9, 27.56], zoom: 11, attributionControl: true });
            map.attributionControl.setPrefix(false);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
            map.on('click', (e) => setTempMarker(e.latlng.lat, e.latlng.lng));
        } else map.invalidateSize();

        let existing = null;
        if (choosingFor === 'from') existing = selectedFrom;
        else if (choosingFor === 'to') existing = selectedTo;
        if (userLocation && !existing) {
            map.setView([userLocation.lat, userLocation.lon], 12);
        }
        if (existing) {
            setTempMarker(existing.latitude, existing.longitude);
            map.setView([existing.latitude, existing.longitude], 11);
        }
    }, 100);
}

function setTempMarker(lat, lon) {
    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = L.marker([lat, lon], { draggable: true }).addTo(map);
    tempMarker.on('dragend', () => {
        const pos = tempMarker.getLatLng();
        selectedMapPoint = { lat: pos.lat, lon: pos.lng };
    });
    selectedMapPoint = { lat, lon };
}

function closeMapModal() {
    document.getElementById('mapModal').classList.remove('active');
    if (map) {
        map.eachLayer(layer => {
            if (layer instanceof L.Marker) map.removeLayer(layer);
        });
        tempMarker = null;
        if (altRouteLayers.length > 0) altRouteLayers.forEach(p => map.removeLayer(p));
        altRouteLayers = [];
        chosenRouteIndex = null;
    }
}


function confirmMapPoint() {
    if (!selectedMapPoint) { showMessage('Выберите точку на карте'); return; }
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${selectedMapPoint.lat}&lon=${selectedMapPoint.lon}&format=json&accept-language=ru`)
        .then(r => r.json())
        .then(data => handleMapPoint({
            displayName: data?.display_name || `Точка (${selectedMapPoint.lat.toFixed(4)}, ${selectedMapPoint.lon.toFixed(4)})`,
            latitude: selectedMapPoint.lat, longitude: selectedMapPoint.lon
        }))
        .catch(() => handleMapPoint({
            displayName: `Точка (${selectedMapPoint.lat.toFixed(4)}, ${selectedMapPoint.lon.toFixed(4)})`,
            latitude: selectedMapPoint.lat, longitude: selectedMapPoint.lon
        }));
}

function handleMapPoint(place) {
    if (choosingFor === 'waypoint') { addWaypoint(place); closeMapModal(); return; }
    assignPlace(choosingFor, place);
    closeMapModal();
}



function closeDetailsModal() {
    document.getElementById('detailsModal').classList.remove('active');
    if (detailsMap) { detailsMap.remove(); detailsMap = null; detailsRouteLayer = null; }
}


// ---------- Отзывы ----------

function openReviewModal(rideRequestId, targetTelegramId) {
    reviewRideRequestId = rideRequestId;
    reviewTargetTelegramId = targetTelegramId;
    selectedRating = 0;
    document.getElementById('reviewComment').value = '';
    document.getElementById('reviewModal').classList.add('active');
    document.querySelectorAll('.star').forEach(s => s.classList.remove('active'));
}

function closeReviewModal() { document.getElementById('reviewModal').classList.remove('active'); }

async function submitReview() {
    if (selectedRating === 0) { showMessage('Пожалуйста, выберите оценку', 'Ошибка'); return; }
    const comment = document.getElementById('reviewComment').value.trim();
    const resp = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tgInitData },
        body: JSON.stringify({ rideRequestId: reviewRideRequestId, reviewedTelegramId: reviewTargetTelegramId, rating: selectedRating, comment })
    });
    if (resp.ok) {
        showMessage('Спасибо за отзыв!');
        closeReviewModal();
        // Перерисовываем все списки, чтобы кнопка пропала
        loadMyRides();
        loadMyResponses();
        if (typeof currentRideId === 'number') loadResponsesForRide(currentRideId);
    } else {
        showMessage(await resp.text(), 'Ошибка');
    }

}

// ---------- Профиль ----------


async function openProfileScreen() {
    if (!currentUser) {
        showMessage('Пользователь не загружен. Обновите страницу.', 'Ошибка');
        return;
    }

    document.querySelector('.app-container').classList.add('hide-header');
    // Переключаем экран
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('profileScreen').classList.add('active');

    // Заполняем данные
    document.getElementById('profileName').textContent = currentUser.firstName || 'Пользователь';
    document.getElementById('profileUsername').textContent = currentUser.username ? `@${currentUser.username}` : '';
    document.getElementById('profileAvatar').textContent = (currentUser.firstName || '?')[0].toUpperCase();
    document.getElementById('profileStars').textContent = currentUser.rating ? currentUser.rating.toFixed(1) : '—';
    document.getElementById('profileTripCount').textContent = currentUser.tripCount || 0;
    document.getElementById('profileRole').textContent = currentUser.role === 'DRIVER' ? 'Водитель' : 'Пассажир';

    // О себе
    document.getElementById('aboutMeDisplay').textContent = currentUser.aboutMe || 'Не указано';

    // Уведомления
    const notifyEl = document.getElementById('notifyStatus');
    if (currentUser.chatId) {
        notifyEl.innerHTML = '✅ Включены — бот напишет, когда появится попутчик';
    } else {
        notifyEl.innerHTML = '❌ Выключены — <button class="btn btn-sm" style="margin:0;padding:6px 12px;font-size:12px;" onclick="openBotForNotifications()">Включить</button>';
    }

    // Телефон
    await loadPhoneStatus();

    // Авто
    if (currentUser.role === 'DRIVER') {
        document.getElementById('vehicleSection').classList.remove('hidden');
        try {
            const r = await fetch('/api/vehicles/my', { headers: { 'X-Telegram-Init-Data': tgInitData } });
            if (r.ok) {
                const v = await r.json();
                const vehicleText = `${v.brand || ''} ${v.model || ''}, ${v.color || ''} · ${v.seats || '?'} мест${v.plateNumber ? ` · ${v.plateNumber}` : ''}`;
                document.getElementById('vehicleDisplay').textContent = vehicleText.trim();
            } else {
                document.getElementById('vehicleDisplay').textContent = 'Не указан';
            }
        } catch (e) {
            document.getElementById('vehicleDisplay').textContent = 'Не удалось загрузить';
        }
    } else {
        document.getElementById('vehicleSection').classList.add('hidden');
    }

    // Отзывы
    await loadRecentReviewsScreen(currentUser.telegramId);
}



(async () => {
    if (isTestMode) {
        const asParam = new URLSearchParams(location.search).get('as');
        if (asParam) localStorage.setItem('ridemateTestUser', asParam);
        const savedId = localStorage.getItem('ridemateTestUser');
        if (!savedId) {
            ensureTestPanel(null);
            return;
        }
        const meta = TEST_USERS.find(u => String(u.id) === String(savedId));
        try {
            const resp = await fetch(`/debug/init-data?userId=${savedId}&firstName=${encodeURIComponent(meta?.firstName || 'Тест')}`);
            if (!resp.ok) throw new Error('Не удалось получить тестовый initData');
            tgInitData = (await resp.json()).initData;
        } catch (e) {
            alert('Ошибка тестовой авторизации: ' + e.message);
            return;
        }
        ensureTestPanel(savedId);
    }
    await registerUser();
    const startParam = tg.initDataUnsafe?.start_param || '';
    if (startParam.startsWith('ride_')) {
        const sharedRideId = parseInt(startParam.slice(5));
        if (sharedRideId) setTimeout(() => openRideDetails(sharedRideId), 800);
    }

    startUnreadPolling();
    bindChatViewport();
    await loadMatchNotifications();   // сначала узнаём про отклики
    loadActiveRide();                  // потом рисуем карточку с бейджем
    startMatchNotifications();
    setTimeout(initMainMap, 100);

})();


document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.star').forEach(star => {
        star.addEventListener('click', () => {
            selectedRating = parseInt(star.dataset.value);
            document.querySelectorAll('.star').forEach(s => s.classList.toggle('active', parseInt(s.dataset.value) <= selectedRating));
        });
    });
});


// ===== Адреса и отзывы в «Деталях заявки» =====

const addressCache = new Map();
const reviewsCache = new Map();

async function reverseGeocodeShort(lat, lon) {
    const key = lat.toFixed(4) + ',' + lon.toFixed(4);
    if (addressCache.has(key)) return addressCache.get(key);
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ru`);
        const data = await r.json();
        let addr = data?.display_name || null;
        if (addr) {
            const parts = addr.split(',');
            addr = parts.slice(0, 3).join(',').trim();
        }
        const result = addr || `Точка (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
        addressCache.set(key, result);
        return result;
    } catch (e) {
        return `Точка (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
    }
}

async function loadUserReviews(telegramId, container) {
    if (!telegramId || !container) return;

    // Если отзывы уже загружали — берём из кэша
    if (reviewsCache.has(telegramId)) {
        container.innerHTML = reviewsCache.get(telegramId);
        return;
    }

    try {
        container.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);">Загрузка отзывов...</div>';
        const resp = await fetch(`/api/reviews/about?telegramId=${telegramId}`, { headers: { 'X-Telegram-Init-Data': tgInitData } });

        if (!resp.ok) {
            container.innerHTML = '';
            return;
        }

        const reviews = await resp.json();
        if (!reviews.length) {
            const emptyHtml = '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">Отзывов пока нет</div>';
            container.innerHTML = emptyHtml;
            reviewsCache.set(telegramId, emptyHtml);
            return;
        }

        let html = `<div style="font-size:12px;font-weight:600;margin-bottom:4px;color:var(--text-secondary);">Последние отзывы:</div>`;

        // Показываем 2 последних отзыва
        reviews.slice(0, 2).forEach(r => {
            html += `<div style="font-size:12px;padding:6px 8px;background:#f8f9fa;border-radius:8px;margin-bottom:4px;border-left:2px solid var(--primary);">
                <strong>${escapeHtml(r.authorName || 'Пользователь')}</strong>
                <span style="color:#ff9800;">${'⭐'.repeat(r.rating || 0)}</span>
                ${r.comment ? `<div style="margin-top:2px;color:var(--text-primary);">"${escapeHtml(r.comment)}"</div>` : ''}
            </div>`;
        });

        if (reviews.length > 2) {
            html += `<div style="font-size:11px;color:var(--primary);margin-top:2px;">...и ещё ${reviews.length - 2} отзывов</div>`;
        }

        container.innerHTML = html;
        reviewsCache.set(telegramId, html);
    } catch (e) {
        container.innerHTML = '';
    }
}

async function openRideDetails(rideId) {
    const resp = await fetch(`/api/rides/${rideId}`, { headers: { 'X-Telegram-Init-Data': tgInitData } });
    if (!resp.ok) { showMessage('Не удалось загрузить детали', 'Ошибка'); return; }
    const d = await resp.json();
    const body = document.getElementById('detailsBody');

    body.innerHTML = `
        <div class="details-row"><span class="k">Кто</span><span class="v">${roleEmoji(d.role)} ${escapeHtml(d.ownerName)}</span></div>
        <div class="details-row"><span class="k">Username</span><span class="v">${d.ownerUsername ? '@' + escapeHtml(d.ownerUsername) : 'не указан'}</span></div>
        <div class="details-row"><span class="k">Рейтинг</span><span class="v">${d.ownerRating ? `⭐ ${d.ownerRating.toFixed(1)}` : 'нет оценок'}</span></div>
        <div class="details-row"><span class="k">Поездок</span><span class="v">${d.ownerTripCount ?? 0}</span></div>
        <div class="details-row"><span class="k">Откуда</span><span class="v" id="detailsFromAddr">загрузка…</span></div>
        <div class="details-row"><span class="k">Куда</span><span class="v" id="detailsToAddr">загрузка…</span></div>
        <div class="details-row"><span class="k">Время</span><span class="v">${d.departureTime ? new Date(d.departureTime).toLocaleString() + ` · ±${d.timeFlexibilityMinutes} мин` : 'не указано'}</span></div>
        ${d.role === 'DRIVER' ? `
        <div class="details-row"><span class="k">Места</span><span class="v">свободно: ${d.availableSeats ?? '—'}${d.vehicleSeats ? ` (в машине: ${d.vehicleSeats})` : ''}</span></div>
        <div class="details-row"><span class="k">Цена</span><span class="v">${d.pricePerSeat ? d.pricePerSeat + ' BYN/место' : 'не указана'}</span></div>
        <div class="details-row"><span class="k">Авто</span><span class="v">${d.vehicleBrand ? escapeHtml(d.vehicleBrand) + ' ' + escapeHtml(d.vehicleModel || '') + (d.vehicleColor ? ', ' + escapeHtml(d.vehicleColor) : '') : 'не указано'}</span></div>
        ` : ''}
        <div class="details-row"><span class="k">Комментарий</span><span class="v">${d.note ? escapeHtml(d.note) : '—'}</span></div>
        <div style="margin-top:12px;">
            <div style="font-weight:600;margin-bottom:6px;">Отзывы о ${escapeHtml(d.ownerName)}:</div>
            <div id="detailsReviews">загрузка…</div>
        </div>
    `;

    // Мини-карта с маршрутом — инициализируем после показа модалки
    setTimeout(() => {
        const mapEl = document.getElementById('detailsMap');
        if (!mapEl) return;
        if (detailsMap) { detailsMap.remove(); detailsMap = null; }
        detailsMap = L.map(mapEl, {
            center: [(d.fromLat + d.toLat) / 2, (d.fromLon + d.toLon) / 2],
            zoom: 8, attributionControl: true, zoomControl: true
        });
        detailsMap.attributionControl.setPrefix(false);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(detailsMap);
        L.marker([d.fromLat, d.fromLon]).addTo(detailsMap);
        L.marker([d.toLat, d.toLon]).addTo(detailsMap);
        // Настоящая дорога с бэкенда; при неудаче — прямая линия между точками
        fetch(`/api/rides/${d.id}/route`, { headers: { 'X-Telegram-Init-Data': tgInitData } })
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(coords => {
                if (!coords || coords.length < 2) throw new Error();
                detailsRouteLayer = L.polyline(coords, { color: '#0088cc', weight: 4, opacity: 0.8 }).addTo(detailsMap);
                detailsMap.fitBounds(detailsRouteLayer.getBounds().pad(0.15));
            })
            .catch(() => {
                detailsRouteLayer = L.polyline([[d.fromLat, d.fromLon], [d.toLat, d.toLon]], { color: '#0088cc', weight: 3, dashArray: '6 6', opacity: 0.7 }).addTo(detailsMap);
                detailsMap.fitBounds(detailsRouteLayer.getBounds().pad(0.3));
            });
    }, 150);


    reverseGeocodeShort(d.fromLat, d.fromLon).then(addr => {
        const el = document.getElementById('detailsFromAddr');
        if (el) el.textContent = addr;
    });
    reverseGeocodeShort(d.toLat, d.toLon).then(addr => {
        const el = document.getElementById('detailsToAddr');
        if (el) el.textContent = addr;
    });

    // ===== БЛОК НАВИГАТОРОВ =====
    const navHtml = `
        <div style="margin-top: 14px; background: #f8f9fa; padding: 12px; border-radius: 12px; border: 1px solid var(--border);">
            <div style="font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary);">🗺️ Открыть маршрут в навигаторе:</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button class="btn btn-sm" style="background: #fc3f1d; color: white; flex: 1;" onclick="openNavigator('yandex', ${d.fromLat}, ${d.fromLon}, ${d.toLat}, ${d.toLon}, '${encodeURIComponent(JSON.stringify(d.waypoints || []))}')">Яндекс</button>
                <button class="btn btn-sm" style="background: #4285F4; color: white; flex: 1;" onclick="openNavigator('google', ${d.fromLat}, ${d.fromLon}, ${d.toLat}, ${d.toLon}, '${encodeURIComponent(JSON.stringify(d.waypoints || []))}')">Google</button>
                <button class="btn btn-sm" style="background: #16a34a; color: white; flex: 1;" onclick="openNavigator('2gis', ${d.fromLat}, ${d.fromLon}, ${d.toLat}, ${d.toLon}, '')">2ГИС</button>
            </div>
        </div>
    `;
    // Вставляем блок в конец detailsBody
    body.innerHTML += navHtml;

    const reviewsEl = document.getElementById('detailsReviews');
    if (reviewsEl) {
        if (d.ownerTelegramId) loadUserReviews(d.ownerTelegramId, reviewsEl);
        else reviewsEl.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);">Пока нет отзывов</p>';
    }

    const actions = document.getElementById('detailsActions');
    actions.innerHTML = '';
    if (d.isMine) {
        actions.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">Это ваша заявка — отредактировать её можно на вкладке «Создать».</p>';
    } else if (respondedRideIds.has(d.id)) {
        const sent = document.createElement('button');
        sent.className = 'btn btn-secondary';
        sent.textContent = 'Отправлено ✓';
        sent.disabled = true;
        actions.appendChild(sent);
    } else {
        const respondBtn = document.createElement('button');
        respondBtn.className = 'btn';
        respondBtn.textContent = 'Откликнуться';
        respondBtn.onclick = () => respondToRide(d.id, respondBtn, { role: d.role, availableSeats: d.availableSeats });
        actions.appendChild(respondBtn);

        const shareBtn = document.createElement('button');
        shareBtn.className = 'btn btn-sm btn-secondary';
        shareBtn.textContent = '📤 Поделиться';
        shareBtn.onclick = () => shareRide(d.id);
        actions.appendChild(shareBtn);
    }

    document.getElementById('detailsModal').classList.add('active');
}


// ===== Адреса вместо координат во всех карточках =====

// Ловим пару «широта, долгота» с 3-6 знаками после точки, в скобках или без.
// Даты («22.11.2026») и цены не совпадают: у них мало знаков после точки или нет второй группы.
const COORD_PATTERN = /[(]?\s*(\d{1,2}\.\d{3,6}),\s*(\d{1,3}\.\d{3,6})\s*[)]?/g;


async function beautifyCoordinates(root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets = [];
    while (walker.nextNode()) {
        COORD_PATTERN.lastIndex = 0;
        if (COORD_PATTERN.test(walker.currentNode.nodeValue)) targets.push(walker.currentNode);
    }
    for (const node of targets) {
        const original = node.nodeValue;
        COORD_PATTERN.lastIndex = 0;
        const pairs = [];
        let m;
        while ((m = COORD_PATTERN.exec(original)) !== null) {
            pairs.push({ full: m[0], lat: parseFloat(m[1]), lon: parseFloat(m[2]) });
        }
        let updated = original;
        for (const p of pairs) {
            updated = updated.replace(p.full, await reverseGeocodeShort(p.lat, p.lon));
        }
        node.nodeValue = updated;
    }
}

// После отрисовки карточек функциями приложения — прогоняем замену по экрану
function wrapAfterRender(name) {
    try {
        const orig = window[name];
        if (typeof orig !== 'function') return;
        window[name] = async function (...args) {
            const result = await orig.apply(this, args);
            await beautifyCoordinates();
            return result;
        };
    } catch (e) { /* функции с таким именем нет — пропускаем */ }
}

['loadActiveRide', 'loadSubscriptions', 'loadMyRides'].forEach(wrapAfterRender);

// Страховка: карточки, отрисованные другими функциями, подхватятся раз в 3 секунды.
// Кэш адресов делает это почти бесплатным.
setInterval(() => beautifyCoordinates(), 3000);

let ownRouteLayer = null;

async function drawMyRoute() {
    if (!currentRideId) return;
    try {
        const resp = await fetch(`/api/rides/${currentRideId}/route`,
            { headers: { 'X-Telegram-Init-Data': tgInitData } });
        if (!resp.ok) return;
        const coords = await resp.json();
        if (ownRouteLayer) { mainMap.removeLayer(ownRouteLayer); ownRouteLayer = null; }
        if (!coords || coords.length < 2) return;
        ownRouteLayer = L.polyline(coords, { color: '#1a73e8', weight: 4, opacity: 0.7 })
            .addTo(mainMap);
    } catch (e) { /* маршрут — украшение, не критично */ }
}

let altRouteLayers = [];
let chosenRouteIndex = null;
let detailsMap = null;
let detailsRouteLayer = null;

const ALT_COLORS = ['#1a73e8', '#f4511e', '#2e7d32'];

async function showRouteAlternatives() {
    if (!selectedFrom || !selectedTo) { showMessage('Сначала выберите обе точки'); return; }

    let url = `/api/rides/alternatives?fromLat=${selectedFrom.latitude}&fromLon=${selectedFrom.longitude}`
        + `&toLat=${selectedTo.latitude}&toLon=${selectedTo.longitude}`;

    // 🔥 ДОБАВЛЕНО: Логирование для отладки
    console.log("📍 Текущие waypoints перед отправкой:", waypoints);

    if (waypoints && waypoints.length > 0) {
        waypoints.forEach(wp => {
            url += `&waypoints=${wp.latitude},${wp.longitude}`;
        });
    } else {
        console.warn("⚠️ Внимание: массив waypoints пуст. Маршрут будет построен только по точкам Откуда-Куда.");
    }

    let routes;
    try {
        const resp = await fetch(url, { headers: { 'X-Telegram-Init-Data': tgInitData } });
        if (!resp.ok) throw new Error(await resp.text());
        routes = await resp.json();
    } catch (e) {
        showMessage('Не удалось получить варианты дороги: ' + e.message, 'Ошибка');
        return;
    }

    if (!routes || routes.length <= 1) {
        showMessage('Альтернативных дорог на этом маршруте нет — будет использован основной вариант.', 'info');
        return;
    }

    openMapModal('alternatives');
    document.getElementById('mapModalTitle').textContent = 'Коснитесь линии, чтобы выбрать дорогу';

    setTimeout(() => {
        clearAltRoutes();
        routes.forEach((coords, i) => {
            const poly = L.polyline(coords, {
                color: ALT_COLORS[i] || '#757575', weight: 5, opacity: 0.8
            }).addTo(map);
            poly.bindTooltip(`Вариант ${i + 1}`, { sticky: true });
            poly.on('click', () => selectRouteAlternative(i));
            altRouteLayers.push(poly);
        });
        if (altRouteLayers.length > 0) {
            map.fitBounds(L.featureGroup(altRouteLayers).getBounds().pad(0.15));
        }
        chosenRouteIndex = null;
    }, 100);
}

function selectRouteAlternative(i) {
    chosenRouteIndex = i;
    const hint = document.getElementById('routeChoiceHint');
    if (hint) hint.textContent = `Выбран вариант ${i + 1}`;
    closeMapModal();
    showMessage(`Выбран вариант дороги ${i + 1}. Сохраните заявку, чтобы маршрут закрепился.`, 'Дорога выбрана');
}

function clearAltRoutes() {
    if (map) altRouteLayers.forEach(p => map.removeLayer(p));
    altRouteLayers = [];
    chosenRouteIndex = null;
}


function reportOutcome(matchId, outcome) {
    const labels = {
        COMPLETED: 'Поездка состоялась',
        NO_SHOW_PASSENGER: 'Пассажир не пришёл',
        NO_SHOW_DRIVER: 'Водитель не выехал'
    };
    if (!confirm(labels[outcome] + '?')) return;
    fetch(`/api/matches/${matchId}/outcome?outcome=${outcome}`, {
        method: 'PUT', headers: { 'X-Telegram-Init-Data': tgInitData }
    }).then(r => {
        if (r.ok) showMessage('Зафиксировали. Второй стороне тоже нужно подтвердить исход.');
        else r.text().then(t => showMessage(t.replace(/["{}]/g, ''), 'Ошибка'));
        if (typeof currentRideId === 'number') loadResponsesForRide(currentRideId);
        loadMyResponses();
    });
}

function humanMatchStatus(s) {
    const map = {
        PENDING: 'Ожидает ответа', CONFIRMING: 'Ждёт подтверждения', CONFIRMED: 'Подтверждено',
        COMPLETED: 'Состоялась', NO_SHOW_PASSENGER: 'Пассажир не пришёл',
        NO_SHOW_DRIVER: 'Водитель не выехал', DISPUTED: 'Спор — на модерации', REJECTED: 'Отклонено'
    };
    return map[s] || s;
}


// ===== Телефон: подтверждение через бота =====

async function loadPhoneStatus() {
    const statusEl = document.getElementById('phoneStatus');
    const formEl = document.getElementById('phoneForm');
    if (!statusEl || !formEl) return;
    try {
        const r = await fetch('/api/phone/status', { headers: { 'X-Telegram-Init-Data': tgInitData } });
        if (!r.ok) return;
        const s = await r.json();
        if (s.verified) {
            statusEl.innerHTML = '📞 ' + escapeHtml(formatPhone(s.phone)) +
                ' <span style="color:var(--passenger);font-weight:600;">✅ подтверждён</span>';
            formEl.classList.add('hidden');
        } else {
            statusEl.textContent = '📞 Телефон не подтверждён — попутчику проще довериться, когда он есть';
            formEl.classList.remove('hidden');
            document.getElementById('codeRow').classList.add('hidden');
        }
    } catch (e) { /* статус телефона — не критично */ }
}

async function requestPhoneCode() {
    const countryCode = document.getElementById('phoneCountryCode').value; // "+375", "+7"...
    const localDigits = document.getElementById('phoneInput').value.trim().replace(/\D/g, '');

    if (!localDigits) { showMessage('Введите номер телефона', 'Ошибка'); return; }

    // Требуемая длина локальной части по коду страны
    const REQUIRED = { '+375': 9, '+7': 10, '+998': 9, '+996': 9, '+992': 9, '+374': 8, '+994': 9 };
    const need = REQUIRED[countryCode];

    if (need && localDigits.length !== need) {
        showMessage(`Для кода ${countryCode} нужно ${need} цифр, сейчас ${localDigits.length}`, 'Проверьте номер');
        return;
    }

    const fullPhone = countryCode + localDigits;

    try {
        const r = await fetch('/api/phone/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tgInitData },
            body: JSON.stringify({ phone: fullPhone })
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) {
            document.getElementById('codeRow').classList.remove('hidden');
            showMessage(body.message || 'Код отправлен вам в чат с ботом', 'Проверьте Telegram');
        } else {
            showMessage(body.message || 'Не удалось отправить код', 'Ошибка');
        }
    } catch (e) {
        showMessage('Сервер недоступен, попробуйте позже', 'Ошибка');
    }
}

async function verifyPhoneCode() {
    const code = document.getElementById('phoneCodeInput').value.trim();
    if (!code) { showMessage('Введите код из сообщения бота', 'Ошибка'); return; }
    try {
        const r = await fetch('/api/phone/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tgInitData },
            body: JSON.stringify({ code })
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) {
            document.getElementById('phoneCodeInput').value = '';
            await loadPhoneStatus();
            showMessage('Телефон подтверждён! Ваш профиль стал надёжнее.', 'Готово');
        } else {
            showMessage(body.message || 'Неверный код', 'Ошибка');
        }
    } catch (e) {
        showMessage('Сервер недоступен, попробуйте позже', 'Ошибка');
    }
}


// ===== Поделиться поездкой =====

function shareRide(rideId) {
    const url = `https://t.me/${BOT_USERNAME}?startapp=ride_${rideId}`;
    const text = `🚗 Еду через RideMate — присоединяйся! ${url}`;
    if (navigator.share) {
        navigator.share({ title: 'RideMate', text, url }).catch(() => copyShareLink(url));
    } else {
        copyShareLink(url);
    }
}

function copyShareLink(url) {
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url)
            .then(() => showMessage('Ссылка скопирована — отправьте её в чат или переслать', 'Поделиться'))
            .catch(() => showMessage('Ссылка: ' + url, 'Поделиться'));
    } else {
        showMessage('Ссылка: ' + url, 'Поделиться');
    }
}

// ===== Обратная связь =====
const TOPIC_LABELS = { PROBLEM: '🐛 Проблема', IDEA: '💡 Идея', QUESTION: '❓ Вопрос' };


function openSupportModal() {
    document.getElementById('supportTopic').value = 'PROBLEM';
    document.getElementById('supportMessage').value = '';
    document.getElementById('supportModal').classList.add('active');
    loadMySupport();
}

function closeSupportModal() { document.getElementById('supportModal').classList.remove('active'); }

async function sendSupport() {
    const message = document.getElementById('supportMessage').value.trim();
    if (!message) { showMessage('Напишите текст обращения', 'Ошибка'); return; }
    const r = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tgInitData },
        body: JSON.stringify({ topic: document.getElementById('supportTopic').value, message })
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok && body.ok) {
        document.getElementById('supportMessage').value = '';
        showMessage('Отправлено! Мы обязательно прочтём.', 'Спасибо');
        loadMySupport();
    } else {
        showMessage(body.message || 'Не удалось отправить', 'Ошибка');
    }
}

async function loadMySupport() {
    const r = await fetch('/api/support/my', { headers: { 'X-Telegram-Init-Data': tgInitData } });
    if (!r.ok) return;
    const items = await r.json();
    const box = document.getElementById('supportMyList');
    box.innerHTML = items.length === 0
        ? '<div style="font-size:13px;color:var(--text-secondary);">Ваших обращений пока нет</div>'
        : '<div style="font-weight:600;font-size:13px;">Ваши обращения:</div>';
    items.forEach(i => {
        const div = document.createElement('div');
        div.style.cssText = 'font-size:13px;padding:6px 0;border-top:1px solid var(--border);';
        div.innerHTML = `${TOPIC_LABELS?.[i.topic] || i.topic} · ${i.status === 'NEW' ? '🟡 новый' : '✅ решён'}<br>${escapeHtml(i.message).slice(0, 120)}`;
        box.appendChild(div);
    });
}


function openNavigator(app, fromLat, fromLon, toLat, toLon, waypointsEncoded) {
    let waypoints = [];
    if (waypointsEncoded) {
        try { waypoints = JSON.parse(decodeURIComponent(waypointsEncoded)); } catch(e) {}
    }

    let url = '';

    if (app === 'yandex') {
        let rtext = `${fromLat},${fromLon}`;
        if (waypoints.length > 0) {
            waypoints.forEach(wp => {
                if (wp.lat && wp.lon) rtext += `~${wp.lat},${wp.lon}`;
            });
        }
        rtext += `~${toLat},${toLon}`;
        url = `https://yandex.ru/maps/?rtext=${encodeURIComponent(rtext)}&rtt=auto`;

    } else if (app === 'google') {
        url = `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLon}&destination=${toLat},${toLon}&travelmode=driving`;
        if (waypoints.length > 0) {
            const wpStr = waypoints
                .filter(wp => wp.lat && wp.lon)
                .map(wp => `${wp.lat},${wp.lon}`)
                .join('|');
            if (wpStr) {
                url += `&waypoints=${encodeURIComponent(wpStr)}`;
            }
        }
    } else if (app === '2gis') {
        // ⚠️ ВАЖНО: Веб-версия 2ГИС официально НЕ поддерживает промежуточные точки в URL.
        // Она построит маршрут только от А до Б. Это ограничение самого 2ГИС, а не вашего кода.
        url = `https://2gis.ru/routeSearch/rsType/car/from/${fromLon},${fromLat}/to/${toLon},${toLat}`;
    }

    window.open(url, '_blank');
}

function updatePricePlaceholder() {
    const input = document.getElementById('priceInput');
    if (!input) return;

    const examples = {
        'RUB': 'Например: 500',
        'KZT': 'Например: 2000',
        'UZS': 'Например: 50000',
        'BYN': 'Например: 25',
        'USD': 'Например: 10'
    };

    input.placeholder = examples[userCurrency] || 'Цена за место';

    // Адаптируем шаг ввода под валюту
    if (userCurrency === 'UZS' || userCurrency === 'KZT') {
        input.step = '100';
    } else {
        input.step = '1';
    }
}

function showToast(text, type = 'info') {
    let box = document.getElementById('toastBox');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toastBox';
        box.style.cssText = 'position:fixed;left:50%;bottom:calc(var(--nav-height)+16px);transform:translateX(-50%);'
            + 'z-index:3000;max-width:92%;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        document.body.appendChild(box);
    }
    const colors = { info: '#1e1e1e', ok: '#2e7d32', warn: '#f57f17', err: '#d32f2f' };
    const toast = document.createElement('div');
    toast.style.cssText = 'background:' + (colors[type] || colors.info) + ';color:#fff;padding:12px 16px;'
        + 'border-radius:12px;font-size:14px;line-height:1.4;box-shadow:0 4px 16px rgba(0,0,0,.25);'
        + 'opacity:0;transition:opacity .25s;pointer-events:auto;';
    toast.textContent = text;
    box.appendChild(toast);
    requestAnimationFrame(() => toast.style.opacity = '1');
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 250);
    }, 3500);
}

// Пересчёт высоты чата под видимую область (учитывает клавиатуру)
function syncChatHeight() {
    const win = document.getElementById('chatWindow');
    if (!win || win.classList.contains('hidden')) return;
    // visualViewport.height — реальная высота без клавиатуры (где поддерживается)
    const h = (window.visualViewport && window.visualViewport.height)
        ? window.visualViewport.height
        : window.innerHeight;
    win.style.setProperty('--chat-h', h + 'px');
    scrollChatToBottom();
}

// Всегда показать последнее сообщение
function scrollChatToBottom() {
    const c = document.getElementById('chatMessages');
    if (!c) return;
    // двойной кадр — чтобы сработало после рендера клавиатуры
    requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
    setTimeout(() => { c.scrollTop = c.scrollHeight; }, 120);
}

// Подписка на события Telegram WebApp (клавиатура, expand/collapse)
function bindChatViewport() {
    if (!tg || !tg.onEvent) return;
    tg.onEvent('viewportChanged', () => {
        syncChatHeight();
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncChatHeight);
        window.visualViewport.addEventListener('scroll', syncChatHeight);
    }
}

function formatPhone(raw) {
    if (!raw) return '—';
    const d = raw.replace(/\D/g, '');
    if (d.startsWith('375') && d.length === 12) {
        return `+${d.slice(0,3)} (${d.slice(3,5)}) ${d.slice(5,8)}-${d.slice(8,10)}-${d.slice(10,12)}`;
    }
    if (d.startsWith('7') && d.length === 11) {
        return `+${d.slice(0,1)} (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9,11)}`;
    }
    return raw; // fallback
}

// Показывать баннер только когда человек реально ждёт уведомлений
function shouldShowNotifyBanner() {
    if (currentUser?.chatId) return false;
    // Не чаще 1 раза в 24 часа, если закрыли без действия
    const last = localStorage.getItem('notifyBannerDismissedAt');
    if (last && Date.now() - Number(last) < 24 * 3600 * 1000) return false;
    return true;
}

function showNotifyBanner() {
    if (!shouldShowNotifyBanner()) return;
    const banner = document.getElementById('notifyBanner');
    if (banner) banner.classList.remove('hidden');
}

function dismissNotifyBanner() {
    const banner = document.getElementById('notifyBanner');
    if (banner) banner.classList.add('hidden');
    localStorage.setItem('notifyBannerDismissedAt', String(Date.now()));
}

function openBotForNotifications() {
    // Открываем чат с ботом с готовым сообщением /start
    tg.openTelegramLink(`https://t.me/${BOT_USERNAME}?start=enable_notifications`);
    // Скрываем баннер — человек уже сделал шаг
    document.getElementById('notifyBanner')?.classList.add('hidden');
    localStorage.setItem('notifyBannerDismissedAt', String(Date.now()));
}

// Автопроверка: если человек нажал /start и вернулся — баннер скрывается сам
async function checkChatIdSilently() {
    try {
        const r = await fetch('/api/users/me', { headers: { 'X-Telegram-Init-Data': tgInitData } });
        if (!r.ok) return;
        const u = await r.json();
        if (u.chatId && currentUser && !currentUser.chatId) {
            currentUser.chatId = u.chatId;
            document.getElementById('notifyBanner')?.classList.add('hidden');
            showToast('✅ Уведомления включены!', 'ok');
        }
    } catch (e) { /* тихо */ }
}


async function loadRecentReviews(telegramId) {
    const container = document.getElementById('recentReviews');
    const showAllBtn = document.getElementById('showAllReviewsBtn');

    try {
        const r = await fetch(`/api/reviews/user/${telegramId}`, { headers: { 'X-Telegram-Init-Data': tgInitData } });
        if (!r.ok) {
            container.innerHTML = '<p class="muted" style="font-size:13px;">Не удалось загрузить отзывы</p>';
            return;
        }

        const reviews = await r.json();

        if (reviews.length === 0) {
            container.innerHTML = '<p class="muted" style="font-size:13px;">Отзывов пока нет</p>';
            showAllBtn.style.display = 'none';
            return;
        }

        // Показываем последние 3
        const recent = reviews.slice(0, 3);
        container.innerHTML = recent.map(rev => `
    <div style="margin-bottom:10px;padding:10px;background:#f9f9f9;border-radius:8px;">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px;">
            ${escapeHtml(rev.authorName || 'Пользователь')} · ${'⭐'.repeat(rev.rating || 0)}
        </div>
        ${rev.comment ? `<div style="font-size:13px;color:var(--text-secondary);">${escapeHtml(rev.comment)}</div>` : ''}
        <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">
            ${rev.createdAt ? new Date(rev.createdAt).toLocaleDateString('ru-RU') : ''}
        </div>
    </div>
`).join('');

        // Если отзывов больше 3 — показываем кнопку
        if (reviews.length > 3) {
            showAllBtn.style.display = 'block';
            showAllBtn.onclick = () => showAllReviews(telegramId);
        } else {
            showAllBtn.style.display = 'none';
        }
    } catch (e) {
        container.innerHTML = '<p class="muted" style="font-size:13px;">Не удалось загрузить отзывы</p>';
    }
}


function updateNotifyBannerState() {
    const banner = document.getElementById('notifyBanner');
    if (!banner) return; // баннера в HTML нет — тихо выходим, не падаем
    if (currentUser && currentUser.chatId) {
        banner.classList.add('hidden');
        return;
    }
    // Показываем не чаще 1 раза в 24 часа
    const last = localStorage.getItem('notifyBannerDismissedAt');
    if (last && Date.now() - Number(last) < 24 * 3600 * 1000) return;
    banner.classList.remove('hidden');
}



async function handleCreateSubmit() {
    if (!selectedFrom || !selectedTo) {
        showMessage('Выберите обе точки маршрута', 'Ошибка');
        return;
    }

    if (createMode === 'ride') {
        // Создаём заявку
        await createRideRequest();
    } else {
        // Создаём подписку
        await createSubscription();
    }
}





function switchCreateMode(mode) {
    createMode = mode;

    // Переключаем кнопки
    document.getElementById('modeRide').classList.toggle('active', mode === 'ride');
    document.getElementById('modeSubscribe').classList.toggle('active', mode === 'subscribe');

    // Показываем/скрываем подсказку
    document.getElementById('subscribeHint').classList.toggle('hidden', mode === 'ride');

    // Показываем/скрываем поля заявки
    document.getElementById('rideOnlyFields').classList.toggle('hidden', mode === 'subscribe');

    // 🔥 НОВОЕ: Показываем/скрываем блок радиуса подписки
    document.getElementById('subscribeOnlyFields').classList.toggle('hidden', mode === 'ride');

    // Скрываем кнопку "Показать варианты дороги" в режиме подписки
    const altBtn = document.getElementById('routeAlternativesBtn');
    if (altBtn) altBtn.classList.toggle('hidden', mode === 'subscribe');

    // Меняем текст кнопки
    const submitBtn = document.getElementById('createSubmitBtn');
    if (mode === 'ride') {
        submitBtn.textContent = 'Создать и найти попутчиков';
    } else {
        submitBtn.textContent = 'Подписаться на маршрут';
    }

    // Проверяем существующую подписку при переключении
    if (mode === 'subscribe') {
        checkExistingSubscription();
    }
}

// Установка радиуса подписки
function setSubscribeRadius(km) {
    subscribeRadiusKm = km;
    document.querySelectorAll('#subscribeRadiusChips .time-chip').forEach(chip => {
        chip.classList.toggle('active', Number(chip.dataset.km) === km);
    });
    // Обновляем подсказку
    updateRadiusHint(km);
    // Перепроверяем существующие подписки
    checkExistingSubscription();
}

function updateRadiusHint(km) {
    const hint = document.getElementById('radiusHint');
    if (!hint) return;

    let description = '';
    if (km === 2) {
        description = 'Точное совпадение. Уведомления будут приходить только если точки старта и финиша практически совпадают с вашими.';
    } else if (km === 5) {
        description = 'Оптимально для города. Точки могут отличаться в пределах одного района.';
    } else if (km === 10) {
        description = 'Широкий поиск. Подойдёт, если вам важно направление, а не конкретная точка.';
    } else if (km === 30) {
        description = 'Очень широкий. Будет много уведомлений, часть может быть нерелевантной.';
    }

    hint.innerHTML = `💡 <strong>Радиус ${km} км.</strong> ${description} Насколько может отличаться точка новой заявки от вашей, чтобы считаться «вашим маршрутом». Чем больше радиус — тем больше уведомлений, но часть может быть нерелевантной.`;
}

// Создание подписки
async function createSubscription() {
    if (!selectedFrom || !selectedTo) {
        showMessage('Выберите обе точки маршрута', 'Ошибка');
        return;
    }

    try {
        const resp = await fetch('/api/subscriptions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Init-Data': tgInitData
            },
            body: JSON.stringify({
                fromLat: selectedFrom.latitude,
                fromLon: selectedFrom.longitude,
                toLat: selectedTo.latitude,
                toLon: selectedTo.longitude,
                radiusMeters: subscribeRadiusKm * 1000
            })
        });

        if (resp.ok) {
            showMessage(`🔔 Вы подписались на маршрут! Радиус допуска: ${subscribeRadiusKm} км. Уведомим, когда кто-то поедет.`, 'Готово');
            loadSubscriptions();
            switchScreen('mapScreen');
        } else {
            const errText = await resp.text();
            if (errText.includes('уже подписаны')) {
                showMessage('Вы уже подписаны на этот маршрут', 'Информация');
            } else {
                showMessage('Ошибка: ' + errText, 'Ошибка');
            }
        }
    } catch (e) {
        showMessage('Сервер недоступен, попробуйте позже', 'Ошибка');
    }
}

// Проверка существующей подписки
async function checkExistingSubscription() {
    if (createMode !== 'subscribe' || !selectedFrom || !selectedTo) return;

    try {
        const resp = await fetch('/api/subscriptions', {
            headers: { 'X-Telegram-Init-Data': tgInitData }
        });
        if (!resp.ok) return;

        const subs = await resp.json();

        // Проверяем совпадение маршрута (без учёта радиуса)
        const exists = subs.some(s =>
            Math.abs(s.fromLat - selectedFrom.latitude) < 0.0001 &&
            Math.abs(s.fromLon - selectedFrom.longitude) < 0.0001 &&
            Math.abs(s.toLat - selectedTo.latitude) < 0.0001 &&
            Math.abs(s.toLon - selectedTo.longitude) < 0.0001
        );

        const submitBtn = document.getElementById('createSubmitBtn');
        if (exists) {
            submitBtn.textContent = '✅ Вы уже подписаны на этот маршрут';
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.6';
        } else {
            submitBtn.textContent = 'Подписаться на маршрут';
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
        }
    } catch (e) {
        console.warn('Не удалось проверить подписку:', e);
    }
}

// Вызов проверки при изменении маршрута
function assignPlace(type, place) {
    if (type === 'from') selectedFrom = place;
    if (type === 'to') selectedTo = place;
    const inp = document.getElementById(type === 'from' ? 'fromInput' : 'toInput');
    if (inp) inp.value = place.displayName;
    const disp = document.getElementById(type === 'from' ? 'fromDisplay' : 'toDisplay');
    if (disp) { disp.textContent = place.displayName; disp.className = 'route-value'; }

    // Проверяем подписку при изменении маршрута
    if (createMode === 'subscribe') {
        checkExistingSubscription();
    }
}


function setMapRadius(km) {
    searchRadiusKm = km;
    document.querySelectorAll('#mapRadiusChips .time-chip').forEach(chip => {
        chip.classList.toggle('active', Number(chip.dataset.km) === km);
    });
    // Перезагружаем поездки с новым радиусом
    loadNearbyRides();
}


// Отдельная функция для рисования маркеров
function drawRideMarkers(rides) {
    // Удаляем ТОЛЬКО маркеры чужих заявок (из нашего массива)
    rideMarkers.forEach(m => {
        if (mainMap.hasLayer(m)) {
            mainMap.removeLayer(m);
        }
    });
    rideMarkers = [];

    rides.forEach(ride => {
        const alreadyResponded = respondedRideIds.has(ride.id);

        // 🔥 Цвет маркера: серый если уже откликнулись, иначе стандартный
        const color = alreadyResponded ? '#9E9E9E' : (ride.role === 'DRIVER' ? '#2196F3' : '#4CAF50');

        const marker = L.circleMarker([ride.fromLat, ride.fromLon], {
            radius: alreadyResponded ? 8 : 10,
            color: color,
            fillColor: color,
            fillOpacity: alreadyResponded ? 0.4 : 0.7,
            weight: alreadyResponded ? 1 : 2
        }).addTo(mainMap);

        // 🔥 Кнопка в попапе: если уже откликнулись — неактивная
        const btnHtml = alreadyResponded
            ? `<button class="btn btn-sm btn-secondary" style="width:100%;opacity:0.7;" disabled>✓ Отклик отправлен</button>`
            : `<button class="btn btn-sm" style="width:100%;" onclick="respondToRideFromMap(${ride.id})">Откликнуться</button>`;

        const popupContent = `
            <div style="min-width:200px;">
                <div style="font-weight:600;margin-bottom:8px;">
                    ${ride.role === 'DRIVER' ? '🚗 Водитель' : '🚶 Пассажир'}
                    ${alreadyResponded ? '<span style="color:#9E9E9E;font-size:12px;margin-left:6px;">(отклик отправлен)</span>' : ''}
                </div>
                <div style="font-size:13px;margin-bottom:4px;">
                    <strong>Маршрут:</strong><br>
                    ${ride.fromAddress || `${ride.fromLat.toFixed(4)}, ${ride.fromLon.toFixed(4)}`} → 
                    ${ride.toAddress || `${ride.toLat.toFixed(4)}, ${ride.toLon.toFixed(4)}`}
                </div>
                <div style="font-size:13px;margin-bottom:4px;">
                    <strong>Время:</strong> ${new Date(ride.departureTime).toLocaleString('ru-RU')}
                </div>
                <div style="font-size:13px;margin-bottom:12px;">
                    <strong>Мест:</strong> ${ride.availableSeats || ride.passengerCount || '?'}
                </div>
                ${btnHtml}
            </div>
        `;

        marker.bindPopup(popupContent);
        rideMarkers.push(marker);
    });
}

function updateMapRadius(km) {
    searchRadiusKm = Number(km);
    document.getElementById('mapRadiusValue').textContent = `${km} км`;
    // Перезагружаем поездки с новым радиусом
    loadNearbyRides();
}

function updateMapLegend() {
    const legend = document.getElementById('mapLegend');
    if (!legend || !currentUser) return;

    if (currentUser.role === 'DRIVER') {
        legend.innerHTML = `<span><span style="color:#4CAF50;">●</span> Пассажиры рядом (ищут место)</span>`;
    } else {
        legend.innerHTML = `<span><span style="color:#2196F3;">●</span> Водители рядом (предлагают места)</span>`;
    }
}


function closeMapHelpModal() {
    document.getElementById('mapHelpModal').classList.remove('active');
}

function closeProfileScreen() {
    document.querySelector('.app-container').classList.remove('hide-header');
    switchScreen('mapScreen');
}

// Модалка редактирования
function openEditProfileModal() {
    document.getElementById('editAboutMe').value = currentUser.aboutMe || '';
    document.getElementById('editAboutMeCounter').textContent = (currentUser.aboutMe || '').length;

    if (currentUser.role === 'DRIVER') {
        document.getElementById('editVehicleFields').classList.remove('hidden');
        // Загружаем данные авто
        fetch('/api/vehicles/my', { headers: { 'X-Telegram-Init-Data': tgInitData } })
            .then(r => r.ok ? r.json() : null)
            .then(v => {
                if (v) {
                    document.getElementById('editVehicleBrand').value = v.brand || '';
                    document.getElementById('editVehicleModel').value = v.model || '';
                    document.getElementById('editVehicleColor').value = v.color || '';
                    document.getElementById('editVehicleSeats').value = v.seats || '';
                    document.getElementById('editVehiclePlateNumber').value = v.plateNumber || '';
                }
            });
    } else {
        document.getElementById('editVehicleFields').classList.add('hidden');
    }

    document.getElementById('editProfileModal').classList.add('active');
}

function closeEditProfileModal() {
    document.getElementById('editProfileModal').classList.remove('active');
}

async function saveAboutMeFromEdit() {
    const about = document.getElementById('editAboutMe').value.trim();
    if (about.length > 140) {
        showMessage('Максимум 140 символов', 'Ошибка');
        return;
    }
    try {
        const r = await fetch('/api/users/about', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tgInitData },
            body: JSON.stringify({ aboutMe: about })
        });
        if (r.ok) {
            currentUser.aboutMe = about;
            document.getElementById('aboutMeDisplay').textContent = about || 'Не указано';
            showMessage('Описание сохранено', 'Готово');
            closeEditProfileModal();
        } else {
            showMessage(await r.text(), 'Ошибка');
        }
    } catch (e) {
        showMessage('Сервер недоступен', 'Ошибка');
    }
}

async function saveVehicleFromEdit() {
    const brand = document.getElementById('editVehicleBrand').value.trim();
    const model = document.getElementById('editVehicleModel').value.trim();
    const color = document.getElementById('editVehicleColor').value.trim();
    const seats = parseInt(document.getElementById('editVehicleSeats').value);
    const plateNumber = document.getElementById('editVehiclePlateNumber').value.trim();

    if (!brand || !model || !seats) {
        showMessage('Заполните марку, модель и количество мест', 'Ошибка');
        return;
    }

    const resp = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tgInitData },
        body: JSON.stringify({ brand, model, color, seats, plateNumber })
    });

    if (resp.ok) {
        showMessage('Автомобиль сохранён', 'Готово');
        closeEditProfileModal();
        openProfileScreen(); // Обновляем экран
    } else {
        showMessage(await resp.text(), 'Ошибка');
    }
}

// Отзывы в стиле карточек
async function loadRecentReviewsScreen(telegramId) {
    const container = document.getElementById('recentReviewsScreen');
    const showAllBtn = document.getElementById('showAllReviewsBtn2');
    if (!container) return;

    try {
        const r = await fetch(`/api/reviews/user/${telegramId}`, { headers: { 'X-Telegram-Init-Data': tgInitData } });
        if (!r.ok) {
            container.innerHTML = '<div class="review-empty">Не удалось загрузить отзывы</div>';
            return;
        }
        const reviews = await r.json();
        if (reviews.length === 0) {
            container.innerHTML = '<div class="review-empty">Отзывов пока нет</div>';
            if (showAllBtn) showAllBtn.style.display = 'none';
            return;
        }

        const recent = reviews.slice(0, 3);
        container.innerHTML = recent.map(rev => renderReviewCard(rev)).join('');

        if (reviews.length > 3 && showAllBtn) {
            showAllBtn.style.display = 'block';
            showAllBtn.onclick = () => showAllReviews(telegramId);
        } else if (showAllBtn) {
            showAllBtn.style.display = 'none';
        }
    } catch (e) {
        container.innerHTML = '<div class="review-empty">Не удалось загрузить отзывы</div>';
    }
}

function renderReviewCard(rev) {
    const initial = (rev.authorName || rev.reviewerName || '?')[0].toUpperCase();
    const stars = '⭐'.repeat(rev.rating || 0);
    const date = rev.createdAt ? new Date(rev.createdAt).toLocaleDateString('ru-RU') : '';
    const comment = rev.comment ? `<div class="review-comment">${escapeHtml(rev.comment)}</div>` : '';

    return `
        <div class="review-card">
            <div class="review-avatar">${escapeHtml(initial)}</div>
            <div class="review-content">
                <div class="review-header">
                    <span class="review-author">${escapeHtml(rev.authorName || rev.reviewerName || 'Пользователь')}</span>
                    <span class="review-rating">${stars}</span>
                </div>
                <div class="review-date">${date}</div>
                ${comment}
            </div>
        </div>
    `;
}

async function showAllReviews(telegramId) {
    if (!telegramId) return;
    document.getElementById('allReviewsModal').classList.add('active');
    const list = document.getElementById('allReviewsList');
    list.innerHTML = '<div class="review-empty">Загружаем…</div>';

    try {
        const r = await fetch(`/api/reviews/user/${telegramId}`, { headers: { 'X-Telegram-Init-Data': tgInitData } });
        if (!r.ok) throw new Error();
        const reviews = await r.json();
        if (reviews.length === 0) {
            list.innerHTML = '<div class="review-empty">Отзывов пока нет</div>';
            return;
        }
        list.innerHTML = reviews.map(rev => renderReviewCard(rev)).join('');
    } catch (e) {
        list.innerHTML = '<div class="review-empty">Не удалось загрузить отзывы</div>';
    }
}

function closeAllReviewsModal() {
    document.getElementById('allReviewsModal').classList.remove('active');
}

// Счётчик символов в модалке редактирования
document.getElementById('editAboutMe')?.addEventListener('input', function() {
    document.getElementById('editAboutMeCounter').textContent = this.value.length;
});

function openMapHelpModal() {
    const content = document.getElementById('mapHelpContent');
    if (!content) return;
    const isDriver = currentUser?.role === 'DRIVER';

    content.innerHTML = `
        <div style="font-size:14px;line-height:1.6;">
            <p style="margin-bottom:12px;">
                ${isDriver
        ? '🚗 <strong>Вы водитель.</strong> Здесь видны пассажиры, которые ищут попутчиков.'
        : '🚶 <strong>Вы пассажир.</strong> Здесь видны водители, которые предлагают места.'
    }
            </p>
            <div style="margin-bottom:12px;">
                <div style="font-weight:600;margin-bottom:6px;">🎯 Маркеры:</div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                    <span style="width:12px;height:12px;border-radius:50%;background:#2196F3;"></span>
                    <span>Синие — ${isDriver ? 'пассажиры' : 'водители'}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                    <span style="width:12px;height:12px;border-radius:50%;background:#4CAF50;"></span>
                    <span>Зелёные — ${isDriver ? 'водители' : 'пассажиры'}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="width:12px;height:12px;border-radius:50%;background:#9E9E9E;"></span>
                    <span>Серые — вы уже откликнулись</span>
                </div>
            </div>
            <div style="margin-bottom:12px;">
                <div style="font-weight:600;margin-bottom:6px;">👆 Что делать:</div>
                <ul style="margin:0;padding-left:20px;">
                    <li>Нажмите на маркер — увидите детали</li>
                    <li>Нажмите «Откликнуться», чтобы связаться</li>
                    <li>Ползунок меняет радиус поиска</li>
                </ul>
            </div>
            <div>
                <div style="font-weight:600;margin-bottom:6px;">💡 Если рядом никого нет:</div>
                <p style="margin:0;">Создайте заявку или подпишитесь на маршрут — уведомим, когда появится попутчик.</p>
            </div>
        </div>
    `;
    document.getElementById('mapHelpModal')?.classList.add('active');
}
