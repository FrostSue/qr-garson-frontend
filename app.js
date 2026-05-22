(() => {
    'use strict';

    const CONFIG = Object.assign({
        API_BASE: 'http://localhost:3000',
        COOLDOWN_SECONDS: 60,
    }, window.APP_CONFIG || {});

    const params = new URLSearchParams(window.location.search);
    const masa = (params.get('masa') || '').trim();

    const els = {
        masaInfo: document.getElementById('masa-info'),
        noTable: document.getElementById('no-table'),
        gpsWarning: document.getElementById('gps-warning'),
        gpsWarningText: document.getElementById('gps-warning-text'),
        actions: document.getElementById('actions'),
        btnMenu: document.getElementById('btn-menu'),
        btnGarson: document.getElementById('btn-garson'),
        btnHesap: document.getElementById('btn-hesap'),
        menuModal: document.getElementById('menu-modal'),
        btnCloseMenu: document.getElementById('btn-close-menu'),
        toast: document.getElementById('toast'),
        statusDot: document.getElementById('status-dot'),
        statusText: document.getElementById('status-text'),
    };

    const buttons = [
        { el: els.btnGarson, type: 'garson', label: 'Garson Cagir' },
        { el: els.btnHesap, type: 'hesap', label: 'Hesap Iste' },
    ];

    const COOLDOWN_KEY = `qr_cooldown_${masa}`;

    let toastTimer = null;
    let userLat = null;
    let userLng = null;
    let cooldownInterval = null;

    function showToast(msg, kind = 'info') {
        if (toastTimer) clearTimeout(toastTimer);
        els.toast.textContent = msg;
        els.toast.classList.remove('toast-hidden');
        els.toast.classList.remove('border-red-500/50', 'border-emerald-500/50', 'border-slate-700');
        if (kind === 'error') els.toast.classList.add('border-red-500/50');
        else if (kind === 'success') els.toast.classList.add('border-emerald-500/50');
        else els.toast.classList.add('border-slate-700');
        toastTimer = setTimeout(() => els.toast.classList.add('toast-hidden'), 3500);
    }

    function setStatus(state) {
        const map = {
            connecting: { color: 'bg-amber-500', text: 'baglaniyor...' },
            online:     { color: 'bg-emerald-500 pulse-dot', text: 'sistem aktif' },
            offline:    { color: 'bg-red-500', text: 'sunucuya ulasilamiyor' },
        };
        const s = map[state] || map.offline;
        els.statusDot.className = `inline-block w-2 h-2 rounded-full mr-1 align-middle ${s.color}`;
        els.statusText.textContent = s.text;
    }

    function setButtonState(btnObj, { disabled, label }) {
        const labelEl = btnObj.el.querySelector('.btn-label');
        if (labelEl) labelEl.textContent = label;
        btnObj.el.disabled = disabled;
        if (disabled) {
            btnObj.el.classList.add('btn-disabled', 'opacity-80');
            btnObj.el.classList.remove('btn-primary', 'btn-warn');
        } else {
            btnObj.el.classList.remove('btn-disabled', 'opacity-80');
            if (btnObj.type === 'garson') btnObj.el.classList.add('btn-primary');
            else btnObj.el.classList.add('btn-warn');
        }
    }

    function startCooldown(untilTs) {
        localStorage.setItem(COOLDOWN_KEY, String(untilTs));
        const tick = () => {
            const remaining = Math.ceil((untilTs - Date.now()) / 1000);
            if (remaining <= 0) {
                clearInterval(cooldownInterval);
                cooldownInterval = null;
                localStorage.removeItem(COOLDOWN_KEY);
                buttons.forEach((b) => setButtonState(b, { disabled: false, label: b.label }));
                return;
            }
            buttons.forEach((b) => setButtonState(b, { disabled: true, label: `Bekleyin... ${remaining}s` }));
        };
        tick();
        cooldownInterval = setInterval(tick, 1000);
    }

    function resumeCooldownIfAny() {
        const v = parseInt(localStorage.getItem(COOLDOWN_KEY) || '0', 10);
        if (v && v > Date.now()) { startCooldown(v); return true; }
        if (v) localStorage.removeItem(COOLDOWN_KEY);
        return false;
    }

    const ERROR_TRANSLATIONS = {
        'Too many requests. Please wait a bit.': 'Çok fazla istek. Lütfen biraz bekleyin.',
        'Too many notification requests. Please wait.': 'Çok fazla bildirim isteği. Lütfen bekleyin.',
        'Unauthorized.': 'Yetkisiz erişim.',
        'Internal server error.': 'Sunucu hatası.',
        'Table number is required.': 'Masa numarası gerekli.',
        'Invalid table number.': 'Geçersiz masa numarası.',
        'Invalid request type (must be garson or hesap).': 'Geçersiz istek türü.',
        'Location information is required.': 'Konum bilgisi gerekli.',
        'Invalid location information.': 'Geçersiz konum bilgisi.',
        'Notifications cannot be sent from outside the restaurant.': 'Restoran dışından bildirim gönderilemez.',
        'Server not configured: WHATSAPP_GROUP_ID is missing.': 'Sunucu yapılandırılmamış (WhatsApp Grup ID eksik).',
        'WhatsApp connection is not ready. Please try again in a few seconds.': 'WhatsApp bağlantısı hazır değil. Lütfen birkaç saniye sonra tekrar deneyin.',
        'Notification sent.': 'Bildirim gönderildi.',
        'Upload endpoint is disabled. UPLOAD_SECRET is not configured.': 'Yükleme noktası devre dışı.',
        'files object is required.': 'Dosya nesnesi gerekli.'
    };

    function getTurkishErrorMessage(errorStr) {
        if (!errorStr) return null;
        if (ERROR_TRANSLATIONS[errorStr]) return ERROR_TRANSLATIONS[errorStr];
        const cooldownMatch = errorStr.match(/Please try again in (\d+) seconds\./);
        if (cooldownMatch) {
            return `Lütfen ${cooldownMatch[1]} saniye sonra tekrar deneyin.`;
        }
        return errorStr;
    }

    async function sendNotify(type) {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/api/notify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ masa, type, lat: userLat, lng: userLng }),
            });

            const data = await res.json().catch(() => ({}));

            if (res.status === 429 && data.cooldownRemaining) {
                startCooldown(Date.now() + data.cooldownRemaining * 1000);
                showToast(getTurkishErrorMessage(data.error) || 'Lutfen biraz bekleyin.', 'error');
                return;
            }

            if (!res.ok || !data.ok) {
                showToast(getTurkishErrorMessage(data.error) || 'Bildirim gonderilemedi.', 'error');
                return;
            }

            const cd = data.cooldownSeconds || CONFIG.COOLDOWN_SECONDS;
            startCooldown(Date.now() + cd * 1000);
            showToast('Bildirim gonderildi. Personelimiz en kisa surede gelecektir.', 'success');
        } catch {
            showToast('Sunucuya ulasilamadi. Internet baglantinizi kontrol edin.', 'error');
        }
    }

    async function checkHealth() {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/api/health`);
            const data = await res.json();
            setStatus(data?.whatsapp?.ready ? 'online' : 'connecting');
        } catch {
            setStatus('offline');
        }
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    function requestLocation() {
        if (!navigator.geolocation) {
            showGpsError('Tarayıcınız konum doğrulamayı desteklemiyor.');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userLat = pos.coords.latitude;
                userLng = pos.coords.longitude;
                els.gpsWarning.classList.add('hidden');
                els.actions.classList.remove('hidden');
            },
            (err) => {
                let msg = 'Konum izni verilmedi. Sistemi kullanmak için lütfen konum izni verin.';
                if (err.code === err.TIMEOUT) {
                    msg = 'Konum alma isteği zaman aşımına uğradı. Lütfen sayfayı yenileyin.';
                } else if (err.code === err.POSITION_UNAVAILABLE) {
                    msg = 'Konum bilgisi alınamadı. Lütfen konum servisinizin açık olduğundan emin olun.';
                }
                showGpsError(msg);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }

    function showGpsError(msg) {
        els.gpsWarningText.textContent = msg;
        els.gpsWarning.classList.remove('hidden');
        els.actions.classList.add('hidden');
    }

    function init() {
        if (!masa) {
            els.masaInfo.classList.add('hidden');
            els.noTable.classList.remove('hidden');
            return;
        }

        els.masaInfo.innerHTML = `Masa <span class="font-bold text-white">${escapeHtml(masa)}</span>`;

        els.btnMenu.addEventListener('click', () => {
            els.menuModal.classList.add('modal-active');
        });

        els.btnCloseMenu.addEventListener('click', () => {
            els.menuModal.classList.remove('modal-active');
        });

        els.menuModal.addEventListener('click', (e) => {
            if (e.target === els.menuModal) {
                els.menuModal.classList.remove('modal-active');
            }
        });

        buttons.forEach((b) => {
            b.el.addEventListener('click', () => {
                if (b.el.disabled) return;
                buttons.forEach((x) => setButtonState(x, { disabled: true, label: 'Gonderiliyor...' }));
                sendNotify(b.type).finally(() => {
                    if (!cooldownInterval) {
                        buttons.forEach((x) => setButtonState(x, { disabled: false, label: x.label }));
                    }
                });
            });
        });

        resumeCooldownIfAny();
        checkHealth();
        setInterval(checkHealth, 30_000);
        requestLocation();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
