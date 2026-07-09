// ============================================================
// IMPORTS
// ============================================================
import { initializeApp } from "firebase/app";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential,
    GoogleAuthProvider,
    signInWithPopup,
    sendPasswordResetEmail
} from "firebase/auth";
import {
    getFirestore,
    doc,
    onSnapshot,
    updateDoc,
    setDoc,
    arrayUnion,
    arrayRemove,
    deleteField,
    getDoc,
    runTransaction
} from "firebase/firestore";

// ============================================================
// CONFIG
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyC75_Oqo4wc7Jx58wfkkoQML9YxgP24QR4",
    authDomain: "bronzx.firebaseapp.com",
    projectId: "bronzx",
    storageBucket: "bronzx.firebasestorage.app",
    messagingSenderId: "155159545642",
    appId: "1:155159545642:web:1d615183d1cdee3bdac053"
};

// Cloudflare Worker URL — replace with your deployed worker URL
const WORKER_URL = "telegram-info.samratsubedi163.workers.dev";

// ============================================================
// APP INIT
// ============================================================
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// ============================================================
// STATE
// ============================================================
let currentUID = null;
let currentUserEmail = null;
let realtimeListener = null;
let purchaseData = null;
let currentBalance = 0;
let selectedPaymentMethod = 'esewa';
const PAYMENT_STORAGE_KEY = 'srtx_payment_state';

// ============================================================
// HELPERS
// ============================================================
function getDate() {
    return new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Kathmandu',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function showToast(message, type = "info") {
    const existing = document.getElementById('srt-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'srt-toast';
    const color = type === 'success' ? '#2dd4a8' : type === 'error' ? '#f15b6c' : '#a5b4fc';
    toast.style.cssText = `
        position:fixed;bottom:32px;left:50%;
        transform:translateX(-50%) translateY(20px);
        background:#181c25;color:${color};
        border:1px solid ${color}33;border-radius:10px;
        padding:13px 22px;font-family:'Inter',sans-serif;
        font-size:13.5px;font-weight:500;letter-spacing:0.2px;
        z-index:99999;box-shadow:0 12px 28px rgba(0,0,0,0.4);
        max-width:320px;text-align:center;opacity:0;
        transition:all 0.25s cubic-bezier(0.4,0,0.2,1);pointer-events:none;
    `;
    toast.innerText = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ============================================================
// VIEW MODE
// ============================================================
function detectDevice() {
    return window.innerWidth >= 1024 ? 'desktop' : 'mobile';
}

window.setViewMode = function(mode) {
    document.body.classList.toggle('desktop-mode', mode === 'desktop');
    document.getElementById('vtDesktop').classList.toggle('active', mode === 'desktop');
    document.getElementById('vtMobile').classList.toggle('active', mode === 'mobile');
    localStorage.setItem('srtx_view_mode', mode);
    if (mode === 'mobile') {
        document.getElementById('sideDrawer').classList.remove('active');
        document.getElementById('menuBtn').classList.remove('active');
        document.getElementById('menuOverlay').style.display = 'none';
    }
};

(function() {
    const saved = localStorage.getItem('srtx_view_mode');
    const mode = saved || detectDevice();
    window.setViewMode(mode);
})();

window.addEventListener('resize', () => {
    const saved = localStorage.getItem('srtx_view_mode');
    if (!saved) window.setViewMode(detectDevice());
});

// ============================================================
// SEARCH & FILTER
// ============================================================
let activeFilter = 'all';
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const noResults = document.getElementById('noResults');
const noResultsMsg = document.getElementById('noResultsMsg');
const productCount = document.getElementById('productCount');

function applyFilters() {
    const query = searchInput.value.trim().toLowerCase();
    let visible = 0;
    document.querySelectorAll('.product-row').forEach(row => {
        const name = (row.dataset.name || '').toLowerCase();
        const tags = (row.dataset.tags || '').toLowerCase();
        const matchesSearch = !query || name.includes(query);
        const tagList = tags.split(/[\s,]+/);
        const matchesFilter = activeFilter === 'all' || tagList.includes(activeFilter);
        if (matchesSearch && matchesFilter) { row.style.display = ''; visible++; } else row.style.display = 'none';
    });
    productCount.textContent = visible + ' PRODUCT' + (visible !== 1 ? 'S' : '');
    if (visible === 0) {
        noResults.classList.add('show');
        noResultsMsg.textContent = query ? `No results for "${query}"` : `No ${activeFilter.toUpperCase()} products`;
    } else { noResults.classList.remove('show'); }
}

searchInput.addEventListener('input', () => {
    searchClear.classList.toggle('hidden', !searchInput.value);
    applyFilters();
});

window.clearSearch = () => {
    searchInput.value = '';
    searchClear.classList.add('hidden');
    applyFilters();
    searchInput.focus();
};

window.filterChip = (el, tag) => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active-chip'));
    el.classList.add('active-chip');
    activeFilter = tag;
    applyFilters();
    if (navigator.vibrate) navigator.vibrate(8);
};

document.addEventListener('DOMContentLoaded', () => {
    const total = document.querySelectorAll('.product-row').length;
    document.getElementById('productCount').textContent = total + ' PRODUCTS';
    applyFilters();
});

// ============================================================
// GOOGLE SIGN-IN
// ============================================================
window.handleGoogleSignIn = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
            await setDoc(userRef, {
                email: user.email || "",
                name: user.displayName || "",
                profileName: user.displayName || "",
                profilePhone: "",
                history: [],
                adminMessage: "Welcome! Pay via eSewa or Balance to get your key 🔑",
                requestStatus: "Active",
                balance: 0,
                balanceHistory: []
            }, { merge: true });
        } else if (!snap.data().email && user.email) {
            await updateDoc(userRef, { email: user.email });
        }
        showToast("Signed in with Google!", "success");
    } catch (err) {
        if (err.code !== 'auth/popup-closed-by-user') {
            showToast("Google Sign-In failed: " + err.message, "error");
        }
    }
};

// ============================================================
// FORGOT PASSWORD
// ============================================================
window.handleForgotPassword = async () => {
    const email = document.getElementById('loginEmail').value.trim() ||
        document.getElementById('regEmail').value.trim();
    if (!email) {
        return showToast("Enter your email above first, then tap Forgot Password", "error");
    }
    try {
        await sendPasswordResetEmail(auth, email);
        showToast("Password reset email sent! Check your inbox.", "success");
    } catch (err) {
        if (err.code === 'auth/user-not-found') {
            showToast("No account found with that email.", "error");
        } else {
            showToast("Failed: " + err.message, "error");
        }
    }
};

// ============================================================
// AUTH STATE
// ============================================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUID = user.uid;
        currentUserEmail = user.email;
        document.getElementById('displayEmail').innerText = user.email || "User";
        document.getElementById('authSection').classList.add('hidden');
        document.getElementById('storeUI').classList.remove('hidden');
        startSync(user.uid);
        startTime();
        history.replaceState(null, '', '#store');
        // Restore unfinished payment if any
        const state = loadPaymentState();
        if (state && state.purchaseData && state.step >= 2) {
            setTimeout(() => {
                const banner = document.createElement('div');
                banner.id = 'restoreBanner';
                banner.style.cssText = `
                    position:fixed;bottom:0;left:0;right:0;
                    background:#181c25;border-top:1px solid rgba(240,162,58,0.4);
                    padding:14px 18px;z-index:9998;
                    display:flex;align-items:center;justify-content:space-between;gap:10px;
                    font-family:'Inter',sans-serif;
                `;
                banner.innerHTML = `
                    <div style="color:#f0a23a;font-size:13px;font-weight:500;">
                        <i class="fas fa-exclamation-triangle"></i>
                        Unfinished payment: <b>${state.purchaseData.name}</b> — Step ${state.step}/3
                    </div>
                    <div style="display:flex;gap:8px;flex-shrink:0;">
                        <button onclick="document.getElementById('restoreBanner').remove();clearPaymentState();"
                            style="padding:7px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:rgba(255,255,255,0.5);font-family:'Inter',sans-serif;font-size:12px;font-weight:600;cursor:pointer;">
                            DISCARD
                        </button>
                        <button onclick="document.getElementById('restoreBanner').remove();restorePaymentState(loadPaymentState(),loadPaymentState().step);"
                            style="padding:7px 14px;border-radius:8px;border:none;background:#f0a23a;color:#000;font-family:'Inter',sans-serif;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:0.2px;">
                            RESUME PAYMENT
                        </button>
                    </div>
                `;
                document.body.appendChild(banner);
            }, 800);
        }
    } else {
        if (realtimeListener) realtimeListener();
        currentUID = null;
        currentUserEmail = null;
        purchaseData = null;
        currentBalance = 0;
        document.getElementById('authSection').classList.remove('hidden');
        document.getElementById('storeUI').classList.add('hidden');
        history.replaceState(null, '', '#login');
    }
});

// ============================================================
// AUTH ACTIONS
// ============================================================
document.getElementById('loginBtn').onclick = async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const pass = document.getElementById('loginPass').value;
    if (!email || !pass) return showToast("Please enter email and password", "error");
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
        showToast("Login Failed: " + err.message, "error");
    }
};

document.getElementById('signupBtn').onclick = async () => {
    const email = document.getElementById('regEmail').value.trim();
    const pass = document.getElementById('regPass').value;
    if (!email || !pass) return showToast("Please fill all fields", "error");
    if (pass.length < 6) return showToast("Password must be at least 6 characters", "error");
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await setDoc(doc(db, "users", cred.user.uid), {
            email: email,
            name: "",
            profileName: "",
            profilePhone: "",
            history: [],
            adminMessage: "Welcome! Pay via eSewa or Balance to get your key 🔑",
            requestStatus: "Active",
            balance: 0,
            balanceHistory: []
        }, { merge: true });
        showToast("Account created successfully!", "success");
    } catch (err) {
        showToast("Signup Failed: " + err.message, "error");
    }
};

window.handleLogout = () => {
    clearPaymentState();
    signOut(auth);
    document.getElementById('authSection').classList.remove('hidden');
    document.getElementById('storeUI').classList.add('hidden');
    history.replaceState(null, '', '#login');
};

// ============================================================
// SIDE MENU
// ============================================================
const menuBtn = document.getElementById('menuBtn');
const sideDrawer = document.getElementById('sideDrawer');
const menuOverlay = document.getElementById('menuOverlay');

const toggleMenu = () => {
    if (document.body.classList.contains('desktop-mode')) return;
    const isOpen = sideDrawer.classList.toggle('active');
    menuBtn.classList.toggle('active');
    menuOverlay.style.display = isOpen ? 'block' : 'none';
};
menuBtn.onclick = toggleMenu;
menuOverlay.onclick = toggleMenu;

function closeMenu() {
    sideDrawer.classList.remove('active');
    menuBtn.classList.remove('active');
    menuOverlay.style.display = 'none';
}

// ============================================================
// PROFILE
// ============================================================
window.saveProfile = async () => {
    const name = document.getElementById('profileName').value.trim();
    const phone = document.getElementById('profilePhone').value.trim();
    if (!name || !phone) return showToast("Please fill both fields", "error");
    if (!currentUID) return showToast("Not logged in", "error");
    try {
        await updateDoc(doc(db, "users", currentUID), {
            profileName: name,
            profilePhone: phone,
            name: name,
            whatsapp: phone,
            email: currentUserEmail || ""
        });
        showToast("Profile saved!", "success");
        closeModals();
    } catch (e) {
        showToast("Failed: " + e.message, "error");
    }
};

function loadProfileToModal(data) {
    if (data.profileName) document.getElementById('profileName').value = data.profileName;
    if (data.profilePhone) document.getElementById('profilePhone').value = data.profilePhone;
    const uidEl = document.getElementById('profileUid');
    if (uidEl) uidEl.value = currentUID || '';
    const emailEl = document.getElementById('profileEmail');
    if (emailEl) emailEl.value = data.email || currentUserEmail || '';
}

// ============================================================
// GENERIC COPY
// ============================================================
window.copyText = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text)
        .then(() => showToast("Copied!", "success"))
        .catch(() => {
            const el = document.createElement('textarea');
            el.value = text;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            showToast("Copied!", "success");
        });
};

// ============================================================
// REAL-TIME SYNC
// ============================================================
function startSync(uid) {
    const userRef = doc(db, "users", uid);
    realtimeListener = onSnapshot(userRef, (snap) => {
        if (!snap.exists()) {
            setDoc(userRef, {
                email: currentUserEmail || "",
                history: [],
                adminMessage: "Welcome! Pay via eSewa or Balance to get your key 🔑",
                requestStatus: "Active",
                balance: 0,
                balanceHistory: []
            }, { merge: true });
            return;
        }
        const data = snap.data();

        if (!data.email && currentUserEmail) {
            updateDoc(userRef, { email: currentUserEmail }).catch(() => {});
        }

        const statusEl = document.getElementById('userStatus');
        const statusDot = document.querySelector('.status-dot');
        statusEl.innerText = data.requestStatus || "Active";
        const status = (data.requestStatus || "Active").toLowerCase();
        if (status.includes("approved") || status === "active") statusDot.style.background = "#2dd4a8";
        else if (status.includes("pending")) statusDot.style.background = "#f0a23a";
        else if (status.includes("reject") || status.includes("ban")) statusDot.style.background = "#f15b6c";
        else statusDot.style.background = "#2dd4a8";

        document.getElementById('adminMsg').innerText = data.adminMessage || "No messages.";
        renderHistory(data.history || []);
        loadProfileToModal(data);

        currentBalance = data.balance || 0;
        document.getElementById('drawerBalance').innerText = currentBalance;
        updateBalanceUI();

        checkForNewKey(data.history || []);
    });
}

let lastKeyCount = 0;

function checkForNewKey(history) {
    const keysDelivered = history.filter(h => h.key && h.status === 'SUCCESS');
    if (keysDelivered.length > lastKeyCount && lastKeyCount !== 0) {
        const newest = keysDelivered[keysDelivered.length - 1];
        showKeyDelivered(newest.key, newest.item || 'Your product');
    }
    lastKeyCount = keysDelivered.length;
}

function updateBalanceUI() {
    const bal = currentBalance || 0;
    const price = purchaseData ? purchaseData.price : 0;
    const insufMsg = document.getElementById('insufficientBalanceMsg');
    if (selectedPaymentMethod === 'balance' && price > 0 && bal < price) {
        insufMsg.classList.add('show');
    } else {
        insufMsg.classList.remove('show');
    }
    const payBtn = document.getElementById('checkoutPayBalanceBtn');
    if (payBtn) {
        if (selectedPaymentMethod === 'balance' && bal >= price) {
            payBtn.classList.remove('hidden');
            payBtn.disabled = false;
            payBtn.style.opacity = '1';
            payBtn.style.pointerEvents = 'auto';
        } else if (selectedPaymentMethod === 'balance') {
            payBtn.classList.remove('hidden');
            payBtn.disabled = true;
            payBtn.style.opacity = '0.4';
            payBtn.style.pointerEvents = 'none';
        } else {
            payBtn.classList.add('hidden');
        }
    }
}

// ============================================================
// HISTORY
// ============================================================
function renderHistory(history) {
    const container = document.getElementById('historyList');
    if (!history || history.length === 0) {
        container.innerHTML = `<p class="empty-msg">No orders yet.</p>`;
        return;
    }
    container.innerHTML = history.slice().reverse().map(item => `
        <div class="history-item">
            <small>${item.date || ''}</small>
            <p>${item.msg || item}</p>
            ${item.status === 'PENDING_APPROVAL' ? `
            <div class="pending-badge"><i class="fas fa-clock"></i> Waiting for admin approval</div>` : ''}
            ${item.status === 'SUCCESS' && item.key ? `
            <div class="key-display">
                <i class="fas fa-key"></i>
                <span class="key-text">${item.key}</span>
                <button class="key-copy-inline" onclick="copyKey('${item.key}')">
                    <i class="fas fa-copy"></i>
                </button>
            </div>` : ''}
            ${item.paymentMethod === 'balance' ? `
            <div style="font-size:10px;color:var(--gold);margin-top:4px;">
                <i class="fas fa-coins"></i> Paid with Balance
            </div>` : ''}
        </div>
    `).join('');
}

window.confirmDeleteHistory = () => document.getElementById('deleteWarning').classList.remove('hidden');
window.hideDeleteWarning = () => document.getElementById('deleteWarning').classList.add('hidden');

window.processHistoryDelete = async () => {
    if (!currentUID) return;
    try {
        await updateDoc(doc(db, "users", currentUID), { history: deleteField() });
        hideDeleteWarning();
        closeModals();
        showToast("History cleared!", "success");
    } catch (e) {
        showToast("Failed to clear history", "error");
    }
};

// ============================================================
// PASSWORD UPDATE
// ============================================================
window.processPassUpdate = async () => {
    const oldP = document.getElementById('oldPass').value.trim();
    const newP = document.getElementById('newPass').value.trim();
    const user = auth.currentUser;
    if (!oldP || !newP) return showToast("Please fill both fields", "error");
    if (newP.length < 6) return showToast("Min 6 characters", "error");
    try {
        const credential = EmailAuthProvider.credential(user.email, oldP);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newP);
        showToast("Password updated!", "success");
        closeModals();
        document.getElementById('oldPass').value = '';
        document.getElementById('newPass').value = '';
    } catch (error) {
        showToast(error.code === 'auth/wrong-password' ? "Wrong current password!" : "Failed: " + error.message,
        "error");
    }
};

// ============================================================
// PRODUCT SELECTION
// ============================================================
window.togglePrices = (id) => {
    const section = document.getElementById(id);
    if (!section) return;
    section.classList.toggle('hidden');
    if (navigator.vibrate) navigator.vibrate(10);
};

window.selectItem = (el, name, price, duration) => {
    document.querySelectorAll('.price-item').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    const row = el.closest('.product-row');
    const pid = row.dataset.pid || null;
    const isExternal = row.dataset.external === 'true';
    purchaseData = {
        name,
        price,
        selectedAt: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }),
        pid: pid,
        duration: duration || name,
        isExternal: isExternal
    };
    const buyBtn = el.closest('.price-list').querySelector('.buy-btn');
    if (buyBtn) buyBtn.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate(15);
    updateBalanceUI();
};

// ============================================================
// PAYMENT METHOD TOGGLE
// ============================================================
window.setPaymentMethod = (method) => {
    selectedPaymentMethod = method;
    document.querySelectorAll('.pm-option').forEach(el => {
        el.classList.toggle('active', el.dataset.pm === method);
    });
    const nextBtn = document.getElementById('checkoutNextBtn');
    const payBalanceBtn = document.getElementById('checkoutPayBalanceBtn');
    if (method === 'esewa') {
        nextBtn.classList.remove('hidden');
        payBalanceBtn.classList.add('hidden');
        document.getElementById('insufficientBalanceMsg').classList.remove('show');
    } else {
        nextBtn.classList.add('hidden');
        payBalanceBtn.classList.remove('hidden');
        updateBalanceUI();
    }
};

// ============================================================
// CHECKOUT
// ============================================================
window.startCheckout = () => {
    if (!purchaseData) return showToast("Please select a product first!", "error");
    openModal('checkoutModal');

    document.getElementById('orderSummaryBox').innerHTML = `
        <span class="item-name">${purchaseData.name}</span>
        <span class="item-price">Rs ${purchaseData.price}</span>
    `;

    selectedPaymentMethod = 'esewa';
    document.querySelectorAll('.pm-option').forEach(el => {
        el.classList.toggle('active', el.dataset.pm === 'esewa');
    });
    document.getElementById('checkoutNextBtn').classList.remove('hidden');
    document.getElementById('checkoutPayBalanceBtn').classList.add('hidden');
    document.getElementById('insufficientBalanceMsg').classList.remove('show');

    if (currentUID) {
        getDoc(doc(db, "users", currentUID)).then(snap => {
            if (!snap.exists()) return;
            const data = snap.data();
            if (data.profileName) document.getElementById('payName').value = data.profileName;
            if (data.profilePhone) document.getElementById('payWA').value = data.profilePhone;
            const note = document.getElementById('autofillNote');
            if (data.profileName || data.profilePhone) {
                note.innerHTML = '<i class="fas fa-check-circle"></i> Auto-filled from profile';
            } else {
                note.innerHTML =
                    '<i class="fas fa-info-circle" style="color:var(--text3)"></i> <span style="color:var(--text3)">Set profile to auto-fill next time</span>';
            }
        });
    }

    showStep(1);
    savePaymentState(1);
    updateBalanceUI();
};

window.handleCheckoutNext = () => {
    if (selectedPaymentMethod === 'balance') {
        return;
    }
    const name = document.getElementById('payName').value.trim();
    const wa = document.getElementById('payWA').value.trim();
    if (!name || !wa) return showToast("Please enter your Name and WhatsApp!", "error");
    showQR();
};

window.showQR = () => {
    const name = document.getElementById('payName').value.trim();
    const wa = document.getElementById('payWA').value.trim();
    if (!name || !wa) return showToast("Please enter your Name and WhatsApp!", "error");

    document.getElementById('esewaAmount').textContent = `Rs ${purchaseData.price}`;
    document.getElementById('esewaMerchant').textContent = "9827260865";

    showStep(2);
    savePaymentState(2);

    let sec = 15;
    const btn = document.getElementById('finalPayBtn');
    btn.disabled = true;
    btn.classList.add('disabled');
    document.getElementById('timerSec').innerText = sec;

    const clock = setInterval(() => {
        sec--;
        document.getElementById('timerSec').innerText = sec;
        if (sec <= 0) {
            clearInterval(clock);
            btn.disabled = false;
            btn.classList.remove('disabled');
        }
    }, 1000);
};

window.showVerifyStep = () => {
    document.getElementById('esewaTransCode').value = '';
    document.getElementById('esewaUserId').value = '';
    const waVal = document.getElementById('payWA').value.trim();
    if (waVal) document.getElementById('esewaUserId').value = waVal;
    showStep(3);
    savePaymentState(3);
};

function showStep(n) {
    ['checkoutStep1', 'checkoutStep2', 'checkoutStep3'].forEach((id, i) => {
        document.getElementById(id).classList.toggle('hidden', i + 1 !== n);
    });
}

// ============================================================
// SUBMIT ESEWA ORDER
// ============================================================
window.submitEsewaOrder = async () => {
    if (!currentUID) return showToast("Please login again.", "error");
    if (!purchaseData) return showToast("No item selected!", "error");

    const esewaId = document.getElementById('esewaUserId').value.trim();
    const txCode = document.getElementById('esewaTransCode').value.trim().toUpperCase();

    if (!txCode) return showToast("Enter your eSewa transaction ID!", "error");
    if (!esewaId) return showToast("Enter your eSewa ID (phone/email)!", "error");

    const submitBtn = document.getElementById('verifyPayBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>SUBMITTING...</span>';

    try {
        const userSnap = await getDoc(doc(db, "users", currentUID));
        if (userSnap.exists()) {
            const existing = (userSnap.data().history || []);
            const duplicate = existing.some(h => h.txCode && h.txCode.toUpperCase() === txCode);
            if (duplicate) {
                showToast("This transaction ID was already submitted!", "error");
                resetSubmitBtn(submitBtn);
                return;
            }
        }
    } catch (e) { /* continue */ }

    const name = document.getElementById('payName').value.trim();
    const waNum = document.getElementById('payWA').value.trim();
    const date = getDate();

    try {
        await updateDoc(doc(db, "users", currentUID), {
            requestStatus: "Key Pending",
            history: arrayUnion({
                date,
                uid: currentUID,
                email: currentUserEmail,
                msg: `PENDING: ${purchaseData.name} — Rs ${purchaseData.price} — TX: ${txCode}`,
                item: purchaseData.name,
                price: purchaseData.price,
                txCode,
                esewaId,
                name,
                waNum,
                status: 'PENDING_APPROVAL',
                cfVerified: true,
                paymentMethod: 'esewa'
            })
        });
    } catch (e) {
        showToast("Failed to save order: " + e.message, "error");
        resetSubmitBtn(submitBtn);
        return;
    }

    const tgMessage =
        `🔔 *NEW ESEWA PAYMENT*\n\n🛍 *Product:* ${purchaseData.name}\n💰 *Amount:* Rs ${purchaseData.price}\n📋 *TX Code:* \`${txCode}\`\n📱 *eSewa ID:* ${esewaId}\n\n👤 *Customer:*\n  Name: ${name}\n  WhatsApp: ${waNum}\n  Email: ${currentUserEmail}\n  UID: \`${currentUID}\`\n\n📅 ${date}\n\n🔗 [Open Admin Panel](https://srtxcheat.github.io/Ad/)`;

    try {
        await fetch("https://srt-telegram-bot.samratsubedi163.workers.dev", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: tgMessage })
        });
    } catch (e) { console.warn("Telegram notify failed:", e.message); }

    clearPaymentState();
    closeModals();
    history.replaceState(null, '', '#store');
    showOrderSubmitted(txCode, 'esewa');
    resetAfterPurchase();
};

// ============================================================
// BALANCE PAYMENT (auto-key via external API)
// ============================================================
window.processBalancePayment = async () => {
    if (!currentUID) return showToast("Please login again.", "error");
    if (!purchaseData) return showToast("No item selected!", "error");

    if (!purchaseData.isExternal || !purchaseData.pid) {
        showToast("This product does not support auto key. Please use eSewa.", "error");
        return;
    }

    const price = purchaseData.price;
    const bal = currentBalance || 0;
    if (bal < price) {
        showToast("Insufficient balance! Please top up.", "error");
        return;
    }

    const name = document.getElementById('payName').value.trim();
    const waNum = document.getElementById('payWA').value.trim();
    if (!name || !waNum) return showToast("Please enter your Name and WhatsApp!", "error");

    const payBtn = document.getElementById('checkoutPayBalanceBtn');
    payBtn.disabled = true;
    payBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>FETCHING KEY...</span>';

    const date = getDate();
    const txCode = 'BAL-' + Date.now().toString(36).toUpperCase();

    try {
        // Call external API to get key
        const apiResponse = await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pid: purchaseData.pid,
                duration: purchaseData.duration
            })
        });

        const apiData = await apiResponse.json();
        if (!apiData.success || !apiData.key) {
            throw new Error(apiData.message || "Failed to fetch key from external API");
        }
        const key = apiData.key;

        // Deduct balance and save order
        const userRef = doc(db, "users", currentUID);
        await runTransaction(db, async (transaction) => {
            const snap = await transaction.get(userRef);
            if (!snap.exists()) throw new Error("User not found");

            const data = snap.data();
            const currentBal = data.balance || 0;
            if (currentBal < price) throw new Error("Insufficient balance");

            const newBal = currentBal - price;
            const historyEntry = {
                amount: -price,
                date: date,
                note: `Purchase: ${purchaseData.name}`,
                type: 'purchase',
                orderId: txCode
            };

            transaction.update(userRef, {
                balance: newBal,
                balanceHistory: arrayUnion(historyEntry),
                history: arrayUnion({
                    date,
                    uid: currentUID,
                    email: currentUserEmail,
                    msg: `SUCCESS: ${purchaseData.name} — Rs ${purchaseData.price} — TX: ${txCode}`,
                    item: purchaseData.name,
                    price: purchaseData.price,
                    txCode,
                    name,
                    waNum,
                    status: 'SUCCESS',
                    key: key,
                    paymentMethod: 'balance',
                    balanceDeducted: price
                })
            });
        });

        currentBalance = currentBalance - price;
        document.getElementById('drawerBalance').innerText = currentBalance;

        showKeyDelivered(key, purchaseData.name);

        const tgMsg =
            `✅ *AUTO KEY DELIVERED (BALANCE)*\n\n🛍 *Product:* ${purchaseData.name}\n💰 *Amount:* Rs ${purchaseData.price}\n🔑 *Key:* \`${key}\`\n\n👤 *Customer:*\n  Name: ${name}\n  WhatsApp: ${waNum}\n  Email: ${currentUserEmail}\n  UID: \`${currentUID}\`\n\n📅 ${date}\n📌 Balance after: Rs ${currentBalance}`;

        try {
            await fetch("https://srt-telegram-bot.samratsubedi163.workers.dev", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: tgMsg })
            });
        } catch (e) { console.warn("Telegram notify failed:", e.message); }

        clearPaymentState();
        closeModals();
        history.replaceState(null, '', '#store');
        resetAfterPurchase();
        showToast("Key delivered! Check your order history.", "success");

    } catch (e) {
        showToast("Balance payment failed: " + e.message, "error");
        payBtn.disabled = false;
        payBtn.innerHTML = '<i class="fas fa-coins"></i> <span>PAY WITH BALANCE</span>';
        const snap = await getDoc(doc(db, "users", currentUID));
        if (snap.exists()) {
            currentBalance = snap.data().balance || 0;
            document.getElementById('drawerBalance').innerText = currentBalance;
            updateBalanceUI();
        }
    }
};

// ============================================================
// TOP-UP
// ============================================================
window.updateTopupDisplay = () => {
    const amt = parseInt(document.getElementById('topupAmount').value) || 0;
    document.getElementById('topupEsewaAmount').textContent = `Rs ${amt}`;
    document.querySelectorAll('.quick-amt').forEach(b => {
        b.classList.toggle('active', parseInt(b.textContent.replace(/\D/g, '')) === amt);
    });
};

window.setTopupAmount = (amount, btn) => {
    document.getElementById('topupAmount').value = amount;
    updateTopupDisplay();
    if (navigator.vibrate) navigator.vibrate(10);
};

window.showTopupStep2 = () => {
    const amount = parseInt(document.getElementById('topupAmount').value);
    if (!amount || amount < 50) return showToast("Enter a valid amount (min Rs 50)", "error");

    document.getElementById('topupSummaryAmount').textContent = `Rs ${amount}`;
    document.getElementById('topupStep1').classList.add('hidden');
    document.getElementById('topupStep2').classList.remove('hidden');

    const waVal = document.getElementById('profilePhone').value.trim();
    const idInput = document.getElementById('topupEsewaUserId');
    if (waVal && !idInput.value) idInput.value = waVal;
};

window.submitTopup = async () => {
    if (!currentUID) return showToast("Please login again.", "error");

    const amount = parseInt(document.getElementById('topupAmount').value);
    const esewaId = document.getElementById('topupEsewaUserId').value.trim();
    const txCode = document.getElementById('topupTransCode').value.trim().toUpperCase();

    if (!amount || amount < 50) return showToast("Enter a valid amount!", "error");
    if (!esewaId) return showToast("Enter your eSewa ID (phone/email)!", "error");
    if (!txCode) return showToast("Enter your eSewa transaction ID!", "error");

    const submitBtn = document.getElementById('topupSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>SUBMITTING...</span>';

    try {
        const userSnap = await getDoc(doc(db, "users", currentUID));
        if (userSnap.exists()) {
            const existing = userSnap.data().topupRequests || [];
            const duplicate = existing.some(t => t.txCode && t.txCode.toUpperCase() === txCode);
            if (duplicate) {
                showToast("This transaction ID was already submitted!", "error");
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i><span>SUBMIT TOP-UP</span>';
                return;
            }
        }
    } catch (e) { /* continue */ }

    const date = getDate();
    const name = document.getElementById('profileName').value.trim() || currentUserEmail || 'N/A';
    const wa = document.getElementById('profilePhone').value.trim() || esewaId;

    const topupEntry = {
        date,
        amount,
        esewaId,
        txCode,
        status: 'PENDING',
        uid: currentUID,
        email: currentUserEmail || ''
    };

    try {
        await updateDoc(doc(db, "users", currentUID), {
            topupRequests: arrayUnion(topupEntry)
        });
    } catch (e) {
        showToast("Failed to save top-up: " + e.message, "error");
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i><span>SUBMIT TOP-UP</span>';
        return;
    }

    const tgMessage =
        `💰 *NEW TOP-UP REQUEST*\n\n💵 *Amount:* Rs ${amount}\n📋 *TX Code:* \`${txCode}\`\n📱 *eSewa ID:* ${esewaId}\n\n👤 *Customer:*\n  Name: ${name}\n  WhatsApp: ${wa}\n  Email: ${currentUserEmail || 'N/A'}\n  UID: \`${currentUID}\`\n\n📅 ${date}\n\n🔗 [Open Admin Panel](https://srtxcheat.github.io/Ad/)`;

    try {
        await fetch("https://srt-telegram-bot.samratsubedi163.workers.dev", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: tgMessage })
        });
    } catch (e) { console.warn("Telegram notify failed:", e.message); }

    closeModals();
    document.getElementById('topupStep1').classList.remove('hidden');
    document.getElementById('topupStep2').classList.add('hidden');
    document.getElementById('topupEsewaUserId').value = '';
    document.getElementById('topupTransCode').value = '';
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i><span>SUBMIT TOP-UP</span>';
    showToast("Top-up request submitted! Balance will be credited shortly.", "success");
};

// ============================================================
// POPUPS
// ============================================================
function showOrderSubmitted(txCode, method) {
    const popup = document.getElementById('autoPopup');
    const msgArea = document.getElementById('popupMsg');
    if (!popup || !msgArea) return;

    const methodLabel = method === 'balance' ? 'BALANCE' : 'ESEWA';
    const methodIcon = method === 'balance' ? 'fa-coins' : 'fa-mobile-alt';
    const methodColor = method === 'balance' ? 'var(--gold)' : 'var(--green)';

    msgArea.innerHTML = `
        <div class="popup-status status-pending">ORDER SUBMITTED</div>
        <p style="font-size:13px;margin:10px 0;color:var(--text2)">Your payment is being verified by admin.</p>
        <div style="background:var(--bg2);border:1px solid rgba(232,162,58,0.25);border-radius:8px;padding:10px;margin:10px 0;">
            <p style="font-size:11px;color:var(--text3);margin:0 0 4px 0;">TRANSACTION ID</p>
            <p style="font-size:14px;color:var(--orange);font-weight:700;margin:0;">${txCode}</p>
        </div>
        <div style="background:var(--bg2);border:1px solid rgba(45,212,168,0.2);border-radius:8px;padding:8px 10px;margin:6px 0;display:flex;align-items:center;gap:8px;justify-content:center;">
            <i class="fas ${methodIcon}" style="color:${methodColor};font-size:14px;"></i>
            <span style="font-size:11px;color:${methodColor};font-weight:600;">${methodLabel} PAYMENT</span>
        </div>
        <p style="font-size:11px;color:var(--text3);margin-top:8px;">
            You'll receive your key in Order History once approved.<br>
            Usually within a few minutes during service hours (8AM–10PM).
        </p>
    `;
    popup.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
}

function showKeyDelivered(key, productName) {
    const popup = document.getElementById('autoPopup');
    const msgArea = document.getElementById('popupMsg');
    if (!popup || !msgArea) return;
    const safeKey = key.replace(/'/g, "\\'");
    msgArea.innerHTML = `
        <div class="popup-status status-approved">KEY DELIVERED</div>
        <p style="font-size:12px;margin-bottom:12px;color:var(--text2)">${productName}</p>
        <div class="key-display-popup">
            <i class="fas fa-key"></i>
            <span>${key}</span>
        </div>
        <button onclick="copyKey('${safeKey}')" class="copy-key-btn">
            <i class="fas fa-copy"></i> COPY KEY
        </button>
        <p style="font-size:11px;color:var(--text3);margin-top:12px;">
            Also saved in Order History
        </p>
    `;
    popup.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
}

window.copyKey = (key) => {
    navigator.clipboard.writeText(key)
        .then(() => showToast("Key copied!", "success"))
        .catch(() => {
            const el = document.createElement('textarea');
            el.value = key;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            showToast("Key copied!", "success");
        });
    if (navigator.vibrate) navigator.vibrate(30);
};

// ============================================================
// PAYMENT STATE PERSISTENCE
// ============================================================
function savePaymentState(step, extraData = {}) {
    const state = {
        step,
        purchaseData,
        payName: document.getElementById('payName')?.value || '',
        payWA: document.getElementById('payWA')?.value || '',
        esewaUserId: document.getElementById('esewaUserId')?.value || '',
        esewaTransCode: document.getElementById('esewaTransCode')?.value || '',
        savedAt: Date.now(),
        ...extraData
    };
    localStorage.setItem(PAYMENT_STORAGE_KEY, JSON.stringify(state));
    if (step >= 1 && step <= 3) {
        history.replaceState(null, '', '#payment/' + step);
    }
}

function loadPaymentState() {
    try {
        const raw = localStorage.getItem(PAYMENT_STORAGE_KEY);
        if (!raw) return null;
        const state = JSON.parse(raw);
        if (Date.now() - state.savedAt > 2 * 60 * 60 * 1000) {
            clearPaymentState();
            return null;
        }
        return state;
    } catch (e) { return null; }
}

function clearPaymentState() {
    localStorage.removeItem(PAYMENT_STORAGE_KEY);
}

function restorePaymentState(state, targetStep) {
    if (!state || !state.purchaseData) return;
    purchaseData = state.purchaseData;
    document.getElementById('modalOverlay').classList.remove('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    document.getElementById('checkoutModal').classList.remove('hidden');
    if (state.payName) document.getElementById('payName').value = state.payName;
    if (state.payWA) document.getElementById('payWA').value = state.payWA;
    document.getElementById('orderSummaryBox').innerHTML = `
        <span class="item-name">${purchaseData.name}</span>
        <span class="item-price">Rs ${purchaseData.price}</span>
    `;
    if (targetStep === 1) { showStep(1); } else if (targetStep === 2) {
        document.getElementById('esewaAmount').textContent = `Rs ${purchaseData.price}`;
        document.getElementById('esewaMerchant').textContent = "9827260865";
        showStep(2);
        const btn = document.getElementById('finalPayBtn');
        btn.disabled = false;
        btn.classList.remove('disabled');
        document.getElementById('timerSec').innerText = '0';
        showToast("Restored: Payment QR step", "info");
    } else if (targetStep === 3) {
        if (state.esewaUserId) document.getElementById('esewaUserId').value = state.esewaUserId;
        if (state.esewaTransCode) document.getElementById('esewaTransCode').value = state.esewaTransCode;
        showStep(3);
        showToast("Restored: Submit order step", "success");
    }
}

window.loadPaymentState = loadPaymentState;
window.clearPaymentState = clearPaymentState;
window.restorePaymentState = restorePaymentState;

// ============================================================
// RESET AFTER PURCHASE
// ============================================================
function resetAfterPurchase() {
    purchaseData = null;
    document.querySelectorAll('.price-item').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.buy-btn').forEach(b => b.classList.add('hidden'));
    document.getElementById('payName').value = '';
    document.getElementById('payWA').value = '';
    document.getElementById('checkoutPayBalanceBtn').innerHTML =
        '<i class="fas fa-coins"></i> <span>PAY WITH BALANCE</span>';
    document.getElementById('checkoutPayBalanceBtn').disabled = false;
    document.getElementById('checkoutPayBalanceBtn').style.opacity = '1';
    document.getElementById('checkoutPayBalanceBtn').style.pointerEvents = 'auto';
}

function resetSubmitBtn(btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> <span>SUBMIT ORDER</span>';
}

// ============================================================
// UI HELPERS
// ============================================================
window.toggleAuth = (mode) => {
    document.getElementById('loginBox').classList.toggle('hidden', mode === 'signup');
    document.getElementById('signupBox').classList.toggle('hidden', mode === 'login');
    history.replaceState(null, '', '#' + mode);
};

window.openModal = (id) => {
    document.getElementById('modalOverlay').classList.remove('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('hidden');
    closeMenu();
    if (id === 'profileModal' && currentUID) {
        const uidEl = document.getElementById('profileUid');
        if (uidEl) uidEl.value = currentUID;
        const emailEl = document.getElementById('profileEmail');
        if (emailEl) emailEl.value = currentUserEmail || '';
        getDoc(doc(db, "users", currentUID)).then(snap => {
            if (snap.exists()) loadProfileToModal(snap.data());
        });
    }
    if (id === 'topupModal') {
        document.getElementById('topupStep1').classList.remove('hidden');
        document.getElementById('topupStep2').classList.add('hidden');
        document.getElementById('topupAmount').value = 100;
        updateTopupDisplay();
    }
    if (id === 'apiModal' && currentUID) {
        getDoc(doc(db, "users", currentUID)).then(snap => {
            renderApiKeys(snap.exists() ? (snap.data().apiKeys || []) : []);
        });
    }
};

window.closeModals = () => {
    document.getElementById('modalOverlay').classList.add('hidden');
    if (window.location.hash.startsWith('#payment/')) {
        history.replaceState(null, '', '#store');
    }
};

// ============================================================
// LIVE CLOCK
// ============================================================
function startTime() {
    const tick = () => {
        const timeEl = document.getElementById('currentTime');
        if (timeEl) timeEl.innerText = new Date().toLocaleTimeString('en-IN');
    };
    tick();
    setInterval(tick, 1000);
}

// ============================================================
// API KEY MANAGER (ENHANCED)
// ============================================================

function generateApiKeyString() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const segments = [8, 4, 4, 4, 12];
    return 'srtx-' + segments.map(len =>
        Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    ).join('-');
}

function renderApiKeys(apiKeys) {
    const list = document.getElementById('apiKeyList');
    if (!list) return;
    if (!apiKeys || apiKeys.length === 0) {
        list.innerHTML = `
            <div style="text-align:center;padding:18px 0 8px;color:var(--text3);font-size:13px;">
                <i class="fas fa-plug" style="font-size:22px;margin-bottom:8px;display:block;opacity:0.3;"></i>
                No API keys yet. Generate one below.
            </div>`;
        return;
    }
    list.innerHTML = apiKeys.map((k, i) => `
        <div class="api-key-card">
            <div class="api-key-top">
                <span class="api-key-label">
                    <i class="fas fa-key" style="color:var(--accent3);font-size:11px;"></i>
                    API KEY ${i + 1}
                </span>
                <span class="api-key-date">${k.createdAt || ''}</span>
            </div>
            <div class="api-key-value-row">
                <code class="api-key-value" id="apiKeyVal_${i}">${maskApiKey(k.key)}</code>
                <button class="api-key-icon-btn" onclick="toggleShowApiKey(${i}, '${k.key}')" title="Show/Hide">
                    <i class="fas fa-eye" id="apiKeyEyeIcon_${i}"></i>
                </button>
                <button class="api-key-icon-btn" onclick="copyApiKey('${k.key}')" title="Copy">
                    <i class="fas fa-copy"></i>
                </button>
            </div>
            <div class="api-key-status">
                <span class="api-status-dot ${k.active ? 'active' : 'inactive'}"></span>
                ${k.active ? 'Active' : 'Revoked'}
                <span style="margin-left:auto;">
                    ${k.active ? `<button class="api-revoke-btn" onclick="revokeApiKey('${k.key}')">
                        <i class="fas fa-ban"></i> Revoke
                    </button>` : `<button class="api-delete-btn" onclick="deleteApiKey('${k.key}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>`}
                </span>
            </div>
        </div>
    `).join('');
}

function maskApiKey(key) {
    if (!key) return '';
    const parts = key.split('-');
    return parts.map((p, i) => i < 2 ? p : '*'.repeat(p.length)).join('-');
}

window.toggleShowApiKey = (index, fullKey) => {
    const el = document.getElementById(`apiKeyVal_${index}`);
    const icon = document.getElementById(`apiKeyEyeIcon_${index}`);
    if (!el) return;
    const isHidden = el.textContent.includes('*');
    el.textContent = isHidden ? fullKey : maskApiKey(fullKey);
    if (icon) {
        icon.className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
    }
};

window.copyApiKey = (key) => {
    navigator.clipboard.writeText(key)
        .then(() => showToast("API key copied!", "success"))
        .catch(() => {
            const el = document.createElement('textarea');
            el.value = key;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            showToast("API key copied!", "success");
        });
};

window.createApiKey = async () => {
    if (!currentUID) return showToast("Please login first", "error");
    const btn = document.getElementById('createApiKeyBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>GENERATING...</span>';

    try {
        const userRef = doc(db, "users", currentUID);
        const snap = await getDoc(userRef);
        const existing = snap.exists() ? (snap.data().apiKeys || []) : [];

        const activeCount = existing.filter(k => k.active).length;
        if (activeCount >= 3) {
            showToast("Max 3 active keys allowed. Revoke one first.", "error");
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plus"></i><span>GENERATE NEW API KEY</span>';
            return;
        }

        const newKey = {
            key: generateApiKeyString(),
            createdAt: getDate(),
            active: true
        };

        await updateDoc(userRef, {
            apiKeys: arrayUnion(newKey)
        });

        showToast("API key created!", "success");
        const freshSnap = await getDoc(userRef);
        renderApiKeys(freshSnap.data().apiKeys || []);
    } catch (e) {
        showToast("Failed to create key: " + e.message, "error");
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-plus"></i><span>GENERATE NEW API KEY</span>';
};

window.revokeApiKey = async (keyStr) => {
    if (!currentUID) return;
    try {
        const userRef = doc(db, "users", currentUID);
        const snap = await getDoc(userRef);
        if (!snap.exists()) return;
        const keys = snap.data().apiKeys || [];
        const updated = keys.map(k => k.key === keyStr ? { ...k, active: false } : k);
        await updateDoc(userRef, { apiKeys: updated });
        renderApiKeys(updated);
        showToast("API key revoked.", "info");
    } catch (e) {
        showToast("Failed to revoke: " + e.message, "error");
    }
};

window.deleteApiKey = async (keyStr) => {
    if (!currentUID) return;
    try {
        const userRef = doc(db, "users", currentUID);
        const snap = await getDoc(userRef);
        if (!snap.exists()) return;
        const keys = snap.data().apiKeys || [];
        const entry = keys.find(k => k.key === keyStr);
        if (!entry) return;
        await updateDoc(userRef, { apiKeys: arrayRemove(entry) });
        const updated = keys.filter(k => k.key !== keyStr);
        renderApiKeys(updated);
        showToast("API key deleted.", "success");
    } catch (e) {
        showToast("Failed to delete: " + e.message, "error");
    }
};

// ============================================================
// FULL PAGE API MANAGER
// ============================================================
window.openApiFullPage = () => {
    document.getElementById('apiFullPage').classList.remove('hidden');
    document.getElementById('storeUI').classList.add('hidden');
    document.getElementById('sideDrawer').classList.remove('active');
    document.getElementById('menuBtn').classList.remove('active');
    document.getElementById('menuOverlay').style.display = 'none';
    // Load keys and product list
    if (currentUID) {
        getDoc(doc(db, "users", currentUID)).then(snap => {
            renderFullApiKeys(snap.exists() ? (snap.data().apiKeys || []) : []);
        });
    }
    renderProductTable();
    // Update endpoint with placeholder
    document.getElementById('apiFullEndpoint').textContent = 'https://srtxcheats.web.app/api/keys?apikey=YOUR_API_KEY';
};

window.closeApiFullPage = () => {
    document.getElementById('apiFullPage').classList.add('hidden');
    document.getElementById('storeUI').classList.remove('hidden');
};

function renderFullApiKeys(apiKeys) {
    const list = document.getElementById('apiFullKeyList');
    if (!list) return;
    if (!apiKeys || apiKeys.length === 0) {
        list.innerHTML = `
            <div style="text-align:center;padding:18px 0 8px;color:var(--text3);font-size:13px;">
                <i class="fas fa-plug" style="font-size:22px;margin-bottom:8px;display:block;opacity:0.3;"></i>
                No API keys yet. Generate one below.
            </div>`;
        return;
    }
    list.innerHTML = apiKeys.map((k, i) => `
        <div class="api-key-card">
            <div class="api-key-top">
                <span class="api-key-label">
                    <i class="fas fa-key" style="color:var(--accent3);font-size:11px;"></i>
                    API KEY ${i + 1}
                </span>
                <span class="api-key-date">${k.createdAt || ''}</span>
            </div>
            <div class="api-key-value-row">
                <code class="api-key-value" id="fullApiKeyVal_${i}">${maskApiKey(k.key)}</code>
                <button class="api-key-icon-btn" onclick="toggleShowFullApiKey(${i}, '${k.key}')" title="Show/Hide">
                    <i class="fas fa-eye" id="fullApiKeyEyeIcon_${i}"></i>
                </button>
                <button class="api-key-icon-btn" onclick="copyApiKey('${k.key}')" title="Copy">
                    <i class="fas fa-copy"></i>
                </button>
            </div>
            <div class="api-key-status">
                <span class="api-status-dot ${k.active ? 'active' : 'inactive'}"></span>
                ${k.active ? 'Active' : 'Revoked'}
                <span style="margin-left:auto;">
                    ${k.active ? `<button class="api-revoke-btn" onclick="revokeFullApiKey('${k.key}')">
                        <i class="fas fa-ban"></i> Revoke
                    </button>` : `<button class="api-delete-btn" onclick="deleteFullApiKey('${k.key}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>`}
                </span>
            </div>
        </div>
    `).join('');
}

window.toggleShowFullApiKey = (index, fullKey) => {
    const el = document.getElementById(`fullApiKeyVal_${index}`);
    const icon = document.getElementById(`fullApiKeyEyeIcon_${index}`);
    if (!el) return;
    const isHidden = el.textContent.includes('*');
    el.textContent = isHidden ? fullKey : maskApiKey(fullKey);
    if (icon) {
        icon.className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
    }
};

window.createApiKeyFull = async () => {
    if (!currentUID) return showToast("Please login first", "error");
    const btn = document.getElementById('createApiKeyFullBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>GENERATING...</span>';

    try {
        const userRef = doc(db, "users", currentUID);
        const snap = await getDoc(userRef);
        const existing = snap.exists() ? (snap.data().apiKeys || []) : [];

        const activeCount = existing.filter(k => k.active).length;
        if (activeCount >= 3) {
            showToast("Max 3 active keys allowed. Revoke one first.", "error");
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plus"></i><span>GENERATE NEW API KEY</span>';
            return;
        }

        const newKey = {
            key: generateApiKeyString(),
            createdAt: getDate(),
            active: true
        };

        await updateDoc(userRef, {
            apiKeys: arrayUnion(newKey)
        });

        showToast("API key created!", "success");
        const freshSnap = await getDoc(userRef);
        renderFullApiKeys(freshSnap.data().apiKeys || []);
    } catch (e) {
        showToast("Failed to create key: " + e.message, "error");
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-plus"></i><span>GENERATE NEW API KEY</span>';
};

window.revokeFullApiKey = async (keyStr) => {
    if (!currentUID) return;
    try {
        const userRef = doc(db, "users", currentUID);
        const snap = await getDoc(userRef);
        if (!snap.exists()) return;
        const keys = snap.data().apiKeys || [];
        const updated = keys.map(k => k.key === keyStr ? { ...k, active: false } : k);
        await updateDoc(userRef, { apiKeys: updated });
        renderFullApiKeys(updated);
        showToast("API key revoked.", "info");
    } catch (e) {
        showToast("Failed to revoke: " + e.message, "error");
    }
};

window.deleteFullApiKey = async (keyStr) => {
    if (!currentUID) return;
    try {
        const userRef = doc(db, "users", currentUID);
        const snap = await getDoc(userRef);
        if (!snap.exists()) return;
        const keys = snap.data().apiKeys || [];
        const entry = keys.find(k => k.key === keyStr);
        if (!entry) return;
        await updateDoc(userRef, { apiKeys: arrayRemove(entry) });
        const updated = keys.filter(k => k.key !== keyStr);
        renderFullApiKeys(updated);
        showToast("API key deleted.", "success");
    } catch (e) {
        showToast("Failed to delete: " + e.message, "error");
    }
};

window.copyApiEndpoint = () => {
    const endpoint = document.getElementById('apiFullEndpoint').textContent;
    navigator.clipboard.writeText(endpoint)
        .then(() => showToast("Endpoint copied!", "success"))
        .catch(() => {
            const el = document.createElement('textarea');
            el.value = endpoint;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            showToast("Endpoint copied!", "success");
        });
};

// ============================================================
// PRODUCT TABLE FROM HUD.TXT (hardcoded)
// ============================================================
function renderProductTable() {
    const container = document.getElementById('apiProductTableWrap');
    if (!container) return;
    // Data extracted from hud.txt
    const products = [
        { pid: 49, name: "BR MOD FF PC VERSION", durations: ["1 Day Pc Aim Silent", "1 Day Pc Bypass + Silent", "1 Day Pc Modmenu x86", "10 Day Pc Modmenu x86", "10 Days Pc Aim Silent", "10 Days Pc Bypass + Silent", "30 Day Pc Modmenu x86", "30 Days Pc Aim Silent", "30 Days Pc Bypass + Silent"] },
        { pid: 67, name: "BR MOD FF ROOT ANDROID", durations: ["1 DaYs", "15 DaYs", "30 DaYs", "7 DaYs"] },
        { pid: 59, name: "DRIPCLIENT 8BP NONROOT ANDROID", durations: ["1 DaYs", "30 DaYs", "7 DaYs"] },
        { pid: 62, name: "DRIPCLIENT FF NONROOT ANDROID", durations: ["1 DaYS NONROOT", "15 DaYS NONROOT", "3 DaYS NONROOT", "30 DaYS NONROOT", "7 DaYS NONROOT"] },
        { pid: 44, name: "DRIPCLIENT FF PC AIMKILL", durations: ["1 DaYS PC AIMKILL", "15 DaYS PC AIMKILL", "30 DaYS PC AIMKILL", "7 DaYS PC AIMKILL"] },
        { pid: 63, name: "DRIPCLIENT FF ROOT ANDROID", durations: ["30 DaYS ROOT"] },
        { pid: 91, name: "DRIPCLIENT PROXY FF NONROOT ANDROID", durations: ["1 DaYs", "3 DaYs", "30 DaYs", "7 DaYs"] },
        { pid: 58, name: "FLUORITE IOS FF", durations: ["1 DAYs FluoRite FF", "7 DAYs FluoRite FF"] },
        { pid: 84, name: "FLUORITE IOS MLBB", durations: ["1 DaYs", "30 DaYs", "7 DaYs"] },
        { pid: 64, name: "HAXX-CKER PRO FF ROOT ANDROID", durations: ["10 DaYs"] },
        { pid: 71, name: "HEX BLADE FF ROOT ANDROID", durations: ["1 DaYs", "10 DaYs", "20 DaYs", "3 DaYs", "30 DaYs", "7 DaYs"] },
        { pid: 65, name: "HG CHEATS FF ALL ANDROID", durations: ["1 DaYs Root + Nonroot", "10 DaYs Root+Nonroot", "30 DaYs Root+Nonroot", "7 DaYs Root+Nonroot"] },
        { pid: 123, name: "HG CHEATS PROXY FF NONROOT ANDROID", durations: ["1 DaYs", "10 DaYs", "30 DaYs", "7 DaYs"] },
        { pid: 72, name: "HIKARI MOD FF ROOT ANDROID", durations: ["1 Days", "15 Days", "3 Days", "30 Days", "7 Days"] },
        { pid: 76, name: "KOS CARROM POOL IOS ANDROID", durations: ["1 DaYs Mod", "1 DaYs Premium Access", "1 DaYs Standard Access", "30 DaYs Mod", "30 DaYs Premium Access", "30 DaYs Standard Access", "7 DaYs Mod", "7 DaYs Premium Access", "7 DaYs Standard Access"] },
        { pid: 75, name: "KOS CARROM POOL NONROOT ANDROID", durations: ["1 DaYs", "30 DaYs"] },
        { pid: 74, name: "KOS FF ROOT ANDROID", durations: ["1 DaYs", "30 DaYs", "7 DaYs"] },
        { pid: 89, name: "LK TEAM FF CRACK ROOT ANDROID", durations: ["1 DaYs", "3 DaYs", "7 DaYs"] },
        { pid: 69, name: "MIGUL IPHONE IOS FF", durations: ["1 DaYs Basic", "1 DaYs PRO", "30 DaYs Basic", "30 DaYs PRO", "7 DaYs Basic", "7 DaYs PRO"] },
        { pid: 70, name: "NEO STRIKE FF ROOT ANDROID", durations: ["1 DaYs", "14 DaYs", "28 DaYs", "3 DaYs", "7 DaYs"] },
        { pid: 54, name: "PATO TEAM FF ALL ANDROID", durations: ["15 DaYs All Colours Mix", "3 DaYs All Colours Mix", "30 DaYs All Colours Mix", "7 DaYs All Colours Mix"] },
        { pid: 48, name: "PRIME HOOK FF NONROOT ANDROID", durations: ["1 Days Nonroot", "10 Days Nonroot", "3 Days Nonroot", "7 Days NonRoot"] },
        { pid: 81, name: "REAPER X PRO FF ROOT ANDROID", durations: ["10 DaYs"] },
        { pid: 66, name: "XYZ CHEATS FF ROOT ANDROID", durations: ["1 Days", "15 Days", "3 Days", "30 Days", "7 Days"] }
    ];

    let html = `<table class="api-product-table">
        <thead>
            <tr><th>PID</th><th>Product Name</th><th>Durations</th></tr>
        </thead>
        <tbody>`;
    products.forEach(p => {
        html += `<tr><td><strong>${p.pid}</strong></td><td>${p.name}</td><td>${p.durations.join(', ')}</td></tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    setPaymentMethod('esewa');
    // Ensure full page API product table loads when needed
});

console.log("✅ SRT X CHEATS store loaded with API key manager.");
console.log("📌 Cloudflare Worker URL:", WORKER_URL);
console.log("📌 To use the API, generate an API key from the 'API Keys' menu.");
console.log("📌 Endpoint: https://srtxcheats.web.app/api/keys?apikey=YOUR_KEY");