const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const Database = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// توليد معرف البائع من البريد واسم المستخدم
function generateSellerId(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // تحويل إلى 32bit integer
  }
  return Math.abs(hash).toString();
}

// توليد معرف العرض
function generateOfferId() {
  return 'offer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// توليد معرف المشتري
function generateBuyerId() {
  return 'buyer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// توليد كود التحقق
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 أرقام
}

// محاكاة إرسال SMS (في الإنتاج، استبدل بخدمة حقيقية)
async function sendSMS(phoneNumber, message) {
  return new Promise((resolve) => {
    console.log(`📱 إرسال SMS إلى ${phoneNumber}:`);
    console.log(`💬 ${message}`);
    
    // محاكاة تأخير الشبكة
    setTimeout(() => {
      resolve({
        success: true,
        messageId: uuidv4(),
        timestamp: Date.now()
      });
    }, 1000);
  });
}

// تنسيق الوقت النسبي
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diffMinutes = Math.floor((now - timestamp) / (1000 * 60));
  
  if (diffMinutes < 1) return 'الآن';
  if (diffMinutes < 60) return `منذ ${diffMinutes} دقيقة`;
  if (diffMinutes < 1440) return `منذ ${Math.floor(diffMinutes / 60)} ساعة`;
  return `منذ ${Math.floor(diffMinutes / 1440)} يوم`;
}

// التحقق من صحة رقم الهاتف السعودي
function validateSaudiPhone(phone) {
  const phoneRegex = /^05[0-9]{8}$/;
  return phoneRegex.test(phone);
}

// تنسيق رقم الهاتف للعرض
function formatPhoneNumber(phone) {
  if (phone && phone.length === 10 && phone.startsWith('05')) {
    return phone.replace(/(\d{2})(\d{4})(\d{4})/, '$1 $2 $3');
  }
  return phone;
}

// إخفاء جزء من رقم الهاتف
function maskPhoneNumber(phone) {
  if (phone && phone.length === 10) {
    return phone.substring(0, 3) + 'XXXX' + phone.substring(7);
  }
  return 'XXXXXXXXXX';
}

// تنظيف النص من المحارف الخطيرة
function sanitizeText(text) {
  if (!text) return '';
  return text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
             .replace(/[<>]/g, '')
             .trim();
}

// إنشاء رابط واتساب
function createWhatsAppLink(phoneNumber, message) {
  const cleanPhone = phoneNumber.startsWith('0') ? '966' + phoneNumber.substring(1) : phoneNumber;
  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
}

// حساب التقييم المتوسط
function calculateAverageRating(ratings) {
  if (!ratings || ratings.length === 0) return 0;
  const sum = ratings.reduce((acc, rating) => acc + rating, 0);
  return (sum / ratings.length).toFixed(1);
}

// تحويل التقييم إلى نجوم
function ratingsToStars(rating) {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  let stars = '';
  
  for (let i = 0; i < 5; i++) {
    if (i < fullStars) {
      stars += '⭐';
    } else if (i === fullStars && hasHalfStar) {
      stars += '🌟';
    } else {
      stars += '☆';
    }
  }
  
  return stars;
}

// إنشاء hash بسيط للأمان
function createSimpleHash(input) {
  let hash = 0;
  if (input.length === 0) return hash.toString();
  
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  return Math.abs(hash).toString();
}

// تحديد نوع الوجبة بناء على الوقت
function suggestMealType() {
  const hour = new Date().getHours();
  
  if (hour >= 5 && hour < 11) return 'فطور';
  if (hour >= 11 && hour < 16) return 'غداء';
  return 'عشاء';
}

// التحقق من صحة السعر
function validatePrice(price) {
  const numPrice = parseFloat(price);
  return !isNaN(numPrice) && numPrice >= 0.5 && numPrice <= 1000;
}

// تحويل الأرقام العربية إلى إنجليزية
function arabicToEnglishNumbers(str) {
  const arabicNumbers = '٠١٢٣٤٥٦٧٨٩';
  const englishNumbers = '0123456789';
  
  return str.replace(/[٠-٩]/g, (match) => {
    return englishNumbers[arabicNumbers.indexOf(match)];
  });
}

// تحويل الأرقام الإنجليزية إلى عربية
function englishToArabicNumbers(str) {
  const arabicNumbers = '٠١٢٣٤٥٦٧٨٩';
  const englishNumbers = '0123456789';
  
  return str.replace(/[0-9]/g, (match) => {
    return arabicNumbers[englishNumbers.indexOf(match)];
  });
}

// إنشاء معرف جلسة فريد
function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 12);
}

// التحقق من انتهاء صلاحية التوقيت
function isExpired(timestamp, durationInMinutes) {
  const now = Math.floor(Date.now() / 1000);
  const expireTime = timestamp + (durationInMinutes * 60);
  return now > expireTime;
}

// تنسيق التاريخ بالعربية
function formatArabicDate(timestamp) {
  const date = new Date(timestamp);
  const arabicMonths = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  
  const day = date.getDate();
  const month = arabicMonths[date.getMonth()];
  const year = date.getFullYear();
  
  return `${day} ${month} ${year}`;
}

// تنظيم لوج الأخطاء
function logError(error, context = '') {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] خطأ في ${context}:`, error);
  
  // في الإنتاج، يمكنك إرسال الأخطاء إلى خدمة مراقبة
  // مثل Sentry أو LogRocket
}

// إنشاء استجابة API موحدة
function createResponse(success, message, data = null, errors = null) {
  const response = {
    success,
    message,
    timestamp: Date.now()
  };
  
  if (data) response.data = data;
  if (errors) response.errors = errors;
  
  return response;
}

// Middleware للتحقق من المصادقة
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'رمز المصادقة مطلوب'
    });
  }

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'رمز المصادقة غير صالح'
      });
    }

    try {
      const user = await Database.get('SELECT * FROM users WHERE id = ?', [decoded.userId]);
      if (!user) {
        return res.status(403).json({
          success: false,
          message: 'المستخدم غير موجود'
        });
      }

      req.user = user;
      next();
    } catch (error) {
      console.error('خطأ في التحقق من المستخدم:', error);
      return res.status(500).json({
        success: false,
        message: 'خطأ في التحقق من المصادقة'
      });
    }
  });
};

module.exports = {
  generateSellerId,
  generateOfferId,
  generateBuyerId,
  generateVerificationCode,
  generateSessionId,
  sendSMS,
  formatTimeAgo,
  validateSaudiPhone,
  formatPhoneNumber,
  maskPhoneNumber,
  sanitizeText,
  createWhatsAppLink,
  calculateAverageRating,
  ratingsToStars,
  createSimpleHash,
  suggestMealType,
  validatePrice,
  arabicToEnglishNumbers,
  englishToArabicNumbers,
  isExpired,
  formatArabicDate,
  logError,
  createResponse,
  authenticateToken
};