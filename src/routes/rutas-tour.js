/* Importing the express module and creating an instance of it. */
const express = require('express')
const app = express.Router()
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const auth = require('../middlewares/authorization')
const db = require('../config/db')


//////////////////////////////////////////
//                rutas                 //
//////////////////////////////////////////

app.get('/obtener/:id', async (req, res) => {
    try {
        let tourId = req.params.id;
        let query = `SELECT * FROM rutas WHERE idTour=${tourId}`;
        let rutas = await db.pool.query(query);

        res.status(200).json(rutas[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/obtenerbyruta/:id', async (req, res) => {
    try {
        let rutaId = req.params.id;
        let query = `SELECT * FROM rutas WHERE id=${rutaId}`;
        let ruta = await db.pool.query(query);

        res.status(200).json(ruta[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})


app.post('/crear', async (req, res) => {
    try {
        const { escala, coordenadas, tour_id, tipo } = req.body

        let errors = Array();

        if (!escala) {
            errors.push({ msg: "El campo escala debe de contener un valor" });
        }
        if (!coordenadas) {
            errors.push({ msg: "El campo coordenadas debe de contener un valor" });
        }
        if (!tour_id) {
            errors.push({ msg: "El campo tour_id debe de contener un valor" });
        }
        if (!tipo) {
            errors.push({ msg: "El campo tipo debe de contener un valor" });
        }

        if (errors.length >= 1) {

            return res.status(400)
                .json({
                    msg: 'Errores en los parametros',
                    error: true,
                    details: errors
                });

        }

        //buscamos si ya existe un tipo inicio 
        if(tipo == 'inicio'){
            let query = `SELECT * FROM rutas WHERE idTour = ${tour_id} AND tipo = '${tipo}'`;
   		    let tipoMarker = await db.pool.query(query);
        	marker = tipoMarker[0];
    		if (marker.length > 0) {
	     		return res.status(400).json({ error:true, msg: 'Ya existe una escala tipo inicio' })
		    }
        }
        //buscamos si ya existe un tipo fin 
        if(tipo == 'fin'){
            let query = `SELECT * FROM rutas WHERE idTour = ${tour_id} AND tipo = '${tipo}'`;
   		    let tipoMarker = await db.pool.query(query);
        	marker = tipoMarker[0];
    		if (marker.length > 0) {
	     		return res.status(400).json({ error:true, msg: 'Ya existe una escala tipo fin' })
		    }
        }


        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        query = `INSERT INTO rutas 
                        (escala, coordenadas, idTour, created_at, updated_at, tipo) 
                        VALUES 
                        ('${escala}', '${coordenadas}', '${tour_id}', '${fecha}', '${fecha}', '${tipo}')`;

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error:false, msg: "Alta de ruta exitosa" })
        
        

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/set', async (req, res) => {
    try {
        const { id, escala, coordenadas, tour_id, tipo } = req.body

        let errors = Array();

        if (!id) {
            errors.push({ msg: "El campo id debe de contener un valor" });
        }
        if (!escala) {
            errors.push({ msg: "El campo escala debe de contener un valor" });
        }
        if (!coordenadas) {
            errors.push({ msg: "El campo coordenadas debe de contener un valor" });
        }
        if (!tour_id) {
            errors.push({ msg: "El campo tour_id debe de contener un valor" });
        }
        if (!tipo) {
            errors.push({ msg: "El campo tipo debe de contener un valor" });
        }
        
        if (errors.length >= 1) {

            return res.status(400)
                .json({
                    msg: 'Errores en los parametros',
                    error: true,
                    details: errors
                });

        }

        //buscamos si ya existe un tipo inicio ademas del que se esta editando
        if(tipo == 'inicio'){
            let query = `SELECT * FROM rutas WHERE idTour = ${tour_id} AND tipo = '${tipo}' AND id != ${id}`;
   		    let tipoMarker = await db.pool.query(query);
        	marker = tipoMarker[0];
    		if (marker.length > 0) {
	     		return res.status(400).json({ error:true, msg: 'Ya existe una escala tipo inicio' })
		    }
        }
        //buscamos si ya existe un tipo fin ademas del que se esta editando
        if(tipo == 'fin'){
            let query = `SELECT * FROM rutas WHERE idTour = ${tour_id} AND tipo = '${tipo}' AND id != ${id}`;
   		    let tipoMarker = await db.pool.query(query);
        	marker = tipoMarker[0];
    		if (marker.length > 0) {
	     		return res.status(400).json({ error:true, msg: 'Ya existe una escala tipo fin' })
		    }
        }

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE rutas SET
                        escala       = '${escala}',
                        coordenadas  = '${coordenadas}',
                        tipo         = '${tipo}',
                        updated_at   = '${fecha}' 
                        WHERE id     = ${id}`;

        let result = await db.pool.query(query);
        result = result[0];


        res.status(200).json({ error:false, msg: "Registro actualizado con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/delete/:id', async (req, res) => {
    try {
        let rutaId = req.params.id;

        let query = `DELETE FROM rutas WHERE id = ${rutaId}`;

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error:false, msg: "Se ha borrado la ruta con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})


module.exports = app
