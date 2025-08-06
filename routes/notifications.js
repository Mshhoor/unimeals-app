const express = require('express');
const Database = require('../config/database');
const { authenticateToken } = require('../utils/helpers');

const router = express.Router();

// جلب إشعارات المستخدم
router.get('/', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const unreadOnly = req.query.unread === 'true';

    let whereClause = 'WHERE (recipient_type = ? AND recipient_id = ?)';
    let queryParams = ['seller', req.user.seller_id];
    
    if (unreadOnly) {
      whereClause += ' AND is_read = 0';
    }

    const notifications = await Database.all(`
      SELECT * FROM notifications 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `, [...queryParams, limit, offset]);

    // جلب عدد الإشعارات غير المقروءة
    const unreadCount = await Database.get(`
      SELECT COUNT(*) as count FROM notifications 
      WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0
    `, ['seller', req.user.seller_id]);

    const formattedNotifications = notifications.map(notification => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data ? JSON.parse(notification.data) : null,
      isRead: notification.is_read === 1,
      createdAt: notification.created_at * 1000
    }));

    res.json({
      success: true,
      notifications: formattedNotifications,
      unreadCount: unreadCount.count,
      hasMore: notifications.length === limit
    });

  } catch (error) {
    console.error('خطأ في جلب الإشعارات:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في جلب الإشعارات'
    });
  }
});

// تحديد إشعار كمقروء
router.put('/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    const { notificationId } = req.params;

    // التحقق من أن الإشعار يخص المستخدم الحالي
    const notification = await Database.get(`
      SELECT * FROM notifications 
      WHERE id = ? AND recipient_type = ? AND recipient_id = ?
    `, [notificationId, 'seller', req.user.seller_id]);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'الإشعار غير موجود'
      });
    }

    await Database.run(`
      UPDATE notifications 
      SET is_read = 1 
      WHERE id = ?
    `, [notificationId]);

    res.json({
      success: true,
      message: 'تم تحديد الإشعار كمقروء'
    });

  } catch (error) {
    console.error('خطأ في تحديث الإشعار:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في تحديث الإشعار'
    });
  }
});

// تحديد جميع الإشعارات كمقروءة
router.put('/mark-all-read', authenticateToken, async (req, res) => {
  try {
    const result = await Database.run(`
      UPDATE notifications 
      SET is_read = 1 
      WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0
    `, ['seller', req.user.seller_id]);

    res.json({
      success: true,
      message: 'تم تحديد جميع الإشعارات كمقروءة',
      updatedCount: result.changes
    });

  } catch (error) {
    console.error('خطأ في تحديث الإشعارات:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في تحديث الإشعارات'
    });
  }
});

// حذف إشعار
router.delete('/:notificationId', authenticateToken, async (req, res) => {
  try {
    const { notificationId } = req.params;

    const result = await Database.run(`
      DELETE FROM notifications 
      WHERE id = ? AND recipient_type = ? AND recipient_id = ?
    `, [notificationId, 'seller', req.user.seller_id]);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: 'الإشعار غير موجود'
      });
    }

    res.json({
      success: true,
      message: 'تم حذف الإشعار'
    });

  } catch (error) {
    console.error('خطأ في حذف الإشعار:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في حذف الإشعار'
    });
  }
});

// حذف جميع الإشعارات المقروءة
router.delete('/clear-read', authenticateToken, async (req, res) => {
  try {
    const result = await Database.run(`
      DELETE FROM notifications 
      WHERE recipient_type = ? AND recipient_id = ? AND is_read = 1
    `, ['seller', req.user.seller_id]);

    res.json({
      success: true,
      message: 'تم حذف جميع الإشعارات المقروءة',
      deletedCount: result.changes
    });

  } catch (error) {
    console.error('خطأ في حذف الإشعارات:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في حذف الإشعارات'
    });
  }
});

// إرسال إشعار اختبار (للمطورين)
router.post('/test', async (req, res) => {
  try {
    // للاختبار فقط في بيئة التطوير
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({
        success: false,
        message: 'متاح فقط في بيئة التطوير'
      });
    }

    const { recipientId, title, message, type = 'test' } = req.body;

    if (!recipientId || !title || !message) {
      return res.status(400).json({
        success: false,
        message: 'البيانات ناقصة'
      });
    }

    await Database.run(`
      INSERT INTO notifications (type, recipient_type, recipient_id, title, message)
      VALUES (?, 'seller', ?, ?, ?)
    `, [type, recipientId, title, message]);

    // إرسال عبر Socket.IO
    const io = req.app.get('io');
    io.to(`seller_${recipientId}`).emit('new_notification', {
      type,
      title,
      message,
      timestamp: Date.now()
    });

    res.json({
      success: true,
      message: 'تم إرسال الإشعار الاختباري'
    });

  } catch (error) {
    console.error('خطأ في إرسال الإشعار الاختباري:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في إرسال الإشعار'
    });
  }
});

// الحصول على إحصائيات الإشعارات
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await Database.get(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_read = 0 THEN 1 END) as unread,
        COUNT(CASE WHEN type = 'new_reservation' THEN 1 END) as reservations,
        COUNT(CASE WHEN type = 'new_rating' THEN 1 END) as ratings,
        COUNT(CASE WHEN created_at > strftime('%s', 'now', '-7 days') THEN 1 END) as this_week
      FROM notifications 
      WHERE recipient_type = ? AND recipient_id = ?
    `, ['seller', req.user.seller_id]);

    res.json({
      success: true,
      stats: {
        total: stats.total || 0,
        unread: stats.unread || 0,
        reservations: stats.reservations || 0,
        ratings: stats.ratings || 0,
        thisWeek: stats.this_week || 0
      }
    });

  } catch (error) {
    console.error('خطأ في جلب إحصائيات الإشعارات:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في جلب الإحصائيات'
    });
  }
});

module.exports = router;