// Global variables
let socket;
let authToken = localStorage.getItem('authToken');
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
let pendingVerificationAction = null;
let currentRatingOffer = null;
let selectedRating = 0;
let resendCountdown;

// API Base URL
const API_BASE = window.location.origin + '/api';

// DOM Elements
const roleSelection = document.getElementById('roleSelection');
const sellerSection = document.getElementById('sellerSection');
const buyerSection = document.getElementById('buyerSection');
const offersList = document.getElementById('offersList');
const sellerOffers = document.getElementById('sellerOffers');
const reservationsList = document.getElementById('reservationsList');
const notificationsList = document.getElementById('notificationsList');
const offerForm = document.getElementById('offerForm');
const ratingModal = document.getElementById('ratingModal');
const loadingOverlay = document.getElementById('loadingOverlay');

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
  initTheme();
  initSocketConnection();
  setupEventListeners();
  checkExistingAuth();
});

// ============= Socket.IO Connection =============
function initSocketConnection() {
  socket = io();
  
  socket.on('connect', () => {
    console.log('متصل بالخادم:', socket.id);
    if (currentUser) {
      socket.emit('join_seller', currentUser.sellerId);
    }
  });

  socket.on('disconnect', () => {
    console.log('انقطع الاتصال بالخادم');
  });

  // Listen for real-time updates
  socket.on('new_reservation', (data) => {
    showNotification(`طلب حجز جديد من ${data.buyerName} لوجبة ${data.mealType}! 🔔`, 'info');
    loadSellerReservations();
    loadNotifications();
  });

  socket.on('reservation_confirmed', (data) => {
    showNotification(`تم تأكيد حجزك لوجبة ${data.mealType} من ${data.sellerName}! 🎉`, 'success');
  });

  socket.on('reservation_rejected', (data) => {
    showNotification(`تم رفض حجزك لوجبة ${data.mealType} من ${data.sellerName} 😔`, 'error');
  });

  socket.on('new_rating', (data) => {
    showNotification(`حصلت على تقييم ${data.rating}/5 نجوم! ⭐`, 'success');
    loadNotifications();
  });

  socket.on('new_offer', (data) => {
    if (document.getElementById('buyerSection').classList.contains('hidden') === false) {
      loadOffers();
    }
  });

  socket.on('offer_removed', (data) => {
    if (document.getElementById('buyerSection').classList.contains('hidden') === false) {
      loadOffers();
    }
  });
}

// ============= Authentication Functions =============
async function checkExistingAuth() {
  if (!authToken || !currentUser) return;

  try {
    const response = await fetch(`${API_BASE}/auth/verify-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: authToken })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        currentUser = data.user;
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        console.log('المستخدم محقق:', currentUser.phone);
      } else {
        clearAuthData();
      }
    } else {
      clearAuthData();
    }
  } catch (error) {
    console.error('خطأ في التحقق من المصادقة:', error);
    clearAuthData();
  }
}

function clearAuthData() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  authToken = null;
  currentUser = null;
}

function isAuthenticated() {
  return authToken && currentUser && currentUser.isVerified;
}

// ============= Phone Verification Functions =============
function showVerificationModal() {
  document.getElementById('phoneVerificationModal').style.display = 'block';
  document.body.style.overflow = 'hidden';
  goToVerifyStep1();
}

function closeVerificationModal() {
  document.getElementById('phoneVerificationModal').style.display = 'none';
  document.body.style.overflow = 'auto';
  pendingVerificationAction = null;
  clearInterval(resendCountdown);
}

async function sendVerificationCode() {
  const phoneInput = document.getElementById('verifyPhoneInput');
  const sendBtn = document.getElementById('sendVerifyCodeBtn');
  
  let phoneNumber = phoneInput.value.trim();
  
  // Validation
  if (!phoneNumber) {
    showVerifyError('verifyError1', 'يرجى إدخال رقم الجوال');
    return;
  }
  
  if (phoneNumber.length !== 10) {
    showVerifyError('verifyError1', 'رقم الجوال يجب أن يكون مكوناً من 10 أرقام');
    return;
  }
  
  if (!phoneNumber.startsWith('05')) {
    showVerifyError('verifyError1', 'رقم الجوال يجب أن يبدأ بـ 05');
    return;
  }

  if (!/^\d+$/.test(phoneNumber)) {
    showVerifyError('verifyError1', 'رقم الجوال يجب أن يحتوي على أرقام فقط');
    return;
  }
  
  sendBtn.disabled = true;
  sendBtn.classList.add('btn-loading');
  
  try {
    const response = await fetch(`${API_BASE}/auth/verify-phone`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phone: phoneNumber })
    });

    const data = await response.json();
    
    if (data.success) {
      document.getElementById('verifiedPhoneDisplay').textContent = '+966' + phoneNumber.substring(1);
      goToVerifyStep2();
      startVerifyCountdown();
      hideVerifyError('verifyError1');
      
      showNotification('تم إرسال كود التحقق بنجاح! 📱', 'success');
      
      // في بيئة التطوير، اعرض الكود
      if (data.code) {
        showNotification(`كود التحقق: ${data.code}`, 'info');
      }
    } else {
      showVerifyError('verifyError1', data.message || 'حدث خطأ في إرسال كود التحقق');
    }
    
  } catch (error) {
    console.error('خطأ في إرسال كود التحقق:', error);
    showVerifyError('verifyError1', 'تحقق من اتصالك بالإنترنت وحاول مرة أخرى');
  } finally {
    sendBtn.disabled = false;
    sendBtn.classList.remove('btn-loading');
  }
}

async function verifyCode() {
  const codeInput = document.getElementById('verifyCodeInput');
  const verifyBtn = document.getElementById('confirmVerifyCodeBtn');
  const phoneNumber = document.getElementById('verifyPhoneInput').value;
  
  const code = codeInput.value.trim();
  
  if (!code) {
    showVerifyError('verifyError2', 'يرجى إدخال كود التحقق');
    return;
  }
  
  if (code.length !== 6) {
    showVerifyError('verifyError2', 'كود التحقق يجب أن يكون مكوناً من 6 أرقام');
    return;
  }

  if (!/^\d+$/.test(code)) {
    showVerifyError('verifyError2', 'كود التحقق يجب أن يحتوي على أرقام فقط');
    return;
  }
  
  verifyBtn.disabled = true;
  verifyBtn.classList.add('btn-loading');
  
  try {
    const response = await fetch(`${API_BASE}/auth/verify-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phone: phoneNumber, code })
    });

    const data = await response.json();
    
    if (data.success) {
      // Save auth data
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('authToken', authToken);
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      
      // Connect to socket with seller ID
      socket.emit('join_seller', currentUser.sellerId);
      
      goToVerifyStep3();
      hideVerifyError('verifyError2');
      
      showNotification('تم التحقق بنجاح! مرحباً بك 🎉', 'success');
    } else {
      showVerifyError('verifyError2', data.message || 'كود التحقق غير صحيح');
      codeInput.value = '';
      codeInput.focus();
    }
    
  } catch (error) {
    console.error('خطأ في التحقق من الكود:', error);
    showVerifyError('verifyError2', 'حدث خطأ في التحقق من الكود');
  } finally {
    verifyBtn.disabled = false;
    verifyBtn.classList.remove('btn-loading');
  }
}

function goToVerifyStep1() {
  document.querySelectorAll('.verification-step').forEach(step => {
    step.classList.remove('active');
  });
  document.getElementById('verifyStep1').classList.add('active');
  clearInterval(resendCountdown);
  
  document.getElementById('verifyPhoneInput').value = '';
  hideVerifyError('verifyError1');
}

function goToVerifyStep2() {
  document.querySelectorAll('.verification-step').forEach(step => {
    step.classList.remove('active');
  });
  document.getElementById('verifyStep2').classList.add('active');
  
  setTimeout(() => {
    document.getElementById('verifyCodeInput').focus();
  }, 300);
}

function goToVerifyStep3() {
  document.querySelectorAll('.verification-step').forEach(step => {
    step.classList.remove('active');
  });
  document.getElementById('verifyStep3').classList.add('active');
  clearInterval(resendCountdown);
}

function proceedAfterVerification() {
  closeVerificationModal();
  
  if (pendingVerificationAction) {
    pendingVerificationAction();
    pendingVerificationAction = null;
  }
  
  setTimeout(() => {
    showNotification('يمكنك الآن الوصول إلى جميع الميزات المتقدمة! 🚀', 'success');
  }, 500);
}

async function resendCode() {
  const resendBtn = document.getElementById('resendCodeBtn');
  resendBtn.disabled = true;
  
  document.getElementById('verifyCodeInput').value = '';
  hideVerifyError('verifyError2');
  
  try {
    await sendVerificationCode();
    startVerifyCountdown();
    showNotification('تم إعادة إرسال الكود 🔄', 'info');
  } catch (error) {
    showVerifyError('verifyError2', 'فشل في إعادة إرسال الكود. حاول مرة أخرى');
    resendBtn.disabled = false;
  }
}

function startVerifyCountdown() {
  let seconds = 60;
  const resendBtn = document.getElementById('resendCodeBtn');
  const countdownDiv = document.getElementById('resendCountdown');
  
  resendBtn.disabled = true;
  
  resendCountdown = setInterval(() => {
    countdownDiv.textContent = `يمكنك إعادة الإرسال خلال ${seconds} ثانية ⏰`;
    seconds--;
    
    if (seconds < 0) {
      clearInterval(resendCountdown);
      resendBtn.disabled = false;
      countdownDiv.textContent = 'يمكنك الآن إعادة إرسال الكود ✅';
    }
  }, 1000);
}

function showVerifyError(errorId, message) {
  const errorDiv = document.getElementById(errorId);
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
  
  setTimeout(() => {
    hideVerifyError(errorId);
  }, 10000);
}

function hideVerifyError(errorId) {
  const errorDiv = document.getElementById(errorId);
  errorDiv.style.display = 'none';
}

// ============= Navigation Functions =============
function showSeller() {
  if (!isAuthenticated()) {
    pendingVerificationAction = showSeller;
    showVerificationModal();
    return;
  }

  roleSelection.classList.add('hidden');
  sellerSection.classList.remove('hidden');
  offerForm.reset();
  showTab(null, 'add-meal');
  loadNotifications();
}

function showBuyer() {
  roleSelection.classList.add('hidden');
  buyerSection.classList.remove('hidden');
  loadOffers();
}

function goHome() {
  sellerSection.classList.add('hidden');
  buyerSection.classList.add('hidden');
  roleSelection.classList.remove('hidden');
}

function showTab(event, tabName) {
  // Check if authentication is needed for certain tabs
  if ((tabName === 'manage-orders' || tabName === 'my-meals' || tabName === 'notifications')) {
    if (!isAuthenticated()) {
      pendingVerificationAction = () => showTab(event, tabName);
      showVerificationModal();
      return;
    }
  }

  // Hide all tab contents
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.add('hidden');
  });
  
  // Remove active class from all tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Show selected tab and mark button as active
  document.getElementById(tabName + '-tab').classList.remove('hidden');
  if (event && event.target) {
    event.target.classList.add('active');
  }
  
  // Load content based on tab
  switch (tabName) {
    case 'manage-orders':
      loadSellerReservations();
      break;
    case 'my-meals':
      loadSellerMeals();
      break;
    case 'notifications':
      loadNotifications();
      break;
  }
}

// ============= API Functions =============
async function apiRequest(url, options = {}) {
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...(authToken && { 'Authorization': `Bearer ${authToken}` })
    }
  };

  const finalOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers
    }
  };

  try {
    const response = await fetch(url, finalOptions);
    
    if (response.status === 401) {
      clearAuthData();
      showNotification('انتهت صلاحية الجلسة، يرجى إعادة التسجيل', 'error');
      goHome();
      return null;
    }

    return response;
  } catch (error) {
    console.error('خطأ في طلب API:', error);
    showNotification('خطأ في الاتصال بالخادم', 'error');
    return null;
  }
}

// ============= Offers Functions =============
async function loadOffers() {
  showLoading();
  
  try {
    const response = await apiRequest(`${API_BASE}/offers`);
    if (!response) return;
    
    const data = await response.json();
    
    if (data.success) {
      displayOffers(data.offers);
    } else {
      showNotification('فشل في تحميل العروض', 'error');
    }
  } catch (error) {
    console.error('خطأ في تحميل العروض:', error);
    showNotification('حدث خطأ في تحميل العروض', 'error');
  } finally {
    hideLoading();
  }
}

function displayOffers(offers) {
  offersList.innerHTML = '';
  
  if (!offers || offers.length === 0) {
    offersList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🍽️</div>
        <h3>لا توجد عروض متاحة حالياً</h3>
        <p>كن أول من ينشر عرضاً للوجبات!</p>
      </div>
    `;
    return;
  }

  offers.forEach((offer) => {
    const offerCard = document.createElement('div');
    offerCard.className = 'offer-card';
    
    let statusDisplay = '';
    let actionButton = '';
    
    switch(offer.status) {
      case 'available':
        statusDisplay = '<div class="status-available">✅ متاح للحجز</div>';
        actionButton = `<button class="btn btn-contact" onclick="reserveMeal('${offer.key}', '${offer.sellerName}', '${offer.type}', '${offer.price}')">
          احجز الآن 🍽️
        </button>`;
        break;
      case 'reserved':
        statusDisplay = '<div class="status-reserved">⏳ محجوز مؤقتاً</div>';
        actionButton = '<button class="btn" disabled style="opacity: 0.5;">محجوز مؤقتاً</button>';
        break;
      case 'sold':
        statusDisplay = '<div class="status-sold">✅ تم البيع</div>';
        actionButton = '<button class="btn" disabled style="opacity: 0.5;">تم البيع</button>';
        break;
    }
    
    offerCard.innerHTML = `
      <div class="meal-type">${offer.type}</div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 1rem;">
        <div class="meal-price">${offer.price} ريال</div>
        <div style="text-align: left;">
          <div style="font-weight: 700; color: #667eea; margin-bottom: 0.5rem;">البائع: ${offer.sellerName}</div>
          <div class="rating-display">
            ${offer.avgRating > 0 ? displayRatingStars(offer.avgRating, offer.ratingCount) : '<span class="rating-text">بائع جديد</span>'}
          </div>
        </div>
      </div>
      ${offer.details && offer.details !== 'لم يتم إضافة تفاصيل' ? `<div class="meal-details">
        <span class="details-label">📝 تفاصيل الوجبة:</span>
        ${offer.details}
      </div>` : ''}
      <div class="contact-info">
        <div class="phone-hidden">رقم الجوال محمي ومخفي للحفاظ على الخصوصية 🔒</div>
        <p style="margin-top: 0.5rem; font-size: 0.9rem; color: #718096;">سيتم الكشف عن رقم البائع بعد تأكيد الحجز</p>
      </div>
      ${statusDisplay}
      <div style="text-align: center; margin-top: 1.5rem;">
        ${actionButton}
      </div>
    `;
    offersList.appendChild(offerCard);
  });
}

async function reserveMeal(offerKey, sellerName, mealType, price) {
  const buyerName = prompt('أدخل اسمك:');
  if (!buyerName || buyerName.trim().length < 2) {
    showNotification('يرجى إدخال اسم صحيح', 'error');
    return;
  }

  const buyerPhone = prompt('أدخل رقم جوالك:');
  if (!buyerPhone || !validatePhoneNumber(buyerPhone)) {
    showNotification('يرجى إدخال رقم جوال صحيح', 'error');
    return;
  }
  
  if (confirm(`هل تريد حجز وجبة ${mealType} من ${sellerName} بسعر ${price} ريال؟`)) {
    showLoading();
    
    try {
      const response = await apiRequest(`${API_BASE}/offers/${offerKey}/reserve`, {
        method: 'POST',
        body: JSON.stringify({
          buyerName: buyerName.trim(),
          buyerPhone
        })
      });

      if (!response) return;
      
      const data = await response.json();
      
      if (data.success) {
        showNotification("تم حجز الوجبة! سيراجع البائع طلبك قريباً 🎉", "success");
        
        // Show rating modal after successful reservation
        setTimeout(() => {
          showRatingModal(offerKey, sellerName);
        }, 2000);
        
        // Reload offers to show updated status
        loadOffers();
      } else {
        showNotification(data.message || "حدث خطأ في حجز الوجبة", "error");
      }
    } catch (error) {
      console.error("خطأ في حجز الوجبة:", error);
      showNotification("حدث خطأ في حجز الوجبة", "error");
    } finally {
      hideLoading();
    }
  }
}

// ============= Seller Functions =============
async function loadSellerMeals() {
  if (!isAuthenticated()) return;
  
  showLoading();
  
  try {
    const response = await apiRequest(`${API_BASE}/offers/my-offers`);
    if (!response) return;
    
    const data = await response.json();
    
    if (data.success) {
      displaySellerMeals(data.offers);
    } else {
      showNotification('فشل في تحميل وجباتك', 'error');
    }
  } catch (error) {
    console.error('خطأ في تحميل وجبات البائع:', error);
    showNotification('حدث خطأ في تحميل وجباتك', 'error');
  } finally {
    hideLoading();
  }
}

function displaySellerMeals(offers) {
  sellerOffers.innerHTML = '';
  
  if (!offers || offers.length === 0) {
    sellerOffers.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🍽️</div>
        <h3>لم تنشر أي وجبات بعد</h3>
        <p>ابدأ بإضافة وجبة من تبويب "إضافة وجبة"</p>
      </div>
    `;
    return;
  }

  offers.forEach((offer) => {
    const offerCard = document.createElement('div');
    offerCard.className = 'offer-card';
    
    let statusDisplay = '';
    let statusClass = '';
    
    switch(offer.status) {
      case 'available':
        statusDisplay = '<div class="status-available">✅ متاح للحجز</div>';
        statusClass = 'available';
        break;
      case 'reserved':
        statusDisplay = '<div class="status-reserved">⏳ محجوز مؤقتاً</div>';
        statusClass = 'reserved';
        break;
      case 'sold':
        statusDisplay = '<div class="status-sold">✅ تم البيع</div>';
        statusClass = 'sold';
        break;
    }
    
    offerCard.innerHTML = `
      <div class="meal-type">${offer.type}</div>
      <div class="meal-price">${offer.price} ريال</div>
      ${offer.details && offer.details !== 'لم يتم إضافة تفاصيل' ? `<div class="meal-details">
        <span class="details-label">📝 تفاصيل الوجبة:</span>
        ${offer.details}
      </div>` : ''}
      <div style="text-align: center; margin: 1rem 0;">
        <span class="badge badge-${statusClass}">نُشر ${formatTimeAgo(offer.timestamp)}</span>
      </div>
      ${statusDisplay}
      ${offer.status === 'sold' && offer.buyerPhone ? `
        <div class="buyer-info">
          <div style="font-weight: 600; margin-bottom: 0.5rem;">📞 تم البيع لـ:</div>
          <div class="whatsapp-contact">
            <div class="contact-number">${offer.buyerPhone}</div>
            <button class="btn btn-whatsapp" onclick="window.open('${createWhatsAppLink(offer.buyerPhone, offer.type, offer.sellerName, offer.price)}', '_blank')">
              💬 محادثة واتساب
            </button>
          </div>
        </div>
      ` : ''}
      <div style="text-align: center; margin-top: 1.5rem;">
        ${offer.status === 'available' ? 
          `<button class="btn btn-danger" onclick="removeOffer('${offer.key}')">
            🗑️ حذف العرض
          </button>` : ''
        }
      </div>
    `;
    sellerOffers.appendChild(offerCard);
  });
}

async function loadSellerReservations() {
  if (!isAuthenticated()) return;
  
  showLoading();
  
  try {
    const response = await apiRequest(`${API_BASE}/offers/reservations`);
    if (!response) return;
    
    const data = await response.json();
    
    if (data.success) {
      displaySellerReservations(data.reservations);
    } else {
      showNotification('فشل في تحميل الحجوزات', 'error');
    }
  } catch (error) {
    console.error('خطأ في تحميل الحجوزات:', error);
    showNotification('حدث خطأ في تحميل الحجوزات', 'error');
  } finally {
    hideLoading();
  }
}

function displaySellerReservations(reservations) {
  reservationsList.innerHTML = '';
  
  if (!reservations || reservations.length === 0) {
    reservationsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <h3>لا توجد طلبات حجز</h3>
        <p>ستظهر هنا طلبات الحجز الجديدة لوجباتك</p>
      </div>
    `;
    return;
  }

  reservations.forEach((reservation) => {
    const reservationCard = document.createElement('div');
    reservationCard.className = 'reservation-card';
    
    reservationCard.innerHTML = `
      <div class="meal-type">${reservation.mealType}</div>
      <div class="meal-price">${reservation.price} ريال</div>
      ${reservation.details && reservation.details !== 'لم يتم إضافة تفاصيل' ? `<div class="meal-details">
        <span class="details-label">📝 تفاصيل الوجبة:</span>
        ${reservation.details}
      </div>` : ''}
      
      <div class="buyer-info">
        <div style="font-weight: 600; margin-bottom: 1rem; text-align: center;">
          🔔 طلب حجز جديد منذ ${formatTimeAgo(reservation.reservedAt)}
        </div>
        <div style="background: rgba(237, 137, 54, 0.1); padding: 1rem; border-radius: 10px; margin: 1rem 0; text-align: center;">
          <strong>👤 اسم المحجوز:</strong> ${reservation.reservedBy}
        </div>
        <div style="background: rgba(245, 101, 101, 0.1); padding: 1rem; border-radius: 10px; text-align: center; border: 2px dashed #f56565;">
          <div style="font-weight: 600; color: #f56565; margin-bottom: 0.5rem;">🔒 رقم المشتري محمي</div>
          <div style="font-size: 0.9rem; color: #718096;">سيظهر رقم المشتري بعد تأكيد الحجز</div>
        </div>
      </div>

      <div class="action-buttons">
        <button class="btn btn-success" onclick="confirmReservation('${reservation.key}', '${reservation.reservedBy}')">
          ✅ تأكيد الحجز
        </button>
        <button class="btn btn-danger" onclick="rejectReservation('${reservation.key}', '${reservation.reservedBy}')">
          ❌ رفض الحجز
        </button>
      </div>
    `;
    reservationsList.appendChild(reservationCard);
  });
}

async function confirmReservation(offerKey, buyerName) {
  if (confirm(`هل تريد تأكيد حجز ${buyerName} لهذه الوجبة؟`)) {
    showLoading();
    
    try {
      const response = await apiRequest(`${API_BASE}/offers/${offerKey}/confirm`, {
        method: 'POST'
      });

      if (!response) return;
      
      const data = await response.json();
      
      if (data.success) {
        showNotification(`تم تأكيد الحجز، اذهب إلى وجباتي! ✅`, "success");
        loadSellerReservations();
        loadSellerMeals();
      } else {
        showNotification(data.message || "حدث خطأ في تأكيد الحجز", "error");
      }
    } catch (error) {
      console.error("خطأ في تأكيد الحجز:", error);
      showNotification("حدث خطأ في تأكيد الحجز", "error");
    } finally {
      hideLoading();
    }
  }
}

async function rejectReservation(offerKey, buyerName) {
  if (confirm(`هل تريد رفض حجز ${buyerName} لهذه الوجبة؟`)) {
    showLoading();
    
    try {
      const response = await apiRequest(`${API_BASE}/offers/${offerKey}/reject`, {
        method: 'POST'
      });

      if (!response) return;
      
      const data = await response.json();
      
      if (data.success) {
        showNotification(`تم رفض الحجز. الوجبة متاحة الآن للحجز مجدداً 🔄`, "info");
        loadSellerReservations();
      } else {
        showNotification(data.message || "حدث خطأ في رفض الحجز", "error");
      }
    } catch (error) {
      console.error("خطأ في رفض الحجز:", error);
      showNotification("حدث خطأ في رفض الحجز", "error");
    } finally {
      hideLoading();
    }
  }
}

async function removeOffer(key) {
  if (confirm('هل أنت متأكد من حذف هذا العرض؟')) {
    showLoading();
    
    try {
      const response = await apiRequest(`${API_BASE}/offers/${key}`, {
        method: 'DELETE'
      });

      if (!response) return;
      
      const data = await response.json();
      
      if (data.success) {
        showNotification("تم حذف العرض بنجاح! 🗑️", "success");
        loadSellerMeals();
      } else {
        showNotification(data.message || "حدث خطأ في حذف العرض", "error");
      }
    } catch (error) {
      console.error("خطأ في حذف العرض:", error);
      showNotification("حدث خطأ في حذف العرض", "error");
    } finally {
      hideLoading();
    }
  }
}

// ============= Form Submit Handler =============
function setupEventListeners() {
  // Offer form submission
  offerForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    if (!isAuthenticated()) {
      pendingVerificationAction = () => offerForm.dispatchEvent(new Event('submit'));
      showVerificationModal();
      return;
    }
    
    const sellerName = document.getElementById('sellerName').value.trim();
    const mealType = document.getElementById('mealType').value;
    const price = parseFloat(document.getElementById('mealPrice').value);
    const details = document.getElementById('mealDetails').value.trim();
    
    // Client-side validation
    if (!price || price <= 0) {
      showNotification("يرجى إدخال سعر صحيح", "error");
      return;
    }
    
    if (!sellerName) {
      showNotification("يرجى إدخال اسم البائع", "error");
      return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.classList.add('btn-loading');
    submitBtn.disabled = true;
    
    try {
      const response = await apiRequest(`${API_BASE}/offers`, {
        method: 'POST',
        body: JSON.stringify({
          sellerName,
          mealType,
          price,
          details: details || undefined
        })
      });

      if (!response) return;
      
      const data = await response.json();
      
      if (data.success) {
        showNotification("تم نشر العرض بنجاح! ✅", "success");
        offerForm.reset();
        
        // Switch to my meals tab
        setTimeout(() => {
          showTab(null, 'my-meals');
          document.querySelector('[onclick*="my-meals"]').click();
        }, 1500);
      } else {
        showNotification(data.message || "حدث خطأ في نشر العرض", "error");
      }
    } catch (error) {
      console.error("خطأ في إضافة العرض:", error);
      showNotification("حدث خطأ في نشر العرض", "error");
    } finally {
      submitBtn.innerHTML = originalText;
      submitBtn.classList.remove('btn-loading');
      submitBtn.disabled = false;
    }
  });

  // Phone input formatting for verification
  const phoneInput = document.getElementById('verifyPhoneInput');
  if (phoneInput) {
    phoneInput.addEventListener('input', function(e) {
      let value = e.target.value.replace(/\D/g, '');
      if (value.length > 10) value = value.substring(0, 10);
      e.target.value = value;
      
      if (value.length >= 8) {
        hideVerifyError('verifyError1');
      }
    });
    
    phoneInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        sendVerificationCode();
      }
    });
  }
  
  // Code input formatting
  const codeInput = document.getElementById('verifyCodeInput');
  if (codeInput) {
    codeInput.addEventListener('input', function(e) {
      let value = e.target.value.replace(/\D/g, '');
      if (value.length > 6) value = value.substring(0, 6);
      e.target.value = value;
      
      if (value.length === 6) {
        hideVerifyError('verifyError2');
        setTimeout(() => verifyCode(), 800);
      }
    });
    
    codeInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter' && e.target.value.length === 6) {
        verifyCode();
      }
    });
    
    codeInput.addEventListener('paste', function(e) {
      e.preventDefault();
      const paste = (e.clipboardData || window.clipboardData).getData('text');
      const digits = paste.replace(/\D/g, '').substring(0, 6);
      e.target.value = digits;
      
      if (digits.length === 6) {
        setTimeout(() => verifyCode(), 500);
      }
    });
  }

  // Rating stars click events
  const ratingStars = document.querySelectorAll('.rating-stars span');
  ratingStars.forEach(star => {
    star.addEventListener('click', function() {
      selectedRating = parseInt(this.dataset.rating);
      updateRatingDisplay();
    });
    
    star.addEventListener('mouseenter', function() {
      const rating = parseInt(this.dataset.rating);
      ratingStars.forEach((s, index) => {
        s.style.color = index < rating ? '#ffd700' : '#ddd';
      });
    });
  });
  
  document.querySelector('.rating-stars').addEventListener('mouseleave', function() {
    updateRatingDisplay();
  });

  // Close modals when clicking outside
  window.onclick = function(event) {
    const verificationModal = document.getElementById('phoneVerificationModal');
    if (event.target === verificationModal) {
      closeVerificationModal();
    }
    if (event.target === ratingModal) {
      closeRatingModal();
    }
  };

  // Close modals with ESC key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeVerificationModal();
      closeRatingModal();
    }
  });
}

// ============= Rating System =============
function showRatingModal(offerKey, sellerName) {
  currentRatingOffer = offerKey;
  document.querySelector('#ratingModal h3').textContent = `قيم تجربتك مع البائع ${sellerName}`;
  selectedRating = 0;
  updateRatingDisplay();
  ratingModal.style.display = 'block';
}

function updateRatingDisplay() {
  const stars = document.querySelectorAll('.rating-stars span');
  const ratingText = document.getElementById('ratingText');
  
  stars.forEach((star, index) => {
    star.classList.toggle('active', index < selectedRating);
  });
  
  const ratingLabels = ['', 'ضعيف جداً', 'ضعيف', 'جيد', 'ممتاز', 'رائع'];
  ratingText.textContent = selectedRating > 0 ? 
    `${selectedRating}/5 - ${ratingLabels[selectedRating]}` : 
    'اختر التقييم';
}

async function submitRating() {
  if (selectedRating === 0) {
    showNotification("يرجى اختيار تقييم أولاً", "error");
    return;
  }
  
  if (!currentRatingOffer) return;
  
  showLoading();
  
  try {
    const response = await apiRequest(`${API_BASE}/ratings`, {
      method: 'POST',
      body: JSON.stringify({
        sellerId: 'temp', // Will be extracted from offer
        rating: selectedRating,
        offerKey: currentRatingOffer
      })
    });

    if (!response) return;
    
    const data = await response.json();
    
    if (data.success) {
      showNotification(`تم إضافة تقييمك: ${selectedRating}/5 نجوم! شكراً لك 🌟`, "success");
      closeRatingModal();
      loadOffers();
    } else {
      showNotification(data.message || "حدث خطأ في إضافة التقييم", "error");
    }
  } catch (error) {
    console.error("خطأ في إضافة التقييم:", error);
    showNotification("حدث خطأ في إضافة التقييم", "error");
  } finally {
    hideLoading();
  }
}

function closeRatingModal() {
  ratingModal.style.display = 'none';
  currentRatingOffer = null;
  selectedRating = 0;
}

// ============= Notifications =============
async function loadNotifications() {
  if (!isAuthenticated()) return;
  
  try {
    const response = await apiRequest(`${API_BASE}/notifications?limit=20`);
    if (!response) return;
    
    const data = await response.json();
    
    if (data.success) {
      displayNotifications(data.notifications, data.unreadCount);
    }
  } catch (error) {
    console.error('خطأ في تحميل الإشعارات:', error);
  }
}

function displayNotifications(notifications, unreadCount) {
  notificationsList.innerHTML = '';
  
  // Update tab badge
  const notificationsTab = document.querySelector('[onclick*="notifications"]');
  if (notificationsTab && unreadCount > 0) {
    notificationsTab.innerHTML = `🔔 الإشعارات <span style="background: red; color: white; border-radius: 10px; padding: 2px 6px; font-size: 0.8rem;">${unreadCount}</span>`;
  }
  
  if (!notifications || notifications.length === 0) {
    notificationsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔔</div>
        <h3>لا توجد إشعارات</h3>
        <p>ستظهر هنا الإشعارات الجديدة</p>
      </div>
    `;
    return;
  }

  notifications.forEach((notification) => {
    const notificationItem = document.createElement('div');
    notificationItem.className = `notification-item ${!notification.isRead ? 'unread' : ''}`;
    
    notificationItem.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
        <div style="font-weight: 700; color: #667eea;">${notification.title}</div>
        <div style="font-size: 0.8rem; color: #718096;">${formatTimeAgo(notification.createdAt)}</div>
      </div>
      <div style="margin-bottom: 1rem; line-height: 1.5;">${notification.message}</div>
      ${!notification.isRead ? `
        <div style="text-align: center;">
          <button class="btn" style="max-width: 150px; padding: 0.5rem 1rem; font-size: 0.9rem;" onclick="markNotificationRead('${notification.id}')">
            تحديد كمقروء
          </button>
        </div>
      ` : ''}
    `;
    notificationsList.appendChild(notificationItem);
  });
}

async function markNotificationRead(notificationId) {
  try {
    const response = await apiRequest(`${API_BASE}/notifications/${notificationId}/read`, {
      method: 'PUT'
    });

    if (response && response.ok) {
      loadNotifications();
    }
  } catch (error) {
    console.error('خطأ في تحديث الإشعار:', error);
  }
}

// ============= Utility Functions =============
function validatePhoneNumber(phone) {
  const phoneRegex = /^\d{10}$/;
  return phoneRegex.test(phone) && phone.startsWith('05');
}

function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diffMinutes = Math.floor((now - timestamp) / (1000 * 60));
  
  if (diffMinutes < 1) return 'الآن';
  if (diffMinutes < 60) return `منذ ${diffMinutes} دقيقة`;
  if (diffMinutes < 1440) return `منذ ${Math.floor(diffMinutes / 60)} ساعة`;
  return `منذ ${Math.floor(diffMinutes / 1440)} يوم`;
}

function displayRatingStars(rating, count = 0) {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  let starsHtml = '';
  
  for (let i = 0; i < 5; i++) {
    if (i < fullStars) {
      starsHtml += '⭐';
    } else if (i === fullStars && hasHalfStar) {
      starsHtml += '🌟';
    } else {
      starsHtml += '☆';
    }
  }
  
  return `<span class="stars">${starsHtml}</span><span class="rating-text">${rating}/5 (${count} تقييم)</span>`;
}

function createWhatsAppLink(phoneNumber, mealType, sellerName, price) {
  const message = `السلام عليكم ورحمة الله وبركاته
🍽️ أبيع وجبة ${mealType} إليك
💰 السعر: ${price} ريال
📱 تم التواصل عبر منصة وجبتي

شكراً لك 😊`;
  
  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/966${phoneNumber.substring(1)}?text=${encodedMessage}`;
}

function showNotification(message, type = 'success') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideInUp 0.5s ease-out reverse';
    setTimeout(() => notification.remove(), 500);
  }, 4000);
}

function showLoading() {
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

// Theme management
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  
  document.documentElement.setAttribute('data-theme', newTheme);
  document.getElementById('themeIcon').textContent = newTheme === 'dark' ? '☀️' : '🌙';
  
  localStorage.setItem('preferred-theme', newTheme);
}

function initTheme() {
  const savedTheme = localStorage.getItem('preferred-theme');
  const defaultTheme = savedTheme || 'light';
  document.documentElement.setAttribute('data-theme', defaultTheme);
  document.getElementById('themeIcon').textContent = defaultTheme === 'dark' ? '☀️' : '🌙';
}

// Make functions available globally
window.showSeller = showSeller;
window.showBuyer = showBuyer;
window.goHome = goHome;
window.showTab = showTab;
window.toggleTheme = toggleTheme;
window.closeVerificationModal = closeVerificationModal;
window.sendVerificationCode = sendVerificationCode;
window.verifyCode = verifyCode;
window.goToVerifyStep1 = goToVerifyStep1;
window.resendCode = resendCode;
window.proceedAfterVerification = proceedAfterVerification;
window.reserveMeal = reserveMeal;
window.confirmReservation = confirmReservation;
window.rejectReservation = rejectReservation;
window.removeOffer = removeOffer;
window.submitRating = submitRating;
window.closeRatingModal = closeRatingModal;
window.markNotificationRead = markNotificationRead;