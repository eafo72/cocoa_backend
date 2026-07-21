// src/routes/fotografias.js

const express = require('express');
const router = express.Router(); // Usamos router en lugar de app para este módulo
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const auth = require('../middlewares/authorization')

// AÑADIDO: Carga las variables de entorno inmediatamente
// Esto garantiza que process.env esté disponible
require('dotenv').config(); 


// --- INICIO DE LA INTEGRACIÓN DE GOOGLE DRIVE API ---
// --- Configuración y Auth de Google Drive ---
const FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const serviceAccount = JSON.parse(
  Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEYFILE, "base64").toString("utf-8")
);


if (!FOLDER_ID) {
  console.warn('⚠️ WARNING: DRIVE_FOLDER_ID no está definido. Las rutas de Drive fallarán.');
}


let drive;
try {
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    drive = google.drive({ version: 'v3', auth });
    console.log('[DRIVE INIT] Google Drive API inicializada correctamente.');
} catch (error) {
    console.error('CRITICAL ERROR: No se pudo inicializar la API de Google Drive.', error.message);
}
// --- FIN DE LA INTEGRACIÓN DE GOOGLE DRIVE API ---


// --- RUTA 1: Buscar Archivos por ID de Reservación ---
// GET /fotografias/buscar/:id
router.get('/buscar/:id', auth, async (req, res) => {
  if (!drive) return res.status(503).json({ error: 'Servicio de Drive no disponible' });
  
  try {
    const id = (req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id vacío' });
    if (!FOLDER_ID) return res.status(500).json({ error: 'Folder ID no configurado' });

    // Consulta: buscar archivos en la carpeta cuyo nombre contiene el ID
    const q = `'${FOLDER_ID}' in parents and trashed = false and name contains '${id}'`;
    
    console.log(`[DRIVE QUERY] Ejecutando consulta: ${q}`); 

    const resp = await drive.files.list({
      q,
      fields: 'files(id,name,mimeType,createdTime,size)',
      pageSize: 1000
    });

    const files = (resp.data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      createdTime: f.createdTime,
      size: f.size,
      // URL que el servidor sirve: la ruta será /fotografias/imagen/:fileId
      url: `/fotografias/imagen/${f.id}` 
    }));

    res.json(files);
  } catch (err) {
    console.error('Error /buscar:', err.message);
    res.status(500).json({ error: 'Error listando archivos' });
  }
});


// GET /fotografias/imagen/:fileId  (PÚBLICA)
router.get('/imagen/:fileId', async (req, res) => {
  if (!drive) return res.status(503).send('Servicio de Drive no disponible');
  try {
    const fileId = req.params.fileId;
    if (!fileId) return res.status(400).send('fileId requerido');

    // Obtener metadata
    const meta = await drive.files.get({ fileId, fields: 'id,name,mimeType' });
    const mimeType = meta.data.mimeType || 'application/octet-stream';
    const fileName = meta.data.name || 'archivo';

    // ✅ Encabezados correctos
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/"/g, '')}"`);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', 'https://boletos.museocasakahlo.org');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Stream del archivo
    const r = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    r.data.pipe(res);
  } catch (err) {
    console.error('Error /imagen/:', err.message);
    res.status(500).send('No se pudo obtener el archivo');
  }
});

// ============================================================================
// 🧩 RUTA 3: WEBHOOK DE CONTEO DE PERSONAS (MILESIGHT)
// POST /fotografias/milesight-people-count
// ============================================================================
router.post('/milesight-people-count', (req, res) => {
    try {
        console.log("--- SOLICITUD DE MILESIGHT RECIBIDA ---");
        console.log("Headers:", req.headers); 
        // ⚠️ USAR JSON.stringify con indentación para ver el PAYLOAD completo
        console.log("Body:", JSON.stringify(req.body, null, 4));
        console.log("--- FIN LOG ---");
        
        res.status(200).json({ status: 'ok', message: 'Test received successfully' });
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ error: 'Internal error' });
    }
});

// ============================================================================
// 🧩 RUTA 3: Descargar Imagen (Forzar descarga)
// GET /fotografias/descargar/:fileId
// 🔒 Protegida: requiere token
// ============================================================================
router.get('/descargar/:fileId', auth, async (req, res) => {
  if (!drive) return res.status(503).send('Servicio de Drive no disponible');
  try {
    const fileId = req.params.fileId;
    if (!fileId) return res.status(400).send('fileId requerido');
    console.log(`[DRIVE DOWNLOAD] Usuario: ${req.user.email || req.user.id} descargando File ID: ${fileId}`);
    const meta = await drive.files.get({ fileId, fields: 'id,name,mimeType' });
    const mimeType = meta.data.mimeType || 'application/octet-stream';
    const fileName = meta.data.name || 'archivo';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
    const stream = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );
    stream.data.on('error', err => {
      console.error('Stream error (descargar):', err);
      try { res.end(); } catch (e) {}
    });
    stream.data.pipe(res);
  } catch (err) {
    console.error('❌ Error en /descargar/:', err.message);
    res.status(500).send('No se pudo descargar el archivo desde Drive');
  }
});



// Exportamos el router y el objeto drive para que index.js pueda montar la ruta y el cron job.
module.exports = {
    router: router,
    drive: drive 
};