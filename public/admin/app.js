// API Configuration
const API_BASE = window.location.origin + '/api';
let authToken = localStorage.getItem('admin_token');
let allKeys = [];

// DOM Elements
const loginPage = document.getElementById('loginPage');
const dashboardPage = document.getElementById('dashboardPage');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const createKeyBtn = document.getElementById('createKeyBtn');
const quickKeyBtn = document.getElementById('quickKeyBtn');
const createKeyModal = document.getElementById('createKeyModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelCreateBtn = document.getElementById('cancelCreateBtn');
const createKeyForm = document.getElementById('createKeyForm');
const searchInput = document.getElementById('searchInput');
const keysTableBody = document.getElementById('keysTableBody');

// Settings DOM Elements
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const settingsForm = document.getElementById('settingsForm');
const apiUrlInput = document.getElementById('apiUrlInput');
const apiKeyInput = document.getElementById('apiKeyInput');
const modelDisplayInput = document.getElementById('modelDisplayInput');
const modelActualInput = document.getElementById('modelActualInput');
const settingsError = document.getElementById('settingsError');
const settingsSuccess = document.getElementById('settingsSuccess');

// Initialize
if (authToken) {
    showDashboard();
    loadKeys();
} else {
    showLogin();
}

// Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('passwordInput').value;
    loginError.classList.add('hidden');

    try {
        const response = await fetch(`${API_BASE}/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (response.ok) {
            authToken = data.token;
            localStorage.setItem('admin_token', authToken);
            showDashboard();
            loadKeys();
        } else {
            loginError.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Login error:', error);
        loginError.textContent = 'Lß╗ùi kß║┐t nß╗æi server';
        loginError.classList.remove('hidden');
    }
});

// Logout
logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('admin_token');
    authToken = null;
    showLogin();
});

// Show/Hide Pages
function showLogin() {
    loginPage.classList.remove('hidden');
    dashboardPage.classList.add('hidden');
}

function showDashboard() {
    loginPage.classList.add('hidden');
    dashboardPage.classList.remove('hidden');
}

// Load Keys
async function loadKeys() {
    try {
        const response = await fetch(`${API_BASE}/admin/keys/list`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        allKeys = data.keys || [];

        // Update stats
        document.getElementById('statTotal').textContent = data.stats.total_keys;
        document.getElementById('statActive').textContent = data.stats.active_keys;
        document.getElementById('statExpired').textContent = data.stats.expired_keys;
        document.getElementById('statActivations').textContent = data.stats.total_activations;

        // Render table
        renderKeysTable(allKeys);
    } catch (error) {
        console.error('Load keys error:', error);
        keysTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-8 text-center text-red-500">
          <i class="fas fa-exclamation-circle text-2xl mb-2"></i>
          <p>Lß╗ùi tß║úi dß╗» liß╗çu</p>
        </td>
      </tr>
    `;
    }
}

// Render Keys Table
function renderKeysTable(keys) {
    if (keys.length === 0) {
        keysTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="px-6 py-8 text-center text-gray-500">
          <i class="fas fa-inbox text-4xl mb-2"></i>
          <p>Ch╞░a c├│ key n├áo</p>
        </td>
      </tr>
    `;
        return;
    }

    keysTableBody.innerHTML = keys.map(key => {
        const usagePercent = Math.min(100, Math.round((key.current_usage / key.daily_limit) * 100));
        let progressColor = 'bg-blue-500';
        if (usagePercent > 80) progressColor = 'bg-yellow-500';
        if (usagePercent >= 100) progressColor = 'bg-red-500';

        const statusBadge = key.is_expired
            ? '<span class="px-3 py-1 bg-red-100 text-red-600 rounded-full text-xs font-semibold">Hß║┐t hß║ín</span>'
            : key.is_active
                ? '<span class="px-3 py-1 bg-green-100 text-green-600 rounded-full text-xs font-semibold">Hoß║ít ─æß╗Öng</span>'
                : '<span class="px-3 py-1 bg-red-100 text-red-600 rounded-full text-xs font-semibold">Hß║┐t l╞░ß╗út</span>';

        return `
      <tr class="transition">
        <td class="px-6 py-4">
          <div class="flex items-center">
            <i class="fas fa-key text-purple-500 mr-3"></i>
            <span class="font-medium text-gray-800">${key.name}</span>
          </div>
        </td>
        <td class="px-6 py-4">${statusBadge}</td>
        <td class="px-6 py-4 text-gray-600">${formatDate(key.expiry)}</td>
        <td class="px-6 py-4">
          <div class="flex flex-col w-full">
            <div class="flex justify-between text-xs mb-1">
              <span class="font-semibold text-gray-700">${key.current_usage} / ${key.daily_limit}</span>
              <span class="text-gray-500">${usagePercent}%</span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-1.5">
              <div class="${progressColor} h-1.5 rounded-full" style="width: ${usagePercent}%"></div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4 text-right">
          <button onclick="copyKey('${key.name}')" class="text-blue-500 hover:text-blue-700 mr-3" title="Copy Key">
            <i class="fas fa-copy"></i>
          </button>
          <button onclick="deleteKey('${key.name}')" class="text-red-500 hover:text-red-700" title="X├│a">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
    }).join('');
}

// Removed showDeviceIds function as it's no longer needed

// Format Date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('vi-VN');
}

// Search
searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filtered = allKeys.filter(key =>
        key.name.toLowerCase().includes(searchTerm)
    );
    renderKeysTable(filtered);
});

// Create Key Modal
createKeyBtn.addEventListener('click', () => {
    createKeyModal.classList.remove('hidden');
    // Set default expiry to 30 days from now
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
    document.getElementById('expiryInput').value = thirtyDaysLater.toISOString().split('T')[0];
});

closeModalBtn.addEventListener('click', () => {
    createKeyModal.classList.add('hidden');
});

cancelCreateBtn.addEventListener('click', () => {
    createKeyModal.classList.add('hidden');
});

// Create Key Form
createKeyForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    let keyName = document.getElementById('keyNameInput').value.trim();
    const expiry = document.getElementById('expiryInput').value;
    const dailyLimit = parseInt(document.getElementById('maxActivationsInput').value);
    const errorDiv = document.getElementById('createKeyError');

    // Generate random key if name is empty
    if (!keyName) {
        keyName = generateRandomKey();
    }

    errorDiv.classList.add('hidden');

    try {
        const response = await fetch(`${API_BASE}/admin/keys/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: keyName,
                expiry,
                daily_limit: dailyLimit
            })
        });

        const data = await response.json();

        if (response.ok) {
            createKeyModal.classList.add('hidden');
            createKeyForm.reset();
            loadKeys();

            // Show success notification
            const message = `Γ£à Key ─æ├ú ─æ╞░ß╗úc tß║ío th├ánh c├┤ng!\n\n≡ƒöæ Key: ${keyName}\n≡ƒôê Giß╗¢i hß║ín: ${dailyLimit} l╞░ß╗út/ng├áy\n\nNhß║Ñn OK ─æß╗â copy key.`;

            if (confirm(message)) {
                copyToClipboard(keyName);
                alert('Γ£à ─É├ú copy key!');
            }
        } else {
            errorDiv.textContent = data.error || 'Lß╗ùi tß║ío key';
            errorDiv.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Create key error:', error);
        errorDiv.textContent = 'Lß╗ùi kß║┐t nß╗æi server';
        errorDiv.classList.remove('hidden');
    }
});

// Generate Random Key
function generateRandomKey() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'key-';
    for (let i = 0; i < 12; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Copy Key
function copyKey(keyName) {
    copyToClipboard(keyName);
    alert(`Γ£à ─É├ú copy key: ${keyName}`);
}

function copyToClipboard(text) {
    const tempInput = document.createElement('input');
    tempInput.value = text;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
}

// Delete Key
async function deleteKey(keyName) {
    if (!confirm(`Bß║ín c├│ chß║»c muß╗æn x├│a key "${keyName}"?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/keys/delete?name=${encodeURIComponent(keyName)}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            alert(`Γ£à ─É├ú x├│a key: ${keyName}`);
            loadKeys();
        } else {
            const data = await response.json();
            alert(`Γ¥î Lß╗ùi: ${data.error}`);
        }
    } catch (error) {
        console.error('Delete key error:', error);
        alert('Γ¥î Lß╗ùi kß║┐t nß╗æi server');
    }
}

// Logout helper
function logout() {
    localStorage.removeItem('admin_token');
    authToken = null;
    showLogin();
}

// =====================
// SETTINGS FUNCTIONALITY
// =====================

// =====================
// API PROFILES MANAGEMENT
// =====================

const PROFILES_STORAGE_KEY = 'api_profiles';

// Get all saved profiles from localStorage
function getProfiles() {
    const data = localStorage.getItem(PROFILES_STORAGE_KEY);
    return data ? JSON.parse(data) : {};
}

// Save profiles to localStorage
function saveProfilesToStorage(profiles) {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

// Load profile list into dropdown
function loadProfilesList() {
    const profiles = getProfiles();
    const select = document.getElementById('profileSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Chß╗ìn Profile ─æß╗â ├íp dß╗Ñng --</option>';

    Object.keys(profiles).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });
}

// Apply selected profile to form inputs
function applyProfile(profileName) {
    const profiles = getProfiles();
    const profile = profiles[profileName];
    if (!profile) return;

    apiUrlInput.value = profile.api_url || '';
    apiKeyInput.value = profile.api_key || '';
    modelDisplayInput.value = profile.model_display || '';
    modelActualInput.value = profile.model_actual || '';
    const systemPromptInput = document.getElementById('systemPromptInput');
    if (systemPromptInput) {
        systemPromptInput.value = profile.system_prompt || '';
    }

    // Show notification
    settingsSuccess.textContent = `Γ£à ─É├ú ├íp dß╗Ñng profile: ${profileName}`;
    settingsSuccess.classList.remove('hidden');
    setTimeout(() => settingsSuccess.classList.add('hidden'), 2000);
}

// Save current form as new profile
function saveCurrentAsProfile() {
    const name = prompt('Nhß║¡p t├¬n profile:');
    if (!name || !name.trim()) return;

    const trimmedName = name.trim();
    const profiles = getProfiles();
    const systemPromptInput = document.getElementById('systemPromptInput');

    profiles[trimmedName] = {
        api_url: apiUrlInput.value,
        api_key: apiKeyInput.value,
        model_display: modelDisplayInput.value,
        model_actual: modelActualInput.value,
        system_prompt: systemPromptInput ? systemPromptInput.value : ''
    };

    saveProfilesToStorage(profiles);
    loadProfilesList();
    document.getElementById('profileSelect').value = trimmedName;

    settingsSuccess.textContent = `Γ£à ─É├ú l╞░u profile: ${trimmedName}`;
    settingsSuccess.classList.remove('hidden');
    setTimeout(() => settingsSuccess.classList.add('hidden'), 2000);
}

// Delete selected profile
function deleteSelectedProfile() {
    const select = document.getElementById('profileSelect');
    const name = select.value;
    if (!name) {
        alert('Vui l├▓ng chß╗ìn profile ─æß╗â x├│a');
        return;
    }

    if (!confirm(`X├│a profile "${name}"?`)) return;

    const profiles = getProfiles();
    delete profiles[name];
    saveProfilesToStorage(profiles);
    loadProfilesList();

    settingsSuccess.textContent = `Γ£à ─É├ú x├│a profile: ${name}`;
    settingsSuccess.classList.remove('hidden');
    setTimeout(() => settingsSuccess.classList.add('hidden'), 2000);
}

// Profile event listeners
document.getElementById('profileSelect')?.addEventListener('change', (e) => {
    if (e.target.value) applyProfile(e.target.value);
});

document.getElementById('saveProfileBtn')?.addEventListener('click', saveCurrentAsProfile);
document.getElementById('deleteProfileBtn')?.addEventListener('click', deleteSelectedProfile);


// Open Settings Modal
settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    loadSettings();
    loadProfilesList();
    loadModels(); // Fix: Load models when opening settings
});

// Close Settings Modal
closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    hideSettingsMessages();
});

cancelSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    hideSettingsMessages();
});

// Hide Settings Messages
function hideSettingsMessages() {
    settingsError.classList.add('hidden');
    settingsSuccess.classList.add('hidden');
}

// Load Settings
async function loadSettings() {
    try {
        const response = await fetch(`${API_BASE}/admin/settings/get`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();

        if (data.api_url) {
            apiUrlInput.value = data.api_url;
        }

        // Load model mapping
        if (data.model_display) {
            modelDisplayInput.value = data.model_display;
        }
        if (data.model_actual) {
            modelActualInput.value = data.model_actual;
        }

        // Load system prompt
        const systemPromptInput = document.getElementById('systemPromptInput');
        if (data.system_prompt && systemPromptInput) {
            systemPromptInput.value = data.system_prompt;
        }

        // Load concurrency limit
        const concurrencyLimitInput = document.getElementById('concurrencyLimitInput');
        if (data.concurrency_limit && concurrencyLimitInput) {
            concurrencyLimitInput.value = data.concurrency_limit;
        }

        // Don't show masked key, let user enter new one if needed
        if (data.api_key_set) {
            apiKeyInput.placeholder = '(─É├ú cß║Ñu h├¼nh - nhß║¡p mß╗¢i ─æß╗â thay ─æß╗òi)';
        }
    } catch (error) {
        console.error('Load settings error:', error);
    }
}

// Save Settings
settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideSettingsMessages();

    const apiUrl = apiUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const modelDisplay = modelDisplayInput.value.trim() || 'Claude-Opus-4.5-VIP';
    const modelActual = modelActualInput.value.trim() || 'claude-3-5-haiku-20241022';
    const systemPromptInput = document.getElementById('systemPromptInput');
    const systemPrompt = systemPromptInput ? systemPromptInput.value.trim() : '';

    const concurrencyLimit = parseInt(document.getElementById('concurrencyLimitInput').value) || 100;

    if (!apiUrl) {
        settingsError.textContent = 'Vui l├▓ng nhß║¡p API URL';
        settingsError.classList.remove('hidden');
        return;
    }

    if (!apiKey) {
        settingsError.textContent = 'Vui l├▓ng nhß║¡p API Key';
        settingsError.classList.remove('hidden');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/settings/save`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_url: apiUrl,
                api_key: apiKey,
                model_display: modelDisplay,
                model_actual: modelActual,
                system_prompt: systemPrompt,
                concurrency_limit: concurrencyLimit
            })
        });

        const data = await response.json();

        if (response.ok) {
            settingsSuccess.textContent = 'Γ£à Settings ─æ├ú ─æ╞░ß╗úc l╞░u th├ánh c├┤ng!';
            settingsSuccess.classList.remove('hidden');
            apiKeyInput.value = '';
            apiKeyInput.placeholder = '(─É├ú cß║Ñu h├¼nh - nhß║¡p mß╗¢i ─æß╗â thay ─æß╗òi)';

            // Auto close after 2 seconds
            setTimeout(() => {
                settingsModal.classList.add('hidden');
                hideSettingsMessages();
            }, 2000);
        } else {
            settingsError.textContent = data.error || 'Lß╗ùi l╞░u settings';
            settingsError.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Save settings error:', error);
        settingsError.textContent = 'Lß╗ùi kß║┐t nß╗æi server';
        settingsError.classList.remove('hidden');
    }
});

// =====================
// QUICK KEY GENERATION
// =====================

// Generate random key name
function generateRandomKeyName() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'key-';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Get date 1 month from now
function getOneMonthFromNow() {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    return date.toISOString().split('T')[0];
}

// Quick Key Button Handler
quickKeyBtn.addEventListener('click', async () => {
    const keyName = generateRandomKeyName();
    const expiry = getOneMonthFromNow();
    const maxActivations = 1;

    try {
        const response = await fetch(`${API_BASE}/admin/keys/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: keyName, // Changed from key_name to name to match existing createKeyForm logic
                expiry: expiry,
                max_activations: maxActivations
            })
        });

        if (response.ok) {
            const data = await response.json();
            alert(`Γ£à ─É├ú tß║ío key nhanh th├ánh c├┤ng!\n\nKey: ${data.key_name || keyName}\nHß║┐t hß║ín: ${expiry}\nSß╗æ thiß║┐t bß╗ï: ${maxActivations}`);
            loadKeys();
        } else {
            const data = await response.json();
            alert(`Γ¥î Lß╗ùi: ${data.error}`);
        }
    } catch (error) {
        console.error('Quick key error:', error);
        alert('Γ¥î Lß╗ùi kß║┐t nß╗æi server');
    }
});

// =====================
// MODEL MANAGEMENT
// =====================

let editingModelId = null;

// Load models list
async function loadModels() {
    const modelsList = document.getElementById('modelsList');
    if (!modelsList) return;

    try {
        const response = await fetch(`${API_BASE}/admin/models/list`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) {
            modelsList.innerHTML = '<p class="text-sm text-red-400 text-center py-2">Lß╗ùi tß║úi danh s├ích model</p>';
            return;
        }

        const data = await response.json();

        if (!data.models || data.models.length === 0) {
            modelsList.innerHTML = '<p class="text-sm text-gray-400 text-center py-2">Ch╞░a c├│ model n├áo</p>';
            return;
        }

        modelsList.innerHTML = data.models.map(model => `
            <div class="flex items-center justify-between p-2 bg-white rounded border border-gray-200 hover:border-purple-300 transition">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="font-medium text-sm text-gray-700">${model.name}</span>
                        <span class="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">${model.id}</span>
                    </div>
                    <p class="text-xs text-gray-500 truncate mt-0.5">${model.system_prompt ? model.system_prompt.substring(0, 50) + '...' : '(kh├┤ng c├│ prompt)'}</p>
                </div>
                <div class="flex gap-1 ml-2">
                    <button onclick="editModel('${model.id}')" class="text-blue-500 hover:text-blue-700 p-1" title="Sß╗¡a">
                        <i class="fas fa-edit text-sm"></i>
                    </button>
                    <button onclick="deleteModel('${model.id}')" class="text-red-500 hover:text-red-700 p-1" title="X├│a">
                        <i class="fas fa-trash text-sm"></i>
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Load models error:', error);
        modelsList.innerHTML = '<p class="text-sm text-red-400 text-center py-2">Lß╗ùi kß║┐t nß╗æi server</p>';
    }
}

// Show add model form
document.getElementById('addModelBtn')?.addEventListener('click', () => {
    editingModelId = null;
    document.getElementById('modelIdInput').value = '';
    document.getElementById('modelIdInput').disabled = false;
    document.getElementById('modelNameInput').value = '';
    document.getElementById('modelSystemPromptInput').value = '';
    document.getElementById('modelForm').classList.remove('hidden');
});

// Cancel model form
document.getElementById('cancelModelBtn')?.addEventListener('click', () => {
    document.getElementById('modelForm').classList.add('hidden');
    editingModelId = null;
});

// Edit model
async function editModel(modelId) {
    try {
        const response = await fetch(`${API_BASE}/admin/models/list`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) return;

        const data = await response.json();
        const model = data.models.find(m => m.id === modelId);

        if (!model) return;

        editingModelId = modelId;
        document.getElementById('modelIdInput').value = model.id;
        document.getElementById('modelIdInput').disabled = true;
        document.getElementById('modelNameInput').value = model.name;
        document.getElementById('modelSystemPromptInput').value = model.system_prompt || '';
        document.getElementById('modelForm').classList.remove('hidden');
    } catch (error) {
        console.error('Edit model error:', error);
    }
}

// Save model
document.getElementById('saveModelBtn')?.addEventListener('click', async () => {
    const modelId = document.getElementById('modelIdInput').value.trim();
    const modelName = document.getElementById('modelNameInput').value.trim();
    const systemPrompt = document.getElementById('modelSystemPromptInput').value;

    if (!modelId || !modelName) {
        alert('Vui l├▓ng nhß║¡p Model ID v├á T├¬n hiß╗ân thß╗ï');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/models/save`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model_id: editingModelId || modelId,
                name: modelName,
                system_prompt: systemPrompt
            })
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('modelForm').classList.add('hidden');
            editingModelId = null;
            loadModels();
            settingsSuccess.textContent = `Γ£à ─É├ú l╞░u model: ${modelName}`;
            settingsSuccess.classList.remove('hidden');
            setTimeout(() => settingsSuccess.classList.add('hidden'), 2000);
        } else {
            alert(`Γ¥î Lß╗ùi: ${data.error}`);
        }
    } catch (error) {
        console.error('Save model error:', error);
        alert('Γ¥î Lß╗ùi kß║┐t nß╗æi server');
    }
});

// Delete model
async function deleteModel(modelId) {
    if (!confirm(`X├│a model "${modelId}"?`)) return;

    try {
        const response = await fetch(`${API_BASE}/admin/models/delete?model_id=${encodeURIComponent(modelId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
            loadModels();
            settingsSuccess.textContent = `Γ£à ─É├ú x├│a model: ${modelId}`;
            settingsSuccess.classList.remove('hidden');
            setTimeout(() => settingsSuccess.classList.add('hidden'), 2000);
        } else {
            const data = await response.json();
            alert(`Γ¥î Lß╗ùi: ${data.error}`);
        }
    } catch (error) {
        console.error('Delete model error:', error);
        alert('Γ¥î Lß╗ùi kß║┐t nß╗æi server');
    }
}

// =====================
// BACKUP API MANAGEMENT
// =====================

const backupModal = document.getElementById('backupModal');
let editingBackupId = null;

// Switch Tab Logic (Updated)
window.switchTab = function (tabName) {
    // Hide all contents
    document.getElementById('content-keys').classList.add('hidden');
    document.getElementById('content-profiles').classList.add('hidden');
    document.getElementById('content-backups').classList.add('hidden');
    const metricsContent = document.getElementById('content-metrics');
    if (metricsContent) metricsContent.classList.add('hidden');
    const announcementsContent = document.getElementById('content-announcements');
    if (announcementsContent) announcementsContent.classList.add('hidden');

    // Reset tab styles
    document.getElementById('tab-keys').className = 'px-4 py-2 rounded-lg text-gray-600 hover:bg-purple-50 hover:text-purple-600 transition';
    document.getElementById('tab-profiles').className = 'px-4 py-2 rounded-lg text-gray-600 hover:bg-purple-50 hover:text-purple-600 transition';
    document.getElementById('tab-backups').className = 'px-4 py-2 rounded-lg text-gray-600 hover:bg-purple-50 hover:text-purple-600 transition';
    const metricsTab = document.getElementById('tab-metrics');
    if (metricsTab) metricsTab.className = 'px-4 py-2 rounded-lg text-gray-600 hover:bg-purple-50 hover:text-purple-600 transition';
    const announcementsTab = document.getElementById('tab-announcements');
    if (announcementsTab) announcementsTab.className = 'px-4 py-2 rounded-lg text-gray-600 hover:bg-purple-50 hover:text-purple-600 transition';

    // Stop metrics auto-refresh when leaving metrics tab
    if (typeof stopMetricsAutoRefresh === 'function') {
        stopMetricsAutoRefresh();
    }

    // Show selected content and activate tab
    if (tabName === 'keys') {
        document.getElementById('content-keys').classList.remove('hidden');
        document.getElementById('tab-keys').className = 'px-4 py-2 rounded-lg bg-purple-100 text-purple-700 font-medium transition';
        loadKeys();
    } else if (tabName === 'profiles') {
        document.getElementById('content-profiles').classList.remove('hidden');
        document.getElementById('tab-profiles').className = 'px-4 py-2 rounded-lg bg-purple-100 text-purple-700 font-medium transition';
        loadProfilesListTable();
    } else if (tabName === 'backups') {
        document.getElementById('content-backups').classList.remove('hidden');
        document.getElementById('tab-backups').className = 'px-4 py-2 rounded-lg bg-purple-100 text-purple-700 font-medium transition';
        loadBackupProfiles();
    } else if (tabName === 'metrics') {
        if (metricsContent) {
            metricsContent.classList.remove('hidden');
            if (metricsTab) metricsTab.className = 'px-4 py-2 rounded-lg bg-purple-100 text-purple-700 font-medium transition';
            // Initial refresh and start auto-refresh
            refreshMetrics();
            if (typeof startMetricsAutoRefresh === 'function') {
                startMetricsAutoRefresh();
            }
        }
    } else if (tabName === 'announcements') {
        if (announcementsContent) {
            announcementsContent.classList.remove('hidden');
            if (announcementsTab) announcementsTab.className = 'px-4 py-2 rounded-lg bg-purple-100 text-purple-700 font-medium transition';
            loadAnnouncement();
        }
    }
}

// Load Backup Profiles
async function loadBackupProfiles() {
    const tbody = document.getElementById('backupsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">─Éang tß║úi...</td></tr>';

    try {
        const response = await fetch(`${API_BASE}/admin/backup-profiles/list`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) throw new Error('Failed to load backup profiles');

        const data = await response.json();
        const profiles = data.profiles || [];

        if (profiles.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Ch╞░a c├│ backup profile n├áo</td></tr>';
            return;
        }

        tbody.innerHTML = profiles.map(profile => {
            // Mock concurrency status for now (requires backend endpoint)
            const concurrencyStatus = `<span class="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Ready</span>`;

            return `
            <tr class="hover:bg-gray-50 transition">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${profile.name}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 truncate max-w-xs">${profile.api_url}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-semibold">${profile.concurrency_limit || 'N/A'}</td>
                <td class="px-6 py-4 whitespace-nowrap">${concurrencyStatus}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onclick="resetConcurrency('${profile.id}')" title="Reset Concurrency" class="text-orange-600 hover:text-orange-900 mr-3">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <button onclick="editBackupProfile('${profile.id}')" class="text-indigo-600 hover:text-indigo-900 mr-3"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteBackupProfile('${profile.id}')" class="text-red-600 hover:text-red-900"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `}).join('');

    } catch (error) {
        console.error('Load backups error:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-500">Lß╗ùi tß║úi dß╗» liß╗çu</td></tr>';
    }
}

// Open Backup Modal
window.openBackupModal = function () {
    editingBackupId = null;
    document.getElementById('backupId').value = '';
    document.getElementById('backupName').value = '';
    document.getElementById('backupUrl').value = '';
    document.getElementById('backupKey').value = '';
    document.getElementById('backupModelActual').value = '';
    document.getElementById('backupConcurrency').value = '50';
    backupModal.classList.remove('hidden');
}

// Close Backup Modal
window.closeBackupModal = function () {
    backupModal.classList.add('hidden');
}

// Save Backup Profile
window.saveBackupProfile = async function () {
    const id = document.getElementById('backupId').value;
    const name = document.getElementById('backupName').value;
    const url = document.getElementById('backupUrl').value;
    const key = document.getElementById('backupKey').value;
    const modelActual = document.getElementById('backupModelActual').value;
    const concurrency = parseInt(document.getElementById('backupConcurrency').value) || 50;

    if (!name || !url || !key) {
        alert('Vui l├▓ng ─æiß╗ün ─æß║ºy ─æß╗º c├íc tr╞░ß╗¥ng bß║»t buß╗Öc');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/backup-profiles/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: editingBackupId, // If editing, send ID to update
                name,
                api_url: url,
                api_key: key,
                model_actual: modelActual,
                concurrency_limit: concurrency,
                type: 'backup'
            })
        });

        if (response.ok) {
            closeBackupModal();
            loadBackupProfiles();
            alert('Γ£à ─É├ú l╞░u Backup Profile th├ánh c├┤ng');
        } else {
            const data = await response.json();
            alert('Γ¥î Lß╗ùi: ' + (data.error || 'Kh├┤ng thß╗â l╞░u profile'));
        }
    } catch (error) {
        console.error('Save backup error:', error);
        alert('Γ¥î Lß╗ùi kß║┐t nß╗æi server');
    }
}

// Edit Backup Profile
window.editBackupProfile = async function (id) {
    try {
        const response = await fetch(`${API_BASE}/admin/backup-profiles/list`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        const profile = data.profiles.find(p => p.id === id);

        if (profile) {
            editingBackupId = id;
            document.getElementById('backupId').value = profile.id;
            document.getElementById('backupName').value = profile.name;
            document.getElementById('backupUrl').value = profile.api_url;
            document.getElementById('backupKey').value = profile.api_key; // Note: Usually hidden, but for simplicity
            document.getElementById('backupModelActual').value = profile.model_actual || '';
            document.getElementById('backupConcurrency').value = profile.concurrency_limit || 50;
            backupModal.classList.remove('hidden');
        }
    } catch (err) {
        console.error(err);
        alert('Cannot load profile details');
    }
}

// Delete Backup Profile
window.deleteBackupProfile = async function (id) {
    if (!confirm('Bß║ín c├│ chß║»c chß║»n muß╗æn x├│a Backup Profile n├áy?')) return;

    try {
        const response = await fetch(`${API_BASE}/admin/backup-profiles/delete?id=${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
            loadBackupProfiles();
            alert('Γ£à ─É├ú x├│a th├ánh c├┤ng');
        } else {
            alert('Γ¥î Lß╗ùi x├│a profile');
        }
    } catch (error) {
        console.error(error);
        alert('Γ¥î Lß╗ùi kß║┐t nß╗æi');
    }
}


// =====================
// CONCURRENCY MONITORING
// =====================

async function updateConcurrencyStatus() {
    // Only run if we are on the relevant tab
    if (document.getElementById('content-backups').classList.contains('hidden')) return;

    try {
        const response = await fetch(`${API_BASE}/admin/concurrency-status`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) return;

        const data = await response.json();

        // 1. Update Default API Status UI
        if (data.default) {
            const currentEl = document.getElementById('defaultApiCurrent');
            const limitEl = document.getElementById('defaultApiLimit');
            const dotEl = document.getElementById('defaultApiStatusDot');
            const textEl = document.getElementById('defaultApiStatusText');

            if (currentEl) currentEl.textContent = data.default.current;
            if (limitEl) limitEl.textContent = data.default.limit;

            if (dotEl && textEl) {
                if (data.default.status === 'green') {
                    dotEl.className = 'w-3 h-3 rounded-full bg-green-500';
                    textEl.className = 'text-sm font-medium text-green-600';
                    textEl.textContent = 'Optimal (Tß║úi Thß║Ñp)';
                } else if (data.default.status === 'yellow') {
                    dotEl.className = 'w-3 h-3 rounded-full bg-yellow-500';
                    textEl.className = 'text-sm font-medium text-yellow-600';
                    textEl.textContent = 'Heavy Load (Tß║úi Cao)';
                } else {
                    dotEl.className = 'w-3 h-3 rounded-full bg-red-500';
                    textEl.className = 'text-sm font-medium text-red-600';
                    textEl.textContent = 'Overloaded (Qu├í Tß║úi)';
                }
            }
        }

        // 2. Update Backup Rows
        const tbody = document.getElementById('backupsTableBody');
        if (tbody && data.backups) {
            refreshBackupTableStatuses(data.backups);
        }

    } catch (error) {
        console.error('Monitoring error:', error);
    }
}

async function resetConcurrency(target) {
    if (!confirm(`Are you sure you want to RESET concurrency for: ${target.toUpperCase()}?\nThis will clear the lock immediately.`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/reset-concurrency`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ target })
        });

        if (response.ok) {
            // Refresh immediately
            updateConcurrencyStatus();
            alert('Reset successful!');
        } else {
            alert('Failed to reset');
        }
    } catch (e) {
        console.error('Reset error:', e);
        alert('Error resetting concurrency');
    }
}

function refreshBackupTableStatuses(backupStatuses) {
    const tbody = document.getElementById('backupsTableBody');
    if (!tbody) return;

    // Map of ID -> Status Data
    const statusMap = new Map(backupStatuses.map(s => [s.id, s]));

    Array.from(tbody.children).forEach(row => {
        const editBtn = row.querySelector('button[onclick^="editBackupProfile"]');
        if (!editBtn) return;

        // Extract ID from onclick="editBackupProfile('ID')"
        const idMatch = editBtn.getAttribute('onclick').match(/'([^']+)'/);
        if (!idMatch) return;

        const id = idMatch[1];
        const statusData = statusMap.get(id);

        if (statusData) {
            // Update Concurrency Cell (Index 2)
            // row.children[2].textContent = `${statusData.current} / ${statusData.limit}`; // Optional: Show numbers

            // Update Status Cell (Index 3)
            const statusCell = row.children[3];
            let colorClass = 'bg-green-100 text-green-700';
            let label = 'Ready';

            if (statusData.status === 'yellow') {
                colorClass = 'bg-yellow-100 text-yellow-800';
                label = 'Heavy Load';
            } else if (statusData.status === 'red') {
                colorClass = 'bg-red-100 text-red-700';
                label = 'Full / Queued';
            }

            statusCell.innerHTML = `<span class="px-2 py-1 ${colorClass} rounded text-xs font-semibold">
                ${label} (${statusData.current}/${statusData.limit})
            </span>`;
        }
    });
}

// Start polling - faster refresh for real-time monitoring
setInterval(updateConcurrencyStatus, 2000); // Poll every 2 seconds




// =====================
// TAB MANAGEMENT
// =====================

window.switchTab = function (tabName) {
    // Hide all contents
    ['keys', 'profiles', 'settings'].forEach(t => {
        const el = document.getElementById(`content-${t}`);
        if (el) el.classList.add('hidden');

        const btn = document.getElementById(`tab-${t}`);
        if (btn) {
            btn.classList.remove('bg-purple-100', 'text-purple-700');
            btn.classList.add('text-gray-600');
        }
    });

    // Show selected content
    const selectedContent = document.getElementById(`content-${tabName}`);
    if (selectedContent) selectedContent.classList.remove('hidden');

    const selectedBtn = document.getElementById(`tab-${tabName}`);
    if (selectedBtn) {
        selectedBtn.classList.remove('text-gray-600');
        selectedBtn.classList.add('bg-purple-100', 'text-purple-700');
    }

    // Load data if needed
    if (tabName === 'profiles') {
        loadAPIProfiles();
        stopPolling();
    } else if (tabName === 'keys') {
        loadKeys();
        stopPolling();
    } else if (tabName === 'backups') {
        loadBackupProfiles();
        startPolling();
    } else {
        stopPolling();
    }
}

function stopPolling() {
    if (typeof pollingInterval !== 'undefined' && pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

function startPolling() {
    stopPolling();
    updateConcurrencyStatus(); // Run immediately
    pollingInterval = setInterval(updateConcurrencyStatus, 2000);
}

// =====================
// API PROFILE UI MANAGEMENT
// =====================

let editingProfileId = null;
window.currentProfiles = {}; // Global store

async function loadAPIProfiles() {
    const tbody = document.getElementById('profilesTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-400">Loading...</td></tr>';

    try {
        const response = await fetch(`${API_BASE}/admin/profiles/list`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) throw new Error('Failed to load profiles');

        const data = await response.json();
        const profiles = Object.values(data.profiles || {});

        if (profiles.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-400">No profiles found</td></tr>';
            return;
        }

        // Store profiles globally for easier editing access
        window.currentProfiles = data.profiles;

        tbody.innerHTML = profiles.map(profile => `
            <tr class="hover:bg-gray-50 transition">
                <td class="p-4 font-medium text-gray-800">${profile.name}</td>
                <td class="p-4 text-gray-600 font-mono text-xs">${profile.api_url}</td>
                <td class="p-4">
                    <span class="px-2 py-1 rounded text-xs font-semibold ${profile.speed === 'fast' ? 'bg-green-100 text-green-700' :
                profile.speed === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
            }">${profile.speed.toUpperCase()}</span>
                </td>
                <td class="p-4">
                    <span class="px-2 py-1 rounded text-xs font-semibold ${profile.is_active ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
            }">${profile.is_active ? 'Active' : 'Inactive'}</span>
                </td>
                <td class="p-4 text-right space-x-2">
                    <button onclick="editAPIProfile('${profile.id}')" class="text-blue-500 hover:text-blue-700">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteAPIProfile('${profile.id}')" class="text-red-500 hover:text-red-700">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Error loading profiles:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-400">Error loading profiles</td></tr>';
    }
}

window.openProfileModal = function (profileId = null) {
    const modal = document.getElementById('profileModal');
    const title = document.getElementById('profileModalTitle');

    // Reset form
    document.getElementById('profileId').value = '';
    document.getElementById('profileName').value = '';
    document.getElementById('profileUrl').value = '';
    document.getElementById('profileKey').value = '';
    document.getElementById('profileModelActual').value = '';
    document.getElementById('profileSpeed').value = 'medium';
    document.getElementById('profileStatus').value = 'true';
    document.getElementById('profileCapabilities').value = '';
    document.getElementById('profileDescription').value = '';

    if (profileId && window.currentProfiles && window.currentProfiles[profileId]) {
        const p = window.currentProfiles[profileId];
        editingProfileId = profileId;
        title.textContent = 'Edit Profile';

        document.getElementById('profileId').value = p.id;
        document.getElementById('profileName').value = p.name;
        document.getElementById('profileUrl').value = p.api_url;
        document.getElementById('profileKey').value = p.api_key;
        document.getElementById('profileModelActual').value = p.model_actual || '';
        document.getElementById('profileSpeed').value = p.speed;
        document.getElementById('profileStatus').value = p.is_active.toString();
        document.getElementById('profileCapabilities').value = (p.capabilities || []).join(', ');
        document.getElementById('profileDescription').value = p.description || '';
    } else {
        editingProfileId = null;
        title.textContent = 'New Profile';
    }

    modal.classList.remove('hidden');
}

window.closeProfileModal = function () {
    document.getElementById('profileModal').classList.add('hidden');
    editingProfileId = null;
}

// Close modal when clicking outside
document.getElementById('profileModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('profileModal')) {
        closeProfileModal();
    }
});

window.editAPIProfile = function (id) {
    openProfileModal(id);
}

window.saveProfile = async function () {
    const name = document.getElementById('profileName').value.trim();
    const api_url = document.getElementById('profileUrl').value.trim();
    const api_key = document.getElementById('profileKey').value.trim();
    const model_actual = document.getElementById('profileModelActual').value.trim() || null;
    const speed = document.getElementById('profileSpeed').value;
    const is_active = document.getElementById('profileStatus').value === 'true';
    const capabilities = document.getElementById('profileCapabilities').value.split(',').map(s => s.trim()).filter(s => s);
    const description = document.getElementById('profileDescription').value.trim();
    const id = document.getElementById('profileId').value.trim();

    if (!name || !api_url || !api_key) {
        alert('Please fill in Name, URL, and API Key');
        return;
    }

    const payload = {
        name, api_url, api_key, model_actual, speed, is_active, capabilities, description
    };

    const endpoint = id ? `${API_BASE}/admin/profiles/update` : `${API_BASE}/admin/profiles/create`;
    const method = id ? 'PUT' : 'POST';

    if (id) {
        payload.id = id;
    }

    try {
        const response = await fetch(endpoint, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Failed to save profile');

        closeProfileModal();
        loadAPIProfiles();
        alert('Profile saved successfully');
    } catch (error) {
        console.error('Error saving profile:', error);
        alert('Error saving profile');
    }
}

window.deleteAPIProfile = async function (id) {
    if (!confirm('Are you sure you want to delete this profile?')) return;

    try {
        const response = await fetch(`${API_BASE}/admin/profiles/delete?id=${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) throw new Error('Failed to delete profile');

        loadAPIProfiles();
    } catch (error) {
        console.error('Error deleting profile:', error);
        alert('Error deleting profile');
    }
}

// =====================
// ANNOUNCEMENT MANAGEMENT
// =====================

let currentAnnouncement = null;

// Load current announcement
async function loadAnnouncement() {
    try {
        const response = await fetch(`${API_BASE}/admin/announcement`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();

        if (data.announcements && data.announcements.length > 0) {
            currentAnnouncement = data.announcements[0];
            displayAnnouncement(data.announcements[0]);
        } else {
            currentAnnouncement = null;
            displayNoAnnouncement();
        }
    } catch (error) {
        console.error('Load announcement error:', error);
        displayNoAnnouncement();
    }
}

// Display announcement in UI
function displayAnnouncement(announcement) {
    const statusBadge = document.getElementById('announcementStatusBadge');
    const content = document.getElementById('announcementDisplay');
    const actions = document.getElementById('announcementActions');

    if (announcement.is_active) {
        statusBadge.className = 'px-3 py-1 bg-green-100 text-green-600 rounded-full text-xs font-semibold';
        statusBadge.textContent = 'Đang hoạt động';
    } else {
        statusBadge.className = 'px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-semibold';
        statusBadge.textContent = 'Tạm dừng';
    }

    content.innerHTML = `
        <div class="text-left">
            <h4 class="text-lg font-bold text-gray-800 mb-2">${announcement.title}</h4>
            <p class="text-gray-600 whitespace-pre-wrap">${announcement.content}</p>
            ${announcement.start_time ? `<p class="text-xs text-gray-500 mt-3"><i class="fas fa-clock mr-1"></i>Bắt đầu: ${formatDateTime(announcement.start_time)}</p>` : ''}
            ${announcement.end_time ? `<p class="text-xs text-gray-500"><i class="fas fa-clock mr-1"></i>Kết thúc: ${formatDateTime(announcement.end_time)}</p>` : ''}
        </div>
    `;

    actions.classList.remove('hidden');
}

// Display no announcement state
function displayNoAnnouncement() {
    const statusBadge = document.getElementById('announcementStatusBadge');
    const content = document.getElementById('announcementDisplay');
    const actions = document.getElementById('announcementActions');

    statusBadge.className = 'px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-semibold';
    statusBadge.textContent = 'Chưa có thông báo';

    content.innerHTML = `
        <div class="text-gray-500 text-center py-8">
            <i class="fas fa-inbox text-4xl mb-2"></i>
            <p>Chưa có thông báo nào được tạo</p>
        </div>
    `;

    actions.classList.add('hidden');
}

// Format datetime for display
function formatDateTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Open announcement modal
window.openAnnouncementModal = function (isEdit = false) {
    const modal = document.getElementById('announcementModal');
    const title = document.getElementById('announcementModalTitle');
    const errorDiv = document.getElementById('announcementError');
    const successDiv = document.getElementById('announcementSuccess');

    errorDiv.classList.add('hidden');
    successDiv.classList.add('hidden');

    if (isEdit && currentAnnouncement) {
        title.textContent = 'Chỉnh sửa Thông báo';
        document.getElementById('announcementTitle').value = currentAnnouncement.title;
        document.getElementById('announcementContent').value = currentAnnouncement.content;
        document.getElementById('announcementIsActive').checked = currentAnnouncement.is_active;

        // Format datetime for input
        if (currentAnnouncement.start_time) {
            document.getElementById('announcementStartTime').value = formatDateTimeForInput(currentAnnouncement.start_time);
        }
        if (currentAnnouncement.end_time) {
            document.getElementById('announcementEndTime').value = formatDateTimeForInput(currentAnnouncement.end_time);
        }
    } else {
        title.textContent = 'Tạo Thông báo';
        document.getElementById('announcementTitle').value = '';
        document.getElementById('announcementContent').value = '';
        document.getElementById('announcementStartTime').value = '';
        document.getElementById('announcementEndTime').value = '';
        document.getElementById('announcementIsActive').checked = true;
    }

    modal.classList.remove('hidden');
}

// Close announcement modal
window.closeAnnouncementModal = function () {
    document.getElementById('announcementModal').classList.add('hidden');
}

// Format datetime for input field
function formatDateTimeForInput(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Save announcement
window.saveAnnouncement = async function () {
    const title = document.getElementById('announcementTitle').value.trim();
    const content = document.getElementById('announcementContent').value.trim();
    const startTime = document.getElementById('announcementStartTime').value;
    const endTime = document.getElementById('announcementEndTime').value;
    const isActive = document.getElementById('announcementIsActive').checked;
    const errorDiv = document.getElementById('announcementError');
    const successDiv = document.getElementById('announcementSuccess');

    errorDiv.classList.add('hidden');
    successDiv.classList.add('hidden');

    if (!title || !content) {
        errorDiv.textContent = 'Vui lòng nhập đầy đủ tiêu đề và nội dung';
        errorDiv.classList.remove('hidden');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/announcement/save`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title,
                content,
                type: 'info',
                start_time: startTime || null,
                end_time: endTime || null,
                is_active: isActive
            })
        });

        const data = await response.json();

        if (response.ok) {
            successDiv.textContent = 'Đã lưu thông báo thành công!';
            successDiv.classList.remove('hidden');

            setTimeout(() => {
                closeAnnouncementModal();
                loadAnnouncement();
            }, 1500);
        } else {
            errorDiv.textContent = data.error || 'Lỗi lưu thông báo';
            errorDiv.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Save announcement error:', error);
        errorDiv.textContent = 'Lỗi kết nối server';
        errorDiv.classList.remove('hidden');
    }
}

// Delete announcement
window.deleteAnnouncement = async function () {
    if (!confirm('Bạn có chắc chắn muốn xóa thông báo này?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/announcement/delete`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.ok) {
            alert('Đã xóa thông báo thành công');
            loadAnnouncement();
        } else {
            const data = await response.json();
            alert(`Lỗi: ${data.error || 'Không thể xóa thông báo'}`);
        }
    } catch (error) {
        console.error('Delete announcement error:', error);
        alert('Lỗi kết nối server');
    }
}

