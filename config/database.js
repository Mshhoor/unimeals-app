const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
  constructor() {
    this.db = null;
  }

  init() {
    // إنشاء مجلد البيانات إذا لم يكن موجوداً
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, 'unimeals.db');
    
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('خطأ في الاتصال بقاعدة البيانات:', err.message);
      } else {
        console.log('🗄️ تم الاتصال بقاعدة البيانات بنجاح');
        this.createTables();
      }
    });

    // تمكين المفاتيح الخارجية
    this.db.run('PRAGMA foreign_keys = ON');
  }

  createTables() {
    // جدول المستخدمين المحدث
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        phone TEXT UNIQUE,
        seller_id TEXT UNIQUE,
        phone_verified BOOLEAN DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // جدول العروض
    this.db.run(`
      CREATE TABLE IF NOT EXISTS offers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        seller_id TEXT NOT NULL,
        seller_name TEXT NOT NULL,
        seller_phone TEXT,
        meal_type TEXT NOT NULL,
        price REAL NOT NULL,
        details TEXT,
        status TEXT DEFAULT 'available',
        reserved_by TEXT,
        reserved_by_phone TEXT,
        buyer_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        reserved_at INTEGER,
        confirmed_at INTEGER,
        rejected_at INTEGER,
        FOREIGN KEY (seller_id) REFERENCES users (seller_id)
      )
    `);

    // جدول التقييمات
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_id TEXT NOT NULL,
        buyer_id TEXT,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        offer_id INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (offer_id) REFERENCES offers (id)
      )
    `);

    // جدول الإشعارات
    this.db.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        recipient_type TEXT NOT NULL, -- 'seller' or 'buyer'
        recipient_id TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT, -- JSON data
        is_read BOOLEAN DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // جدول جلسات المستخدمين
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    console.log('📊 تم إنشاء جداول قاعدة البيانات');
  }

  // دوال مساعدة للاستعلامات
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            id: this.lastID,
            changes: this.changes
          });
        }
      });
    });
  }

  // إغلاق الاتصال
  close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('خطأ في إغلاق قاعدة البيانات:', err.message);
          } else {
            console.log('🔒 تم إغلاق قاعدة البيانات');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // تنظيف البيانات القديمة
  async cleanup() {
    const oneWeekAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    
    // حذف الجلسات المنتهية الصلاحية
    await this.run(`
      DELETE FROM user_sessions 
      WHERE expires_at < ?
    `, [Math.floor(Date.now() / 1000)]);

    // حذف الإشعارات القديمة المقروءة
    await this.run(`
      DELETE FROM notifications 
      WHERE is_read = 1 AND created_at < ?
    `, [oneWeekAgo]);

    console.log('🧹 تم تنظيف البيانات القديمة');
  }
}

const database = new Database();

// تنظيف دوري كل 6 ساعات
setInterval(() => {
  database.cleanup().catch(console.error);
}, 6 * 60 * 60 * 1000);

module.exports = database;