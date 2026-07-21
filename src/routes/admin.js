/* Importing the express module and creating an instance of it. */
const express = require('express')
const app = express.Router()
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const auth = require('../middlewares/authorization')
const db = require('../config/db')
const mailer = require('../controller/mailController')

//////////////////////////////////////////
//            Administrador             //
//////////////////////////////////////////

//Trae todos los administradores de la DB
app.get('/administradores', async (req, res) => {
    try {
        let query = `SELECT u.id, nombres, apellidos, u.telefono, u.correo, isAdmin, tipoAdmin, u.status, empresa_id, e.nombre AS empresa
                        FROM usuario 
                        AS u
                        INNER JOIN empresa
                        AS e
                        ON e.id = u.empresa_id
                        WHERE isAdmin=1`;

        let administradores = await db.pool.query(query);
        res.status(200).json(administradores[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//Trae un administrador por su ID
app.get('/obtener/:id', async (req, res) => {
    try {
        //obtenemos el campo id de los params
        let adminId = req.params.id;

        let query = `SELECT u.id, nombres, apellidos, u.telefono, u.correo, isAdmin, tipoAdmin, u.status, empresa_id, e.nombre AS empresa
                        FROM usuario 
                        AS u
                        INNER JOIN empresa
                        AS e
                        ON e.id = u.empresa_id
                        WHERE u.id=${adminId} 
                        AND isAdmin=1`;

        let admin = await db.pool.query(query);

        res.status(200).json(admin[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//Crea un registro en administrador
app.post('/crear', async (req, res) => {
    try {
        let { nombres, apellidos, telefono, correo, password, tipoAdmin, isSuperAdmin, empresa_id } = req.body
        let errors = Array();

        if (!nombres) {
            errors.push({ msg: "El campo nombres debe de contener un valor" });
        }
        if (!apellidos) {
            errors.push({ msg: "El campo apellidos debe de contener un valor" });
        }
        if (!correo) {
            errors.push({ msg: "El campo correo debe de contener un valor" });
        }
        if (!password) {
            errors.push({ msg: "El campo password debe de contener un valor" });
        }
        if (!tipoAdmin) {
            errors.push({ msg: "El campo tipoAdmin debe de contener un valor" });
        }
        if (!isSuperAdmin) {
            errors.push({ msg: "El campo isSuperAdmin debe de contener un valor" });
        }
        if (!empresa_id) {
            errors.push({ msg: "El campo empresa_id debe de contener un valor" });
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

        //Verificamos no exista el correo en la DB
        let query = `SELECT *
                        FROM usuario 
                        WHERE correo='${correo}'`;

        let existCorreo = await db.pool.query(query);
        
        if (existCorreo[0].length >= 1) {
            return res.status(400)
                .json({
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

        query = `INSERT INTO usuario
                        (nombres, apellidos, 
                        telefono, correo, 
                        password, isAdmin,
                        tipoAdmin, isSuperAdmin, 
                        empresa_id,
                        created_at, updated_at) 
                        VALUES 
                        ('${nombres}', '${apellidos}',
                        '${telefono}', '${correo}',
                        '${hashedPassword}', 1,
                        '${tipoAdmin}', '${isSuperAdmin}', 
                        '${empresa_id}',
                        '${fecha}', '${fecha}')`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            admin: {
                id: result.insertId,
            }
        }

        jwt.sign(payload, process.env.SECRET, { expiresIn: 36000 }, (error, token) => {
            if (error) throw error
            res.status(200).json({error:false, token:token})
            //res.json(respuestaDB)
        })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

//Modifica un registro de administrador
app.put('/set', async (req, res) => {
    try {
        let { id, nombres, apellidos, telefono, password, tipoAdmin, isSuperAdmin, empresa_id } = req.body;

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
        if (!tipoAdmin) {
            errors.push({ msg: "El campo tipoAdmin debe de contener un valor" });
        }
        if (!isSuperAdmin) {
            errors.push({ msg: "El campo isSuperAdmin debe de contener un valor" });
        }
        if (!empresa_id) {
            errors.push({ msg: "El campo empresa_id debe de contener un valor" });
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
                        nombres     = '${nombres}', 
                        apellidos   = '${apellidos}',
                        telefono    = '${telefono}', 
                        password    = '${hashedPassword}',
                        tipoAdmin   = '${tipoAdmin}', 
                        isSuperAdmin = '${isSuperAdmin}', 
                        empresa_id  = '${empresa_id}', 
                        updated_at  = '${fecha}'
                        WHERE id    = ${id}`;

        } else {

            query = `UPDATE usuario  SET
                        nombres     = '${nombres}', 
                        apellidos   = '${apellidos}',
                        telefono    = '${telefono}', 
                        tipoAdmin   = '${tipoAdmin}', 
                        isSuperAdmin = '${isSuperAdmin}', 
                        empresa_id  = '${empresa_id}', 
                        updated_at  = '${fecha}'
                        WHERE id    = ${id}`;

        }

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error:false, msg: "Registro actualizado con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.post('/resetpass', async (req, res) => {
    try {
        let correoAdmin = req.body.correo;

        if (!correo) {
            return res.status(400)
                .json({
                    msg: 'El campo correo debe de contener un valor',
                    error: true,
                });
        }

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `SELECT id, isAdmin, status 
                        FROM usuario 
                        WHERE correo = '${correoAdmin}' 
                        AND  isAdmin = 1 
                        AND  status  = 1`;

        let admin = await db.pool.query(query);

        if (admin[0].length != 0) {

            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let newpass = Math.random().toString(36).substring(0, 10);

            let message = {
                from: process.env.MAIL, // sender address
                to: correoAdmin, // list of receivers
                subject: "Cambio de Contraseña", // Subject line
                text: "", // plain text body
                html: `<p>Su nueva contraseña es: ${newpass}</p>`, // html body
            }

            const info = await mailer.sendMail(message);
            console.log(info);

            const salt = await bcryptjs.genSalt(10);
            const hashedPassword = await bcryptjs.hash(newpass, salt);

            admin = admin[0][0];

            query = `UPDATE usuario SET
						password    = '${hashedPassword}', 
						updated_at  = '${fecha}'
						WHERE id    = ${admin.id}`;

            let result = await db.pool.query(query);
        }

        res.status(200).json({ error:false, msg: "Se ha enviado el correo electronico" })

    } catch (error) {
        console.log(error);
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.put('/delete', async (req, res) => {
    try {
        let adminId = req.body.id;

        if (!adminId) {
            return res.status(400)
                .json({
                    msg: 'El id debe tener algun valor',
                    error: true
                });
        }

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE usuario  SET
                        status      = 0,
                        updated_at  = '${fecha}'
                        WHERE id    = ${adminId}`;

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error:false, msg: "Se ha dado de baja al administrador con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/active', async (req, res) => {
    try {
        let adminId = req.body.id;

        if (!adminId) {
            return res.status(400)
                .json({
                    msg: 'El id debe tener algun valor',
                    error: true
                });
        }

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE usuario  SET
                        status      = 1,
                        updated_at  = '${fecha}'
                        WHERE id    = ${adminId}`;

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error:false, msg: "Se ha reactivado al administrador con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})


module.exports = app