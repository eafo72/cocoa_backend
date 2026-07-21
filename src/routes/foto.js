/* Importing the express module and creating an instance of it. */
const express = require('express')
const app = express.Router()
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const auth = require('../middlewares/authorization')
const db = require('../config/db')
const imageController = require('../controller/imageController')
const fs = require('fs');
let FormData = require('form-data');
const fetch = require("node-fetch");

//////////////////////////////////////////
//              Foto-Tour               //
//////////////////////////////////////////

app.get('/fotos', async (req, res) => {
    try {
        let query = "SELECT * FROM foto";
        let fotos = await db.pool.query(query);

        res.status(200).json(fotos[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})


app.get('/obtener/:id', async (req, res) => {
    try {
        let fotoId = req.params.id;

        let query = `SELECT * FROM foto WHERE id=${fotoId}`;
        let tour = await db.pool.query(query);

        res.status(200).json(tour[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//obtenermos las fotos de un tour
app.get('/obtenerbytour/:id', async (req, res) => {
    try {
        let tourId = req.params.id;

        let query = `SELECT * 
                        FROM foto 
                        WHERE tour_id=${tourId}`;

        let fotos = await db.pool.query(query);

        res.status(200).json(fotos[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})


app.post('/crear', imageController.upload, async (req, res) => {
    try {
        const { id } = req.body

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;
        let images = new Array();

        let tituloImage = `${date}-${req.files[0].originalname}`;
        let thumb = `${process.env.URLFRONT}/images/tours/${tituloImage}`;

        let file = fs.readFileSync(req.files[0].path, { encoding: "base64" });

        let formdata = new FormData();
        formdata.append('thumb', file);
        formdata.append('nombre_thumb', tituloImage);

        let response = await fetch(`${process.env.URLFRONT}/images/tours/api_tours_base64.php`, {
            method: 'POST',
            body: formdata
        });

        
        let result = await response.json();


        result.forEach(element => {
            if (element.error) {
                return res.status(400).json({ error: true, msg: "No se agregaron las fotos, intenterlo nuevamente", details: element.msg })
            }
        });

        let query2 = `INSERT INTO foto
                        (titulo, url, created_at, updated_at, tour_id)
                        VALUES 
                        ('${tituloImage}', '${thumb}', '${fecha}', '${fecha}', '${id}')`;

        let resultImage = db.pool.query(query2);


        const payload = {
            tour: {
                id: id
            },
            image: {
                imges: images,
            }
        }

        jwt.sign(payload, process.env.SECRET, { expiresIn: 36000 }, (error, token) => {
            if (error) throw error
            res.status(200).json({ error: false, token: token })
            //res.json(respuestaDB)
        })

    } catch (error) {
        console.log(error);
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/set', imageController.upload, async (req, res) => {
    try {
        const { id, tourId } = req.body

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;
        let query = ``;

        if (req.files.length != 0) {

            let tituloImage = `${date}-${req.files[0].originalname}`;
            let thumb = `${process.env.URLFRONT}/images/tours/${tituloImage}`;

            let file = fs.readFileSync(req.files[0].path, { encoding: "base64" });

            let formdata = new FormData();
            formdata.append('thumb', file);
            formdata.append('nombre_thumb', tituloImage);

            let response = await fetch(`${process.env.URLFRONT}/images/tours/api_tours_base64.php`, {
                method: 'POST',
                body: formdata
            });

            let result = await response.json();

            if (result.error) {
                return res.status(400).json({ error: true, msg: "No se agregaron las fotos, intenterlo nuevamente", details: result.error })
            }

            query = `UPDATE foto SET
                        titulo    = '${tituloImage}', 
                        url        = '${thumb}',
                        updated_at = '${fecha}', 
                        tour_id    = '${tourId}'
                        WHERE id   = ${id}`;

        } else {

            query = `UPDATE foto SET
                        updated_at = '${fecha}', 
                        tour_id    = '${tourId}'
                        WHERE id   = ${id}`;

        }

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error: false, msg: "Registro actualizado con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.delete('/delete/:id', async (req, res) => {
    try {
        let fotoId = req.params.id;

        let query = `DELETE FROM foto WHERE id = ${fotoId}`;

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error: false, msg: "Se ha borrado la foto con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

module.exports = app