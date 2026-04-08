// Parking System Core Logic
const APP_VERSION = '1.0.0';
const DB_NAME = 'SmartParkingDB';
const STORE_NAME = 'parkingData';

// IndexedDB Setup for Offline Storage
let db;

function initDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Create object stores
            if (!db.objectStoreNames.contains('parkingSessions')) {
                const sessionStore = db.createObjectStore('parkingSessions', { keyPath: 'id', autoIncrement: true });
                sessionStore.createIndex('bayId', 'bayId', { unique: false });
                sessionStore.createIndex('status', 'status', { unique: false });
            }

            if (!db.objectStoreNames.contains('violations')) {
                const violationStore = db.createObjectStore('violations', { keyPath: 'id', autoIncrement: true });
                violationStore.createIndex('bayId', 'bayId', { unique: false });
                violationStore.createIndex('status', 'status', { unique: false });
                violationStore.createIndex('timestamp', 'timestamp', { unique: false });
            }

            if (!db.objectStoreNames.contains('offlineQueue')) {
                db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

// Save data to IndexedDB for offline use
async function saveOfflineData(storeName, data) {
    if (!db) await initDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);

        const request = store.add({
            ...data,
            timestamp: new Date().toISOString(),
            synced: false
        });

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Load offline data
async function loadOfflineData(storeName) {
    if (!db) await initDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Parking Bay Configuration
const bays = [
    { id: 1, number: 'A01', type: '30min', maxMinutes: 30, sensorId: 'XPERANTI_001', location: 'Level 1' },
    { id: 2, number: 'A02', type: '30min', maxMinutes: 30, sensorId: 'XPERANTI_002', location: 'Level 1' },
    { id: 3, number: 'A03', type: '2hour', maxMinutes: 120, sensorId: 'XPERANTI_003', location: 'Level 1' },
    { id: 4, number: 'A04', type: '2hour', maxMinutes: 120, sensorId: 'XPERANTI_004', location: 'Level 1' },
    { id: 5, number: 'B01', type: '30min', maxMinutes: 30, sensorId: 'XPERANTI_005', location: 'Level 2' },
    { id: 6, number: 'B02', type: '30min', maxMinutes: 30, sensorId: 'XPERANTI_006', location: 'Level 2' },
    { id: 7, number: 'B03', type: '2hour', maxMinutes: 120, sensorId: 'XPERANTI_007', location: 'Level 2' },
    { id: 8, number: 'B04', type: '2hour', maxMinutes: 120, sensorId: 'XPERANTI_008', location: 'Level 2' }
];

// State Management
let activeSessions = {};
let violations = [];
let enforcerAlerts = [];

// Initialize Application
async function initializeApp() {
    console.log('Initializing Smart Parking PWA v' + APP_VERSION);

    // Initialize IndexedDB
    await initDatabase();

    // Load cached data
    await loadCachedState();

    // Render UI
    renderBays();
    updateStats();
    updateActiveSessionsTable();
    updateEnforcerPanel();

    // Start timers
    startTimers();
    startEnforcerCheck();

    // Setup push notifications
    setupPushNotifications();

    // Setup background sync
    setupBackgroundSync();

    showNotification('Smart Parking System Ready', 'success');
}

// Load cached state from IndexedDB
async function loadCachedState() {
    try {
        const cachedSessions = await loadOfflineData('parkingSessions');
        const cachedViolations = await loadOfflineData('violations');

        if (cachedSessions.length > 0) {
            // Reconstruct active sessions from cached data
            cachedSessions.forEach(session => {
                if (session.status === 'active') {
                    activeSessions[session.bayId] = session;
                }
            });
        }

        if (cachedViolations.length > 0) {
            violations = cachedViolations.filter(v => !v.compounded);
        }

        console.log('Loaded cached data:', { sessions: cachedSessions.length, violations: cachedViolations.length });
    } catch (error) {
        console.error('Failed to load cached data:', error);
    }
}

// Setup Push Notifications
async function setupPushNotifications() {
    if (!('Notification' in window)) {
        console.log('Push notifications not supported');
        return;
    }

    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
        console.log('Push notifications enabled');

        // Subscribe to push notifications
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            const registration = await navigator.serviceWorker.ready;

            try {
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array('YOUR_PUBLIC_VAPID_KEY')
                });

                console.log('Push subscription:', subscription);

                // Send subscription to server (simulated)
                await saveOfflineData('pushSubscription', subscription);
            } catch (error) {
                console.error('Failed to subscribe to push:', error);
            }
        }
    }
}

// Setup Background Sync
async function setupBackgroundSync() {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const registration = await navigator.serviceWorker.ready;

        try {
            await registration.sync.register('sync-parking-data');
            console.log('Background sync registered');
        } catch (error) {
            console.error('Background sync failed:', error);
        }
    }

    // Setup periodic sync if supported
    if ('serviceWorker' in navigator && 'periodicSync' in registration) {
        try {
            await registration.periodicSync.register('check-parking-status', {
                minInterval: 5 * 60 * 1000 // 5 minutes
            });
            console.log('Periodic sync registered');
        } catch (error) {
            console.error('Periodic sync failed:', error);
        }
    }
}

// Utility function for VAPID key conversion
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Render all parking bays
function renderBays() {
    const grid = $('#baysGrid');
    grid.empty();

    bays.forEach(bay => {
        const session = activeSessions[bay.id];
        let status = 'available';
        let statusClass = 'bay-available';
        let statusText = 'Available';

        if (session) {
            const elapsed = Math.floor((Date.now() - session.startTime) / 60000);
            if (elapsed > bay.maxMinutes) {
                status = 'violation';
                statusClass = 'bay-violation';
                statusText = '⚠ VIOLATION';
            } else {
                status = 'occupied';
                statusClass = 'bay-occupied';
                statusText = 'Occupied';
            }
        }

        const card = `
            <div class="col-6 col-md-3">
                <div class="card bay-card ${statusClass}" onclick="toggleBay(${bay.id})">
                    <div class="card-body text-center p-2">
                        <h6 class="mb-1">Bay ${bay.number}</h6>
                        <span class="badge bg-light text-dark mb-1 small">${bay.type}</span>
                        <p class="mb-1 small fw-bold">${statusText}</p>
                        ${session ? `
                            <div class="progress mb-1">
                                <div class="progress-bar bg-white" 
                                     style="width: ${getProgress(bay.id)}%"></div>
                            </div>
                            <small class="timer-display" id="timer-${bay.id}">
                                ${formatTime(bay.id)}
                            </small>
                        ` : '<small class="text-white-50">Tap to park</small>'}
                    </div>
                </div>
            </div>
        `;
        grid.append(card);
    });
}

// Toggle bay occupancy
async function toggleBay(bayId) {
    if (activeSessions[bayId]) {
        await endParkingSession(bayId);
    } else {
        await startParkingSession(bayId);
    }
}

// Start a parking session
async function startParkingSession(bayId) {
    const bay = bays.find(b => b.id === bayId);

    const session = {
        bayId: bayId,
        bayNumber: bay.number,
        bayType: bay.type,
        maxMinutes: bay.maxMinutes,
        startTime: Date.now(),
        sensorId: bay.sensorId,
        enforcerNotified: false,
        status: 'active'
    };

    activeSessions[bayId] = session;

    // Save to IndexedDB for offline support
    await saveOfflineData('parkingSessions', session);

    showNotification(`Vehicle parked at Bay ${bay.number} (${bay.type})`, 'info');

    // Vibrate if supported
    if ('vibrate' in navigator) {
        navigator.vibrate(50);
    }

    updateAll();
}

// End a parking session
async function endParkingSession(bayId) {
    const session = activeSessions[bayId];
    if (!session) return;

    const bay = bays.find(b => b.id === bayId);
    const duration = Math.floor((Date.now() - session.startTime) / 60000);

    if (duration > bay.maxMinutes) {
        showNotification(`Vehicle left Bay ${bay.number} after ${duration} min (OVERSTAY)`, 'warning');
    } else {
        showNotification(`Vehicle left Bay ${bay.number} after ${duration} min`, 'success');
    }

    // Update session status in IndexedDB
    session.status = 'completed';
    session.endTime = Date.now();
    session.duration = duration;
    await saveOfflineData('parkingSessions', session);

    delete activeSessions[bayId];

    // Vibrate if supported
    if ('vibrate' in navigator) {
        navigator.vibrate([50, 50, 50]);
    }

    updateAll();
}

// Get progress percentage
function getProgress(bayId) {
    const session = activeSessions[bayId];
    if (!session) return 0;

    const bay = bays.find(b => b.id === bayId);
    const elapsed = Math.floor((Date.now() - session.startTime) / 60000);
    return Math.min(100, (elapsed / bay.maxMinutes) * 100);
}

// Format time display
function formatTime(bayId) {
    const session = activeSessions[bayId];
    if (!session) return '0:00';

    const bay = bays.find(b => b.id === bayId);
    const elapsed = Math.floor((Date.now() - session.startTime) / 60000);
    const remaining = Math.max(0, bay.maxMinutes - elapsed);

    if (elapsed > bay.maxMinutes) {
        const overstay = elapsed - bay.maxMinutes;
        return `+${overstay}m`;
    }

    return `${elapsed}/${bay.maxMinutes}m`;
}

// Trigger enforcer alert
async function triggerEnforcerAlert(bayId) {
    const session = activeSessions[bayId];
    const bay = bays.find(b => b.id === bayId);
    const elapsed = Math.floor((Date.now() - session.startTime) / 60000);
    const overstay = elapsed - bay.maxMinutes;

    // Play alert sound
    try {
        document.getElementById('alertSound').play();
    } catch (e) {
        console.log('Audio play failed:', e);
    }

    // Vibrate pattern for alert
    if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 200]);
    }

    // Add to violations
    const violation = {
        id: Date.now(),
        bayId: bayId,
        bayNumber: bay.number,
        overstayMinutes: overstay,
        time: new Date(),
        status: 'pending',
        compounded: false,
        timestamp: new Date().toISOString()
    };

    violations.push(violation);
    enforcerAlerts.push(violation);

    // Save to IndexedDB
    await saveOfflineData('violations', violation);

    // Show push notification if supported and permitted
    if ('Notification' in window && Notification.permission === 'granted') {
        const registration = await navigator.serviceWorker.ready;
        registration.showNotification('🚨 Parking Violation Alert!', {
            body: `Bay ${bay.number} has exceeded time limit by ${overstay} minutes`,
            icon: '/icons/icon-192x192.png',
            badge: '/icons/badge-72x72.png',
            vibrate: [200, 100, 200],
            tag: `violation-${bayId}`,
            renotify: true,
            data: {
                url: '/',
                bayId: bayId
            },
            actions: [
                {
                    action: 'view',
                    title: 'View Details'
                },
                {
                    action: 'compound',
                    title: 'Issue Compound'
                }
            ]
        });
    }

    showNotification(`🚨 VIOLATION: Bay ${bay.number} overstay ${overstay} minutes!`, 'danger');

    updateEnforcerPanel();
    updateStats();
}

// Update enforcer panel
function updateEnforcerPanel() {
    const panel = $('#enforcerPanel');
    const pendingViolations = violations.filter(v => !v.compounded);

    if (pendingViolations.length === 0) {
        panel.html('<p class="text-muted text-center small">No active violations</p>');
        $('#alertBadge').text('0');
        return;
    }

    $('#alertBadge').text(pendingViolations.length);

    let html = '';
    pendingViolations.forEach(v => {
        const fee = calculateCompoundFee(v.overstayMinutes);
        html += `
            <div class="enforcer-alert">
                <div class="d-flex justify-content-between">
                    <h6 class="mb-1">Bay ${v.bayNumber}</h6>
                    <span class="badge bg-light text-dark">+${v.overstayMinutes}m</span>
                </div>
                <p class="mb-2 small">Fee: RM${fee}</p>
                <button class="btn btn-sm btn-light w-100" onclick="compoundViolation(${v.id})">
                    Compound
                </button>
            </div>
        `;
    });

    panel.html(html);
}

// Calculate compound fee
function calculateCompoundFee(overstayMinutes) {
    const hours = Math.ceil(overstayMinutes / 60);
    return 30 + (Math.max(0, hours - 1) * 10);
}

// Compound a violation
async function compoundViolation(violationId) {
    const violation = violations.find(v => v.id === violationId);
    if (violation) {
        violation.compounded = true;
        violation.status = 'compounded';
        violation.compoundedAt = new Date().toISOString();

        // Update in IndexedDB
        await saveOfflineData('violations', violation);

        const fee = calculateCompoundFee(violation.overstayMinutes);
        showNotification(`✅ Bay ${violation.bayNumber} compounded! Fee: RM${fee}`, 'success');

        // Vibrate
        if ('vibrate' in navigator) {
            navigator.vibrate(100);
        }

        updateEnforcerPanel();
        updateStats();
    }
}

// Compound all violations
async function compoundAllViolations() {
    const pendingViolations = violations.filter(v => !v.compounded);

    for (let violation of pendingViolations) {
        violation.compounded = true;
        violation.status = 'compounded';
        violation.compoundedAt = new Date().toISOString();
        await saveOfflineData('violations', violation);
    }

    if (pendingViolations.length > 0) {
        showNotification(`✅ Compounded ${pendingViolations.length} violation(s)`, 'success');
    }

    updateEnforcerPanel();
    updateStats();
}

// Update statistics
function updateStats() {
    const total = bays.length;
    const occupied = Object.keys(activeSessions).length;
    const available = total - occupied;
    const violationCount = violations.filter(v => !v.compounded).length;

    $('#totalBays').text(total);
    $('#availableBays').text(available);
    $('#occupiedBays').text(occupied);
    $('#violationCount').text(violationCount);
}

// Update active sessions table
function updateActiveSessionsTable() {
    const tbody = $('#activeSessionsTable');
    const sessions = Object.values(activeSessions);

    if (sessions.length === 0) {
        tbody.html('<tr><td colspan="5" class="text-center text-muted">No active sessions</td></tr>');
        return;
    }

    let html = '';
    sessions.forEach(session => {
        const bay = bays.find(b => b.id === session.bayId);
        const elapsed = Math.floor((Date.now() - session.startTime) / 60000);
        const remaining = Math.max(0, bay.maxMinutes - elapsed);
        const isViolation = elapsed > bay.maxMinutes;

        html += `
            <tr class="${isViolation ? 'table-danger' : ''}">
                <td><strong>${session.bayNumber}</strong></td>
                <td><small>${session.bayType}</small></td>
                <td><small>${elapsed}m</small></td>
                <td>
                    <span class="badge ${isViolation ? 'bg-danger' : 'bg-success'}">
                        ${isViolation ? 'VIOLATION' : 'ACTIVE'}
                    </span>
                </td>
                <td>
                    <button class="btn btn-sm btn-outline-danger" onclick="endParkingSession(${session.bayId})">
                        End
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.html(html);
}

// Show notification toast
function showNotification(message, type = 'info') {
    const bgClass = {
        'info': 'bg-primary',
        'success': 'bg-success',
        'warning': 'bg-warning',
        'danger': 'bg-danger'
    }[type] || 'bg-info';

    const toast = `
        <div class="toast show align-items-center text-white ${bgClass} border-0 mb-2" role="alert">
            <div class="d-flex">
                <div class="toast-body small">
                    <i class="bi bi-info-circle me-2"></i>${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `;

    $('#notificationContainer').append(toast);

    setTimeout(() => {
        $('#notificationContainer .toast').first().fadeOut(300, function () {
            $(this).remove();
        });
    }, 4000);
}

// Simulate random car arrival
function simulateRandomCar() {
    const availableBays = bays.filter(b => !activeSessions[b.id]);

    if (availableBays.length === 0) {
        showNotification('No available bays!', 'warning');
        return;
    }

    const randomBay = availableBays[Math.floor(Math.random() * availableBays.length)];
    startParkingSession(randomBay.id);
}

// Reset all bays
async function resetAllBays() {
    if (!confirm('Reset all parking bays?')) return;

    activeSessions = {};
    violations = [];
    enforcerAlerts = [];

    // Clear IndexedDB
    if (db) {
        const transaction = db.transaction(['parkingSessions', 'violations'], 'readwrite');
        await transaction.objectStore('parkingSessions').clear();
        await transaction.objectStore('violations').clear();
    }

    updateAll();
    showNotification('System reset complete', 'info');
}

// Refresh data
function refreshData() {
    updateAll();
}

// Update everything
function updateAll() {
    renderBays();
    updateStats();
    updateActiveSessionsTable();
    updateEnforcerPanel();
}

// Start timers for real-time updates
function startTimers() {
    setInterval(() => {
        Object.keys(activeSessions).forEach(bayId => {
            $(`#timer-${bayId}`).text(formatTime(bayId));

            const progress = getProgress(bayId);
            $(`#timer-${bayId}`).closest('.bay-card').find('.progress-bar').css('width', progress + '%');
        });

        updateActiveSessionsTable();
        updateStats();
    }, 1000);
}

// Start enforcer check
function startEnforcerCheck() {
    setInterval(() => {
        Object.keys(activeSessions).forEach(bayId => {
            const bay = bays.find(b => b.id === parseInt(bayId));
            const session = activeSessions[bayId];
            const elapsed = Math.floor((Date.now() - session.startTime) / 60000);

            if (elapsed > bay.maxMinutes && !session.enforcerNotified) {
                triggerEnforcerAlert(bayId);
                session.enforcerNotified = true;
            }
        });
    }, 5000);
}

// Handle online/offline status
window.addEventListener('online', () => {
    showNotification('Back online', 'success');
    syncOfflineData();
});

window.addEventListener('offline', () => {
    showNotification('Offline mode - Data will sync when online', 'warning');
});

// Sync offline data when back online
async function syncOfflineData() {
    try {
        const offlineQueue = await loadOfflineData('offlineQueue');

        for (let item of offlineQueue) {
            // Process queued actions
            console.log('Processing queued item:', item);
        }

        showNotification('Data synchronized', 'success');
    } catch (error) {
        console.error('Sync failed:', error);
    }
}

// Handle visibility change (app in background)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('App in background - reducing updates');
        // Could reduce timer frequency here
    } else {
        console.log('App in foreground - resuming updates');
        refreshData();
    }
});

// Handle before unload
window.addEventListener('beforeunload', (e) => {
    if (Object.keys(activeSessions).length > 0) {
        e.preventDefault();
        e.returnValue = 'There are active parking sessions. Are you sure you want to leave?';
    }
});

// Make functions globally available
window.toggleBay = toggleBay;
window.endParkingSession = endParkingSession;
window.simulateRandomCar = simulateRandomCar;
window.resetAllBays = resetAllBays;
window.compoundViolation = compoundViolation;
window.compoundAllViolations = compoundAllViolations;
window.refreshData = refreshData;

// Initialize app when ready
$(document).ready(() => {
    initializeApp();

    // Check for updates
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(registration => {
            registration.update();
        });
    }
});