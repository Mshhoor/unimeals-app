const express = require('express');
const { body, validationResult } = require('express-validator');
const Database = require('../config/database');

const router = express.Router();

// إضافة تقييم جديد
router.post('/', [
  body('sellerId').notEmpty().withMessage('معرف البائع مطلوب'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('التقييم يجب أن يكون بين 1 و 5'),
  body('offerKey').optional().notEmpty().withMessage('مفتاح العرض مطلوب'),
  body('buyerId').optional().notEmpty().withMessage('معرف المشتري مطلوب')
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

    const { sellerId, rating, offerKey, buyerId } = req.body;
    
    // التحقق من وجود البائع
    const seller = await Database.get('SELECT * FROM users WHERE seller_id = ?', [sellerId]);
    if (!seller) {
      return res.status(404).json({
        success: false,
        message: 'البائع غير موجود'
      });
    }

    let offerId = null;
    if (offerKey) {
      const offer = await Database.get('SELECT id FROM offers WHERE key = ?', [offerKey]);
      offerId = offer ? offer.id : null;
    }

    // التحقق من عدم وجود تقييم سابق من نفس المشتري لنفس العرض
    if (buyerId && offerId) {
      const existingRating = await Database.get(`
        SELECT id FROM ratings 
        WHERE seller_id = ? AND buyer_id = ? AND offer_id = ?
      `, [sellerId, buyerId, offerId]);

      if (existingRating) {
        return res.status(400).json({
          success: false,
          message: 'لقد قيمت هذا البائع من قبل لهذا العرض'
        });
      }
    }

    // إضافة التقييم
    const result = await Database.run(`
      INSERT INTO ratings (seller_id, buyer_id, rating, offer_id)
      VALUES (?, ?, ?, ?)
    `, [sellerId, buyerId, rating, offerId]);

    // حساب المتوسط الجديد
    const stats = await Database.get(`
      SELECT 
        AVG(rating) as avg_rating,
        COUNT(*) as total_ratings
      FROM ratings 
      WHERE seller_id = ?
    `, [sellerId]);

    // إرسال إشعار للبائع
    const io = req.app.get('io');
    io.to(`seller_${sellerId}`).emit('new_rating', {
      rating,
      avgRating: parseFloat(stats.avg_rating).toFixed(1),
      totalRatings: stats.total_ratings
    });

    // إضافة إشعار للبائع
    await Database.run(`
      INSERT INTO notifications (type, recipient_type, recipient_id, title, message, data)
      VALUES (?, 'seller', ?, ?, ?, ?)
    `, [
      'new_rating',
      sellerId,
      'تقييم جديد',
      `حصلت على تقييم ${rating}/5 نجوم`,
      JSON.stringify({ 
        rating, 
        avgRating: parseFloat(stats.avg_rating).toFixed(1),
        totalRatings: stats.total_ratings,
        offerId 
      })
    ]);

    res.json({
      success: true,
      message: 'تم إضافة التقييم بنجاح',
      rating: {
        id: result.id,
        rating,
        avgRating: parseFloat(stats.avg_rating).toFixed(1),
        totalRatings: stats.total_ratings
      }
    });

  } catch (error) {
    console.error('خطأ في إضافة التقييم:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في إضافة التقييم'
    });
  }
});

// جلب تقييمات بائع معين
router.get('/seller/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    
    // التحقق من وجود البائع
    const seller = await Database.get('SELECT * FROM users WHERE seller_id = ?', [sellerId]);
    if (!seller) {
      return res.status(404).json({
        success: false,
        message: 'البائع غير موجود'
      });
    }

    // جلب جميع التقييمات
    const ratings = await Database.all(`
      SELECT r.*, o.meal_type, o.price
      FROM ratings r
      LEFT JOIN offers o ON r.offer_id = o.id
      WHERE r.seller_id = ?
      ORDER BY r.created_at DESC
    `, [sellerId]);

    // حساب الإحصائيات
    const stats = await Database.get(`
      SELECT 
        AVG(rating) as avg_rating,
        COUNT(*) as total_ratings,
        COUNT(CASE WHEN rating = 5 THEN 1 END) as five_stars,
        COUNT(CASE WHEN rating = 4 THEN 1 END) as four_stars,
        COUNT(CASE WHEN rating = 3 THEN 1 END) as three_stars,
        COUNT(CASE WHEN rating = 2 THEN 1 END) as two_stars,
        COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star
      FROM ratings 
      WHERE seller_id = ?
    `, [sellerId]);

    const formattedRatings = ratings.map(rating => ({
      id: rating.id,
      rating: rating.rating,
      mealType: rating.meal_type,
      price: rating.price,
      createdAt: rating.created_at * 1000
    }));

    res.json({
      success: true,
      ratings: formattedRatings,
      stats: {
        avgRating: stats.avg_rating ? parseFloat(stats.avg_rating).toFixed(1) : 0,
        totalRatings: stats.total_ratings || 0,
        distribution: {
          5: stats.five_stars || 0,
          4: stats.four_stars || 0,
          3: stats.three_stars || 0,
          2: stats.two_stars || 0,
          1: stats.one_star || 0
        }
      }
    });

  } catch (error) {
    console.error('خطأ في جلب تقييمات البائع:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في جلب التقييمات'
    });
  }
});

// جلب إحصائيات التقييمات لعدة بائعين
router.post('/bulk-stats', [
  body('sellerIds').isArray().withMessage('قائمة معرفات البائعين يجب أن تكون مصفوفة')
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

    const { sellerIds } = req.body;
    
    if (sellerIds.length === 0) {
      return res.json({
        success: true,
        stats: {}
      });
    }

    // إنشاء placeholders للاستعلام
    const placeholders = sellerIds.map(() => '?').join(',');
    
    const stats = await Database.all(`
      SELECT 
        seller_id,
        AVG(rating) as avg_rating,
        COUNT(*) as total_ratings
      FROM ratings 
      WHERE seller_id IN (${placeholders})
      GROUP BY seller_id
    `, sellerIds);

    // تحويل النتائج إلى object
    const statsMap = {};
    stats.forEach(stat => {
      statsMap[stat.seller_id] = {
        avgRating: parseFloat(stat.avg_rating).toFixed(1),
        totalRatings: stat.total_ratings
      };
    });

    // إضافة البائعين الذين لا يملكون تقييمات
    sellerIds.forEach(sellerId => {
      if (!statsMap[sellerId]) {
        statsMap[sellerId] = {
          avgRating: 0,
          totalRatings: 0
        };
      }
    });

    res.json({
      success: true,
      stats: statsMap
    });

  } catch (error) {
    console.error('خطأ في جلب إحصائيات التقييمات:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في جلب الإحصائيات'
    });
  }
});

// جلب أفضل البائعين حسب التقييم
router.get('/top-sellers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const topSellers = await Database.all(`
      SELECT 
        r.seller_id,
        u.name as seller_name,
        u.phone,
        AVG(r.rating) as avg_rating,
        COUNT(r.rating) as total_ratings,
        COUNT(o.id) as total_offers
      FROM ratings r
      JOIN users u ON r.seller_id = u.seller_id
      LEFT JOIN offers o ON r.seller_id = o.seller_id
      GROUP BY r.seller_id
      HAVING COUNT(r.rating) >= 3
      ORDER BY avg_rating DESC, total_ratings DESC
      LIMIT ?
    `, [limit]);

    const formattedSellers = topSellers.map(seller => ({
      sellerId: seller.seller_id,
      sellerName: seller.seller_name || 'بائع',
      avgRating: parseFloat(seller.avg_rating).toFixed(1),
      totalRatings: seller.total_ratings,
      totalOffers: seller.total_offers
    }));

    res.json({
      success: true,
      topSellers: formattedSellers
    });

  } catch (error) {
    console.error('خطأ في جلب أفضل البائعين:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في جلب أفضل البائعين'
    });
  }
});

// حذف تقييم (للمطورين فقط)
router.delete('/:ratingId', async (req, res) => {
  try {
    // هذا الطريق محمي ويحتاج إلى كلمة مرور خاصة
    const adminPassword = req.headers['x-admin-password'];
    if (adminPassword !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({
        success: false,
        message: 'غير مسموح'
      });
    }

    const { ratingId } = req.params;
    
    const result = await Database.run('DELETE FROM ratings WHERE id = ?', [ratingId]);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: 'التقييم غير موجود'
      });
    }

    res.json({
      success: true,
      message: 'تم حذف التقييم'
    });

  } catch (error) {
    console.error('خطأ في حذف التقييم:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في حذف التقييم'
    });
  }
});

module.exports = router;