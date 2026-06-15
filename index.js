class IDBStore {
  constructor(dbName = 'wallet-keys', storeName = 'keys') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 2);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
        const store = e.target.transaction.objectStore(this.storeName);
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;
          const val = cursor.value || {};
          if (val.encryptedKey && !val.encryptedPk && !val.encryptedSeed) {
            val.encryptedPk = val.encryptedKey;
            delete val.encryptedKey;
            cursor.update(val);
          }
          if (val.encryptedSecret && !val.encryptedPk && !val.encryptedSeed) {
            if (val.secretType === 'seed') val.encryptedSeed = val.encryptedSecret;
            else val.encryptedPk = val.encryptedSecret;
            delete val.encryptedSecret;
            delete val.secretType;
            cursor.update(val);
          }
          cursor.continue();
        };
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
    });
  }

  async transaction(mode, operation) {
    if (!this.db) throw new Error('DB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([this.storeName], mode);
      tx.onerror = () => reject(tx.error);
      const store = tx.objectStore(this.storeName);
      Promise.resolve(operation(store)).then(resolve).catch(reject);
    });
  }

  async getAll() {
    return this.transaction('readonly', (store) =>
      new Promise((res, rej) => {
        const req = store.getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      })
    );
  }

  async put(value) {
    return this.transaction('readwrite', (store) =>
      new Promise((res, rej) => {
        const req = store.put(value);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      })
    );
  }

  async delete(id) {
    return this.transaction('readwrite', (store) =>
      new Promise((res, rej) => {
        const req = store.delete(id);
        req.onsuccess = () => res();
        req.onerror = () => rej(req.error);
      })
    );
  }
}

// ===== WalletKeyManager =====
class WalletKeyManager {
  constructor() {
    this.store = new IDBStore();
    this.ready = this.store.init();
  }

  async deriveKey(password, salt, iterations = 200000) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async encryptText(text, password) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = 200000;
    const key = await this.deriveKey(password, salt, iterations);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
    return {
      iterations,
      salt: Array.from(salt),
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted)),
    };
  }

  async decryptText(obj, password) {
    const salt = new Uint8Array(obj.salt || []);
    const iterations = obj.iterations || 200000;
    const key = await this.deriveKey(password, salt, iterations);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(obj.iv) },
      key,
      new Uint8Array(obj.data)
    );
    return new TextDecoder().decode(decrypted);
  }

  normalizeSeed(seed) {
    return seed.trim().toLowerCase().split(/\s+/g).join(' ');
  }

  async saveWallet({ address, seedPhrase = '', privateKey = '' }, password) {
    await this.ready;
    const addr = (address || '').trim();
    if (!addr) throw new Error('Address required');
    const seed = seedPhrase && seedPhrase.trim() ? this.normalizeSeed(seedPhrase) : '';
    const pk = privateKey && privateKey.trim() ? privateKey.trim() : '';
    if (!seed && !pk) throw new Error('Need seed or private key');
    const encryptedSeed = seed ? await this.encryptText(seed, password) : null;
    const encryptedPk = pk ? await this.encryptText(pk, password) : null;
    return this.store.put({ id: addr, encryptedSeed, encryptedPk, updatedAt: Date.now() });
  }

  async getWallets(password) {
    await this.ready;
    const all = await this.store.getAll();
    const wallets = [];
    for (const item of all) {
      try {
        const seedPhrase = item.encryptedSeed ? await this.decryptText(item.encryptedSeed, password) : '';
        const privateKey = item.encryptedPk ? await this.decryptText(item.encryptedPk, password) : '';
        wallets.push({ address: item.id, seedPhrase, privateKey });
      } catch {
        throw new Error('Wrong password');
      }
    }
    return wallets;
  }

  async deleteWallet(address) {
    await this.ready;
    return this.store.delete(address);
  }
}

// ===== App state =====
const manager = new WalletKeyManager();
let currentPassword = '';
let currentWallets = [];
let failedAttempts = 0;
const MAX_ATTEMPTS = 5;

// Auto-lock
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 хвилин
let lockTimer = null;
let lockCountdownTimer = null;
let lockAt = null;

function resetLockTimer() {
  if (!currentPassword) return;
  clearTimeout(lockTimer);
  lockAt = Date.now() + LOCK_TIMEOUT;
  lockTimer = setTimeout(lock, LOCK_TIMEOUT);
  updateCountdown();
}

function updateCountdown() {
  clearInterval(lockCountdownTimer);
  if (!currentPassword) return;
  const banner = document.getElementById('lockBanner');
  banner.classList.add('show');
  lockCountdownTimer = setInterval(() => {
    const remaining = Math.max(0, lockAt - Date.now());
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    document.getElementById('lockCountdown').textContent =
      m + ':' + String(s).padStart(2, '0');
    if (remaining <= 0) { clearInterval(lockCountdownTimer); lock(); }
  }, 1000);
}

['click', 'keydown', 'mousemove', 'touchstart'].forEach(evt =>
  document.addEventListener(evt, () => { if (currentPassword) resetLockTimer(); }, { passive: true })
);

function lock() {
  currentPassword = '';
  currentWallets = [];
  clearTimeout(lockTimer);
  clearInterval(lockCountdownTimer);
  document.getElementById('lockBanner').classList.remove('show');
  document.getElementById('keysContainer').classList.add('hidden');
  document.getElementById('loginBlock').classList.remove('hidden');
  document.getElementById('masterPassword').value = '';
  showStatus('Сесію заблоковано. Введіть пароль знову.', 'warning');
}

// ===== DOM refs =====
const masterPasswordEl = document.getElementById('masterPassword');
const keysContainerEl  = document.getElementById('keysContainer');
const keysListEl       = document.getElementById('keysList');
const statusEl         = document.getElementById('status');
const unlockBtn        = document.getElementById('unlockBtn');
const lockBtn          = document.getElementById('lockBtn');
const addWalletBtn     = document.getElementById('addWalletBtn');
const modalOverlay     = document.getElementById('modalOverlay');

// Enter key on password field
masterPasswordEl.addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });

unlockBtn.addEventListener('click', unlock);
lockBtn.addEventListener('click', lock);
addWalletBtn.addEventListener('click', openModal);
document.getElementById('modalCancel').addEventListener('click', closeModal);
document.getElementById('modalSave').addEventListener('click', saveWallet);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ===== Unlock =====
async function unlock() {
  if (failedAttempts >= MAX_ATTEMPTS) {
    return showStatus('Забагато спроб. Перезавантаж сторінку.', 'error');
  }

  const password = masterPasswordEl.value;
  if (!password) return showStatus('Введіть пароль!', 'error');

  unlockBtn.disabled = true;
  unlockBtn.textContent = 'Розшифровую...';

  try {
    currentWallets = await manager.getWallets(password);
    currentPassword = password;
    failedAttempts = 0;
    updateAttemptDots();

    renderWallets(currentWallets);
    keysContainerEl.classList.remove('hidden');
    document.getElementById('loginBlock').classList.add('hidden');
    resetLockTimer();

    if (currentWallets.length === 0) showStatus('Гаманців не знайдено. Додайте перший!', 'info');
    else showStatus('Розблоковано · ' + currentWallets.length + ' гаманців', 'success');
  } catch {
    failedAttempts++;
    updateAttemptDots();
    const left = MAX_ATTEMPTS - failedAttempts;
    if (left <= 0) {
      showStatus('Вичерпано всі спроби. Перезавантаж сторінку.', 'error');
      unlockBtn.disabled = true;
      unlockBtn.textContent = 'Заблоковано';
      return;
    }
    showStatus('Неправильний пароль! Залишилось спроб: ' + left, 'error');
  } finally {
    if (failedAttempts < MAX_ATTEMPTS) {
      unlockBtn.disabled = false;
      unlockBtn.textContent = 'Розблокувати';
    }
  }
}

function updateAttemptDots() {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const dot = document.getElementById('d' + i);
    if (dot) dot.classList.toggle('used', i < failedAttempts);
  }
}

// ===== Render wallets =====
function renderWallets(wallets) {
  document.getElementById('walletCount').textContent = wallets.length + ' шт.';
  keysListEl.innerHTML = wallets.map((w, idx) => `
    <div class="wallet-card">
      <div class="wlabel">Адреса</div>
      <div class="wvalue">${escapeHtml(w.address)}</div>
      <div class="btn-row">
        ${w.seedPhrase ? `<button class="btn btn-copy" data-action="copy-seed" data-idx="${idx}">Копіювати seed</button>` : ''}
        ${w.privateKey ? `<button class="btn btn-copy-secondary" data-action="copy-pk" data-idx="${idx}">Копіювати PK</button>` : ''}
        <button class="btn btn-delete" data-action="delete" data-idx="${idx}">Видалити</button>
      </div>
    </div>
  `).join('');

  keysListEl.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const action = e.currentTarget.dataset.action;
      const idx = Number(e.currentTarget.dataset.idx);
      const w = currentWallets[idx];
      if (!w) return;

      if (action === 'copy-seed') {
        if (!w.seedPhrase) return showStatus('Нема seed фрази', 'error');
        copyText(w.seedPhrase, 'Seed фразу скопійовано');
      }
      if (action === 'copy-pk') {
        if (!w.privateKey) return showStatus('Нема приватного ключа', 'error');
        copyText(w.privateKey, 'Приватний ключ скопійовано');
      }
      if (action === 'delete') {
        const confirmDelete = confirm(`Видалити гаманець?\n${w.address}\n\nЦю дію не можна скасувати!`);
        if (!confirmDelete) return;
        try {
          await manager.deleteWallet(w.address);
          currentWallets = currentWallets.filter((_, i) => i !== idx);
          renderWallets(currentWallets);
          showStatus('Гаманець видалено', 'info');
        } catch {
          showStatus('Помилка видалення', 'error');
        }
      }
    });
  });
}

// ===== Modal =====
function openModal() {
  if (!currentPassword) return showStatus('Спочатку розблокуй', 'error');
  document.getElementById('mAddress').value = '';
  document.getElementById('mSeed').value = '';
  document.getElementById('mPk').value = '';
  modalOverlay.classList.add('open');
  setTimeout(() => document.getElementById('mAddress').focus(), 50);
}

function closeModal() {
  modalOverlay.classList.remove('open');
  // Очистити поля після закриття
  setTimeout(() => {
    document.getElementById('mAddress').value = '';
    document.getElementById('mSeed').value = '';
    document.getElementById('mPk').value = '';
  }, 200);
}

async function saveWallet() {
  const address    = document.getElementById('mAddress').value;
  const seedPhrase = document.getElementById('mSeed').value;
  const privateKey = document.getElementById('mPk').value;

  if (!address.trim()) return showStatus('Адреса обов\u02bcязкова', 'error');
  if (!seedPhrase.trim() && !privateKey.trim()) return showStatus('Введи seed і/або приватний ключ', 'error');

  const saveBtn = document.getElementById('modalSave');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Шифрую...';

  try {
    await manager.saveWallet({ address, seedPhrase, privateKey }, currentPassword);
    closeModal();
    currentWallets = await manager.getWallets(currentPassword);
    renderWallets(currentWallets);
    showStatus('Гаманець збережено!', 'success');
  } catch(e) {
    showStatus('Помилка: ' + e.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Зберегти';
  }
}

// ===== Clipboard with auto-clear =====
let clipClearTimer = null;

function copyText(text, label) {
  navigator.clipboard.writeText(String(text))
    .then(() => {
      showStatus(label + ' · очиститься через 30 сек', 'success');

      clearTimeout(clipClearTimer);
      let secs = 30;
      const notice = document.getElementById('clipNotice');
      notice.textContent = '📋 Буфер очиститься через ' + secs + ' сек';

      clipClearTimer = setInterval(() => {
        secs--;
        if (secs <= 0) {
          clearInterval(clipClearTimer);
          navigator.clipboard.writeText('').catch(() => {});
          notice.textContent = '✓ Буфер очищено';
          setTimeout(() => notice.textContent = '', 2000);
        } else {
          notice.textContent = '📋 Буфер очиститься через ' + secs + ' сек';
        }
      }, 1000);
    })
    .catch(() => showStatus('Не вдалось скопіювати (потрібен HTTPS/localhost)', 'error'));
}

// ===== Utils =====
function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'status ' + type + ' show';
  clearTimeout(statusEl._timer);
  statusEl._timer = setTimeout(() => statusEl.classList.remove('show'), 3000);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}