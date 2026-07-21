/* Importing the express module and creating an instance of it. */
const express = require('express')
const app = express.Router()
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const auth = require('../middlewares/authorization')
const db = require('../config/db')
const imageController = require('../controller/imageController')
const fs = require('fs');
const FormData = require('form-data');
const fetch = require("node-fetch");

//////////////////////////////////////////
//                Empresa               //
//////////////////////////////////////////

//Trae todas las empresas de la BD
app.get('/empresas', async (req, res) => {
    try {
        let query = "SELECT * FROM empresa";
        let empresas = await db.pool.query(query);

        res.status(200).json(empresas[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//Trae una empresa basada en su id
app.get('/obtener/:id', async (req, res) => {
    try {
        let empresaId = req.params.id;

        let query = `SELECT * FROM empresa WHERE id=${empresaId}`;
        let empresa = await db.pool.query(query);


        res.status(200).json(empresa[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//Crea una registro de empresa
app.post('/crear', imageController.upload, async (req, res) => {
    try {
        let { nombre, telefono, correo, ubicacion, descripcion, paypal, tarjeta } = req.body

        let errors = Array();

        if (!nombre) {
            errors.push({ msg: "El campo nombres debe de contener un valor" });
        }
        if (!telefono) {
            errors.push({ msg: "El campo apellidos debe de contener un valor" });
        }
        if (!correo) {
            errors.push({ msg: "El campo correo debe de contener un valor" });
        }
        if (!ubicacion) {
            errors.push({ msg: "El campo ubicacion debe de contener un valor" });
        }
        if (!descripcion) {
            descripcion = null;
        }
        if (!paypal) {
            paypal = null;
        }
        if (!tarjeta) {
            tarjeta = null;
        }

        if (errors.length >= 1) {

            return res.status(400)
                .json({
                    msg: 'Errores en los parametros',
                    error: true,
                    details: errors
                });

        }

        //Verificamos no exista el correo en la DB
        let query = `SELECT *
                        FROM empresa 
                        WHERE correo='${correo}'`;

        let existCorreo = await db.pool.query(query);

        if (existCorreo[0].length >= 1) {
            return res.status(400)
                .json({
                    msg: 'El correo ya esta registrado',
                    error: true,
                });
        }

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        if (req.files.length != 0) {
            let tituloImage = `${date}-${req.files[0].originalname}`;
            let url = `${process.env.URLFRONT}/images/empresas/${tituloImage}`;

            let file = fs.readFileSync(req.files[0].path, { encoding: "base64" });

            let formdata = new FormData();
            formdata.append('logo', file);
            formdata.append('nombre_logo', tituloImage);

            let response = await fetch(`${process.env.URLFRONT}/images/empresas/api_empresas_base64.php`, {
                method: 'POST',
                body: formdata
            });

            let result = await response.json();

            result.forEach(element => {
                if (element.error) {
                    return res.status(400).json({ error: true, msg: "No se agregaron las fotos, intenterlo nuevamente", details: element.msg })
                }
            });

            query = `INSERT INTO empresa 
					(nombre, telefono, 
                    correo, ubicacion, 
                    descripcion, logo, 
                    paypal, tarjeta, 
                    created_at, updated_at) 
					VALUES 
                    ('${nombre}', '${telefono}',
                    '${correo}', '${ubicacion}',
                    '${descripcion}', '${url}',
                    '${paypal}', '${tarjeta}',
                    '${fecha}', '${fecha}')`;

            result = await db.pool.query(query);
            result = result[0];

            const payload = {
                empresa: {
                    id: result.insertId,
                }
            }

            jwt.sign(payload, process.env.SECRET, { expiresIn: 36000 }, (error, token) => {
                if (error) throw error
                res.status(200).json({ error: false, token: token })
                //res.json(respuestaDB)
            })
        } else {
            return res.status(400).json({ error: true, msg: "Imagen no detectada por multer", details: `Contenido en files: ${req.files}` })
        }

    } catch (error) {
        console.log(error);
        res.status(400).json({ error: true, details: error })
    }
})

//modifica un registro empresa
app.put('/set', imageController.upload, async (req, res) => {
    try {
        let { id, nombre, telefono, correo, ubicacion, descripcion, paypal, tarjeta } = req.body

        let errors = Array();

        if (!id) {
            errors.push({ msg: "El campo id debe de contener un valor valido" });
        }
        if (!nombre) {
            errors.push({ msg: "El campo nombres debe de contener un valor" });
        }
        if (!telefono) {
            errors.push({ msg: "El campo apellidos debe de contener un valor" });
        }
        if (!ubicacion) {
            errors.push({ msg: "El campo ubicacion debe de contener un valor" });
        }
        if (!descripcion) {
            descripcion = null;
        }
        if (!paypal) {
            paypal = null;
        }
        if (!tarjeta) {
            tarjeta = null;
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

        let query = `UPDATE empresa  SET
                    nombre      = '${nombre}', 
                    telefono    = '${telefono}',`;

        if (correo) {
            query = query + `correo = '${correo}',`;
        }

        query = query + `ubicacion   = '${ubicacion}', 
                        descripcion = '${descripcion}',`;

        if (req.files.length != 0) {

            let tituloImage = `${date}-${req.files[0].originalname}`;
            let url = `${process.env.URLFRONT}/images/empresas/${tituloImage}`;

            let file = fs.readFileSync(req.files[0].path, { encoding: "base64" });

            let formdata = new FormData();
            formdata.append('logo', file);
            formdata.append('nombre_logo', tituloImage);

            let response = await fetch(`${process.env.URLFRONT}/images/empresas/api_empresas_base64.php`, {
                method: 'POST',
                body: formdata
            });

            let result = await response.json();

            result.forEach(element => {
                if (element.error) {
                    return res.status(400).json({ error: true, msg: "No se agregaron las fotos, intenterlo nuevamente", details: element.msg })
                }
            });

            query = query + `logo = '${url}',`;
        }

        query = query + `paypal     = '${paypal}', 
                tarjeta     = '${tarjeta}', 
                updated_at  = '${fecha}'
                WHERE id    = ${id}`;

        result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error: false, msg: "Registro actualizado con exito" })

    } catch (error) {
        console.log(error);
        res.status(400).json({ error: true, details: error })
    }
})

//Se da de baja una empresa cambiando el status a 0
app.put('/delete', async (req, res) => {
    try {
        let empresaId = req.body.id;

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE empresa  SET
                        status      = 0,
                        updated_at  = '${fecha}'
                        WHERE id    = ${empresaId}`;

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error: false, msg: "Se ha dado de baja la empresa con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

//Se reactiva la empresa cambiando el status a 1
app.put('/active', async (req, res) => {
    try {
        let empresaId = req.body.id;

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE empresa  SET
                        status      = 1,
                        updated_at  = '${fecha}'
                        WHERE id    = ${empresaId}`;

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error: false, msg: "Se ha reactivado la empresa con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

module.exports = app