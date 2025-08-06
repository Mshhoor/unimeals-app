const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const Database = require('../config/database');
const { generateSellerId, generateVerificationCode, sendSMS, authenticateToken } = require('../utils/helpers');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// التحقق من رقم الهاتف
router.post('/verify-phone', [
  body('phone').matches(/^05\d{8}$/).withMessage('رقم الهاتف يجب أن يبدأ بـ 05 ويتكون من 10 أرقام')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صحيحة',
        errors: errors.array()
      });
    }

    const { phone } = req.body;
    const code = generateVerificationCode();
    const expiresAt = Math.floor(Date.now() / 1000) + (5 * 60); // 5 minutes

    // حذف الجلسات السابقة لنفس الرقم
    await Database.run('DELETE FROM verification_sessions WHERE phone = ?', [phone]);

    // إنشاء جلسة تحقق جديدة
    await Database.run(`
      INSERT INTO verification_sessions (phone, code, expires_at)
      VALUES (?, ?, ?)
    `, [phone, code, expiresAt]);

    // محاكاة إرسال SMS (في الإنتاج، استخدم خدمة SMS حقيقية)
    const smsResult = await sendSMS(phone, `كود التحقق لمنصة وجبتي: ${code}\nالكود صالح لمدة 5 دقائق`);

    res.json({
      success: true,
      message: 'تم إرسال كود التحقق',
      // في البيئة التطويرية، نعرض الكود
      ...(process.env.NODE_ENV === 'development' && { code })
    });

  } catch (error) {
    console.error('خطأ في إرسال كود التحقق:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في إرسال كود التحقق'
    });
  }
});

// تأكيد كود التحقق
router.post('/verify-code', [
  body('phone').matches(/^05\d{8}$/).withMessage('رقم الهاتف غير صحيح'),
  body('code').isLength({ min: 4, max: 6 }).withMessage('كود التحقق يجب أن يكون من 4-6 أرقام')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صحيحة',
        errors: errors.array()
      });
    }

    const { phone, code } = req.body;
    const currentTime = Math.floor(Date.now() / 1000);

    // البحث عن جلسة التحقق
    const session = await Database.get(`
      SELECT * FROM verification_sessions 
      WHERE phone = ? AND code = ? AND expires_at > ? AND is_used = 0
      ORDER BY created_at DESC LIMIT 1
    `, [phone, code, currentTime]);

    if (!session) {
      // زيادة عدد المحاولات
      await Database.run(`
        UPDATE verification_sessions 
        SET attempts = attempts + 1 
        WHERE phone = ? AND expires_at > ?
      `, [phone, currentTime]);

      return res.status(400).json({
        success: false,
        message: 'كود التحقق غير صحيح أو منتهي الصلاحية'
      });
    }

    // تحديث الجلسة كمستخدمة
    await Database.run('UPDATE verification_sessions SET is_used = 1 WHERE id = ?', [session.id]);

    // البحث عن المستخدم أو إنشاء جديد
    let user = await Database.get('SELECT * FROM users WHERE phone = ?', [phone]);
    
    if (!user) {
      const sellerId = generateSellerId(phone);
      const result = await Database.run(`
        INSERT INTO users (phone, seller_id, is_verified)
        VALUES (?, ?, 1)
      `, [phone, sellerId]);
      
      user = await Database.get('SELECT * FROM users WHERE id = ?', [result.id]);
    } else {
      // تحديث حالة التحقق
      await Database.run('UPDATE users SET is_verified = 1 WHERE id = ?', [user.id]);
      user.is_verified = 1;
    }

    // إنشاء JWT token
    const token = jwt.sign(
      { userId: user.id, phone: user.phone, sellerId: user.seller_id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'تم التحقق بنجاح',
      user: {
        id: user.id,
        phone: user.phone,
        sellerId: user.seller_id,
        isVerified: true
      },
      token
    });

  } catch (error) {
    console.error('خطأ في تأكيد الكود:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في التحقق من الكود'
    });
  }
});

// التحقق من صحة التوكن
router.post('/verify-token', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'لم يتم تمرير رمز المصادقة'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await Database.get('SELECT * FROM users WHERE id = ?', [decoded.userId]);

    if (!user || !user.is_verified) {
      return res.status(401).json({
        success: false,
        message: 'رمز المصادقة غير صحيح'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        sellerId: user.seller_id,
        isVerified: user.is_verified
      }
    });

  } catch (error) {
    console.error('خطأ في التحقق من التوكن:', error);
    res.status(401).json({
      success: false,
      message: 'رمز المصادقة غير صالح'
    });
  }
});

// Middleware للتحقق من المصادقة - تم نقله إلى utils/helpers.js

// تحديث اسم المستخدم
router.put('/update-profile', authenticateToken, [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('الاسم يجب أن يكون من 2-50 حرف')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صحيحة',
        errors: errors.array()
      });
    }

    const { name } = req.body;
    
    await Database.run('UPDATE users SET name = ? WHERE id = ?', [name, req.user.id]);

    res.json({
      success: true,
      message: 'تم تحديث الملف الشخصي',
      user: {
        ...req.user,
        name
      }
    });

  } catch (error) {
    console.error('خطأ في تحديث الملف الشخصي:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في التحديث'
    });
  }
});

module.exports = router;