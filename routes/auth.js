const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const Database = require('../config/database');
const { generateSellerId, authenticateToken, validateSaudiPhone } = require('../utils/helpers');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// تسجيل حساب جديد
router.post('/signup', [
  body('username').trim().isLength({ min: 2, max: 50 }).withMessage('اسم المستخدم يجب أن يكون من 2-50 حرف'),
  body('email').isEmail().normalizeEmail().withMessage('البريد الإلكتروني غير صحيح'),
  body('password').isLength({ min: 6 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل')
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

    const { username, email, password } = req.body;

    // التحقق من عدم وجود المستخدم
    const existingUser = await Database.get(
      'SELECT id FROM users WHERE username = ? OR email = ?', 
      [username, email]
    );

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'اسم المستخدم أو البريد الإلكتروني مستخدم بالفعل'
      });
    }

    // تشفير كلمة المرور
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // إنشاء معرف البائع
    const sellerId = generateSellerId(email + username);

    // إدراج المستخدم الجديد
    const result = await Database.run(`
      INSERT INTO users (username, email, password_hash, seller_id)
      VALUES (?, ?, ?, ?)
    `, [username, email, passwordHash, sellerId]);

    // إنشاء JWT token
    const token = jwt.sign(
      { 
        userId: result.id, 
        username, 
        email,
        sellerId 
      },
      JWT_SECRET,
      { expiresIn: process.env.TOKEN_EXPIRY || '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'تم إنشاء الحساب بنجاح',
      user: {
        id: result.id,
        username,
        email,
        sellerId,
        phoneVerified: false
      },
      token
    });

  } catch (error) {
    console.error('خطأ في إنشاء الحساب:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في إنشاء الحساب'
    });
  }
});

// تسجيل الدخول
router.post('/signin', [
  body('email').isEmail().normalizeEmail().withMessage('البريد الإلكتروني غير صحيح'),
  body('password').notEmpty().withMessage('كلمة المرور مطلوبة')
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

    const { email, password } = req.body;

    // البحث عن المستخدم
    const user = await Database.get('SELECT * FROM users WHERE email = ?', [email]);

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
      });
    }

    // التحقق من كلمة المرور
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
      });
    }

    // إنشاء JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username,
        email: user.email,
        sellerId: user.seller_id
      },
      JWT_SECRET,
      { expiresIn: process.env.TOKEN_EXPIRY || '7d' }
    );

    res.json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        sellerId: user.seller_id,
        phone: user.phone,
        phoneVerified: user.phone_verified === 1
      },
      token
    });

  } catch (error) {
    console.error('خطأ في تسجيل الدخول:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في تسجيل الدخول'
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

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'رمز المصادقة غير صحيح'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        sellerId: user.seller_id,
        phone: user.phone,
        phoneVerified: user.phone_verified === 1
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

// إضافة/تحديث رقم الجوال
router.post('/add-phone', authenticateToken, [
  body('phone').matches(/^05\d{8}$/).withMessage('رقم الهاتف يجب أن يبدأ بـ 05 ويتكون من 10 أرقام')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'رقم الهاتف غير صحيح',
        errors: errors.array()
      });
    }

    const { phone } = req.body;

    // التحقق من عدم استخدام الرقم من قبل مستخدم آخر
    const existingPhone = await Database.get(
      'SELECT id FROM users WHERE phone = ? AND id != ?', 
      [phone, req.user.id]
    );

    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: 'رقم الجوال مستخدم بالفعل من قبل مستخدم آخر'
      });
    }

    // تحديث رقم الجوال
    await Database.run(
      'UPDATE users SET phone = ?, phone_verified = 1, updated_at = strftime(\'%s\', \'now\') WHERE id = ?',
      [phone, req.user.id]
    );

    res.json({
      success: true,
      message: 'تم إضافة رقم الجوال بنجاح',
      phone: phone
    });

  } catch (error) {
    console.error('خطأ في إضافة رقم الجوال:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في إضافة رقم الجوال'
    });
  }
});

// تحديث الملف الشخصي
router.put('/update-profile', authenticateToken, [
  body('username').optional().trim().isLength({ min: 2, max: 50 }).withMessage('اسم المستخدم يجب أن يكون من 2-50 حرف'),
  body('email').optional().isEmail().normalizeEmail().withMessage('البريد الإلكتروني غير صحيح')
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

    const { username, email } = req.body;
    const updates = [];
    const params = [];

    if (username) {
      // التحقق من عدم وجود اسم المستخدم
      const existingUser = await Database.get(
        'SELECT id FROM users WHERE username = ? AND id != ?', 
        [username, req.user.id]
      );
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'اسم المستخدم مستخدم بالفعل'
        });
      }

      updates.push('username = ?');
      params.push(username);
    }

    if (email) {
      // التحقق من عدم وجود البريد
      const existingEmail = await Database.get(
        'SELECT id FROM users WHERE email = ? AND id != ?', 
        [email, req.user.id]
      );
      
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: 'البريد الإلكتروني مستخدم بالفعل'
        });
      }

      updates.push('email = ?');
      params.push(email);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'لا توجد بيانات للتحديث'
      });
    }

    updates.push('updated_at = strftime(\'%s\', \'now\')');
    params.push(req.user.id);

    await Database.run(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // إرجاع البيانات المحدثة
    const updatedUser = await Database.get('SELECT * FROM users WHERE id = ?', [req.user.id]);

    res.json({
      success: true,
      message: 'تم تحديث الملف الشخصي',
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        sellerId: updatedUser.seller_id,
        phone: updatedUser.phone,
        phoneVerified: updatedUser.phone_verified === 1
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

// تغيير كلمة المرور
router.post('/change-password', authenticateToken, [
  body('currentPassword').notEmpty().withMessage('كلمة المرور الحالية مطلوبة'),
  body('newPassword').isLength({ min: 6 }).withMessage('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل')
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

    const { currentPassword, newPassword } = req.body;

    // التحقق من كلمة المرور الحالية
    const user = await Database.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);

    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: 'كلمة المرور الحالية غير صحيحة'
      });
    }

    // تشفير كلمة المرور الجديدة
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // تحديث كلمة المرور
    await Database.run(
      'UPDATE users SET password_hash = ?, updated_at = strftime(\'%s\', \'now\') WHERE id = ?',
      [newPasswordHash, req.user.id]
    );

    res.json({
      success: true,
      message: 'تم تغيير كلمة المرور بنجاح'
    });

  } catch (error) {
    console.error('خطأ في تغيير كلمة المرور:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في تغيير كلمة المرور'
    });
  }
});

// تسجيل الخروج
router.post('/signout', (req, res) => {
  // في هذا التطبيق، التوكن يُحفظ في localStorage فقط
  // لذا تسجيل الخروج يحدث في الواجهة الأمامية
  res.json({
    success: true,
    message: 'تم تسجيل الخروج بنجاح'
  });
});

module.exports = router;