/* Importing the express module and creating an instance of it. */
const express = require('express')
const app = express.Router()
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const auth = require('../middlewares/authorization')
const db = require('../config/db')

const IDIOMAS_VALIDOS = ['Español', 'English', 'French']

const normalizarIdioma = (idioma) => {
    if (typeof idioma === 'undefined' || idioma === null || idioma === '' || idioma === 'libre') {
        return null
    }

    if (!IDIOMAS_VALIDOS.includes(idioma)) {
        return 'Español'
    }

    return idioma
}

const normalizarFechaCupo = (fecha) => {
    if (typeof fecha === 'undefined' || fecha === null || fecha === '') {
        return null
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return false
    }

    return fecha
}


//////////////////////////////////////////
//                fecha                 //
//////////////////////////////////////////

app.get('/obtener/:id', async (req, res) => {
    try {
        let fechaId = req.params.id;
        let query = `SELECT * FROM fecha WHERE id=${fechaId}`;
        let venta = await db.pool.query(query);

        res.status(200).json(venta[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/obtenerbytour/:id', async (req, res) => {
    try {
        let tourId = req.params.id;
        let query = `SELECT * FROM fecha WHERE tour_id=${tourId}`;
        let venta = await db.pool.query(query);

        res.status(200).json(venta[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})


app.post('/crear', async (req, res) => {
    try {
        const { dia, hora_salida, hora_regreso, tour_id, max_personas } = req.body
        let status = req.body.status;
        let apply_for_operator = req.body.apply_for_operator;
        let idioma = normalizarIdioma(req.body.idioma);
        const fecha_inicio_cupo = normalizarFechaCupo(req.body.fecha_inicio_cupo)
        const fecha_fin_cupo = normalizarFechaCupo(req.body.fecha_fin_cupo)

        // Normalizar hora_salida a hh:mm
        let hora_salida_normalizada = hora_salida;
        if (typeof hora_salida === 'string') {
            const partes = hora_salida.split(':');
            if (partes.length >= 2) {
                hora_salida_normalizada = partes[0].padStart(2, '0') + ':' + partes[1].padStart(2, '0');
            }
        }

        let errors = Array();

        if (!dia) {
            errors.push({ msg: "El campo dia debe de contener un valor" });
        }
        if (!hora_salida) {
            errors.push({ msg: "El campo hora_salida debe de contener un valor" });
        }
        if (!hora_regreso) {
            errors.push({ msg: "El campo hora_regreso debe de contener un valor" });
        }
        if (!status) {
            status = 1;
        }
        if (!apply_for_operator) {
            apply_for_operator = 0;
        }
        if (!tour_id) {
            errors.push({ msg: "El campo tour_id debe de contener un valor" });
        }

        if (typeof max_personas !== 'undefined' && max_personas !== null && max_personas !== '') {
            const mp = parseInt(max_personas, 10);
            if (isNaN(mp) || mp < 0) {
                errors.push({ msg: "El campo max_personas debe ser un entero mayor o igual a 0 o vacío para heredar" });
            }

            if (fecha_inicio_cupo === null) {
                errors.push({ msg: "El campo fecha_inicio_cupo debe de contener un valor cuando se define max_personas" });
            }
            if (fecha_fin_cupo === null) {
                errors.push({ msg: "El campo fecha_fin_cupo debe de contener un valor cuando se define max_personas" });
            }
        }

        if (fecha_inicio_cupo === false) {
            errors.push({ msg: "El campo fecha_inicio_cupo debe tener formato YYYY-MM-DD" });
        }
        if (fecha_fin_cupo === false) {
            errors.push({ msg: "El campo fecha_fin_cupo debe tener formato YYYY-MM-DD" });
        }
        if (fecha_inicio_cupo && fecha_fin_cupo && fecha_fin_cupo < fecha_inicio_cupo) {
            errors.push({ msg: "El campo fecha_fin_cupo no puede ser menor a fecha_inicio_cupo" });
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

        const idiomaSQL = idioma === null ? 'NULL' : `'${idioma}'`;
        const maxPersonasSQL = (typeof max_personas === 'undefined' || max_personas === null || max_personas === '') ? 'NULL' : `${parseInt(max_personas, 10)}`;
        const fechaInicioCupoSQL = fecha_inicio_cupo ? `'${fecha_inicio_cupo}'` : 'NULL';
        const fechaFinCupoSQL = fecha_fin_cupo ? `'${fecha_fin_cupo}'` : 'NULL';

        let query = `INSERT INTO fecha 
            (dia, hora_salida, hora_regreso, status, applyForOperator, created_at, updated_at, tour_id, idioma, max_personas, fecha_inicio_cupo, fecha_fin_cupo) 
            VALUES 
            ('${dia}', '${hora_salida_normalizada}', '${hora_regreso}', '${status}', '${apply_for_operator}', '${fecha}', '${fecha}', '${tour_id}', ${idiomaSQL}, ${maxPersonasSQL}, ${fechaInicioCupoSQL}, ${fechaFinCupoSQL})`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            venta: {
                id: result.insertId,
            }
        }

        jwt.sign(payload, process.env.SECRET, { expiresIn: 36000 }, (error, token) => {
            if (error) throw error
            res.status(200).json({ error: false, token: token })
            //res.json(respuestaDB)
        })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/set', async (req, res) => {
    try {
        const { id, dia, hora_salida, hora_regreso, max_personas } = req.body
        // Normalizar hora_salida a hh:mm
        let hora_salida_normalizada = hora_salida;
        if (typeof hora_salida === 'string') {
            const partes = hora_salida.split(':');
            if (partes.length >= 2) {
                hora_salida_normalizada = partes[0].padStart(2, '0') + ':' + partes[1].padStart(2, '0');
            }
        }
        let status = req.body.status;
        let apply_for_operator = req.body.apply_for_operator;
        let idioma = normalizarIdioma(req.body.idioma);
        const fecha_inicio_cupo = normalizarFechaCupo(req.body.fecha_inicio_cupo)
        const fecha_fin_cupo = normalizarFechaCupo(req.body.fecha_fin_cupo)

        let errors = Array();

        // validar id como entero
        const idNum = parseInt(id, 10);
        if (isNaN(idNum)) {
            errors.push({ msg: "El campo id debe ser un entero válido" });
        }

        if (!dia) {
            errors.push({ msg: "El campo dia debe de contener un valor" });
        }
        if (!hora_salida) {
            errors.push({ msg: "El campo hora_salida debe de contener un valor" });
        }
        if (!hora_regreso) {
            errors.push({ msg: "El campo hora_regreso debe de contener un valor" });
        }
        if (!status) {
            status = 1;
        }
        if (!apply_for_operator) {
            apply_for_operator = 0;
        }
        if (typeof max_personas !== 'undefined' && max_personas !== null && max_personas !== '') {
            const mp = parseInt(max_personas, 10);
            if (isNaN(mp) || mp < 0) {
                errors.push({ msg: "El campo max_personas debe ser un entero mayor o igual a 0 o vacío para heredar" });
            }

            if (fecha_inicio_cupo === null) {
                errors.push({ msg: "El campo fecha_inicio_cupo debe de contener un valor cuando se define max_personas" });
            }
            if (fecha_fin_cupo === null) {
                errors.push({ msg: "El campo fecha_fin_cupo debe de contener un valor cuando se define max_personas" });
            }
        }

        if (fecha_inicio_cupo === false) {
            errors.push({ msg: "El campo fecha_inicio_cupo debe tener formato YYYY-MM-DD" });
        }
        if (fecha_fin_cupo === false) {
            errors.push({ msg: "El campo fecha_fin_cupo debe tener formato YYYY-MM-DD" });
        }
        if (fecha_inicio_cupo && fecha_fin_cupo && fecha_fin_cupo < fecha_inicio_cupo) {
            errors.push({ msg: "El campo fecha_fin_cupo no puede ser menor a fecha_inicio_cupo" });
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

        const idiomaSQL = idioma === null ? 'NULL' : `'${idioma}'`;
        const maxPersonasSQL = (typeof max_personas === 'undefined' || max_personas === null || max_personas === '') ? 'NULL' : `${parseInt(max_personas, 10)}`;
        const fechaInicioCupoSQL = fecha_inicio_cupo ? `'${fecha_inicio_cupo}'` : 'NULL';
        const fechaFinCupoSQL = fecha_fin_cupo ? `'${fecha_fin_cupo}'` : 'NULL';

        let query = `UPDATE fecha SET
            dia              = '${dia}',
            hora_salida      = '${hora_salida_normalizada}',
            hora_regreso     = '${hora_regreso}', 
            status           = '${status}', 
            applyForOperator = '${apply_for_operator}', 
            idioma           = ${idiomaSQL},
            max_personas     = ${maxPersonasSQL},
            fecha_inicio_cupo = ${fechaInicioCupoSQL},
            fecha_fin_cupo    = ${fechaFinCupoSQL},
            updated_at       = '${fecha}' 
            WHERE id         =  ${id}`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            venta: {
                id: result.insertId,
            }
        }

        res.status(200).json({ error: false, msg: "Registro actualizado con exito" })

    } catch (error) {
        console.error(error); // <-- esto te lo muestra en la consola

        res.status(400).json({
            error: true,
            message: error.message,
            stack: error.stack
        });
    }
})

app.put('/delete/:id', async (req, res) => {
    try {
        let salidaId = req.params.id;

        let query = `DELETE FROM fecha WHERE id = ${salidaId}`;

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error: false, msg: "Se ha borrado la fecha de salida con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/active', async (req, res) => {
    try {
        let fechaId = req.body.id;

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE fecha SET
                        status     = 1,
                        updated_at = '${fecha}' 
                        WHERE id   = ${fechaId}`;

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error: false, msg: "Se ha reactivado la venta con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

module.exports = app
