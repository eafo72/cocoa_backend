const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Middleware para manejar errores
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Obtener el conteo actual de personas
router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await db.pool.query(
    'SELECT * FROM camara WHERE fecha = CURDATE()'
  );
  
  if (rows.length === 0) {
    // Si no hay registro para hoy, crear uno con valores en 0
    const [result] = await db.pool.query(
      'INSERT INTO camara (fecha, entrada, salida) VALUES (CURDATE(), 0, 0)'
    );
    return res.json({ 
      fecha: new Date().toISOString().split('T')[0],
      entrada: 0,
      salida: 0
    });
  }
  
  res.json(rows[0]);
}));

// Actualizar conteo de personas (puede ser entrada, salida o ambos)
router.post('/actualizar', asyncHandler(async (req, res) => {
  const { entrada, salida } = req.body;
  
  // Validar que al menos uno de los dos valores esté presente y sea un número positivo
  if ((entrada === undefined && salida === undefined) || 
      (entrada !== undefined && (isNaN(entrada) || entrada < 0)) ||
      (salida !== undefined && (isNaN(salida) || salida < 0))) {
    return res.status(400).json({ 
      error: 'Parámetros inválidos. Se requiere al menos "entrada" o "salida" como números positivos.' 
    });
  }
  
  // Usar transacción para asegurar la integridad de los datos
  const connection = await db.pool.getConnection();
  await connection.beginTransaction();
  
  try {
    // Verificar si ya existe un registro para hoy
    const [existing] = await connection.query(
      'SELECT * FROM camara WHERE fecha = CURDATE() FOR UPDATE'
    );
    
    if (existing.length > 0) {
      // Actualizar registro existente con los nuevos valores
      const updateFields = [];
      const updateValues = [];
      
      if (entrada !== undefined) {
        updateFields.push('entrada = ?');
        updateValues.push(entrada);
      }
      
      if (salida !== undefined) {
        updateFields.push('salida = ?');
        updateValues.push(salida);
      }
      
      // Ejecutar actualización con los valores directos
      await connection.query(
        `UPDATE camara SET ${updateFields.join(', ')} WHERE fecha = CURDATE()`,
        updateValues
      );
    } else {
      // Crear nuevo registro con los valores proporcionados (o 0 si no se proporcionaron)
      await connection.query(
        'INSERT INTO camara (fecha, entrada, salida) VALUES (CURDATE(), ?, ?)',
        [
          entrada !== undefined ? entrada : 0,
          salida !== undefined ? salida : 0
        ]
      );
    }
    
    // Obtener los valores actualizados
    const [current] = await connection.query(
      'SELECT * FROM camara WHERE fecha = CURDATE()'
    );
    
    await connection.commit();
    
    // Emitir actualización a través de WebSocket si está disponible
    if (req.app.get('io')) {
      req.app.get('io').emit('actualizacionAforo', current[0]);
    }
    
    res.json(current[0]);
  } catch (error) {
    await connection.rollback();
    console.error('Error al actualizar el conteo:', error);
    res.status(500).json({ error: 'Error al actualizar el conteo de personas' });
  } finally {
    connection.release();
  }
}));

// Obtener historial de aforo
router.get('/historial', asyncHandler(async (req, res) => {
  const [rows] = await db.pool.query(
    'SELECT * FROM camara ORDER BY fecha DESC LIMIT 30'
  );
  res.json(rows);
}));

router.get('/:fecha', asyncHandler(async (req, res) => {
  const { fecha } = req.params;
  
  // Validar el formato de fecha (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(fecha) || isNaN(Date.parse(fecha))) {
    return res.status(400).json({ 
      error: 'Formato de fecha inválido. Use YYYY-MM-DD' 
    });
  }
  
  const [rows] = await db.pool.query(
    'SELECT * FROM camara WHERE fecha = ?',
    [fecha]
  );
  
  if (rows.length === 0) {
    return res.status(404).json({
      message: 'No se encontraron registros para la fecha especificada',
      fecha,
      entrada: 0,
      salida: 0
    });
  }
  
  res.json(rows[0]);
}));

module.exports = router;
