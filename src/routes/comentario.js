/* Importing the express module and creating an instance of it. */
const express = require('express')
const app = express.Router()
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const auth = require('../middlewares/authorization')
const db = require('../config/db')

//////////////////////////////////////////
//              Comentario              //
//////////////////////////////////////////
app.get('/comentarios', async (req, res) => {
    try {
        let query = `SELECT c.id, estrellas, comentario, c.created_at, c.updated_at, viajeTour_id, cliente_id, u.nombres, u.apellidos
                    FROM comentario
                    AS c
                    INNER JOIN usuario
                    AS u
                    ON c.cliente_id = u.id`;

        let comentario = await db.pool.query(query);

        res.status(200).json(comentario[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/obtenerByEmpresa/:id', async (req, res) => {
    try {
        let empresaId = req.params.id;
        let query = `SELECT c.id, estrellas, comentario, c.created_at, c.updated_at, c.viajeTour_id, cliente_id, u.nombres, u.apellidos
                    FROM comentario
                    AS c
                    INNER JOIN usuario
                    AS u
                    ON c.cliente_id = u.id
                    INNER JOIN viajeTour
                    AS vt
                    On c.viajeTour_id = vt.id
                    INNER JOIN tour
                    AS t
                    ON vt.tour_id = t.id
                    INNER JOIN empresa
                    AS e
                    ON t.empresa_id = e.id
                    WHERE e.id=${empresaId}`;

        let comentario = await db.pool.query(query);

        res.status(200).json(comentario[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/obtenerByTour/:id', async (req, res) => {
    try {
        let tourId = req.params.id;
        let query = `SELECT c.id, estrellas, comentario, c.created_at, c.updated_at, c.viajeTour_id, cliente_id, u.nombres, u.apellidos
                    FROM comentario
                    AS c
                    INNER JOIN usuario
                    AS u
                    ON c.cliente_id = u.id
                    INNER JOIN viajeTour
                    AS vt
                    On c.viajeTour_id = vt.id
                    INNER JOIN tour
                    AS t
                    ON vt.tour_id = t.id
                    WHERE t.id=${tourId}`;

        let comentario = await db.pool.query(query);

        res.status(200).json(comentario[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})


app.get('/obtener/:id', async (req, res) => {
    try {
        let comentarioId = req.params.id;
        let query = `SELECT c.id, estrellas, comentario, c.created_at, c.updated_at, viajeTour_id, cliente_id, u.nombres, u.apellidos
                    FROM comentario
                    AS c
                    INNER JOIN usuario
                    AS u
                    ON c.cliente_id = u.id 
                    WHERE c.id=${comentarioId}`;
        let comentario = await db.pool.query(query);

        res.status(200).json(comentario[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})


app.post('/crear', async (req, res) => {
    try {
        const { estrellas, comentario, viajeTourId, cliente_id} = req.body

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `INSERT INTO comentario 
                        (estrellas, comentario, created_at, updated_at, viajeTour_id, cliente_id) 
                        VALUES 
                        ('${estrellas}', '${comentario}', '${fecha}', '${fecha}', '${viajeTourId}', '${cliente_id}')`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            comentario: {
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
        const {id, estrellas, comentario, viajeTourId, cliente_id} = req.body

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE comentario SET
                        estrellas     = '${estrellas}', 
                        comentario    ='${comentario}',
                        updated_at    = '${fecha}',
                        viajeTour_id  = '${viajeTourId}',
                        cliente_id    = '${cliente_id}'
                        WHERE id      = ${id}`;

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
        let comentarioId = req.params.id;

        let query = `DELETE FROM comentario WHERE id = ${comentarioId}`;

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error:false, msg: "Se ha borrado el comentario con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

module.exports = app
