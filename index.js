
// class IDBStore {
//   constructor(dbName = 'wallet-keys', storeName = 'keys') {
//     this.dbName = dbName;
//     this.storeName = storeName;
//     this.db = null;
//   }

//   async init() {
//     return new Promise((resolve, reject) => {
//       const req = indexedDB.open(this.dbName, 1);
//       req.onerror = () => reject(req.error);
//       req.onupgradeneeded = (e) => {
//         const db = e.target.result;
//         if (!db.objectStoreNames.contains(this.storeName)) {
//           db.createObjectStore(this.storeName, { keyPath: 'id' });
//         }
//       };
//       req.onsuccess = (e) => {
//         this.db = e.target.result;
//         resolve(this.db);
//       };
//     });
//   }

//   async transaction(mode, operation) {
//     if (!this.db) throw new Error('DB not initialized');
//     return new Promise((resolve, reject) => {
//       const tx = this.db.transaction([this.storeName], mode);
//       tx.onerror = () => reject(tx.error);
//       const store = tx.objectStore(this.storeName);
//       operation(store).then(resolve).catch(reject);
//     });
//   }

//   async getAll() {
//     return this.transaction('readonly', (store) =>
//       new Promise((res, rej) => {
//         const req = store.getAll();
//         req.onsuccess = () => res(req.result);
//         req.onerror = () => rej(req.error);
//       })
//     );
//   }

//   async put(value) {
//     return this.transaction('readwrite', (store) =>
//       new Promise((res, rej) => {
//         const req = store.put(value);
//         req.onsuccess = () => res(req.result);
//         req.onerror = () => rej(req.error);
//       })
//     );
//   }
// }

// // WalletKeyManager - використовує IDBStore
// class WalletKeyManager {
//   constructor() {
//     this.store = new IDBStore();
//     this.store.init(); // Не блокує
//   }

//   async encrypt(text, password) {
//     const enc = new TextEncoder();
//     const keyMaterial = await crypto.subtle.importKey(
//       'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']
//     );
//     const salt = enc.encode('salt-2026');
//     const key = await crypto.subtle.deriveKey(
//       { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
//       keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
//     );
//     const iv = crypto.getRandomValues(new Uint8Array(12));
//     const encrypted = await crypto.subtle.encrypt(
//       { name: 'AES-GCM', iv }, key, enc.encode(text)
//     );
//     return { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
//   }

//   async decrypt(encryptedObj, password) {
//     const enc = new TextEncoder();
//     const keyMaterial = await crypto.subtle.importKey(
//       'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']
//     );
//     const salt = enc.encode('salt-2026');
//     const key = await crypto.subtle.deriveKey(
//       { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
//       keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
//     );
//     const decrypted = await crypto.subtle.decrypt(
//       { name: 'AES-GCM', iv: new Uint8Array(encryptedObj.iv) },
//       key, new Uint8Array(encryptedObj.data)
//     );
//     return new TextDecoder().decode(decrypted);
//   }

//   async saveWallet(name, privateKey, password) {
//     const encryptedKey = await this.encrypt(privateKey, password);
//     return this.store.put({ id: name, encryptedKey });
//   }

//   async getWallets(password) {
//     const all = await this.store.getAll();
//     const wallets = [];
//     for (const item of all) {
//       try {
//         const decryptedKey = await this.decrypt(item.encryptedKey, password);
//         wallets.push({ name: item.id, privateKey: decryptedKey });
//       } catch {
//         throw new Error('Wrong password');
//       }
//     }
//     return wallets;
//   }
// }

// const manager = new WalletKeyManager();
// let currentPassword = '';

// async function unlock() {
//     const password = document.getElementById('masterPassword').value;
//     if (!password) return showStatus('Введіть пароль!', 'error');
    
//     try {
//         const wallets = await manager.getWallets(password);
//         currentPassword = password;
        
//         if (wallets.length === 0) {
//             showStatus('Гаманці не знайдено. Додайте перший!', 'success');
//         }
        
//         renderWallets(wallets);
//         document.getElementById('keysContainer').classList.remove('hidden');
//         showStatus('Успішно розблоковано!', 'success');
//     } catch (error) {
//         showStatus('Неправильний пароль!', 'error');
//     }
// }

// function renderWallets(wallets) {
//     const container = document.getElementById('keysList');
//     container.innerHTML = wallets.map(wallet => `
//         <div class="key-item">
//             <strong>${wallet.name}</strong>
//             <button class="copy-btn" onclick="copyKey('${wallet.privateKey}')">📋 Копіювати</button>
//         </div>
//     `).join('');
// }

// async function addWallet() {
//     const name = prompt('Назва гаманця:');
//     const privateKey = prompt('Private Key:');
//     if (name && privateKey) {
//         await manager.saveWallet(name, privateKey, currentPassword);
//         unlock(); // Оновити список
//     }
// }

// function copyKey(key) {
//     navigator.clipboard.writeText(key).then(() => {
//         showStatus('Скопійовано в буфер!', 'success');
//     });
// }

// function showStatus(message, type) {
//     const status = document.getElementById('status');
//     status.textContent = message;
//     status.className = `status ${type}`;
//     status.classList.remove('hidden');
//     setTimeout(() => status.classList.add('hidden'), 3000);
// }


// ===== IndexedDB helper =====
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

        // міграція старих записів (якщо були)
        const store = e.target.transaction.objectStore(this.storeName);
        const cursorReq = store.openCursor();

        cursorReq.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;

          const val = cursor.value || {};

          // v1: { encryptedKey } -> encryptedPk
          if (val.encryptedKey && !val.encryptedPk && !val.encryptedSeed) {
            val.encryptedPk = val.encryptedKey;
            delete val.encryptedKey;
            cursor.update(val);
          }

          // проміжний: { encryptedSecret, secretType } -> encryptedSeed/encryptedPk
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

      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
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
}

// ===== Encryption + Wallet manager =====
class WalletKeyManager {
  constructor() {
    this.store = new IDBStore();
    this.ready = this.store.init();
  }

  async deriveKey(password, salt, iterations = 200000) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
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

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(text)
    );

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

    return this.store.put({
      id: addr,
      encryptedSeed,
      encryptedPk,
      updatedAt: Date.now(),
    });
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
}

// ===== UI =====
const manager = new WalletKeyManager();
let currentPassword = '';
let currentWallets = [];

const masterPasswordEl = document.getElementById('masterPassword');
const keysContainerEl = document.getElementById('keysContainer');
const keysListEl = document.getElementById('keysList');
const statusEl = document.getElementById('status');

document.getElementById('unlockBtn').addEventListener('click', unlock);
document.getElementById('addWalletBtn').addEventListener('click', addWallet);

async function unlock() {
  const password = masterPasswordEl.value;
  if (!password) return showStatus('Введіть пароль!', 'error');

  try {
    currentWallets = await manager.getWallets(password);
    currentPassword = password;

    renderWallets(currentWallets);
    keysContainerEl.classList.remove('hidden');

    if (currentWallets.length === 0) showStatus('Гаманців не знайдено. Додайте перший!', 'success');
    else showStatus('Успішно розблоковано!', 'success');
  } catch {
    showStatus('Неправильний пароль!', 'error');
  }
}

function renderWallets(wallets) {
  // Показуємо тільки address + 2 кнопки (seed / pk)
  keysListEl.innerHTML = wallets.map((w, idx) => `
    <div class="wallet-card">
      <div class="label">Адреса кошелька</div>
      <div class="value">${escapeHtml(w.address)}</div>

      <div class="btn-line">
        <button class="btn-copy" data-action="copy-seed" data-idx="${idx}">Копіювати seed</button>
        <button class="btn-copy-secondary" data-action="copy-pk" data-idx="${idx}">Копіювати PK</button>
      </div>
    </div>
  `).join('');

  // Вішаємо обробники через dataset, а не inline onclick [web:57]
  keysListEl.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const action = e.currentTarget.dataset.action; // читаємо data-action [web:57]
      const idx = Number(e.currentTarget.dataset.idx);
      const w = currentWallets[idx];
      if (!w) return;

      if (action === 'copy-seed') {
        if (!w.seedPhrase) return showStatus('Нема seed фрази для цього гаманця', 'error');
        copyText(w.seedPhrase);
        return;
      }

      if (action === 'copy-pk') {
        if (!w.privateKey) return showStatus('Нема приват ключа для цього гаманця', 'error');
        copyText(w.privateKey);
        return;
      }
    });
  });
}

async function addWallet() {
  if (!currentPassword) return showStatus('Спочатку розблокуй мастер-паролем', 'error');

  const address = prompt('Адреса кошелька (0x...):') || '';
  const seedPhrase = prompt('Сід фраза (можна пусто):') || '';
  const privateKey = prompt('Приват ключ (можна пусто):') || '';

  if (!address.trim()) return showStatus('Адреса обовʼязкова', 'error');
  if (!seedPhrase.trim() && !privateKey.trim()) return showStatus('Введи seed і/або приват ключ', 'error');

  try {
    await manager.saveWallet({ address, seedPhrase, privateKey }, currentPassword);
    await unlock();
  } catch {
    showStatus('Не вдалось зберегти', 'error');
  }
}

function copyText(text) {
  // writeText повертає Promise і працює в secure context [web:19]
  navigator.clipboard.writeText(String(text))
    .then(() => showStatus('Скопійовано!', 'success'))
    .catch(() => showStatus('Не вдалось скопіювати (перевір https/localhost)', 'error'));
}

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.classList.remove('hidden');
  setTimeout(() => statusEl.classList.add('hidden'), 2500);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
