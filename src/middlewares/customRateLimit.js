const rateLimit = require('express-rate-limit');
const db = require("../config/db");

const customLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300, // Máx 300 peticiones por IP
  handler: async (req, res, next) => {
    const ip = req.ip;
    const bloqueadoHasta = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    try {
      await db.pool.query(`
        INSERT INTO blocked_ips (ip, blocked_until)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE blocked_until = VALUES(blocked_until)
      `, [ip, bloqueadoHasta]);

      console.warn(`[🚫 IP BLOQUEADA]: ${ip}`);
    } catch (err) {
      console.error('Error al registrar IP bloqueada', err);
    }

    return res.status(429).json({
      error: 'Demasiadas solicitudes. Intenta más tarde.'
    });
  }
});

module.exports = customLimiter;
