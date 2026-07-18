const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'jasa_printing_super_secret_key_123';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
// Menggunakan database 'jasa_printing', username 'root', password 'alen'
const sequelize = new Sequelize('jasa_printing', 'root', 'alen', {
    host: '127.0.0.1',
    dialect: 'mysql',
    logging: false
});

// Models Definition
const User = sequelize.define('User', {
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    }
});

const Setting = sequelize.define('Setting', {
    key: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    value: {
        type: DataTypes.STRING,
        allowNull: false
    }
});

const Order = sequelize.define('Order', {
    customerName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    fileName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    fileUrl: {
        type: DataTypes.STRING,
        allowNull: false
    },
    pageCount: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    pricePerPage: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    totalPrice: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('Pending', 'Diproses', 'Selesai', 'Dibatalkan'),
        defaultValue: 'Pending'
    },
    note: {
        type: DataTypes.TEXT,
        allowNull: true
    }
});

// Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ status: 401, message: 'Akses ditolak. Token tidak ditemukan.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ status: 403, message: 'Token tidak valid atau kedaluwarsa.' });
        }
        req.user = user;
        next();
    });
};

// --- API Routes ---

// Auth Routes
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ where: { username } });
        if (!user) {
            return res.status(404).json({ status: 404, message: 'Username tidak ditemukan.' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ status: 401, message: 'Password salah.' });
        }

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({
            status: 200,
            message: 'Login berhasil',
            token,
            user: { id: user.id, username: user.username }
        });
    } catch (error) {
        res.status(500).json({ status: 500, message: 'Terjadi kesalahan server.', error: error.message });
    }
});

// Settings Routes (Public & Admin)
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await Setting.findAll();
        const settingsMap = {};
        settings.forEach(s => {
            settingsMap[s.key] = s.value;
        });
        
        // Default settings if empty
        if (!settingsMap['price_per_page']) {
            settingsMap['price_per_page'] = '1000'; // Default 1000 IDR per lembar
        }
        res.json({ status: 200, data: settingsMap });
    } catch (error) {
        res.status(500).json({ status: 500, message: 'Gagal mengambil pengaturan.', error: error.message });
    }
});

app.post('/api/settings', authenticateToken, async (req, res) => {
    const { price_per_page } = req.body;
    try {
        await Setting.upsert({ key: 'price_per_page', value: String(price_per_page) });
        res.json({ status: 200, message: 'Pengaturan berhasil diperbarui.' });
    } catch (error) {
        res.status(500).json({ status: 500, message: 'Gagal menyimpan pengaturan.', error: error.message });
    }
});

// Orders Routes (Public: Create / Admin: Read, Update, Delete)
app.post('/api/orders', async (req, res) => {
    const { customerName, fileName, fileUrl, pageCount, pricePerPage, totalPrice, note } = req.body;
    
    if (!customerName || !fileName || !fileUrl || !pageCount || !pricePerPage || !totalPrice) {
        return res.status(400).json({ status: 400, message: 'Informasi pesanan tidak lengkap.' });
    }

    try {
        const newOrder = await Order.create({
            customerName,
            fileName,
            fileUrl,
            pageCount,
            pricePerPage,
            totalPrice,
            note,
            status: 'Pending'
        });
        res.status(201).json({ status: 201, message: 'Pesanan cetak berhasil dibuat.', data: newOrder });
    } catch (error) {
        res.status(500).json({ status: 500, message: 'Gagal membuat pesanan.', error: error.message });
    }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const orders = await Order.findAll({ order: [['createdAt', 'DESC']] });
        res.json({ status: 200, data: orders });
    } catch (error) {
        res.status(500).json({ status: 500, message: 'Gagal mengambil data pesanan.', error: error.message });
    }
});

app.put('/api/orders/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { status, note } = req.body;
    try {
        const order = await Order.findByPk(id);
        if (!order) {
            return res.status(404).json({ status: 404, message: 'Pesanan tidak ditemukan.' });
        }
        await order.update({ status, note });
        res.json({ status: 200, message: 'Pesanan berhasil diperbarui.', data: order });
    } catch (error) {
        res.status(500).json({ status: 500, message: 'Gagal memperbarui pesanan.', error: error.message });
    }
});

app.delete('/api/orders/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const order = await Order.findByPk(id);
        if (!order) {
            return res.status(404).json({ status: 404, message: 'Pesanan tidak ditemukan.' });
        }
        await order.destroy();
        res.json({ status: 200, message: 'Pesanan berhasil dihapus.' });
    } catch (error) {
        res.status(500).json({ status: 500, message: 'Gagal menghapus pesanan.', error: error.message });
    }
});

// Fallback to SPA Frontend
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Database Sync & Initial Data Seeding
const startServer = async () => {
    try {
        await sequelize.authenticate();
        console.log('Database terhubung dengan sukses.');

        // Sinkronisasi Tabel
        await sequelize.sync({ alter: true });

        // Cek Admin Default
        const adminExists = await User.findOne({ where: { username: 'admin' } });
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await User.create({
                username: 'admin',
                password: hashedPassword
            });
            console.log('Akun Admin Default Berhasil Dibuat (admin / admin123)');
        }

        // Cek Setting Default Harga per lembar
        const priceExists = await Setting.findOne({ where: { key: 'price_per_page' } });
        if (!priceExists) {
            await Setting.create({
                key: 'price_per_page',
                value: '1000'
            });
            console.log('Setting default harga berhasil diset: Rp 1.000/lembar');
        }

        // Jalankan Server
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, "127.0.0.1", () => {
            console.log(`Server running on http://127.0.0.1:${PORT}`);
        });

    } catch (error) {
        console.error('Gagal menghubungkan ke database atau sinkronisasi data:', error);
    }
};

startServer();