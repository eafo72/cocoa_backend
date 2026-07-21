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
//                 Tour                 //
//////////////////////////////////////////
app.get('/tours', async (req, res) => {
    try {
        let query = `SELECT t.id, t.nombre, t.titulo, t.thumb, t.precio_pp, t.descripcion_corta, t.descripcion,
                        t.de_que_va, t.conocer_mas, t.recomendaciones, t.punto_encuentro, t.fechas_no_disponibles,
                        t.guias, t.max_pasajeros, t.min_pasajeros, t.status, t.empresa_id, categoria_id, t.ciudad, t.estado, t.duracion, e.nombre AS empresa, c.nombre AS categoria
                        FROM tour
                        AS t
                        INNER JOIN empresa 
                        AS e
                        ON t.empresa_id = e.id
                        INNER JOIN catregoria
                        AS c
                        ON t.categoria_id = c.id`;
        let tours = await db.pool.query(query);

        res.status(200).json(tours[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/toursBEST', async (req, res) => {
    try {
        let query = `SELECT t.id, t.nombre, t.titulo, t.thumb, t.precio_pp, t.descripcion_corta, t.descripcion,
                        t.de_que_va, t.conocer_mas, t.recomendaciones, t.punto_encuentro, t.fechas_no_disponibles,
                        t.guias, t.max_pasajeros, t.min_pasajeros, t.status, t.empresa_id, categoria_id, t.ciudad, t.estado, t.duracion, e.nombre AS empresa, c.nombre AS categoria
                        FROM tour
                        AS t
                        INNER JOIN empresa 
                        AS e
                        ON t.empresa_id = e.id
                        INNER JOIN catregoria
                        AS c
                        ON t.categoria_id = c.id LIMIT 6`;
        let tours = await db.pool.query(query);

        res.status(200).json(tours[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})


app.get('/obtener/:id', async (req, res) => {
    try {
        let tourId = req.params.id;

        let query = `SELECT t.id, t.nombre, titulo, thumb, precio_pp, descripcion_corta, t.descripcion, de_que_va, 
                        conocer_mas, recomendaciones, punto_encuentro, fechas_no_disponibles,fechashorarios_no_disponibles, guias, t.max_pasajeros, t.min_pasajeros,
                        t.status, t.created_at, t.updated_at, empresa_id, categoria_id, t.ciudad, t.estado, t.duracion, e.nombre AS empresa, c.nombre AS categoria
                        FROM tour
                        AS t
                        INNER JOIN empresa 
                        AS e
                        ON t.empresa_id = e.id
                        INNER JOIN catregoria
                        AS c
                        ON t.categoria_id = c.id 
                        WHERE t.id=${tourId}`;
        let tour = await db.pool.query(query);

        tour = tour[0];

        query = `SELECT * FROM foto WHERE tour_id=${tourId}`;
        let images = await db.pool.query(query);

        query = `SELECT * FROM fecha WHERE tour_id=${tourId}`;
        let fecha = await db.pool.query(query);

        let info = {
            tour: tour,
            images: images[0],
            fechas: fecha[0]
        }

        res.status(200).json(info);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/obtenerByEmpresa/:id', async (req, res) => {
    try {
        let empresaId = req.params.id;

        let query = `SELECT t.id, t.nombre, t.titulo, t.thumb, t.precio_pp, t.descripcion_corta, t.descripcion,
                        t.de_que_va, t.conocer_mas, t.recomendaciones, t.punto_encuentro, t.fechas_no_disponibles,
                        t.guias, t.max_pasajeros, t.min_pasajeros, t.status, t.empresa_id, categoria_id, t.ciudad, t.estado, t.duracion, e.nombre AS empresa, c.nombre AS categoria
                        FROM tour
                        AS t
                        INNER JOIN empresa 
                        AS e
                        ON t.empresa_id = e.id
                        INNER JOIN catregoria
                        AS c
                        ON t.categoria_id = c.id
                        WHERE t.empresa_id = ${empresaId}`;
        let tours = await db.pool.query(query);

        res.status(200).json(tours[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/obtenerCiudades', async (req, res) => {
    try {

        let query = `SELECT ciudad 
                        FROM tour 
                        GROUP BY ciudad
                        ORDER BY ciudad`;
        let tours = await db.pool.query(query);

        res.status(200).json(tours[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/obtenerEstados', async (req, res) => {
    try {

        let query = `SELECT estado 
                        FROM tour 
                        GROUP BY estado
                        ORDER BY estado`;
        let tours = await db.pool.query(query);

        res.status(200).json(tours[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/search/:ciudad/:estado', async (req, res) => {
    try {
        let ciudad = req.params.ciudad;
        let estado = req.params.estado;

        let query = `SELECT t.id, t.nombre, t.titulo, t.thumb, t.precio_pp, t.descripcion_corta, t.descripcion,
                        t.de_que_va, t.conocer_mas, t.recomendaciones, t.punto_encuentro, t.fechas_no_disponibles,
                        t.guias, t.max_pasajeros, t.min_pasajeros, t.status, t.empresa_id, categoria_id, t.ciudad, t.estado, t.duracion, e.nombre AS empresa, c.nombre AS categoria
                        FROM tour
                        AS t
                        INNER JOIN empresa 
                        AS e
                        ON t.empresa_id = e.id
                        INNER JOIN catregoria
                        AS c
                        ON t.categoria_id = c.id
                        WHERE t.ciudad LIKE '%${ciudad}%' 
                        AND t.estado LIKE '%${estado}%' `;
        let tours = await db.pool.query(query);

        res.status(200).json(tours[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/searchOnlyByState/:estado', async (req, res) => {
    try {
        let estado = req.params.estado;

        let query = `SELECT t.id, t.nombre, t.titulo, t.thumb, t.precio_pp, t.descripcion_corta, t.descripcion,
                        t.de_que_va, t.conocer_mas, t.recomendaciones, t.punto_encuentro, t.fechas_no_disponibles,
                        t.guias, t.max_pasajeros, t.min_pasajeros, t.status, t.empresa_id, categoria_id, t.ciudad, t.estado, t.duracion, e.nombre AS empresa, c.nombre AS categoria
                        FROM tour
                        AS t
                        INNER JOIN empresa 
                        AS e
                        ON t.empresa_id = e.id
                        INNER JOIN catregoria
                        AS c
                        ON t.categoria_id = c.id
                        WHERE t.estado LIKE '%${estado}%' `;
        let tours = await db.pool.query(query);

        res.status(200).json(tours[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.post('/crear', imageController.upload, async (req, res) => {
    try {
        let { nombre, titulo, precio_pp, descripcion_corta, descripcion, de_que_va, conocer_mas, recomendaciones, punto_encuentro, fechas_no_disponibles, guias, max_pasajeros, min_pasajeros, empresa_id, categoria_id, ciudad, estado, duracion } = req.body

        let errors = Array();

        if (!nombre) {
            errors.push({ msg: "El campo nombre debe de contener un valor" });
        }
        if (!titulo) {
            errors.push({ msg: "El campo titulo debe de contener un valor" });
        }
        if (!precio_pp) {
            errors.push({ msg: "El campo precio_pp debe de contener un valor" });
        }
        if (!descripcion_corta) {
            errors.push({ msg: "El campo descripcion_corta debe de contener un valor" });
        }
        if (!descripcion) {
            errors.push({ msg: "El campo descripcion debe de contener un valor" });
        }
        if (!de_que_va) {
            errors.push({ msg: "El campo de_que_va debe de contener un valor" });
        }
        if (!conocer_mas) {
            errors.push({ msg: "El campo conocer_mas debe de contener un valor" });
        }
        if (!recomendaciones) {
            errors.push({ msg: "El campo recomendaciones debe de contener un valor" });
        }
        if (!punto_encuentro) {
            errors.push({ msg: "El campo punto_encuentro debe de contener un valor" });
        }
        /*
        if (!fechas_no_disponibles) {
            errors.push({ msg: "El campo fechas_no_disponibles debe de contener un valor" });
        }
        */
        if (!guias) {
            errors.push({ msg: "El campo guias debe de contener un valor" });
        }
        if (!max_pasajeros) {
            errors.push({ msg: "El campo max_pasajeros debe de contener un valor" });
        }
        if (!min_pasajeros) {
            errors.push({ msg: "El campo min_pasajeros debe de contener un valor" });
        }
        if (!empresa_id) {
            errors.push({ msg: "El campo empresa_id debe de contener un valor valido" });
        }
        if (!categoria_id) {
            errors.push({ msg: "El campo categoria_id debe de contener un valor valido" });
        }
        if (!ciudad) {
            errors.push({ msg: "El campo ciudad debe de contener un valor" });
        }
        if (!estado) {
            errors.push({ msg: "El campo estado debe de contener un valor" });
        }
        if (!duracion) {
            errors.push({ msg: "El campo duracion debe de contener un valor" });
        }

        if (errors.length >= 1) {

            return res.status(400)
                .json({
                    msg: 'Errores en los parametros',
                    error: true,
                    details: errors
                });

        }
        
        min_pasajeros = parseInt(min_pasajeros, 10);
        max_pasajeros = parseInt(max_pasajeros, 10);

        if (min_pasajeros > max_pasajeros) {
            return res.status(400)
                .json({
                    msg: 'El minimo de pasajeros no puede ser más grande que el maximo',
                    error: true,
                    details: errors
                });
        }

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

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
            return res.status(400).json({ error: true, msg: "No se agregaron las fotos, intenterlo nuevamente", details: "" })
        }
        let fechas = '';

        //fechas_no_disponibles = JSON.parse(fechas_no_disponibles);
        if(Array.isArray(fechas_no_disponibles) && fechas_no_disponibles.length > 0){
            fechas_no_disponibles.forEach(fecha => {
                fechas += fecha + ";";
            });
        }   


        let guiasTour = JSON.stringify(guias);
        /*
        //guias = JSON.parse(guias);
        guias.forEach(guia => {
            guiasTour += guia + ";";
        });
        */

        let query = `INSERT INTO tour 
                        (nombre, titulo, thumb, precio_pp, descripcion_corta, descripcion, de_que_va, conocer_mas, recomendaciones, punto_encuentro, fechas_no_disponibles, guias, max_pasajeros, min_pasajeros, created_at, updated_at, empresa_id, categoria_id, ciudad, estado, duracion) 
                        VALUES 
                        ('${nombre}', '${titulo}', '${thumb}', '${precio_pp}', '${descripcion_corta}', '${descripcion}', '${de_que_va}', '${conocer_mas}', '${recomendaciones}', '${punto_encuentro}', '${fechas}', '${guiasTour}', '${max_pasajeros}', '${min_pasajeros}', '${fecha}', '${fecha}', '${empresa_id}', '${categoria_id}', '${ciudad}', '${estado}', '${duracion}')`;

        result = await db.pool.query(query);
        result = result[0];

        //dias = JSON.parse(dias);
        /*
        dias.forEach(dia => {
            try {
                query = `INSERT INTO fecha
                        (dia, hora_salida, hora_regreso, created_at, updated_at, tour_id)
                        VALUES
                        ('${dia.dia}', '${dia.hora_salida}', '${dia.hora_regreso}', '${fecha}', '${fecha}', '${result.insertId}')`
                let resultado = db.pool.query(query);
            } catch (error) {
                res.status(400).json({ error: true, details: error })
            }
        });
        */

        res.status(200).json({ error: false, msg: "Registro creado con exito" })

    } catch (error) {
        console.log(error);
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/set', imageController.upload, async (req, res) => {
    try {
        let { id, nombre, titulo, precio_pp, descripcion_corta, descripcion, de_que_va, conocer_mas, recomendaciones, punto_encuentro, fechas_no_disponibles, fechashorarios_no_disponibles, guias, max_pasajeros, min_pasajeros, empresa_id, categoria_id, dias, ciudad, estado, duracion } = req.body

        let errors = Array();

        if (!id) {
            errors.push({ msg: "El campo id debe de contener un valor valido" });
        }
        if (!nombre) {
            errors.push({ msg: "El campo nombres debe de contener un valor" });
        }
        if (!titulo) {
            errors.push({ msg: "El campo titulo debe de contener un valor" });
        }
        if (!precio_pp) {
            errors.push({ msg: "El campo precio_pp debe de contener un valor" });
        }
        if (!descripcion_corta) {
            errors.push({ msg: "El campo descripcion_corta debe de contener un valor" });
        }
        if (!descripcion) {
            errors.push({ msg: "El campo descripcion debe de contener un valor" });
        }
        if (!de_que_va) {
            errors.push({ msg: "El campo de_que_va debe de contener un valor" });
        }
        if (!conocer_mas) {
            errors.push({ msg: "El campo conocer_mas debe de contener un valor" });
        }
        if (!recomendaciones) {
            errors.push({ msg: "El campo recomendaciones debe de contener un valor" });
        }
        if (!punto_encuentro) {
            errors.push({ msg: "El campo punto_encuentro debe de contener un valor" });
        }
        /*
        if (!fechas_no_disponibles) {
            errors.push({ msg: "El campo fechas_no_disponibles debe de contener un valor" });
        }
        */
        if (!guias) {
            errors.push({ msg: "El campo guias debe de contener un valor" });
        }
        if (!max_pasajeros) {
            errors.push({ msg: "El campo max_pasajeros debe de contener un valor" });
        }
        if (!min_pasajeros) {
            errors.push({ msg: "El campo min_pasajeros debe de contener un valor" });
        }
        if (!empresa_id) {
            errors.push({ msg: "El campo empresa_id debe de contener un valor valido" });
        }
        if (!categoria_id) {
            errors.push({ msg: "El campo categoria_id debe de contener un valor valido" });
        }
        if (!dias) {
            dias = [];
        }
        if (!ciudad) {
            errors.push({ msg: "El campo ciudad debe de contener un valor" });
        }
        if (!estado) {
            errors.push({ msg: "El campo estado debe de contener un valor" });
        }
        if (!duracion) {
            errors.push({ msg: "El campo duracion debe de contener un valor" });
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
        let fechas = '';

        //fechas_no_disponibles = JSON.parse(fechas_no_disponibles);
        if(Array.isArray(fechas_no_disponibles) && fechas_no_disponibles.length > 0){
            fechas_no_disponibles.forEach(fecha => {
                fechas += fecha + ";";
            });
        }   

        let fechashorarios = '';
        if(Array.isArray(fechashorarios_no_disponibles) && fechashorarios_no_disponibles.length > 0){
            fechashorarios_no_disponibles.forEach(fecha => {
                fechashorarios += fecha + ";";
            });
        }   

        let guiasTour = JSON.stringify(guias);
        //guias.forEach(guia => {
        //    guiasTour += guia + ";";
        //});

        query = `UPDATE tour SET
                        nombre            = '${nombre}',
                        titulo            = '${titulo}',
                `;

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
                return res.status(400).json({ error: true, msg: "No se agregaron las fotos, intenterlo nuevamente", details: "" })
            }

            query += `thumb             = '${thumb}', `;

        }

        query += `precio_pp            = '${precio_pp}', 
                    descripcion_corta = '${descripcion_corta}', 
                    descripcion       = '${descripcion}', 
                    de_que_va         = '${de_que_va}', 
                    conocer_mas       = '${conocer_mas}', 
                    recomendaciones   = '${recomendaciones}', 
                    punto_encuentro   = '${punto_encuentro}', 
                    fechas_no_disponibles = '${fechas}',
                    fechashorarios_no_disponibles = '${fechashorarios}',
                    guias             = '${guiasTour}', 
                    max_pasajeros     = '${max_pasajeros}', 
                    min_pasajeros     = '${min_pasajeros}', 
                    updated_at        = '${fecha}', 
                    empresa_id        = '${empresa_id}', 
                    categoria_id      = '${categoria_id}',
                    ciudad            = '${ciudad}',
                    estado            = '${estado}',
                    duracion          = '${duracion}'
                    WHERE id          = ${id}`;



        let result = await db.pool.query(query);
        result = result[0];

        dias.forEach(dia => {
            try {
                if (dia.id) {

                    query = `UPDATE fecha SET 
                                dia          = '${dia.dia}', 
                                hora_salida  = '${dia.hora_salida}', 
                                hora_regreso = '${dia.hora_regreso}', 
                                updated_at   = '${fecha}', 
                                tour_id      = '${id}' 
                                WHERE id     = ${dia.id}`;

                } else {

                    query = `INSERT INTO fecha
                        (dia, hora_salida, hora_regreso, created_at, updated_at, tour_id)
                        VALUES
                        ('${dia.dia}', '${dia.hora_salida}', '${dia.hora_regreso}', '${fecha}', '${fecha}', '${id}')`

                }

                let resultado = db.pool.query(query);

            } catch (error) {
                console.log(error);
                res.status(400).json({ error: true, details: error })
            }
        });

        res.status(200).json({ error: false, msg: "Registro actualizado con exito" })

    } catch (error) {
        console.log(error);
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/delete', async (req, res) => {
    try {
        let tourId = req.body.id;

        if (!tourId) {
            errors.push({ msg: "El campo id debe de contener un valor valido" });
        }

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE tour SET
                        status     = 0,
                        updated_at = '${fecha}' 
                        WHERE id   = ${tourId}`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            tour: {
                id: result.insertId,
            }
        }

        res.status(200).json({ error: false, msg: "Se ha dado de baja el tour con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/active', async (req, res) => {
    try {
        let tourId = req.body.id;

        if (!tourId) {
            errors.push({ msg: "El campo id debe de contener un valor valido" });
        }

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE tour SET
                        status     = 1,
                        updated_at = '${fecha}' 
                        WHERE id   = ${tourId}`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            tour: {
                id: result.insertId,
            }
        }

        res.status(200).json({ error: false, msg: "Se ha reactivado el tour con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

module.exports = app
