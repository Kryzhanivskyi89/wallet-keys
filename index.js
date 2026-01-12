class WalletKeyManager {
    constructor() {
        this.dbName = 'wallet-keys';
        this.storeName = 'keys';
        this.initDB();
    }

    async initDB() {
        return new Promise((resolve) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };
            request.onsuccess = () => resolve(request.result);
        });
    }

    async encrypt(text, password) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: enc.encode('salt-2026'), iterations: 100000, hash: 'SHA-256' },
            keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt']
        );
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv }, key, enc.encode(text)
        );
        return { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
    }

    async decrypt(encrypted, password) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: enc.encode('salt-2026'), iterations: 100000, hash: 'SHA-256' },
            keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
        );
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) },
            key, new Uint8Array(encrypted.data)
        );
        return enc.decode(decrypted);
    }

    async saveWallet(name, privateKey, password) {
        const encryptedKey = await this.encrypt(privateKey, password);
        const tx = await this.openTransaction('readwrite');
        await tx.put({ id: name, encryptedKey });
        return true;
    }

    async getWallets(password) {
        const tx = await this.openTransaction('readonly');
        const wallets = [];
        for (let cursor = await tx.openCursor(); cursor; cursor.continue()) {
            const decryptedKey = await this.decrypt(cursor.value.encryptedKey, password);
            wallets.push({ name: cursor.value.id, privateKey: decryptedKey });
        }
        return wallets;
    }

    async openTransaction(mode) {
        return new Promise((resolve) => {
            const request = indexedDB.open(this.dbName);
            request.onsuccess = () => {
                const tx = request.result.transaction([this.storeName], mode);
                resolve(tx.objectStore(this.storeName));
            };
        });
    }
}

const manager = new WalletKeyManager();
let currentPassword = '';

async function unlock() {
    const password = document.getElementById('masterPassword').value;
    if (!password) return showStatus('Введіть пароль!', 'error');
    
    try {
        const wallets = await manager.getWallets(password);
        currentPassword = password;
        
        if (wallets.length === 0) {
            showStatus('Гаманці не знайдено. Додайте перший!', 'success');
        }
        
        renderWallets(wallets);
        document.getElementById('keysContainer').classList.remove('hidden');
        showStatus('Успішно розблоковано!', 'success');
    } catch (error) {
        showStatus('Неправильний пароль!', 'error');
    }
}

function renderWallets(wallets) {
    const container = document.getElementById('keysList');
    container.innerHTML = wallets.map(wallet => `
        <div class="key-item">
            <strong>${wallet.name}</strong>
            <button class="copy-btn" onclick="copyKey('${wallet.privateKey}')">📋 Копіювати</button>
        </div>
    `).join('');
}

async function addWallet() {
    const name = prompt('Назва гаманця:');
    const privateKey = prompt('Private Key:');
    if (name && privateKey) {
        await manager.saveWallet(name, privateKey, currentPassword);
        unlock(); // Оновити список
    }
}

function copyKey(key) {
    navigator.clipboard.writeText(key).then(() => {
        showStatus('Скопійовано в буфер!', 'success');
    });
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
    status.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 3000);
}
