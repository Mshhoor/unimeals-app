const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// Add parent directory to path to access config
process.chdir(path.join(__dirname, '..'));

const Database = require('../config/database');
const { generateSellerId, generateOfferId, generateBuyerId } = require('../utils/helpers');

async function initializeDatabase() {
  console.log('🚀 بدء تهيئة قاعدة البيانات...');
  
  try {
    // Initialize database
    Database.init();
    
    // Wait a bit for database to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('📊 إدراج البيانات التجريبية...');
    
    // Sample users with hashed passwords
    const sampleUsers = [
      {
        username: 'أحمد_محمد',
        email: 'ahmed@example.com',
        password: '123456',
        phone: '0512345678'
      },
      {
        username: 'فاطمة_علي',
        email: 'fatima@example.com',
        password: '123456',
        phone: '0587654321'
      },
      {
        username: 'محمد_السالم',
        email: 'mohammed@example.com',
        password: '123456',
        phone: '0501234567'
      },
      {
        username: 'نورا_أحمد',
        email: 'nora@example.com',
        password: '123456',
        phone: '0559876543'
      },
      {
        username: 'عبدالله_الخالد',
        email: 'abdullah@example.com',
        password: '123456',
        phone: '0566789012'
      }
    ];

    // Hash passwords and insert users
    for (const user of sampleUsers) {
      const passwordHash = await bcrypt.hash(user.password, 12);
      const sellerId = generateSellerId(user.email + user.username);
      
      await Database.run(`
        INSERT OR IGNORE INTO users (username, email, password_hash, phone, seller_id, phone_verified)
        VALUES (?, ?, ?, ?, ?, 1)
      `, [user.username, user.email, passwordHash, user.phone, sellerId]);
    }

    console.log('✅ تم إدراج المستخدمين التجريبيين');

    // Get inserted users with their seller IDs
    const users = await Database.all('SELECT * FROM users ORDER BY id');

    // Insert sample offers
    const sampleOffers = [
      {
        key: generateOfferId(),
        seller_id: users[0].seller_id,
        seller_name: users[0].username,
        seller_phone: users[0].phone,
        meal_type: 'فطور',
        price: 3.5,
        details: 'وجبة فطور لذيذة تتكون من بيض مقلي مع خبز توست وعصير برتقال طازج',
        status: 'available'
      },
      {
        key: generateOfferId(),
        seller_id: users[1].seller_id,
        seller_name: users[1].username,
        seller_phone: users[1].phone,
        meal_type: 'غداء',
        price: 12.0,
        details: 'وجبة غداء مميزة: أرز بخاري مع دجاج مشوي وسلطة خضار وشوربة عدس',
        status: 'available'
      },
      {
        key: generateOfferId(),
        seller_id: users[2].seller_id,
        seller_name: users[2].username,
        seller_phone: users[2].phone,
        meal_type: 'عشاء',
        price: 8.5,
        details: 'وجبة عشاء خفيفة: شاورما لحم مع البطاطس المقلية ومشروب غازي',
        status: 'available'
      },
      {
        key: generateOfferId(),
        seller_id: users[3].seller_id,
        seller_name: users[3].username,
        seller_phone: users[3].phone,
        meal_type: 'غداء',
        price: 15.0,
        details: 'وجبة غداء فاخرة: مندي لحم مع الرز الأحمر والسلطة اليمنية',
        status: 'reserved',
        reserved_by: 'مشتري تجريبي',
        reserved_by_phone: '0598765432',
        buyer_id: generateBuyerId(),
        reserved_at: Math.floor(Date.now() / 1000) - 1800 // 30 minutes ago
      },
      {
        key: generateOfferId(),
        seller_id: users[4].seller_id,
        seller_name: users[4].username,
        seller_phone: users[4].phone,
        meal_type: 'فطور',
        price: 4.0,
        details: 'فطور صحي: شوفان بالفواكه مع العسل وكوب حليب',
        status: 'sold',
        reserved_by: 'مشتري آخر',
        reserved_by_phone: '0534567890',
        buyer_id: generateBuyerId(),
        reserved_at: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        confirmed_at: Math.floor(Date.now() / 1000) - 1800 // 30 minutes ago
      }
    ];

    for (const offer of sampleOffers) {
      await Database.run(`
        INSERT INTO offers (
          key, seller_id, seller_name, seller_phone, meal_type, 
          price, details, status, reserved_by, reserved_by_phone, 
          buyer_id, reserved_at, confirmed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        offer.key, offer.seller_id, offer.seller_name, offer.seller_phone,
        offer.meal_type, offer.price, offer.details, offer.status,
        offer.reserved_by || null, offer.reserved_by_phone || null,
        offer.buyer_id || null, offer.reserved_at || null, offer.confirmed_at || null
      ]);
    }

    console.log('✅ تم إدراج العروض التجريبية');

    // Insert sample ratings
    const sampleRatings = [
      {
        seller_id: users[0].seller_id,
        rating: 5,
        buyer_id: generateBuyerId()
      },
      {
        seller_id: users[0].seller_id,
        rating: 4,
        buyer_id: generateBuyerId()
      },
      {
        seller_id: users[1].seller_id,
        rating: 5,
        buyer_id: generateBuyerId()
      },
      {
        seller_id: users[1].seller_id,
        rating: 5,
        buyer_id: generateBuyerId()
      },
      {
        seller_id: users[1].seller_id,
        rating: 4,
        buyer_id: generateBuyerId()
      },
      {
        seller_id: users[2].seller_id,
        rating: 3,
        buyer_id: generateBuyerId()
      },
      {
        seller_id: users[3].seller_id,
        rating: 5,
        buyer_id: generateBuyerId()
      },
      {
        seller_id: users[4].seller_id,
        rating: 4,
        buyer_id: generateBuyerId()
      },
      {
        seller_id: users[4].seller_id,
        rating: 5,
        buyer_id: generateBuyerId()
      }
    ];

    for (const rating of sampleRatings) {
      await Database.run(`
        INSERT INTO ratings (seller_id, rating, buyer_id)
        VALUES (?, ?, ?)
      `, [rating.seller_id, rating.rating, rating.buyer_id]);
    }

    console.log('✅ تم إدراج التقييمات التجريبية');

    // Insert sample notifications
    const sampleNotifications = [
      {
        type: 'new_reservation',
        recipient_type: 'seller',
        recipient_id: users[3].seller_id,
        title: 'طلب حجز جديد',
        message: 'لديك طلب حجز جديد من مشتري تجريبي لوجبة غداء',
        data: JSON.stringify({ offerKey: sampleOffers[3].key, buyerName: 'مشتري تجريبي' }),
        is_read: 0
      },
      {
        type: 'new_rating',
        recipient_type: 'seller',
        recipient_id: users[0].seller_id,
        title: 'تقييم جديد',
        message: 'حصلت على تقييم 5/5 نجوم من أحد المشترين',
        data: JSON.stringify({ rating: 5 }),
        is_read: 0
      },
      {
        type: 'reservation_confirmed',
        recipient_type: 'buyer',
        recipient_id: generateBuyerId(),
        title: 'تم تأكيد حجزك',
        message: 'تم تأكيد حجز وجبة فطور من عبدالله الخالد',
        data: JSON.stringify({ 
          offerKey: sampleOffers[4].key, 
          sellerName: users[4].username,
          mealType: 'فطور'
        }),
        is_read: 1
      }
    ];

    for (const notification of sampleNotifications) {
      await Database.run(`
        INSERT INTO notifications (type, recipient_type, recipient_id, title, message, data, is_read)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        notification.type, notification.recipient_type, notification.recipient_id,
        notification.title, notification.message, notification.data, notification.is_read
      ]);
    }

    console.log('✅ تم إدراج الإشعارات التجريبية');

    console.log('🎉 تمت تهيئة قاعدة البيانات بنجاح!');
    console.log('');
    console.log('👥 المستخدمين التجريبيين:');
    console.log('='.repeat(50));
    sampleUsers.forEach((user, index) => {
      console.log(`${index + 1}. الاسم: ${user.username}`);
      console.log(`   البريد: ${user.email}`);
      console.log(`   الجوال: ${user.phone}`);
      console.log(`   كلمة المرور: ${user.password}`);
      console.log('   ' + '-'.repeat(30));
    });
    console.log('');
    console.log('🔐 معلومات تسجيل الدخول:');
    console.log('- استخدم أي بريد إلكتروني من القائمة أعلاه');
    console.log('- كلمة المرور لجميع الحسابات: 123456');
    console.log('');
    console.log('📱 ملاحظات مهمة:');
    console.log('- تم ربط رقم جوال لكل مستخدم مسبقاً');
    console.log('- يمكنك تغيير رقم الجوال من الملف الشخصي');
    console.log('- العروض التجريبية متاحة للتجربة');
    console.log('');
    console.log('🚀 يمكنك الآن تشغيل الخادم باستخدام: npm start');

  } catch (error) {
    console.error('❌ خطأ في تهيئة قاعدة البيانات:', error);
    process.exit(1);
  }
}

// التحقق من وجود ملف قاعدة البيانات
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'unimeals.db');

if (fs.existsSync(dbPath)) {
  console.log('⚠️  قاعدة البيانات موجودة بالفعل');
  console.log('هل تريد حذفها وإعادة إنشائها؟ (y/N)');
  
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data) => {
    const input = data.toString().trim().toLowerCase();
    if (input === 'y' || input === 'yes' || input === 'نعم') {
      fs.unlinkSync(dbPath);
      console.log('🗑️  تم حذف قاعدة البيانات القديمة');
      initializeDatabase();
    } else {
      console.log('❌ تم إلغاء العملية');
      process.exit(0);
    }
  });
} else {
  // إنشاء مجلد البيانات إذا لم يكن موجوداً
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('📁 تم إنشاء مجلد البيانات');
  }
  
  initializeDatabase();
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n👋 تم إيقاف العملية');
  Database.close().then(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 تم إنهاء العملية');
  Database.close().then(() => {
    process.exit(0);
  });
});