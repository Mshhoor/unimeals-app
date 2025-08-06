const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const Database = require('./config/database');
const authRoutes = require('./routes/auth');
const offerRoutes = require('./routes/offers');
const ratingRoutes = require('./routes/ratings');
const notificationRoutes = require('./routes/notifications');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Initialize database
Database.init();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // تعطيل لأغراض التطوير
}));

app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'تم تجاوز الحد المسموح من الطلبات، حاول لاحقاً'
});
app.use('/api/', limiter);

// SMS verification rate limiting
const smsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // limit each IP to 3 SMS requests per minute
  message: 'تم تجاوز حد إرسال رسائل التحقق، انتظر دقيقة'
});
app.use('/api/auth/verify-phone', smsLimiter);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('مستخدم جديد متصل:', socket.id);
  
  socket.on('join_seller', (sellerId) => {
    socket.join(`seller_${sellerId}`);
  });
  
  socket.on('join_buyer', (buyerId) => {
    socket.join(`buyer_${buyerId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('مستخدم منقطع:', socket.id);
  });
});

// Make io available in routes
app.set('io', io);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'خادم وجبتي يعمل بشكل طبيعي',
    timestamp: new Date().toISOString()
  });
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('خطأ في الخادم:', err.stack);
  res.status(500).json({
    success: false,
    message: 'حدث خطأ في الخادم',
    error: process.env.NODE_ENV === 'development' ? err.message : 'خطأ داخلي'
  });
});

// 404 handler
app.use('*', (req, res) => {
  if (req.originalUrl.startsWith('/api')) {
    res.status(404).json({
      success: false,
      message: 'المسار غير موجود'
    });
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 خادم وجبتي يعمل على المنفذ ${PORT}`);
  console.log(`📱 تطبيق الويب: http://localhost:${PORT}`);
  console.log(`🔧 API Endpoint: http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 إيقاف الخادم...');
  server.close(() => {
    Database.close();
    console.log('✅ تم إيقاف الخادم بنجاح');
    process.exit(0);
  });
});

module.exports = { app, io };