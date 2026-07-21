const express = require('express')
const app = express.Router()
const db = require('../config/db')
const fs = require('fs')
const path = require('path')
const imageController = require('../controller/imageController')
let FormData = require('form-data');
const fetch = require('node-fetch');

const normalizeMostrarEnIndex = (value) => {
  if (value === undefined || value === null || value === '') return 0;
  return Number(value) === 1 ? 1 : 0;
};

const mapEventoIndexFlag = (evento) => {
  if (!evento) return evento;

  return {
    ...evento,
    mostrar_en_index: Number(evento.destacado ?? 0),
  };
};

// Lista todos los eventos
app.get('/eventos', async (req, res) => {
  try {
    let query = `SELECT id, titulo, descripcion_corta, descripcion_larga, imagen, fecha_inicio_agenda, fecha_fin_agenda, activo, destacado, orden, created_at, updated_at FROM eventos_especiales ORDER BY orden DESC`;
    let eventosRes = await db.pool.query(query);
    const eventos = (eventosRes[0] || []).map(mapEventoIndexFlag);

    if (eventos.length === 0) return res.status(200).json([]);

    // Obtener todos los horarios de los eventos en una sola consulta
    const ids = eventos.map(e => e.id).join(',') || '0';
    let qHorarios = `SELECT * FROM eventos_especiales_horarios WHERE evento_id IN (${ids}) ORDER BY fecha, hora_inicio`;
    let horariosRes = await db.pool.query(qHorarios);
    const horarios = horariosRes[0] || [];

    // Obtener todos los boletos de los eventos en una sola consulta
    let qBoletos = `SELECT * FROM eventos_especiales_boletos WHERE evento_id IN (${ids}) ORDER BY evento_id, orden`;
    let boletosRes = await db.pool.query(qBoletos);
    const boletos = boletosRes[0] || [];

    // Mapear horarios por evento_id
    const horariosMap = {};
    horarios.forEach(h => {
      if (!horariosMap[h.evento_id]) horariosMap[h.evento_id] = [];
      horariosMap[h.evento_id].push(h);
    });

    // Mapear boletos por evento_id
    const boletosMap = {};
    boletos.forEach(b => {
      if (!boletosMap[b.evento_id]) boletosMap[b.evento_id] = [];
      boletosMap[b.evento_id].push(b);
    });

    // Adjuntar horarios y boletos a cada evento
    const enriched = eventos.map(ev => ({ ...ev, horarios: horariosMap[ev.id] || [], boletos: boletosMap[ev.id] || [] }));

    return res.status(200).json(enriched);
  } catch (error) {
    return res.status(500).json({ msg: 'Hubo un error obteniendo los eventos', error: true, details: error })
  }
})

//Lista de todos los eventos activos (activo=1) con sus horarios y boletos
app.get('/eventos/activos', async (req, res) => {
  try {
    let query = `SELECT id, titulo, descripcion_corta, descripcion_larga, imagen, fecha_inicio_agenda, fecha_fin_agenda, activo, destacado, orden, created_at, updated_at FROM eventos_especiales WHERE activo=1 ORDER BY orden DESC`;
    let eventosRes = await db.pool.query(query);
    const eventos = (eventosRes[0] || []).map(mapEventoIndexFlag);

    if (eventos.length === 0) return res.status(200).json([]);

    // Obtener todos los horarios de los eventos en una sola consulta
    const ids = eventos.map(e => e.id).join(',') || '0';
    let qHorarios = `SELECT * FROM eventos_especiales_horarios WHERE evento_id IN (${ids}) ORDER BY fecha, hora_inicio`;
    let horariosRes = await db.pool.query(qHorarios);
    const horarios = horariosRes[0] || [];

    // Obtener todos los boletos de los eventos en una sola consulta
    let qBoletos = `SELECT * FROM eventos_especiales_boletos WHERE evento_id IN (${ids}) ORDER BY evento_id, orden`;
    let boletosRes = await db.pool.query(qBoletos);
    const boletos = boletosRes[0] || [];

    // Mapear horarios por evento_id
    const horariosMap = {};
    horarios.forEach(h => {
      if (!horariosMap[h.evento_id]) horariosMap[h.evento_id] = [];
      horariosMap[h.evento_id].push(h);
    });

    // Mapear boletos por evento_id
    const boletosMap = {};
    boletos.forEach(b => {
      if (!boletosMap[b.evento_id]) boletosMap[b.evento_id] = [];
      boletosMap[b.evento_id].push(b);
    });

    // Adjuntar horarios y boletos a cada evento
    const enriched = eventos.map(ev => ({ ...ev, horarios: horariosMap[ev.id] || [], boletos: boletosMap[ev.id] || [] }));

    return res.status(200).json(enriched);
  } catch (error) {
    return res.status(500).json({ msg: 'Hubo un error obteniendo los eventos', error: true, details: error })
  }
})

// Obtener evento por id (incluye horarios y boletos)
app.get('/obtener/:id', async (req, res) => {
  try {
    const eventoId = req.params.id;

    let query = `SELECT * FROM eventos_especiales WHERE id=${eventoId}`;
    let evento = await db.pool.query(query);
    evento = mapEventoIndexFlag(evento[0][0]);

    if (!evento) return res.status(404).json({ error: true, msg: 'Evento no encontrado' });

    let qHorarios = `SELECT * FROM eventos_especiales_horarios WHERE evento_id=${eventoId} ORDER BY fecha, hora_inicio`;
    let qBoletos = `SELECT * FROM eventos_especiales_boletos WHERE evento_id=${eventoId} ORDER BY orden`;

    let horarios = await db.pool.query(qHorarios);
    let boletos = await db.pool.query(qBoletos);

    return res.status(200).json({ evento, horarios: horarios[0], boletos: boletos[0] });
  } catch (error) {
    return res.status(500).json({ msg: 'Hubo un error obteniendo el evento', error: true, details: error })
  }
})

// Crear evento especial (acepta imagen en campo 'image' y campos horarios/boletos como JSON string)
app.post('/crear', imageController.upload, async (req, res) => {
  let conn;
  try {
    const {
      titulo,
      descripcion_corta,
      descripcion_larga,
      fecha_inicio_agenda,
      fecha_fin_agenda,
      activo,
      destacado,
      mostrar_en_index
    } = req.body;

    const mostrarEnIndex = normalizeMostrarEnIndex(mostrar_en_index ?? destacado);

    let horarios = [];
    let boletos = [];
    try {
      if (req.body.horarios) horarios = JSON.parse(req.body.horarios);
    } catch (e) { horarios = []; }
    try {
      if (req.body.boletos) boletos = JSON.parse(req.body.boletos);
    } catch (e) { boletos = []; }

    // Validaciones mínimas
    if (!titulo) {
      // eliminar archivo subido si hay uno
      if (req.files && req.files.length > 0) {
        try {
          req.files.forEach(f => {
            const p = path.join(__dirname, '../images', f.filename);
            if (fs.existsSync(p)) fs.unlinkSync(p);
          })
        } catch (e) { console.log('Error borrando archivo tras validacion', e) }
      }
      return res.status(400).json({ error: true, msg: 'Titulo es requerido' });
    }

    // Validar que exista al menos un horario y un boleto
    if (!Array.isArray(horarios) || horarios.length === 0) {
      if (req.files && req.files.length > 0) {
        try { req.files.forEach(f => { const p = path.join(__dirname, '../images', f.filename); if (fs.existsSync(p)) fs.unlinkSync(p); }) } catch (e) { console.log('Error borrando archivo tras validacion', e) }
      }
      return res.status(400).json({ error: true, msg: 'Debe especificar al menos un horario' });
    }
    if (!Array.isArray(boletos) || boletos.length === 0) {
      if (req.files && req.files.length > 0) {
        try { req.files.forEach(f => { const p = path.join(__dirname, '../images', f.filename); if (fs.existsSync(p)) fs.unlinkSync(p); }) } catch (e) { console.log('Error borrando archivo tras validacion', e) }
      }
      return res.status(400).json({ error: true, msg: 'Debe especificar al menos un boleto' });
    }

    // Validar contenidos de horarios y boletos ANTES de iniciar la transacción
    for (let i = 0; i < horarios.length; i++) {
      const h = horarios[i];
      if (!h.fecha) {
        if (req.files && req.files.length > 0) {
          try { req.files.forEach(f => { const p = path.join(__dirname, '../images', f.filename); if (fs.existsSync(p)) fs.unlinkSync(p); }) } catch (e) { console.log('Error borrando archivo tras validacion', e) }
        }
        return res.status(400).json({ error: true, msg: `El horario #${i + 1} requiere la propiedad 'fecha'` });
      }
      if (!h.hora_inicio) {
        if (req.files && req.files.length > 0) {
          try { req.files.forEach(f => { const p = path.join(__dirname, '../images', f.filename); if (fs.existsSync(p)) fs.unlinkSync(p); }) } catch (e) { console.log('Error borrando archivo tras validacion', e) }
        }
        return res.status(400).json({ error: true, msg: `El horario #${i + 1} requiere la propiedad 'hora_inicio'` });
      }
    }

    for (let i = 0; i < boletos.length; i++) {
      const b = boletos[i];
      if (!b.titulo || b.titulo === '') {
        if (req.files && req.files.length > 0) {
          try { req.files.forEach(f => { const p = path.join(__dirname, '../images', f.filename); if (fs.existsSync(p)) fs.unlinkSync(p); }) } catch (e) { console.log('Error borrando archivo tras validacion', e) }
        }
        return res.status(400).json({ error: true, msg: `El boleto #${i + 1} requiere la propiedad 'titulo'` });
      }
    }

    let today = new Date();
    let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
    let fecha = date + ' ' + time;

    // imagen URL (si se subió archivo, subirla al frontend via base64 como en foto.js)
    let imagenUrl = null;
    if (req.files && req.files.length > 0) {
      try {
        let tituloImage = `${date}-${req.files[0].originalname}`;
        let thumb = `${process.env.URLFRONT}/images/eventos/${tituloImage}`;

        let file = fs.readFileSync(req.files[0].path, { encoding: 'base64' });
        let formdata = new FormData();
        formdata.append('thumb', file);
        formdata.append('nombre_thumb', tituloImage);

        // endpoint en el frontend que recibe base64 y guarda la imagen
        let response = await fetch(`${process.env.URLFRONT}/images/eventos/api_eventos_base64.php`, {
          method: 'POST',
          body: formdata
        });

        let result = await response.json();
        // algunos endpoints devuelven un array de resultados
        if (Array.isArray(result)) {
          result.forEach(element => { if (element.error) throw new Error(element.msg || 'Error subiendo imagen'); });
        } else if (result && result.error) {
          throw new Error(result.msg || 'Error subiendo imagen');
        }

        imagenUrl = thumb;
      } catch (e) {
        console.log('Error subiendo imagen a URLFRONT', e);
        // eliminar archivos locales subidos por multer
        try { if (req.files && req.files.length > 0) req.files.forEach(f => { const p = path.join(__dirname, '../images', f.filename); if (fs.existsSync(p)) fs.unlinkSync(p); }); } catch (ee) { console.log('Error borrando archivo local tras fallo subida', ee); }
        return res.status(400).json({ error: true, msg: 'No se pudo subir la imagen', details: e.message });
      }
    }

    // Generar slug desde el título
    let computedSlug = titulo.toString().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

    // Iniciar transacción
    conn = await db.pool.getConnection();
    await conn.beginTransaction();

    let qInsert = `INSERT INTO eventos_especiales
      (titulo, slug, descripcion_corta, descripcion_larga, imagen, fecha_inicio_agenda, fecha_fin_agenda, activo, destacado, orden, created_at, updated_at)
      VALUES
      ('${titulo}', '${computedSlug}', '${descripcion_corta || ''}', '${descripcion_larga || ''}', ${imagenUrl ? "'"+imagenUrl+"'" : 'NULL'}, ${fecha_inicio_agenda ? "'"+fecha_inicio_agenda+"'" : 'NULL'}, ${fecha_fin_agenda ? "'"+fecha_fin_agenda+"'" : 'NULL'}, ${activo ? activo : 1}, ${imagenUrl ? mostrarEnIndex : 0}, 0, '${fecha}', '${fecha}')`;

    let result = await conn.query(qInsert);
    result = result[0];
    const eventoId = result.insertId;

    // Insertar horarios (las validaciones ya se hicieron arriba)
    for (let i = 0; i < horarios.length; i++) {
      const h = horarios[i];
      let f = h.fecha;
      let hi = h.hora_inicio;
      let hf = h.hora_fin || null;
      let cupo_total = h.cupo_total && h.cupo_total !== '' ? h.cupo_total : null;

      let qH = `INSERT INTO eventos_especiales_horarios (evento_id, fecha, hora_inicio, hora_fin, cupo_total, activo, orden, created_at, updated_at) VALUES (${eventoId}, '${f}', '${hi}', ${hf ? "'"+hf+"'" : 'NULL'}, ${cupo_total !== null ? cupo_total : 'NULL'}, 1, 0, '${fecha}', '${fecha}')`;
      await conn.query(qH);
    }

    // Validar e insertar boletos
    for (let i = 0; i < boletos.length; i++) {
      const b = boletos[i];
      let tituloB = b.titulo;
      let descB = b.descripcion || '';
      let precio = b.precio && b.precio !== '' ? b.precio : 0.00;
      let cupo_total = b.cupo_total && b.cupo_total !== '' ? b.cupo_total : null;

      let qB = `INSERT INTO eventos_especiales_boletos (evento_id, titulo, descripcion, precio, cupo_total, cupo_disponible, activo, orden, created_at, updated_at) VALUES (${eventoId}, '${tituloB}', '${descB}', ${precio}, ${cupo_total !== null ? cupo_total : 'NULL'}, ${cupo_total !== null ? cupo_total : 'NULL'}, 1, 0, '${fecha}', '${fecha}')`;
      await conn.query(qB);
    }
    // Si todo salió bien commit
    await conn.commit();
    return res.status(200).json({ error: false, msg: 'Evento creado con exito', id: eventoId });

  } catch (error) {
    console.log('Error crear evento, realizando rollback', error);
    // rollback si hay conexión
    try {
      if (conn) await conn.rollback();
    } catch (rerr) {
      console.log('Error en rollback', rerr);
    }

    const message = error && error.message ? error.message : 'Error interno del servidor';
    return res.status(500).json({ error: true, msg: 'Error al crear el evento', details: message });
  } finally {
    if (conn) conn.release();
  }
})



// Eliminar evento (horarios y boletos) por id
app.delete('/delete/:id', async (req, res) => {
  let conn;
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: true, msg: 'Id requerido' });

    conn = await db.pool.getConnection();
    await conn.beginTransaction();

    // obtener imagen para eliminar archivo si existe
    const sel = await conn.query(`SELECT imagen FROM eventos_especiales WHERE id=${id}`);
    const row = sel[0][0];
    // borrar boletos
    await conn.query(`DELETE FROM eventos_especiales_boletos WHERE evento_id=${id}`);
    // borrar horarios
    await conn.query(`DELETE FROM eventos_especiales_horarios WHERE evento_id=${id}`);
    // borrar evento
    await conn.query(`DELETE FROM eventos_especiales WHERE id=${id}`);

    await conn.commit();

    // eliminar archivo fisico si aplica (fuera de la transacción)
    try {
      if (row && row.imagen) {
        const filename = path.basename(row.imagen);
        const p = path.join(__dirname, '../images', filename);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } catch (e) {
      console.log('Error borrando archivo en delete', e);
    }

    return res.status(200).json({ error: false, msg: 'Evento borrado con exito' });

  } catch (error) {
    console.log('Error deleting evento, rollback', error);
    try { if (conn) await conn.rollback(); } catch (r) { console.log('rollback error', r); }
    return res.status(500).json({ error: true, msg: 'Error borrando evento', details: error && error.message });
  } finally {
    if (conn) conn.release();
  }
});

// Actualizar evento (acepta imagen en campo 'image' y horarios/boletos como JSON)
app.put('/set', imageController.upload, async (req, res) => {
  let conn;
  try {
    const {
      id,
      titulo,
      descripcion_corta,
      descripcion_larga,
      fecha_inicio_agenda,
      fecha_fin_agenda,
      activo,
      destacado,
      mostrar_en_index
    } = req.body;

    const mostrarEnIndex = normalizeMostrarEnIndex(mostrar_en_index ?? destacado);

    if (!id) return res.status(400).json({ error: true, msg: 'Id es requerido' });

    let horarios = [];
    let boletos = [];
    try { if (req.body.horarios) horarios = JSON.parse(req.body.horarios); } catch (e) { horarios = []; }
    try { if (req.body.boletos) boletos = JSON.parse(req.body.boletos); } catch (e) { boletos = []; }

    // Validar contenidos si vienen
    for (let i = 0; i < horarios.length; i++) {
      const h = horarios[i];
      if (!h.fecha) return res.status(400).json({ error: true, msg: `El horario #${i + 1} requiere la propiedad 'fecha'` });
      if (!h.hora_inicio) return res.status(400).json({ error: true, msg: `El horario #${i + 1} requiere la propiedad 'hora_inicio'` });
    }
    for (let i = 0; i < boletos.length; i++) {
      const b = boletos[i];
      if (!b.titulo || b.titulo === '') return res.status(400).json({ error: true, msg: `El boleto #${i + 1} requiere la propiedad 'titulo'` });
    }

    let today = new Date();
    let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
    let fecha = date + ' ' + time;

    conn = await db.pool.getConnection();
    await conn.beginTransaction();

    // obtener imagen antigua
    const sel = await conn.query(`SELECT imagen FROM eventos_especiales WHERE id=${id}`);
    const oldRow = sel[0][0];

    let imagenUrl = null;
    if (req.files && req.files.length > 0) {
      try {
        let tituloImage = `${date}-${req.files[0].originalname}`;
        let thumb = `${process.env.URLFRONT}/images/eventos/${tituloImage}`;

        let file = fs.readFileSync(req.files[0].path, { encoding: 'base64' });
        let formdata = new FormData();
        formdata.append('thumb', file);
        formdata.append('nombre_thumb', tituloImage);

        let response = await fetch(`${process.env.URLFRONT}/images/eventos/api_eventos_base64.php`, {
          method: 'POST',
          body: formdata
        });

        let result = await response.json();
        if (Array.isArray(result)) {
          if (result.some(el => el.error)) throw new Error(result.find(el => el.error).msg || 'Error subiendo imagen');
        } else if (result && result.error) {
          throw new Error(result.msg || 'Error subiendo imagen');
        }

        imagenUrl = thumb;
      } catch (e) {
        console.log('Error subiendo imagen a URLFRONT en set', e);
        try { if (req.files && req.files.length > 0) req.files.forEach(f => { const p = path.join(__dirname, '../images', f.filename); if (fs.existsSync(p)) fs.unlinkSync(p); }); } catch (ee) { console.log('Error borrando archivo local tras fallo subida', ee); }
        return res.status(400).json({ error: true, msg: 'No se pudo subir la imagen', details: e.message });
      }
    }

    // actualizar tabla eventos_especiales
    let qUp = `UPDATE eventos_especiales SET titulo='${titulo || ''}', descripcion_corta='${descripcion_corta || ''}', descripcion_larga='${descripcion_larga || ''}', fecha_inicio_agenda=${fecha_inicio_agenda ? "'"+fecha_inicio_agenda+"'" : 'NULL'}, fecha_fin_agenda=${fecha_fin_agenda ? "'"+fecha_fin_agenda+"'" : 'NULL'}, activo=${activo ? activo : 1}, destacado=${(imagenUrl || oldRow?.imagen) ? mostrarEnIndex : 0}, updated_at='${fecha}'`;
    if (imagenUrl) qUp += `, imagen='${imagenUrl}'`;
    qUp += ` WHERE id=${id}`;

    await conn.query(qUp);

    // si se enviaron horarios/boletos, reemplazarlos
    if (Array.isArray(horarios) && horarios.length > 0) {
      await conn.query(`DELETE FROM eventos_especiales_horarios WHERE evento_id=${id}`);
      for (let i = 0; i < horarios.length; i++) {
        const h = horarios[i];
        let f = h.fecha;
        let hi = h.hora_inicio;
        let hf = h.hora_fin || null;
        let cupo_total = h.cupo_total && h.cupo_total !== '' ? h.cupo_total : null;
        // No insertar cupo_disponible aquí; dejamos que viajeTour sea la fuente de disponibilidad
        let qH = `INSERT INTO eventos_especiales_horarios (evento_id, fecha, hora_inicio, hora_fin, cupo_total, activo, orden, created_at, updated_at) VALUES (${id}, '${f}', '${hi}', ${hf ? "'"+hf+"'" : 'NULL'}, ${cupo_total !== null ? cupo_total : 'NULL'}, 1, 0, '${fecha}', '${fecha}')`;
        await conn.query(qH);
      }
    }

    if (Array.isArray(boletos) && boletos.length > 0) {
      await conn.query(`DELETE FROM eventos_especiales_boletos WHERE evento_id=${id}`);
      for (let i = 0; i < boletos.length; i++) {
        const b = boletos[i];
        let tituloB = b.titulo;
        let descB = b.descripcion || '';
        let precio = b.precio && b.precio !== '' ? b.precio : 0.00;
        let cupo_total = b.cupo_total && b.cupo_total !== '' ? b.cupo_total : null;
        let qB = `INSERT INTO eventos_especiales_boletos (evento_id, titulo, descripcion, precio, cupo_total, cupo_disponible, activo, orden, created_at, updated_at) VALUES (${id}, '${tituloB}', '${descB}', ${precio}, ${cupo_total !== null ? cupo_total : 'NULL'}, ${cupo_total !== null ? cupo_total : 'NULL'}, 1, 0, '${fecha}', '${fecha}')`;
        await conn.query(qB);
      }
    }

    await conn.commit();

    // eliminar archivo antiguo si se subió uno nuevo
    try {
      if (imagenUrl && oldRow && oldRow.imagen) {
        const filename = path.basename(oldRow.imagen);
        const p = path.join(__dirname, '../images', filename);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } catch (e) { console.log('Error borrando archivo antiguo en set', e); }

    return res.status(200).json({ error: false, msg: 'Evento actualizado con exito' });

  } catch (error) {
    console.log('Error updating evento, rollback', error);
    try { if (conn) await conn.rollback(); } catch (r) { console.log('rollback error', r); }
    return res.status(500).json({ error: true, msg: 'Error actualizando evento', details: error && error.message });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = app