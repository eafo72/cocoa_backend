/* Importing the express module and creating an instance of it. */
const express = require('express')
const app = express.Router()
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const auth = require('../middlewares/authorization')
const db = require('../config/db')

//////////////////////////////////////////
//              Catregoria              //
//////////////////////////////////////////
app.get('/catregorias', async (req, res) => {
    try {
        let query = "SELECT * FROM catregoria";
        let catregorias = await db.pool.query(query);

        res.status(200).json(catregorias[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})


app.get('/obtener/:id', async (req, res) => {
    try {
        let catregoriaId = req.params.id;

        let query = `SELECT * FROM catregoria WHERE id=${catregoriaId}`;
        let catregoria = await db.pool.query(query);

        res.status(200).json(catregoria[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})


app.post('/crear', async (req, res) => {
    try {
        const { nombre } = req.body

        if (!nombre) {
            return res.status(400)
                .json({
                    msg: 'El campo nombre debe de tener un valor',
                    error: true
                });
        }

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `INSERT INTO catregoria 
                        (nombre, created_at, updated_at) 
                        VALUES 
                        ('${nombre}', '${fecha}', '${fecha}')`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            catregoria: {
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

app.put('/set', async (req, res) => {
    try {
        const { id, nombre } = req.body

        let errors = Array();

        if (!id) {
            errors.push({ msg: "El campo id debe de contener un valor" });
        }
        if (!nombre) {
            errors.push({ msg: "El campo nombres debe de contener un valor" });
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

        let query = `UPDATE catregoria SET
                        nombre     = '${nombre}', 
                        updated_at = '${fecha}'
                        WHERE id   = ${id}`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            empresa: {
                id: result.insertId,
            }
        }

        res.status(200).json({ error:false, msg: "Registro actualizado con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.delete('/delete/:id', async (req, res) => {
    try {
        let categoriaId = req.params.id;

        let query = `DELETE FROM catregoria WHERE id = ${categoriaId}`;

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error: false, msg: "Se ha borrado la categoria con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

module.exports = app