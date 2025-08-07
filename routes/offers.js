const express = require('express');
const { body, validationResult } = require('express-validator');
const Database = require('../config/database');
const { authenticateToken, generateOfferId, generateBuyerId } = require('../utils/helpers');

const router = express.Router();

// جلب جميع العروض المتاحة
router.get('/', async (req, res) => {
  try {
    const offers = await Database.all(`
      SELECT 
        o.*,
        (
          SELECT AVG(rating) 
          FROM ratings 
          WHERE seller_id = o.seller_id
        ) as avg_rating,
        (
          SELECT COUNT(*) 
          FROM ratings 
          WHERE seller_id = o.seller_id
        ) as rating_count
      FROM offers o
      WHERE o.status IN ('available', 'reserved', 'sold')
      ORDER BY o.created_at DESC
    `);

    // تحويل التوقيتات إلى milliseconds للتوافق مع الواجهة الأمامية
    const formattedOffers = offers.map(offer => ({
      key: offer.key,
      sellerName: offer.seller_name,
      sellerId: offer.seller_id,
      type: offer.meal_type,
      price: offer.price,
      details: offer.details || 'لم يتم إضافة تفاصيل',
      phone: offer.seller_phone,
      status: offer.status,
      reservedBy: offer.reserved_by,
      buyerPhone: offer.reserved_by_phone,
      timestamp: offer.created_at * 1000, // convert to milliseconds
      reservedAt: offer.reserved_at ? offer.reserved_at * 1000 : null,
      avgRating: offer.avg_rating ? parseFloat(offer.avg_rating).toFixed(1) : 0,
      ratingCount: offer.rating_count || 0
    }));

    res.json({
      success: true,
      offers: formattedOffers
    });

  } catch (error) {
    console.error('خطأ في جلب العروض:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في جلب العروض'
    });
  }
});

// إضافة عرض جديد
router.post('/', authenticateToken, [
  body('mealType').isIn(['فطور', 'غداء', 'عشاء']).withMessage('نوع الوجبة غير صحيح'),
  body('price').isFloat({ min: 0.5, max: 1000 }).withMessage('السعر يجب أن يكون بين 0.5 و 1000 ريال'),
  body('details').optional().trim().isLength({ max: 500 }).withMessage('التفاصيل لا يجب أن تتجاوز 500 حرف')
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

    // التحقق من وجود رقم الجوال
    if (!req.user.phone) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إضافة رقم الجوال أولاً من الملف الشخصي'
      });
    }

    const { sellerName, mealType, price, details } = req.body;
    const offerKey = generateOfferId();

    const result = await Database.run(`
      INSERT INTO offers (
        key, seller_id, seller_name, seller_phone, 
        meal_type, price, details, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'available')
    `, [
      offerKey, req.user.seller_id, sellerName || req.user.username, req.user.phone,
      mealType, price, details || null
    ]);

    // إرسال إشعار مباشر عبر Socket.IO
    const io = req.app.get('io');
    io.emit('new_offer', {
      key: offerKey,
      sellerName: sellerName || req.user.username,
      type: mealType,
      price,
      details: details || 'لم يتم إضافة تفاصيل',
      timestamp: Date.now()
    });

    res.json({
      success: true,
      message: 'تم إضافة العرض بنجاح',
      offer: {
        key: offerKey,
        id: result.id
      }
    });

  } catch (error) {
    console.error('خطأ في إضافة العرض:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في إضافة العرض'
    });
  }
});

// جلب عروض البائع
router.get('/my-offers', authenticateToken, async (req, res) => {
  try {
    const offers = await Database.all(`
      SELECT * FROM offers 
      WHERE seller_phone = ? 
      ORDER BY created_at DESC
    `, [req.user.phone]);

    const formattedOffers = offers.map(offer => ({
      key: offer.key,
      sellerName: offer.seller_name,
      type: offer.meal_type,
      price: offer.price,
      details: offer.details,
      status: offer.status,
      reservedBy: offer.reserved_by,
      buyerPhone: offer.reserved_by_phone,
      timestamp: offer.created_at * 1000,
      reservedAt: offer.reserved_at ? offer.reserved_at * 1000 : null,
      confirmedAt: offer.confirmed_at ? offer.confirmed_at * 1000 : null
    }));

    res.json({
      success: true,
      offers: formattedOffers
    });

  } catch (error) {
    console.error('خطأ في جلب عروض البائع:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في جلب عروضك'
    });
  }
});

// حجز وجبة
router.post('/:offerKey/reserve', [
  body('buyerName').trim().isLength({ min: 2, max: 50 }).withMessage('اسم المشتري يجب أن يكون من 2-50 حرف'),
  body('buyerPhone').matches(/^05\d{8}$/).withMessage('رقم الهاتف يجب أن يبدأ بـ 05 ويتكون من 10 أرقام')
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

    const { offerKey } = req.params;
    const { buyerName, buyerPhone } = req.body;
    const buyerId = generateBuyerId();

    // التحقق من وجود العرض وحالته
    const offer = await Database.get('SELECT * FROM offers WHERE key = ?', [offerKey]);
    
    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'العرض غير موجود'
      });
    }

    if (offer.status !== 'available') {
      return res.status(400).json({
        success: false,
        message: 'العرض غير متاح للحجز'
      });
    }

    // تحديث حالة العرض إلى محجوز
    await Database.run(`
      UPDATE offers 
      SET status = 'reserved', 
          reserved_by = ?, 
          reserved_by_phone = ?, 
          buyer_id = ?,
          reserved_at = strftime('%s', 'now')
      WHERE key = ? AND status = 'available'
    `, [buyerName, buyerPhone, buyerId, offerKey]);

    // إرسال إشعار للبائع
    const io = req.app.get('io');
    io.to(`seller_${offer.seller_id}`).emit('new_reservation', {
      offerKey,
      buyerName,
      mealType: offer.meal_type,
      price: offer.price,
      timestamp: Date.now()
    });

    // إضافة إشعار في قاعدة البيانات
    await Database.run(`
      INSERT INTO notifications (type, recipient_type, recipient_id, title, message, data)
      VALUES (?, 'seller', ?, ?, ?, ?)
    `, [
      'new_reservation',
      offer.seller_id,
      'طلب حجز جديد',
      `لديك طلب حجز جديد من ${buyerName} لوجبة ${offer.meal_type}`,
      JSON.stringify({ offerKey, buyerId, buyerName, buyerPhone })
    ]);

    res.json({
      success: true,
      message: 'تم حجز الوجبة بنجاح',
      reservation: {
        buyerId,
        status: 'pending'
      }
    });

  } catch (error) {
    console.error('خطأ في حجز الوجبة:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في حجز الوجبة'
    });
  }
});

// تأكيد الحجز (للبائع)
router.post('/:offerKey/confirm', authenticateToken, async (req, res) => {
  try {
    const { offerKey } = req.params;
    
    const offer = await Database.get(`
      SELECT * FROM offers 
      WHERE key = ? AND seller_phone = ? AND status = 'reserved'
    `, [offerKey, req.user.phone]);

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'العرض غير موجود أو غير قابل للتأكيد'
      });
    }

    // تحديث حالة العرض إلى مباع
    await Database.run(`
      UPDATE offers 
      SET status = 'sold', confirmed_at = strftime('%s', 'now')
      WHERE key = ?
    `, [offerKey]);

    // إرسال إشعار للمشتري
    const io = req.app.get('io');
    io.to(`buyer_${offer.buyer_id}`).emit('reservation_confirmed', {
      offerKey,
      sellerName: offer.seller_name,
      sellerPhone: offer.seller_phone,
      mealType: offer.meal_type,
      price: offer.price
    });

    // إضافة إشعار للمشتري
    await Database.run(`
      INSERT INTO notifications (type, recipient_type, recipient_id, title, message, data)
      VALUES (?, 'buyer', ?, ?, ?, ?)
    `, [
      'reservation_confirmed',
      offer.buyer_id,
      'تم تأكيد حجزك',
      `تم تأكيد حجز وجبة ${offer.meal_type} من ${offer.seller_name}`,
      JSON.stringify({ 
        offerKey, 
        sellerName: offer.seller_name,
        sellerPhone: offer.seller_phone,
        mealType: offer.meal_type,
        price: offer.price
      })
    ]);

    res.json({
      success: true,
      message: 'تم تأكيد الحجز بنجاح'
    });

  } catch (error) {
    console.error('خطأ في تأكيد الحجز:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في تأكيد الحجز'
    });
  }
});

// رفض الحجز (للبائع)
router.post('/:offerKey/reject', authenticateToken, async (req, res) => {
  try {
    const { offerKey } = req.params;
    
    const offer = await Database.get(`
      SELECT * FROM offers 
      WHERE key = ? AND seller_phone = ? AND status = 'reserved'
    `, [offerKey, req.user.phone]);

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'العرض غير موجود أو غير قابل للرفض'
      });
    }

    // إعادة العرض إلى حالة متاح
    await Database.run(`
      UPDATE offers 
      SET status = 'available', 
          reserved_by = NULL,
          reserved_by_phone = NULL,
          buyer_id = NULL,
          reserved_at = NULL,
          rejected_at = strftime('%s', 'now')
      WHERE key = ?
    `, [offerKey]);

    // إرسال إشعار للمشتري
    const io = req.app.get('io');
    io.to(`buyer_${offer.buyer_id}`).emit('reservation_rejected', {
      offerKey,
      sellerName: offer.seller_name,
      mealType: offer.meal_type,
      price: offer.price
    });

    // إضافة إشعار للمشتري
    await Database.run(`
      INSERT INTO notifications (type, recipient_type, recipient_id, title, message, data)
      VALUES (?, 'buyer', ?, ?, ?, ?)
    `, [
      'reservation_rejected',
      offer.buyer_id,
      'تم رفض حجزك',
      `تم رفض حجز وجبة ${offer.meal_type} من ${offer.seller_name}`,
      JSON.stringify({ offerKey, sellerName: offer.seller_name })
    ]);

    res.json({
      success: true,
      message: 'تم رفض الحجز، والعرض متاح مجدداً'
    });

  } catch (error) {
    console.error('خطأ في رفض الحجز:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في رفض الحجز'
    });
  }
});

// حذف عرض
router.delete('/:offerKey', authenticateToken, async (req, res) => {
  try {
    const { offerKey } = req.params;
    
    const result = await Database.run(`
      DELETE FROM offers 
      WHERE key = ? AND seller_phone = ? AND status = 'available'
    `, [offerKey, req.user.phone]);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: 'العرض غير موجود أو لا يمكن حذفه'
      });
    }

    // إرسال إشعار مباشر
    const io = req.app.get('io');
    io.emit('offer_removed', { offerKey });

    res.json({
      success: true,
      message: 'تم حذف العرض بنجاح'
    });

  } catch (error) {
    console.error('خطأ في حذف العرض:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في حذف العرض'
    });
  }
});

// جلب الحجوزات للبائع
router.get('/reservations', authenticateToken, async (req, res) => {
  try {
    const reservations = await Database.all(`
      SELECT * FROM offers 
      WHERE seller_phone = ? AND status = 'reserved'
      ORDER BY reserved_at DESC
    `, [req.user.phone]);

    const formattedReservations = reservations.map(reservation => ({
      key: reservation.key,
      mealType: reservation.meal_type,
      price: reservation.price,
      details: reservation.details,
      reservedBy: reservation.reserved_by,
      buyerPhone: reservation.reserved_by_phone,
      reservedAt: reservation.reserved_at * 1000
    }));

    res.json({
      success: true,
      reservations: formattedReservations
    });

  } catch (error) {
    console.error('خطأ في جلب الحجوزات:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في جلب الحجوزات'
    });
  }
});

module.exports = router;