/* Importing the express module and creating an instance of it. */
const express = require('express')
const app = express.Router()
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const auth = require('../middlewares/authorization')
const db = require('../config/db')
const imageController = require('../controller/imageGuiaController')
const fs = require('fs');
let FormData = require('form-data');
const fetch = require("node-fetch");


//////////////////////////////////////////
//                 Guia                 //
//////////////////////////////////////////

//Trae todos los guias de la DB
app.get('/guias', async (req, res) => {
  try {
    let query = `SELECT u.id, nombres, apellidos, u.telefono, u.correo, isGuia, isSpecialist, foto, identificacion, u.status, u.updated_at, empresa_id, cargo, area, nss, e.nombre AS empresa
                        FROM usuario 
                        AS u
                        INNER JOIN  empresa 
                        AS e
                        ON e.id = u.empresa_id
                        WHERE isGuia=1 OR isSpecialist = 1`;
    let guias = await db.pool.query(query);

    res.status(200).json(guias[0]);

  } catch (error) {
    res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
  }
})

app.get('/obtenerByEmpresa/:id', async (req, res) => {
  try {
    let empresaId = req.params.id;

    let query = `SELECT u.id, nombres, apellidos, u.telefono, u.correo, isGuia, isSpecialist, foto, identificacion, u.status, u.updated_at, empresa_id, cargo, area, nss, e.nombre AS empresa
                        FROM usuario 
                        AS u
                        INNER JOIN  empresa 
                        AS e
                        ON e.id = u.empresa_id
                        WHERE (isGuia=1 OR isSpecialist = 1)
                        AND u.empresa_id=${empresaId}`;
    let guias = await db.pool.query(query);

    res.status(200).json(guias[0]);

  } catch (error) {
    res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
  }
})


app.get('/obtener/:id', async (req, res) => {
  try {
    let guiaId = req.params.id;

    let query = `SELECT u.id, nombres, apellidos, u.telefono, u.correo, isGuia, foto, identificacion, u.status, u.updated_at, empresa_id, cargo, area, nss, hora_entrada, hora_salida, hora_salida_comer, hora_regreso_comer, e.nombre AS empresa
                        FROM usuario 
                        AS u
                        INNER JOIN  empresa 
                        AS e
                        ON e.id = u.empresa_id
                        WHERE isGuia=1 
                        AND u.id=${guiaId}`;
    let guia = await db.pool.query(query);

    res.status(200).json(guia[0]);

  } catch (error) {
    res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
  }
})


app.post('/crear', imageController.upload, async (req, res) => {
  try {
    let { nombres, apellidos, telefono, correo, password, empresa_id, tipoColaborador, cargo, area, nss, hora_entrada, hora_salida, hora_salida_comer, hora_regreso_comer } = req.body;

    let errors = [];

    if (!nombres) errors.push({ msg: "El campo nombres debe de contener un valor" });
    if (!apellidos) errors.push({ msg: "El campo apellidos debe de contener un valor" });
    if (!correo) errors.push({ msg: "El campo correo debe de contener un valor" });
    if (!password) errors.push({ msg: "El campo password debe de contener un valor" });
    if (!empresa_id) errors.push({ msg: "El campo empresa_id debe de contener un valor" });
    if (!tipoColaborador) tipoColaborador = 'Colaborador';

    if (!cargo) errors.push({ msg: "El campo cargo debe de contener un valor" });
    if (!area) errors.push({ msg: "El campo area debe de contener un valor" });
    if (!nss) errors.push({ msg: "El campo nss debe de contener un valor" });


    if (!telefono) telefono = null;

    if (errors.length >= 1) {
      return res.status(400).json({
        msg: 'Errores en los parametros',
        error: true,
        details: errors
      });
    }

    // Verificamos no exista el correo en la DB
    let query = `SELECT * FROM usuario WHERE correo='${correo}'`;
    let existCorreo = await db.pool.query(query);

    if (existCorreo[0].length >= 1) {
      return res.status(400).json({
        msg: 'El correo ya esta registrado',
        error: true,
      });
    }

    const salt = await bcryptjs.genSalt(10);
    const hashedPassword = await bcryptjs.hash(password, salt);

    let today = new Date();
    let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
    let fecha = date + ' ' + time;

    // ============================
    // VALIDAMOS ARCHIVOS
    // ============================
    let foto1 = null;

    let existeFoto = req.files?.foto && req.files.foto.length > 0;


    // ============================
    // SI HAY ARCHIVOS, LOS SUBIMOS
    // ============================
    if (existeFoto) {

      let formdata = new FormData();

      if (existeFoto) {
        let tituloFoto = `${date}-${req.files.foto[0].originalname}`;
        foto1 = `${process.env.URLFRONT}/images/guias/${tituloFoto}`;

        let file = fs.readFileSync(req.files.foto[0].path, { encoding: "base64" });

        formdata.append('foto', file);
        formdata.append('nombre_foto', tituloFoto);
      }



      let response = await fetch(`${process.env.URLFRONT}/images/guias/api_guias_base64.php`, {
        method: 'POST',
        body: formdata
      });

      let result = await response.json();

      for (let element of result) {
        if (element.error) {
          return res.status(400).json({
            error: true,
            msg: "No se agregaron las fotos, intentarlo nuevamente",
            details: element.msg
          });
        }
      }
    }

    // ============================
    // PREPARAMOS VALORES PARA SQL
    // ============================
    let fotoDB = foto1 ? `'${foto1}'` : `NULL`;

    // ============================
    // INSERT
    // ============================
    if (tipoColaborador == 'Colaborador') {

      query = `INSERT INTO usuario 
          (nombres, apellidos, telefono, correo, password,
          isGuia, foto,  empresa_id, cargo, area, nss, hora_entrada, hora_salida, hora_salida_comer, hora_regreso_comer,
          created_at, updated_at) 
          VALUES 
          ('${nombres}', '${apellidos}', 
          ${telefono ? `'${telefono}'` : 'NULL'},
          '${correo}', 
          '${hashedPassword}', 
          1, ${fotoDB}, '${empresa_id}', '${cargo}', '${area}', '${nss}', '${hora_entrada}', '${hora_salida}', '${hora_salida_comer}', '${hora_regreso_comer}',
          '${fecha}', '${fecha}')`;

    } else if (tipoColaborador == 'Especialista') {

      query = `INSERT INTO usuario 
          (nombres, apellidos, telefono, correo, password,
          isSpecialist, foto, empresa_id, cargo, area, nss, hora_entrada, hora_salida, hora_salida_comer, hora_regreso_comer,
          created_at, updated_at) 
          VALUES 
          ('${nombres}', '${apellidos}', 
          ${telefono ? `'${telefono}'` : 'NULL'},
          '${correo}', 
          '${hashedPassword}', 
          1, ${fotoDB}, '${empresa_id}', '${cargo}', '${area}', '${nss}', '${hora_entrada}', '${hora_salida}', '${hora_salida_comer}', '${hora_regreso_comer}',
          '${fecha}', '${fecha}')`;

    }

    let insertResult = await db.pool.query(query);
    insertResult = insertResult[0];

    const payload = {
      guia: {
        id: insertResult.insertId,
      }
    };

    jwt.sign(payload, process.env.SECRET, { expiresIn: 36000 }, (error, token) => {
      if (error) throw error;
      res.status(200).json({ error: false, token: token });
    });

  } catch (error) {
    res.status(400).json({
      error: true,
      message: error.message,
      stack: error.stack
    });
  }
});


app.put('/set', imageController.upload, async (req, res) => {
  try {
    let { id, nombres, apellidos, telefono, password, empresa_id, cargo, area, nss, hora_entrada, hora_salida, hora_salida_comer, hora_regreso_comer } = req.body;

    let errors = [];

    if (!id) errors.push({ msg: "El campo id debe de contener un valor valido" });
    if (!nombres) errors.push({ msg: "El campo nombres debe de contener un valor" });
    if (!apellidos) errors.push({ msg: "El campo apellidos debe de contener un valor" });
    if (!empresa_id) errors.push({ msg: "El campo empresa_id debe de contener un valor" });
    if (!cargo) errors.push({ msg: "El campo cargo debe de contener un valor" });
    if (!area) errors.push({ msg: "El campo area debe de contener un valor" });
    if (!nss) errors.push({ msg: "El campo nss debe de contener un valor" });




    if (!telefono) telefono = null;

    if (errors.length >= 1) {
      return res.status(400).json({
        msg: 'Errores en los parametros',
        error: true,
        details: errors
      });
    }

    let today = new Date();
    let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
    let fecha = date + ' ' + time;

    // ============================
    // VALIDAMOS ARCHIVOS
    // ============================
    let existeFoto = req.files?.foto && req.files.foto.length > 0;


    let formdata = new FormData();
    let noFotos = 0;

    // ============================
    // ARMAMOS QUERY BASE
    // ============================
    let query = `UPDATE usuario SET
        nombres          = '${nombres}', 
        apellidos        = '${apellidos}',
        cargo            = '${cargo}',
        area             = '${area}',
        nss              = '${nss}',
        hora_entrada     = '${hora_entrada}',
        hora_salida      = '${hora_salida}',
        hora_salida_comer= '${hora_salida_comer}',
        hora_regreso_comer= '${hora_regreso_comer}',
        telefono         = ${telefono ? `'${telefono}'` : 'NULL'},`;

    // ============================
    // PASSWORD
    // ============================   
    if (password) {
      const salt = await bcryptjs.genSalt(10);
      const hashedPassword = await bcryptjs.hash(password, salt);
      query += `password = '${hashedPassword}',`;
    }
    // ============================
    // FOTO
    // ============================
    if (existeFoto) {
      noFotos++;

      let tituloFoto = `${date}-${req.files.foto[0].originalname}`;
      let foto1 = `${process.env.URLFRONT}/images/guias/${tituloFoto}`;

      let file = fs.readFileSync(req.files.foto[0].path, { encoding: "base64" });

      formdata.append('foto', file);
      formdata.append('nombre_foto', tituloFoto);

      query += `foto = '${foto1}',`;
    }

    // ============================
    // SI HAY ARCHIVOS, SUBIMOS
    // ============================
    if (existeFoto) {

      let response = await fetch(`${process.env.URLFRONT}/images/guias/api_guias_base64.php`, {
        method: 'POST',
        body: formdata
      });

      let result = await response.json();

      let noErrors = 0;

      result.forEach(element => {
        if (element.error) {
          noErrors++;
        }
      });

      // Si hay errores al subir
      if (noErrors >= 4 || (noFotos >= 2 && noErrors >= 2) || noErrors == 1) {
        return res.status(400).json({
          error: true,
          msg: "No se agregaron las fotos, intentarlo nuevamente"
        });
      }
    }

    // ============================
    // TERMINAMOS QUERY
    // ============================
    query += `
        empresa_id      = '${empresa_id}', 
        updated_at      = '${fecha}'
        WHERE id        = ${id}`;

    let resultDB = await db.pool.query(query);
    resultDB = resultDB[0];

    res.status(200).json({
      error: false,
      msg: `Registro actualizado con exito, fotos actualizadas: ${noFotos}`
    });

  } catch (error) {
    res.status(400).json({
      error: true,
      message: error.message,
      stack: error.stack
    });
  }
});


app.put('/setBasicData', async (req, res) => {
  try {
    let { id, nombres, apellidos, password, telefono } = req.body

    let errors = Array();

    if (!id) {
      errors.push({ msg: "El campo id debe de contener un valor valido" });
    }
    if (!nombres) {
      errors.push({ msg: "El campo nombres debe de contener un valor" });
    }
    if (!apellidos) {
      errors.push({ msg: "El campo apellidos debe de contener un valor" });
    }
    if (!telefono) {
      telefono = null;
    }

    if (errors.length >= 1) {

      return res.status(400)
        .json({
          msg: 'Errores en los parametros',
          error: true,
          details: errors
        });

    }

    let today = new Date();
    let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
    let fecha = date + ' ' + time;
    let query = ``;

    if (password) {
      const salt = await bcryptjs.genSalt(10);
      const hashedPassword = await bcryptjs.hash(password, salt);

      query = `UPDATE usuario  SET
                        nombres              = '${nombres}', 
                        apellidos            = '${apellidos}',
                        telefono             = '${telefono}', 
						password             = '${hashedPassword}',
                        updated_at           = '${fecha}'
                        WHERE id             = ${id}`;
    } else {
      query = `UPDATE usuario  SET
                        nombres              = '${nombres}', 
                        apellidos            = '${apellidos}',
                        telefono             = '${telefono}', 
                        updated_at           = '${fecha}'
                        WHERE id             = ${id}`;
    }

    let result = await db.pool.query(query);
    result = result[0];


    res.status(200).json({ error: false, msg: "Registro actualizado con exito" })

  } catch (error) {
    res.status(400).json({ error: true, details: error })
  }
})


app.put('/delete', async (req, res) => {
  try {
    let guiaId = req.body.id;

    if (!guiaId) {
      return res.status(400)
        .json({
          msg: 'El id debe ser un numero entero',
          error: true
        });
    }

    let today = new Date();
    let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
    let fecha = date + ' ' + time;

    let query = `UPDATE usuario SET
                        status      = 0,
                        updated_at  = '${fecha}'
                        WHERE id    = ${guiaId}`;

    let result = await db.pool.query(query);
    result = result[0];

    res.status(200).json({ error: false, msg: "Se ha dado de baja al guia con exito" })

  } catch (error) {
    res.status(400).json({ error: true, details: error })
  }
})

app.put('/active', async (req, res) => {
  try {
    let guiaId = req.body.id;

    if (!guiaId) {
      return res.status(400)
        .json({
          msg: 'El id debe ser un numero entero',
          error: true
        });
    }

    let today = new Date();
    let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
    let fecha = date + ' ' + time;

    let query = `UPDATE usuario SET
                        status      = 1,
                        updated_at  = '${fecha}'
                        WHERE id    = ${guiaId}`;

    let result = await db.pool.query(query);
    result = result[0];

    res.status(200).json({ error: false, msg: "Se ha reactivado al guia con exito" })

  } catch (error) {
    res.status(400).json({ error: true, details: error })
  }
})

// Login para guías
app.post('/login', async (req, res) => {
  try {
    // aceptar tanto "email" como "correo" por compatibilidad
    const { email, correo, password } = req.body;
    const correoUser = email || correo;
    let errors = Array();
    if (!correoUser) errors.push({ msg: "El campo correo/email debe de contener un valor" });
    if (!password) errors.push({ msg: "El campo password debe de contener un valor" });
    if (errors.length >= 1) {
      return res.status(400).json({ msg: 'Errores en los parametros', error: true, details: errors });
    }
    // Buscar guía activo y que sea guía (isGuia=1)
    let query = `SELECT * FROM usuario WHERE correo = '${correoUser}' AND status = 1 AND isGuia = 1`;
    let result = await db.pool.query(query);
    let rows = result[0];
    if (rows.length === 0) {
      return res.status(400).json({ msg: 'El guía no existe o no está activo', error: true });
    }
    let guia = rows[0];
    // Verificar que exista password (si tus guías no tienen password, hay que setear una)
    if (!guia.password) {
      return res.status(400).json({ msg: 'No hay contraseña registrada para este guía. Asigna una antes de intentar login.', error: true });
    }
    // Comparar password
    const passCorrecto = await bcryptjs.compare(password, guia.password);
    if (!passCorrecto) {
      return res.status(400).json({ msg: 'Password incorrecto', error: true });
    }
    // Payload idéntico al login de users.js (para que el front lo trate igual)
    const payload = {
      user: {
        id: guia.id
      }
    }
    // Igual que users.js: mismo secret y mismo expiresIn
    jwt.sign(payload, process.env.SECRET, { expiresIn: 3600000 }, (error, token) => {
      if (error) throw error;
      res.status(200).json({ error: false, token: token });
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ msg: 'Hubo un error en el servidor', error: true, details: error });
  }
});

module.exports = app