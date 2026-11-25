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

// ---------- Утилиты ----------

function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function showMessage(message, title = 'Информация') {
    try {
        if (window.Telegram?.WebApp?.showPopup) {
            window.Telegram.WebApp.showPopup({ title, message });
        } else { alert(message); }
    } catch (e) { alert(message); }
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

// ---------- Навигация ----------

function switchScreen(screenId) {

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
    if (screenId === 'myRidesScreen') switchRidesTab(currentRidesTab);
    if (screenId === 'chatsScreen') {
        loadChats();
        document.getElementById('chatWindow').classList.add('hidden');
        document.getElementById('chatsListCard').classList.remove('hidden');
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

function updateUserMarker(lat, lon, accuracy, fly) {
    if (!mainMap) return;
    if (userMarker) {
        userMarker.setLatLng([lat, lon]);
        accuracyCircle.setLatLng([lat, lon]).setRadius(accuracy || 50);
        return;
    }
    userMarker = L.circleMarker([lat, lon], { radius: 8, color: '#1a73e8', weight: 3, fillOpacity: 0.9 }).addTo(mainMap);
    accuracyCircle = L.circle([lat, lon], { radius: accuracy || 50, color: '#1a73e8', weight: 1, fillOpacity: 0.1 }).addTo(mainMap);
    if (fly) mainMap.flyTo([lat, lon], 14, { duration: 1.2 });
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

        // 🔥 Проверка chatId
        if (!currentUser.chatId) {
            setTimeout(() => {
                showMessage('⚠️ Чтобы получать уведомления о поездках, напишите боту @' + BOT_USERNAME + ' /start', 'Важно');
            }, 1000);
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
                requestUserLocation().then(loc => {
                    if (loc) {
                        userLocation = loc;
                        updateUserMarker(loc.lat, loc.lon, 50, false);
                        mainMap.flyTo([loc.lat, loc.lon], 14, { duration: 0.8 });
                    } else showMessage('Не удалось получить местоположение', 'Ошибка');
                });
            });
            return btn;
        }
    });
    new LocateControl().addTo(mainMap);

    requestUserLocation().then(loc => {
        if (loc) {
            userLocation = loc;
            updateUserMarker(loc.lat, loc.lon, 50, true);
            mainMap.setView([loc.lat, loc.lon], 12);
        }
        loadNearbyRides();
    });
}

async function loadNearbyRides() {
    const list = document.getElementById('mapRideList');
    if (!currentUser?.role) {
        list.innerHTML = '<div class="empty-state">Выберите роль, чтобы увидеть поездки</div>';
        return;
    }
    const loc = userLocation || { lat: 53.9, lon: 27.56 };

    // Рекомендации считаем от активной заявки, а не от текущего положения:
    // «Куда» ищущего — его реальный пункт назначения, иначе скоринг топит всех,
    // кто едет дальше точки, где пользователь стоит на карте.
    const from = window.activeRideFrom
        || (typeof selectedFrom !== 'undefined' && selectedFrom)
        || { latitude: loc.lat, longitude: loc.lon };
    const knownTo = window.activeRideTo
        || (typeof selectedTo !== 'undefined' && selectedTo)
        || null;
    const toLat = knownTo ? knownTo.latitude : from.latitude;
    const toLon = knownTo ? knownTo.longitude : from.longitude;
    // Если назначение известно — коридор по «Куда» 30 км; если нет — не отсекаем, как раньше
    const toRadius = knownTo ? searchRadiusKm * 1000 : 30000000;


    let url = `/api/rides/matches?role=${oppositeRole(currentUser.role)}`
        + `&fromLat=${from.latitude}&fromLon=${from.longitude}`
        + `&toLat=${toLat}&toLon=${toLon}`
        + `&fromRadiusMeters=${searchRadiusKm * 1000}&toRadiusMeters=${toRadius}&limit=10`;
    // Время выезда и гибкость берём из активной заявки — тогда проценты
    // на «Карте» и в «Найденных попутчиках» совпадут
    if (window.activeRideDepartureTime) {
        url += `&departureTime=${encodeURIComponent(window.activeRideDepartureTime)}`;
        if (window.activeRideFlexibility) url += `&flexibilityMinutes=${window.activeRideFlexibility}`;
    }


    try {
        const resp = await fetch(url, { headers: { 'X-Telegram-Init-Data': tgInitData } });
        if (!resp.ok) throw new Error(await resp.text());
        renderMapRides(await resp.json());
    } catch (e) {
        list.innerHTML = `<div class="empty-state">Ошибка загрузки: ${escapeHtml(e.message)}</div>`;
    }
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

function assignPlace(type, place) {
    if (type === 'from') selectedFrom = place;
    if (type === 'to') selectedTo = place;
    const inp = document.getElementById(type === 'from' ? 'fromInput' : 'toInput');
    if (inp) inp.value = place.displayName;
    const disp = document.getElementById(type === 'from' ? 'fromDisplay' : 'toDisplay');
    if (disp) { disp.textContent = place.displayName; disp.className = 'route-value'; }
}

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
        document.getElementById('myRide').classList.remove('hidden');
        renderMyRideInfo(selectedFrom.displayName, selectedTo.displayName, departureTime,
            currentUser.role, availableSeats, pricePerSeat, timeFlexibility, passengerCount, note);
        searchMatches(
            selectedFrom.latitude, selectedFrom.longitude,
            selectedTo.latitude, selectedTo.longitude,
            departureTime, timeFlexibility, searchRadiusKm * 1000
        );
        // Убираем линии вариантов дороги — выбор сделан и сохранён
        clearAltRoutes();
        loadNearbyRides();
        loadActiveRide();
    } else {
        showMessage(await resp.text(), 'Ошибка');
    }
}


function renderMyRideInfo(fromName, toName, departureTime, role, availableSeats, pricePerSeat, timeFlexibility, passengerCount, note) {
    document.getElementById('myRideInfo').innerHTML = `
        <strong>Маршрут:</strong> ${escapeHtml(fromName)} → ${escapeHtml(toName)}<br>
        <strong>Время:</strong> ${escapeHtml(new Date(departureTime).toLocaleString())}
        ${role === 'DRIVER' ? `<br><strong>Мест:</strong> ${availableSeats}${pricePerSeat ? ` · ${pricePerSeat} BYN/место` : ''} · ±${timeFlexibility} мин` : `<br><strong>Пассажиров:</strong> ${passengerCount}`}
        ${note ? `<br><strong>Комментарий:</strong> ${escapeHtml(note)}` : ''}
    `;
}

async function searchMatches(fromLat, fromLon, toLat, toLon, departureTime = null, flexibilityMinutes = 30, radius = 5000) {
    const listEl = document.getElementById('matchesList');
    const containerEl = document.getElementById('matchesBlock');
    const opposite = oppositeRole(currentUser.role);
    let url = `/api/rides/matches?role=${opposite}&fromLat=${fromLat}&fromLon=${fromLon}&toLat=${toLat}&toLon=${toLon}&fromRadiusMeters=${radius}&toRadiusMeters=${radius}&flexibilityMinutes=${flexibilityMinutes}&limit=10`;
    if (departureTime) url += `&departureTime=${encodeURIComponent(departureTime)}`;
    const resp = await fetch(url, { headers: { 'X-Telegram-Init-Data': tgInitData } });
    const matches = await resp.json();
    containerEl.classList.remove('hidden');
    listEl.innerHTML = '';
    if (matches.length === 0) {
        listEl.innerHTML = '<p>Пока нет подходящих попутчиков. Заявка активна — уведомим, когда кто-то появится. Попробуйте увеличить радиус.</p>';
        return;
    }
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
    const block = document.getElementById('myRide');
    if (rides.length === 0) {
        if (!editingRideId) block.classList.add('hidden');
        return;
    }
    const ride = rides[0];
    currentRideId = ride.id;

    window.activeRideDepartureTime = ride.departureTime || null;
    window.activeRideFlexibility = ride.timeFlexibilityMinutes || 30;
    window.activeRideFrom = { latitude: ride.fromLat, longitude: ride.fromLon };
    window.activeRideTo = { latitude: ride.toLat, longitude: ride.toLon };



    block.classList.remove('hidden');
    const timeStr = ride.departureTime ? new Date(ride.departureTime).toLocaleString() : 'время не указано';
    let waypointsStr = '';
    if (ride.waypoints && ride.waypoints.length > 0) {
        const wpNames = ride.waypoints.map(w => w.name || 'Точка').join(', ');
        waypointsStr = `<br><strong>Заезд через:</strong> 📍 ${escapeHtml(wpNames)}`;
    }

    document.getElementById('myRideInfo').innerHTML = `
        <strong>${ride.role === 'DRIVER' ? '🚗 Водитель' : '🚶 Пассажир'}</strong><br>
        <strong>Маршрут:</strong> (${ride.fromLat.toFixed(4)}, ${ride.fromLon.toFixed(4)}) → (${ride.toLat.toFixed(4)}, ${ride.toLon.toFixed(4)})
        ${waypointsStr}
        <br><strong>Время:</strong> ${escapeHtml(timeStr)} · ±${ride.timeFlexibilityMinutes} мин
        ${ride.pricePerSeat ? ` · 💰 ${ride.pricePerSeat} BYN/место` : ''}
        ${ride.note ? `<br><strong>Комментарий:</strong> ${escapeHtml(ride.note)}` : ''}
    `;
    document.getElementById('myRideInfo').innerHTML +=
        '<p style="font-size:13px;color:var(--text-secondary);margin-top:8px;">Отклики на эту заявку приходят во вкладку «Заявки» → кнопка «Отклики».</p>';
    if (pendingResponsesCount > 0) {
        document.getElementById('myRideInfo').innerHTML +=
            `<p style="font-size:13px;color:#f57f17;font-weight:600;margin-top:4px;">🔔 Новых откликов: ${pendingResponsesCount} — смотрите «Заявки» → «Отклики»</p>`;
    }
    // Блок действий — редактирование большое и заметное, отмена маленькая и второстепенная
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid var(--border);';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn';  // Большая кнопка на всю ширину
    editBtn.textContent = '✏️ Редактировать заявку';
    editBtn.style.cssText = 'background:var(--primary);font-size:15px;padding:14px;';
    editBtn.onclick = () => startEditRide(ride);
    actions.appendChild(editBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-sm btn-secondary';  // Маленькая, второстепенная
    cancelBtn.textContent = 'Отменить заявку';
    cancelBtn.style.cssText = 'align-self:flex-start;font-size:13px;padding:8px 16px;color:var(--danger);background:transparent;border:1px solid var(--danger);';
    cancelBtn.onclick = cancelMyRide;
    actions.appendChild(cancelBtn);

    document.getElementById('myRideInfo').appendChild(actions);

    drawMyRoute();
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

function switchRidesTab(tab) {
    currentRidesTab = tab;
    document.getElementById('tabMyRides').classList.toggle('active-tab', tab === 'myRides');
    document.getElementById('tabMyResponses').classList.toggle('active-tab', tab === 'myResponses');
    document.getElementById('myRidesList').classList.toggle('hidden', tab !== 'myRides');
    document.getElementById('myResponsesList').classList.toggle('hidden', tab !== 'myResponses');
    document.getElementById('showAllRidesBtn').classList.toggle('hidden', tab !== 'myRides');
    if (tab === 'myRides') loadMyRides(); else loadMyResponses();
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
        list.innerHTML = showAllRides ? '<p>У вас нет заявок</p>' : '<p>Активных заявок нет. Нажмите «Показать все», чтобы увидеть заявки с бронью.</p>';
        return;
    }

    for (const ride of rides) {
        const card = document.createElement('div');
        card.className = 'ride-card';
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

        // Асинхронно подтягиваем адреса
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

// 🔥 Для MATCHED/COMPLETED/CANCELLED кнопка редактирования не добавляется
        } else if (ride.status === 'MATCHED') {
            const responsesBtn = document.createElement('button');
            responsesBtn.className = 'btn btn-sm btn-secondary';
            responsesBtn.textContent = 'Отклики на заявку';
            responsesBtn.onclick = () => loadResponsesForRide(ride.id);
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
        list.appendChild(card);
    }
}



async function loadResponsesForRide(rideId) {
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
}

async function loadMyResponses() {
    const resp = await fetch('/api/matches/my', { headers: { 'X-Telegram-Init-Data': tgInitData } });
    if (!resp.ok) return;
    const matches = await resp.json();
    const list = document.getElementById('myResponsesList');
    list.innerHTML = '';
    if (matches.length === 0) { list.innerHTML = '<p>Вы ещё не откликались</p>'; return; }

    for (const match of matches) {
        // ВАЖНО: здесь должен быть continue, а не return!
        // Иначе одна отмененная заявка сломает отрисовку всего списка.
        if (match.status === 'REJECTED' || match.status === 'EXPIRED') continue;

        const item = document.createElement('div');
        item.className = 'match-item';
        let contactInfo = '';
        if (match.status === 'CONFIRMED' && match.contactUsername) {
            contactInfo = `<div style="margin-top:4px;">📞 @${escapeHtml(match.contactUsername)}</div>`;
        }
        const seatsNote = match.seats ? ` · мест: ${match.seats}` : '';
        const routeId = `resp_${match.id}`;
        const reviewsId = `rev_owner_${match.id}`;

        const ratingStr = match.ownerRating ? `⭐ ${Number(match.ownerRating).toFixed(1)}` : '⭐ Нет оценок';
        const tripsStr = `Поездок: ${match.ownerTripCount || 0}`;
        const timeStr = match.departureTime ? new Date(match.departureTime).toLocaleString() : 'Время не указано';
        const priceStr = match.pricePerSeat ? `<div style="color:var(--primary);font-weight:600;margin-top:2px;">💰 ${match.pricePerSeat} BYN</div>` : '';

        item.innerHTML = `
            <div class="ride-header">
                <span class="role-icon">👤</span>
                <span class="role-name" style="flex:1;">Отклик на заявку ${escapeHtml(match.ownerName)}</span>
               <span class="match-status ${match.status.toLowerCase()}">${escapeHtml(translateMatchStatus(match.status))}${escapeHtml(seatsNote)}</span>
            </div>
            <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">
                ${ratingStr} · ${tripsStr}
            </div>
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
            const el = document.getElementById(`${routeId}_from`);
            if (el) el.textContent = addr;
        });
        reverseGeocodeShort(match.toLat, match.toLon).then(addr => {
            const el = document.getElementById(`${routeId}_to`);
            if (el) el.textContent = addr;
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

        // ВОТ ЭТОТ БЛОК ТЫ ЗАБЫЛ ДОБАВИТЬ
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

    if (subs.length === 0) {
        const roleHint = currentUser?.role === 'DRIVER'
            ? 'Подписка работает в фоне: как только пассажир создаст заявку по вашему маршруту — бот пришлёт уведомление. Это не заявка, а «ожидание попутчика».'
            : 'Подписка работает в фоне: как только водитель создаст заявку по вашему маршруту — бот пришлёт уведомление. Это не заявка, а «ожидание водителя».';
        list.innerHTML = `
            <div class="empty-state" style="text-align:left;padding:12px 4px;">
                <div style="font-weight:600;margin-bottom:6px;">🔔 Подписок пока нет</div>
                <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">
                    ${roleHint}
                </div>
                <button class="btn btn-sm" style="margin-top:10px;" onclick="subscribeFromCurrent()">
                    ➕ Подписаться на мой маршрут
                </button>
            </div>`;
        return;
    }

    list.innerHTML = '';
    for (const sub of subs) {
        const fromAddr = await reverseGeocodeShort(sub.fromLat, sub.fromLon);
        const toAddr   = await reverseGeocodeShort(sub.toLat, sub.toLon);
        const item = document.createElement('div');
        item.className = 'waypoint-item';
        item.innerHTML = `
            <div style="min-width:0;">
                <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    📍 ${escapeHtml(fromAddr)} → ${escapeHtml(toAddr)}
                </div>
                <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">
                    радиус ${sub.radiusMeters / 1000} км · уведомим, когда поедет попутчик
                </div>
            </div>`;
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = 'Удалить подписку';
        del.onclick = async () => {
            if (!confirm('Удалить эту подписку?')) return;
            await fetch(`/api/subscriptions/${sub.id}`, { method: 'DELETE', headers: { 'X-Telegram-Init-Data': tgInitData } });
            loadSubscriptions();
        };
        item.appendChild(del);
        list.appendChild(item);
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

// ---------- Детали заявки ----------

async function openRideDetails(rideId) {
    const resp = await fetch(`/api/rides/${rideId}`, { headers: { 'X-Telegram-Init-Data': tgInitData } });
    if (!resp.ok) { showMessage('Не удалось загрузить детали', 'Ошибка'); return; }
    const d = await resp.json();
    const body = document.getElementById('detailsBody');
    const rows = [
        ['Кто', `${roleEmoji(d.role)} ${escapeHtml(d.ownerName)}`],
        ['Username', d.ownerUsername ? '@' + escapeHtml(d.ownerUsername) : 'не указан'],
        ['Рейтинг', d.ownerRating ? `⭐ ${d.ownerRating.toFixed(1)}` : 'нет оценок'],
        ['Поездок', d.ownerTripCount ?? 0],
        ['Откуда', `(${d.fromLat.toFixed(4)}, ${d.fromLon.toFixed(4)})`],
        ['Куда', `(${d.toLat.toFixed(4)}, ${d.toLon.toFixed(4)})`],
        ['Время', d.departureTime ? new Date(d.departureTime).toLocaleString() + ` · ±${d.timeFlexibilityMinutes} мин` : 'не указано']
    ];
    if (d.role === 'DRIVER') {
        rows.push(
            ['Места', `свободно: ${d.availableSeats ?? '—'}${d.vehicleSeats ? ` (в машине: ${d.vehicleSeats})` : ''}`],
            ['Цена', d.pricePerSeat ? `${d.pricePerSeat} BYN/место` : 'не указана'],
            ['Авто', d.vehicleBrand ? `${escapeHtml(d.vehicleBrand)} ${escapeHtml(d.vehicleModel || '')}${d.vehicleColor ? `, ${escapeHtml(d.vehicleColor)}` : ''}` : 'не указано']
        );
    }
    rows.push(['Комментарий', d.note ? escapeHtml(d.note) : '—']);
    body.innerHTML = rows.map(([k, v]) => `<div class="details-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
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
    }
    document.getElementById('detailsModal').classList.add('active');
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

function openProfileModal() {
    if (!currentUser) return;
    const fullName = ((currentUser.firstName || '') + ' ' + (currentUser.lastName || '')).trim();
    document.getElementById('profileName').textContent = fullName || 'Без имени';
    document.getElementById('profileUsername').textContent = currentUser.username ? '@' + currentUser.username : 'username не указан';

    // Аватар — первая буква имени
    const avatar = document.getElementById('profileAvatar');
    avatar.textContent = (currentUser.firstName || '?').trim().charAt(0).toUpperCase();

    // Рейтинг: звёзды + число; без оценок — прочерк
    document.getElementById('profileStars').textContent = currentUser.rating
        ? '⭐ ' + currentUser.rating.toFixed(1)
        : '—';

    document.getElementById('profileTripCount').textContent = currentUser.tripCount || 0;
    document.getElementById('profileRole').textContent = currentUser.role === 'PASSENGER' ? 'Пассажир'
        : (currentUser.role === 'DRIVER' ? 'Водитель' : '—');

    const vehicleFields = document.getElementById('vehicleFields');
    if (currentUser.role === 'DRIVER') {
        vehicleFields.classList.remove('hidden');
        if (currentUser.vehicleBrand) {
            document.getElementById('vehicleBrand').value = currentUser.vehicleBrand;
            document.getElementById('vehicleModel').value = currentUser.vehicleModel || '';
            document.getElementById('vehicleColor').value = currentUser.vehicleColor || '';
            document.getElementById('vehicleSeats').value = currentUser.vehicleSeats || '';
        }
    } else vehicleFields.classList.add('hidden');
    document.getElementById('profileModal').classList.add('active');
    loadPhoneStatus();

}


function closeProfileModal() { document.getElementById('profileModal').classList.remove('active'); }

async function saveVehicle() {
    if (!currentUser || currentUser.role !== 'DRIVER') return;
    const brand = document.getElementById('vehicleBrand').value.trim();
    const model = document.getElementById('vehicleModel').value.trim();
    const color = document.getElementById('vehicleColor').value.trim();
    const seats = parseInt(document.getElementById('vehicleSeats').value);
    const plateNumber = document.getElementById('vehiclePlateNumber').value.trim();
    if (!brand || !model || !seats) { showMessage('Заполните марку, модель и количество мест', 'Ошибка'); return; }
    const resp = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tgInitData },
        body: JSON.stringify({ brand, model, color, seats, plateNumber })
    });
    if (resp.ok) { showMessage('Автомобиль сохранён'); closeProfileModal(); registerUser(); }
    else showMessage(await resp.text(), 'Ошибка');
}

function changeRoleFromProfile() { closeProfileModal(); document.getElementById('roleBanner').classList.remove('hidden'); }

// ---------- Запуск ----------

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
            statusEl.innerHTML = '📞 ' + escapeHtml(s.phone) + ' <span style="color:var(--passenger);font-weight:600;">✅ подтверждён</span>';
            formEl.classList.add('hidden');
        } else {
            statusEl.textContent = '📞 Телефон не подтверждён — попутчику проще довериться, когда он есть';
            formEl.classList.remove('hidden');
            document.getElementById('codeRow').classList.add('hidden');
        }
    } catch (e) { /* статус телефона — не критично */ }
}

async function requestPhoneCode() {
    const countryCode = document.getElementById('phoneCountryCode').value;
    const phone = document.getElementById('phoneInput').value.trim().replace(/\D/g, '');

    if (!phone) { showMessage('Введите номер телефона', 'Ошибка'); return; }

    // Собираем полный номер с кодом страны
    const fullPhone = countryCode + phone;

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

    // Устанавливаем текст подсказки
    input.placeholder = examples[userCurrency] || 'Цена за место';

    // Опционально: меняем шаг (step) в зависимости от валюты
    if (userCurrency === 'UZS' || userCurrency === 'KZT') {
        input.step = '100'; // Чтобы не вводить 1500.5 сумов
    } else {
        input.step = '1'; // Или '0.5' для BYN/RUB, если нужны копейки
    }
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