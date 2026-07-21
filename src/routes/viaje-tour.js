// Utilidad para sumar minutos a una fecha
function addMinutesToDate(objDate, intMinutes) {
    var numberOfMlSeconds = objDate.getTime();
    var addMlSeconds = intMinutes * 60000;
    var newDateObj = new Date(numberOfMlSeconds + addMlSeconds);
    return newDateObj;
}
/* Importing the express module and creating an instance of it. */
const express = require('express')
const app = express.Router()
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const auth = require('../middlewares/authorization')
const db = require('../config/db')

//////////////////////////////////////////
//              Viaje Tour              //
//////////////////////////////////////////
app.get('/viaje-Tours', async (req, res) => {
    try {
        let query = `SELECT
    COALESCE(t.nombre, 'Tour Desconocido') AS "nombre_del_tour",      
    v.id_reservacion AS "id_reservacion",
    v.nombre_cliente AS "nombre_visitante", 
    v.correo AS correo,
    v.no_boletos AS "no_boletos",
    v.checkin AS checkin,
    v.session_id AS "session_id",
        
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoA')) AS UNSIGNED), 0) AS "total_tipo_A",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoB')) AS UNSIGNED), 0) AS "total_tipo_B",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoC')) AS UNSIGNED), 0) AS "total_tipo_C",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoD')) AS UNSIGNED), 0) AS "total_tipo_D",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoE')) AS UNSIGNED), 0) AS "total_tipo_E",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoF')) AS UNSIGNED), 0) AS "total_tipo_F",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoG')) AS UNSIGNED), 0) AS "total_tipo_G",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoH')) AS UNSIGNED), 0) AS "total_tipo_H",
    DATE_FORMAT(vt.fecha_ida, '%Y-%m-%d %H:%i:%s') AS "fecha_ida",
    DATE_FORMAT(v.updated_at, '%Y-%m-%d %H:%i:%s')  AS "fecha_visita",
    DATE_FORMAT(v.fecha_compra, '%Y-%m-%d %H:%i:%s') AS "fecha_compra",
        
    v.total AS "total_de_compra",
    
    CASE
        WHEN v.status_traspaso = 99 THEN 'No Aplica'
        WHEN v.status_traspaso = 98 THEN 'Cortesía'
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
            THEN 'Efectivo'
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Pos_tarjeta')
            THEN 'Pos Tarjeta'
        ELSE 'Stripe'
    END AS tipo_compra,
    
    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NULL 
            AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
            THEN v.total
        ELSE 0.00
    END AS cobrado_efectivo,

    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NULL AND v.metodo_pago = 'Pos_tarjeta' THEN v.total
        ELSE 0.00
    END AS "cobrado_tarjeta",
    
    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NOT NULL THEN v.total
        ELSE 0.00
    END AS "cobrado_stripe"
FROM
    venta AS v
LEFT JOIN 
    viajeTour AS vt ON v.viajeTour_id = vt.id
LEFT JOIN 
    tour AS t ON vt.tour_id = t.id
LEFT JOIN 
    usuario AS u ON v.cliente_id = u.id    
WHERE
    v.status_traspaso <> 99 AND u.isOperator = 0   
ORDER BY
    v.fecha_compra DESC`;
        let tours = await db.pool.query(query);

        res.status(200).json(tours[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/viaje-ToursByMonth', async (req, res) => {
    try {

        // Si no mandan month/year, usamos mes actual
        const now = new Date();
        const month = req.query.month ? parseInt(req.query.month) : now.getMonth() + 1;
        const year = req.query.year ? parseInt(req.query.year) : now.getFullYear();

        // Validación básica
        if (month < 1 || month > 12) {
            return res.status(400).json({ msg: "Mes inválido" });
        }

        if (year < 2000 || year > 2100) {
            return res.status(400).json({ msg: "Año inválido" });
        }

        let query = `
            SELECT
                COALESCE(t.nombre, 'Tour Desconocido') AS "nombre_del_tour",      
                v.id_reservacion AS "id_reservacion",
                v.nombre_cliente AS "nombre_visitante", 
                v.correo AS correo,
                v.no_boletos AS "no_boletos",
                v.checkin AS checkin,
                v.session_id AS "session_id",
                    
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoA')) AS UNSIGNED), 0) AS "total_tipo_A",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoB')) AS UNSIGNED), 0) AS "total_tipo_B",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoC')) AS UNSIGNED), 0) AS "total_tipo_C",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoD')) AS UNSIGNED), 0) AS "total_tipo_D",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoE')) AS UNSIGNED), 0) AS "total_tipo_E",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoF')) AS UNSIGNED), 0) AS "total_tipo_F",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoG')) AS UNSIGNED), 0) AS "total_tipo_G",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoH')) AS UNSIGNED), 0) AS "total_tipo_H",
                
                DATE_FORMAT(vt.fecha_ida, '%Y-%m-%d %H:%i:%s') AS "fecha_ida",
                DATE_FORMAT(v.updated_at, '%Y-%m-%d %H:%i:%s')  AS "fecha_visita",
                DATE_FORMAT(v.fecha_compra, '%Y-%m-%d %H:%i:%s') AS "fecha_compra",
                    
                v.total AS "total_de_compra",
                
                CASE
                    WHEN v.status_traspaso = 99 THEN 'No Aplica'
                    WHEN v.status_traspaso = 98 THEN 'Cortesía'
                    WHEN v.session_id IS NULL 
                         AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
                        THEN 'Efectivo'
                    WHEN v.session_id IS NULL 
                         AND (v.metodo_pago = 'Pos_tarjeta')
                        THEN 'Pos Tarjeta'
                    ELSE 'Stripe'
                END AS tipo_compra,
                
                CASE
                    WHEN v.status_traspaso = 99 THEN 0.00      
                    WHEN v.session_id IS NULL 
                        AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
                        THEN v.total
                    ELSE 0.00
                END AS cobrado_efectivo,

                CASE
                    WHEN v.status_traspaso = 99 THEN 0.00      
                    WHEN v.session_id IS NULL AND v.metodo_pago = 'Pos_tarjeta' THEN v.total
                    ELSE 0.00
                END AS "cobrado_tarjeta",
                
                CASE
                    WHEN v.status_traspaso = 99 THEN 0.00      
                    WHEN v.session_id IS NOT NULL THEN v.total
                    ELSE 0.00
                END AS "cobrado_stripe"
            FROM
                venta AS v
            LEFT JOIN 
                viajeTour AS vt ON v.viajeTour_id = vt.id
            LEFT JOIN 
                tour AS t ON vt.tour_id = t.id
            LEFT JOIN 
                usuario AS u ON v.cliente_id = u.id    
            WHERE
                v.status_traspaso <> 99 
                AND u.isOperator = 0
                AND MONTH(v.fecha_compra) = ?
                AND YEAR(v.fecha_compra) = ?
            ORDER BY
                v.fecha_compra DESC
        `;

        let tours = await db.pool.query(query, [month, year]);

        res.status(200).json(tours[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
});


app.get('/viaje-Tours-Operadores', async (req, res) => {
    try {
        let query = `SELECT
    COALESCE(t.nombre, 'Tour Desconocido') AS "nombre_del_tour",      
    v.id_reservacion AS "id_reservacion",
    v.nombre_cliente AS "nombre_visitante", 
    v.nombre_cliente_asignado AS "nombre_cliente_asignado",
    v.correo AS correo,
    v.correo_asignado AS "correo_asignado",
    v.no_boletos AS "no_boletos",
    v.checkin AS checkin,
        
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoA')) AS UNSIGNED), 0) AS "total_tipo_A",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoB')) AS UNSIGNED), 0) AS "total_tipo_B",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoC')) AS UNSIGNED), 0) AS "total_tipo_C",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoD')) AS UNSIGNED), 0) AS "total_tipo_D",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoE')) AS UNSIGNED), 0) AS "total_tipo_E",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoF')) AS UNSIGNED), 0) AS "total_tipo_F",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoG')) AS UNSIGNED), 0) AS "total_tipo_G",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoH')) AS UNSIGNED), 0) AS "total_tipo_H",
      
    DATE_FORMAT(vt.fecha_ida, '%Y-%m-%d %H:%i:%s') AS "fecha_ida",
    DATE_FORMAT(v.updated_at, '%Y-%m-%d %H:%i:%s')  AS "fecha_visita",
    DATE_FORMAT(v.fecha_compra, '%Y-%m-%d %H:%i:%s') AS "fecha_compra",
        
    v.total AS "total_de_compra",
    
    CASE
        WHEN v.status_traspaso = 99 THEN 'No Aplica'
        WHEN v.status_traspaso = 98 THEN 'Cortesía'
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
            THEN 'Efectivo'
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Pos_tarjeta')
            THEN 'Pos Tarjeta'
        ELSE 'Stripe'
    END AS tipo_compra,
    
    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NULL 
            AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
            THEN v.total
        ELSE 0.00
    END AS cobrado_efectivo,

    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NULL AND v.metodo_pago = 'Pos_tarjeta' THEN v.total
        ELSE 0.00
    END AS "cobrado_tarjeta",
    
    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NOT NULL THEN v.total
        ELSE 0.00
    END AS "cobrado_stripe"
FROM
    venta AS v
LEFT JOIN 
    viajeTour AS vt ON v.viajeTour_id = vt.id
LEFT JOIN 
    tour AS t ON vt.tour_id = t.id
LEFT JOIN 
    usuario AS u ON v.cliente_id = u.id    
WHERE
    v.status_traspaso <> 99 AND u.isOperator = 1   
ORDER BY
    v.fecha_compra DESC`;
        let tours = await db.pool.query(query);

        res.status(200).json(tours[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/viaje-Tours-canceladas', async (req, res) => {
    try {
        let query = `SELECT
    COALESCE(t.nombre, 'Tour Desconocido') AS "nombre_del_tour",      
    v.id_reservacion AS "id_reservacion",
    v.nombre_cliente AS "nombre_visitante", 
    v.correo AS correo,
    v.no_boletos AS "no_boletos",
    v.checkin AS checkin,
    v.session_id AS "session_id",
        
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoA')) AS UNSIGNED), 0) AS "total_tipo_A",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoB')) AS UNSIGNED), 0) AS "total_tipo_B",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoC')) AS UNSIGNED), 0) AS "total_tipo_C",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoD')) AS UNSIGNED), 0) AS "total_tipo_D",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoE')) AS UNSIGNED), 0) AS "total_tipo_E",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoF')) AS UNSIGNED), 0) AS "total_tipo_F",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoG')) AS UNSIGNED), 0) AS "total_tipo_G",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoH')) AS UNSIGNED), 0) AS "total_tipo_H",
      
    DATE_FORMAT(vt.fecha_ida, '%Y-%m-%d %H:%i:%s') AS "fecha_ida",
    DATE_FORMAT(v.updated_at, '%Y-%m-%d %H:%i:%s')  AS "fecha_visita",
    DATE_FORMAT(v.fecha_compra, '%Y-%m-%d %H:%i:%s') AS "fecha_compra",
        
    v.total AS "total_de_compra",
    
    CASE
        WHEN v.status_traspaso = 99 THEN 'No Aplica'
        WHEN v.status_traspaso = 98 THEN 'Cortesía'
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
            THEN 'Efectivo'
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Pos_tarjeta')
            THEN 'Pos Tarjeta'
        ELSE 'Stripe'
    END AS tipo_compra,
    
    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NULL 
            AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
            THEN v.total
        ELSE 0.00
    END AS cobrado_efectivo,

    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NULL AND v.metodo_pago = 'Pos_tarjeta' THEN v.total
        ELSE 0.00
    END AS "cobrado_tarjeta",
    
    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NOT NULL THEN v.total
        ELSE 0.00
    END AS "cobrado_stripe"
FROM
    venta AS v
LEFT JOIN 
    viajeTour AS vt ON v.viajeTour_id = vt.id
LEFT JOIN 
    tour AS t ON vt.tour_id = t.id
LEFT JOIN 
    usuario AS u ON v.cliente_id = u.id   
WHERE
    v.status_traspaso = 99  AND u.isOperator = 0      
ORDER BY
    v.fecha_compra DESC`;
        let tours = await db.pool.query(query);

        res.status(200).json(tours[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/calendario', async (req, res) => {
    try {
        let query = `SELECT vt.*, u.nombres, u.apellidos, t.nombre FROM viajeTour
                        AS vt
                        INNER JOIN tour
                        AS t
                        ON vt.tour_id = t.id
                        INNER JOIN usuario 
                        AS u
                        ON vt.guia_id = u.id
                        GROUP BY vt.fecha_ida, vt.fecha_regreso ORDER BY vt.fecha_ida ASC`;
        let tours = await db.pool.query(query);

        res.status(200).json(tours[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/calendariobyempresa/:id', async (req, res) => {
    let empresaId = req.params.id;
    try {
        let query = `SELECT vt.*, u.nombres, u.apellidos, t.nombre FROM viajeTour
                        AS vt
                        INNER JOIN tour
                        AS t
                        ON vt.tour_id = t.id
                        INNER JOIN usuario 
                        AS u
                        ON vt.guia_id = u.id
                        WHERE t.empresa_id = ${empresaId}
                        GROUP BY vt.fecha_ida, vt.fecha_regreso ORDER BY vt.fecha_ida ASC`;

        let tours = await db.pool.query(query);

        res.status(200).json(tours[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})


app.get('/obtener/:id', async (req, res) => {
    try {
        let viajeTourId = req.params.id;
        let query = `SELECT 
                        vt.id, fecha_ida, fecha_regreso, vt.status, lugares_disp, vt.updated_at, tour_id, guia_id, geo_llegada, geo_salida, 
                        status_viaje, t.nombre, t.titulo, t.precio_pp, u.nombres, u.apellidos, u.correo
                        FROM viajeTour
                        AS vt
                        INNER JOIN tour
                        AS t
                        ON vt.tour_id = t.id
                        INNER JOIN usuario
                        AS u
                        ON vt.guia_id = u.id 
                        WHERE vt.id=${viajeTourId}`;
        let tour = await db.pool.query(query);

        res.status(200).json(tour[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//historial por id cliente
app.get('/historial/:id', async (req, res) => {
    try {
        let clienteId = req.params.id;
        let query = `SELECT u.nombres AS nombreUsuario, u.apellidos AS apellidoUsuario, u.correo AS correoUsuario, v.id, v.id_reservacion, v.no_boletos, 
                        pagado, fecha_compra, comision, status_traspaso, v.created_at, v.updated_at, v.cliente_id, v.viajeTour_id, v.total, v.checkin
                        vt.fecha_ida, vt.fecha_regreso, vt.status, vt.tour_id, vt.guia_id, vt.geo_llegada, vt.geo_salida, vt.status_viaje,
                        t.nombre AS nombreTour
                        FROM venta 
                        AS v
                        INNER JOIN usuario
                        AS u
                        ON v.cliente_id = u.id 
                        INNER JOIN viajeTour
                        AS vt
                        ON v.viajeTour_id = vt.id
                        INNER JOIN tour
                        AS t
                        ON vt.tour_id = t.id
                        WHERE v.cliente_id=${clienteId} ORDER BY vt.fecha_ida ASC`;
        let tour = await db.pool.query(query);

        if (tour[0].length != 0) {

            for (let i = 0; i < tour[0].length; i++) {

                let query = `SELECT *
                                FROM comentario
                                WHERE viajeTour_id=${tour[0][i].viajeTour_id}
                                AND cliente_id=${clienteId}`;
                let comentario = await db.pool.query(query);

                if (comentario[0].length != 0) {
                    tour[0][i].comentado = true;
                } else {
                    tour[0][i].comentado = false;
                }
            }
        }

        res.status(200).json(tour[0]);

    } catch (error) {
        console.log(error);
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//historial por id guia
app.get('/historialGuia/:id', async (req, res) => {
    try {
        let guiaId = req.params.id;
        let query = `SELECT vt.fecha_ida, vt.fecha_regreso, vt.status, vt.tour_id, vt.guia_id, vt.geo_llegada, vt.geo_salida, vt.status_viaje,
                        t.nombre AS nombreTour
                        FROM viajeTour
                        AS vt
                        INNER JOIN tour
                        AS t
                        ON vt.tour_id = t.id
                        WHERE vt.guia_id=${guiaId} ORDER BY vt.fecha_ida ASC`;
        let tour = await db.pool.query(query);


        res.status(200).json(tour[0]);

    } catch (error) {
        console.log(error);
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//tours de hoy por id guia
app.get('/toursHoy/:id', async (req, res) => {
    try {
        let guiaId = req.params.id;


        query = `SELECT vt.id AS viajeTour_id, vt.fecha_ida, vt.fecha_regreso, vt.status, vt.tour_id, vt.guia_id, vt.geo_llegada, vt.geo_salida, vt.status_viaje,
                        t.nombre AS nombreTour
                        FROM viajeTour
                        AS vt
                        INNER JOIN tour
                        AS t
                        ON vt.tour_id = t.id
                        WHERE vt.guia_id=${guiaId} AND DATE(vt.fecha_ida) = DATE(now()) AND vt.status_viaje !="realizado"`;
        let tour = await db.pool.query(query);


        res.status(200).json(tour[0]);

    } catch (error) {
        console.log(error);
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//historial de compras de cliente generico por cuenta de correo
app.post('/historialByCorreo', async (req, res) => {
    try {
        let clienteCorreo = req.body.correo;
        let query = `SELECT u.nombres AS nombreUsuario, u.apellidos AS apellidoUsuario, u.correo AS correoUsuario, v.id, v.id_reservacion, v.no_boletos, 
                        pagado, fecha_compra, comision, status_traspaso, v.created_at, v.updated_at, v.cliente_id, v.viajeTour_id, v.total, v.checkin,
                        vt.fecha_ida, vt.fecha_regreso, vt.status, vt.tour_id, vt.guia_id, vt.geo_llegada, vt.geo_salida, vt.status_viaje,
                        t.nombre AS nombreTour
                        FROM venta 
                        AS v
                        INNER JOIN usuario
                        AS u
                        ON v.cliente_id = u.id 
                        INNER JOIN viajeTour
                        AS vt
                        ON v.viajeTour_id = vt.id
                        INNER JOIN tour
                        AS t
                        ON vt.tour_id = t.id
                        WHERE v.correo = '${clienteCorreo}'  AND v.cliente_id = 1 ORDER BY vt.fecha_ida ASC`;
        let tour = await db.pool.query(query);

        res.status(200).json(tour[0]);

    } catch (error) {
        console.log(error);
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/historialByEmpresa/:emId/admin/:adId', async (req, res) => {
    try {
        let empresaId = req.params.emId;
        let adminId = req.params.adId;

        let query = `SELECT
    COALESCE(t.nombre, 'Tour Desconocido') AS "nombre_del_tour",      
    v.id_reservacion AS "id_reservacion",
    v.nombre_cliente AS "nombre_visitante", 
    v.correo AS correo,
    v.no_boletos AS "no_boletos",
    v.checkin AS checkin,
        
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoA')) AS UNSIGNED), 0) AS "total_tipo_A",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoB')) AS UNSIGNED), 0) AS "total_tipo_B",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoC')) AS UNSIGNED), 0) AS "total_tipo_C",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoD')) AS UNSIGNED), 0) AS "total_tipo_D",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoE')) AS UNSIGNED), 0) AS "total_tipo_E",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoF')) AS UNSIGNED), 0) AS "total_tipo_F",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoG')) AS UNSIGNED), 0) AS "total_tipo_G",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoH')) AS UNSIGNED), 0) AS "total_tipo_H",
      
    DATE_FORMAT(vt.fecha_ida, '%Y-%m-%d %H:%i:%s') AS "fecha_ida",
    DATE_FORMAT(v.updated_at, '%Y-%m-%d %H:%i:%s')  AS "fecha_visita",
    DATE_FORMAT(v.fecha_compra, '%Y-%m-%d %H:%i:%s') AS "fecha_compra",
    

        
    v.total AS "total_de_compra",
    
    CASE
        WHEN v.status_traspaso = 99 THEN 'No Aplica'
        WHEN v.status_traspaso = 98 THEN 'Cortesía'
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
            THEN 'Efectivo'
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Pos_tarjeta')
            THEN 'Pos Tarjeta'
        ELSE 'Stripe'
    END AS tipo_compra,
    
    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
            THEN v.total
        ELSE 0.00
    END AS cobrado_efectivo,

    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NULL AND v.metodo_pago = 'Pos_tarjeta' THEN v.total
        ELSE 0.00
    END AS "cobrado_tarjeta",
    
    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NOT NULL THEN v.total
        ELSE 0.00
    END AS "cobrado_stripe"
FROM
    venta AS v
LEFT JOIN 
    viajeTour AS vt ON v.viajeTour_id = vt.id
LEFT JOIN 
    tour AS t ON vt.tour_id = t.id
INNER JOIN 
    empresa AS e ON t.empresa_id = e.id
INNER JOIN
    usuario AS ad ON ad.empresa_id = e.id     
WHERE 
    t.empresa_id=${empresaId} AND ad.id=${adminId} AND v.status_traspaso <> 99 AND ad.isOperator = 0
ORDER BY
    v.fecha_compra DESC`;

        let tour = await db.pool.query(query);

        res.status(200).json(tour[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/historialByEmpresaByMonth/:emId/admin/:adId', async (req, res) => {
    try {
        let empresaId = req.params.emId;
        let adminId = req.params.adId;

        // month y year vienen por query string
        let { month, year } = req.query;

        // si no vienen, usar el mes y año actual
        const today = new Date();
        month = month ? parseInt(month) : today.getMonth() + 1;
        year = year ? parseInt(year) : today.getFullYear();

        let query = `
            SELECT
                COALESCE(t.nombre, 'Tour Desconocido') AS "nombre_del_tour",      
                v.id_reservacion AS "id_reservacion",
                v.nombre_cliente AS "nombre_visitante", 
                v.correo AS correo,
                v.no_boletos AS "no_boletos",
                v.checkin AS checkin,
                    
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoA')) AS UNSIGNED), 0) AS "total_tipo_A",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoB')) AS UNSIGNED), 0) AS "total_tipo_B",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoC')) AS UNSIGNED), 0) AS "total_tipo_C",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoD')) AS UNSIGNED), 0) AS "total_tipo_D",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoE')) AS UNSIGNED), 0) AS "total_tipo_E",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoF')) AS UNSIGNED), 0) AS "total_tipo_F",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoG')) AS UNSIGNED), 0) AS "total_tipo_G",
                COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoH')) AS UNSIGNED), 0) AS "total_tipo_H",
                DATE_FORMAT(vt.fecha_ida, '%Y-%m-%d %H:%i:%s') AS "fecha_ida",
                DATE_FORMAT(v.updated_at, '%Y-%m-%d %H:%i:%s')  AS "fecha_visita",
                DATE_FORMAT(v.fecha_compra, '%Y-%m-%d %H:%i:%s') AS "fecha_compra",

                v.total AS "total_de_compra",
                
                CASE
                    WHEN v.status_traspaso = 99 THEN 'No Aplica'
                    WHEN v.status_traspaso = 98 THEN 'Cortesía'
                    WHEN v.session_id IS NULL 
                        AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
                        THEN 'Efectivo'
                    WHEN v.session_id IS NULL 
                        AND (v.metodo_pago = 'Pos_tarjeta')
                        THEN 'Pos Tarjeta'
                    ELSE 'Stripe'
                END AS tipo_compra,
                
                CASE
                    WHEN v.status_traspaso = 99 THEN 0.00      
                    WHEN v.session_id IS NULL 
                        AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
                        THEN v.total
                    ELSE 0.00
                END AS cobrado_efectivo,

                CASE
                    WHEN v.status_traspaso = 99 THEN 0.00      
                    WHEN v.session_id IS NULL AND v.metodo_pago = 'Pos_tarjeta' THEN v.total
                    ELSE 0.00
                END AS "cobrado_tarjeta",
                
                CASE
                    WHEN v.status_traspaso = 99 THEN 0.00      
                    WHEN v.session_id IS NOT NULL THEN v.total
                    ELSE 0.00
                END AS "cobrado_stripe"
            FROM
                venta AS v
            LEFT JOIN 
                viajeTour AS vt ON v.viajeTour_id = vt.id
            LEFT JOIN 
                tour AS t ON vt.tour_id = t.id
            INNER JOIN 
                empresa AS e ON t.empresa_id = e.id
            INNER JOIN
                usuario AS ad ON ad.empresa_id = e.id     
            WHERE 
                t.empresa_id = ${empresaId}
                AND ad.id = ${adminId}
                AND v.status_traspaso <> 99
                AND ad.isOperator = 0
                AND MONTH(v.fecha_compra) = ${month}
                AND YEAR(v.fecha_compra) = ${year}
            ORDER BY
                v.fecha_compra DESC
        `;

        let tour = await db.pool.query(query);

        res.status(200).json(tour[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
});


app.get('/historialByEmpresaOperadores/:emId/admin/:adId', async (req, res) => {
    try {
        let empresaId = req.params.emId;
        let adminId = req.params.adId;

        let query = `SELECT
    COALESCE(t.nombre, 'Tour Desconocido') AS "nombre_del_tour",      
    v.id_reservacion AS "id_reservacion",
    v.nombre_cliente AS "nombre_visitante", 
    v.nombre_cliente_asignado AS "nombre_cliente_asignado",
    v.correo AS correo,
    v.correo_asignado AS "correo_asignado",
    v.no_boletos AS "no_boletos",
    v.checkin AS checkin,
        
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoA')) AS UNSIGNED), 0) AS "total_tipo_A",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoB')) AS UNSIGNED), 0) AS "total_tipo_B",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoC')) AS UNSIGNED), 0) AS "total_tipo_C",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoD')) AS UNSIGNED), 0) AS "total_tipo_D",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoE')) AS UNSIGNED), 0) AS "total_tipo_E",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoF')) AS UNSIGNED), 0) AS "total_tipo_F",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoG')) AS UNSIGNED), 0) AS "total_tipo_G",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoH')) AS UNSIGNED), 0) AS "total_tipo_H",
      
    DATE_FORMAT(vt.fecha_ida, '%Y-%m-%d %H:%i:%s') AS "fecha_ida",
    DATE_FORMAT(v.updated_at, '%Y-%m-%d %H:%i:%s')  AS "fecha_visita",
    DATE_FORMAT(v.fecha_compra, '%Y-%m-%d %H:%i:%s') AS "fecha_compra",
    

        
    v.total AS "total_de_compra",
    
    CASE
        WHEN v.status_traspaso = 99 THEN 'No Aplica'
        WHEN v.status_traspaso = 98 THEN 'Cortesía'
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
            THEN 'Efectivo'
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Pos_tarjeta')
            THEN 'Pos Tarjeta'
        ELSE 'Stripe'
    END AS tipo_compra,
    
    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
            THEN v.total
        ELSE 0.00
    END AS cobrado_efectivo,

    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NULL AND v.metodo_pago = 'Pos_tarjeta' THEN v.total
        ELSE 0.00
    END AS "cobrado_tarjeta",
    
    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NOT NULL THEN v.total
        ELSE 0.00
    END AS "cobrado_stripe"
FROM
    venta AS v
LEFT JOIN 
    viajeTour AS vt ON v.viajeTour_id = vt.id
LEFT JOIN 
    tour AS t ON vt.tour_id = t.id
INNER JOIN 
    empresa AS e ON t.empresa_id = e.id
INNER JOIN
    usuario AS ad ON ad.empresa_id = e.id     
WHERE 
    t.empresa_id=${empresaId} AND ad.id=${adminId} AND v.status_traspaso <> 99 AND ad.isOperator = 1
ORDER BY
    v.fecha_compra DESC`;

        let tour = await db.pool.query(query);

        res.status(200).json(tour[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.get('/historialByEmpresa-canceladas/:emId/admin/:adId', async (req, res) => {
    try {
        let empresaId = req.params.emId;
        let adminId = req.params.adId;

        let query = `SELECT
    COALESCE(t.nombre, 'Tour Desconocido') AS "nombre_del_tour",      
    v.id_reservacion AS "id_reservacion",
    v.nombre_cliente AS "nombre_visitante", 
    v.correo AS correo,
    v.no_boletos AS "no_boletos",
    v.checkin AS checkin,
        
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoA')) AS UNSIGNED), 0) AS "total_tipo_A",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoB')) AS UNSIGNED), 0) AS "total_tipo_B",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoC')) AS UNSIGNED), 0) AS "total_tipo_C",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoD')) AS UNSIGNED), 0) AS "total_tipo_D",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoE')) AS UNSIGNED), 0) AS "total_tipo_E",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoF')) AS UNSIGNED), 0) AS "total_tipo_F",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoG')) AS UNSIGNED), 0) AS "total_tipo_G",
    COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoH')) AS UNSIGNED), 0) AS "total_tipo_H",
      
    DATE_FORMAT(vt.fecha_ida, '%Y-%m-%d %H:%i:%s') AS "fecha_ida",
    DATE_FORMAT(v.updated_at, '%Y-%m-%d %H:%i:%s')  AS "fecha_visita",
    DATE_FORMAT(v.fecha_compra, '%Y-%m-%d %H:%i:%s') AS "fecha_compra",
    

        
    v.total AS "total_de_compra",
    
    CASE
        WHEN v.status_traspaso = 99 THEN 'No Aplica'
        WHEN v.status_traspaso = 98 THEN 'Cortesía'
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
            THEN 'Efectivo'
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Pos_tarjeta')
            THEN 'Pos Tarjeta'
        ELSE 'Stripe'
    END AS tipo_compra,
    
    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NULL 
             AND (v.metodo_pago = 'Efectivo' OR v.metodo_pago IS NULL)
            THEN v.total
        ELSE 0.00
    END AS cobrado_efectivo,

    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NULL AND v.metodo_pago = 'Pos_tarjeta' THEN v.total
        ELSE 0.00
    END AS "cobrado_tarjeta",
    
    CASE
        WHEN v.status_traspaso = 99 THEN 0.00      
        WHEN v.session_id IS NOT NULL THEN v.total
        ELSE 0.00
    END AS "cobrado_stripe"
FROM
    venta AS v
LEFT JOIN 
    viajeTour AS vt ON v.viajeTour_id = vt.id
LEFT JOIN 
    tour AS t ON vt.tour_id = t.id
INNER JOIN 
    empresa AS e ON t.empresa_id = e.id
INNER JOIN
    usuario AS ad ON ad.empresa_id = e.id     
WHERE 
    t.empresa_id=${empresaId} AND ad.id=${adminId} AND v.status_traspaso = 99 AND ad.isOperator = 0
ORDER BY
    v.fecha_compra DESC`;

        let tour = await db.pool.query(query);

        res.status(200).json(tour[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})


app.post('/crear', async (req, res) => {
    try {
        const { fecha_ida, max_pasajeros, min_pasajeros, lugares_disp, tour_id, guia_id } = req.body;

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        // Obtener duración del tour en minutos
        let queryDuracion = `SELECT duracion FROM tour WHERE id = ${tour_id}`;
        let resultDuracion = await db.pool.query(queryDuracion);
        let duracion = resultDuracion[0][0]?.duracion || 0;

        // Calcular fecha_regreso sumando minutos
        const newfecha = addMinutesToDate(new Date(fecha_ida), parseInt(duracion));
        const fecha_regreso = newfecha.getFullYear() + "-" + ("0" + (newfecha.getMonth() + 1)).slice(-2) + "-" + ("0" + newfecha.getDate()).slice(-2) + " " + ("0" + (newfecha.getHours())).slice(-2) + ":" + ("0" + (newfecha.getMinutes())).slice(-2);

        let query = `INSERT INTO viajeTour 
                        (fecha_ida, fecha_regreso, max_pasajeros, min_pasajeros, lugares_disp, created_at, updated_at, tour_id, guia_id) 
                        VALUES 
                        ('${fecha_ida}', '${fecha_regreso}', '${max_pasajeros}', '${min_pasajeros}', '${lugares_disp}', '${fecha}', '${fecha}', '${tour_id}', '${guia_id}')`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            viajeTourId: {
                id: result.insertId,
            }
        }

        jwt.sign(payload, process.env.SECRET, { expiresIn: 36000 }, (error, token) => {
            if (error) throw error
            res.status(200).json({ error: false, token: token })
        })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/set', async (req, res) => {
    try {
        const { id, fecha_ida, fecha_regreso, lugares_disp, tour_id, guia_id, geo_llegada, geo_salida, status_viaje } = req.body

        let errors = Array();

        if (!id) {
            errors.push({ msg: "El campo id debe de contener un valor valido" });
        }
        if (!fecha_ida) {
            errors.push({ msg: "El campo fecha_ida debe de contener un valor" });
        }
        if (!fecha_regreso) {
            errors.push({ msg: "El campo fecha_regreso debe de contener un valor" });
        }
        if (!lugares_disp) {
            errors.push({ msg: "El campo lugares_disp debe de contener un valor" });
        }
        if (!tour_id) {
            errors.push({ msg: "El campo tour_id debe de contener un valor" });
        }
        if (!guia_id) {
            errors.push({ msg: "El campo guia_id debe de contener un valor" });
        }
        if (!geo_llegada) {
            errors.push({ msg: "El campo geo_llegada debe de contener un valor" });
        }
        if (!geo_salida) {
            errors.push({ msg: "El campo geo_salida debe de contener un valor" });
        }
        if (!status_viaje) {
            errors.push({ msg: "El campo status_viaje debe de contener un valor" });
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

        let query = `UPDATE viajeTour SET
                        fecha_ida     = '${fecha_ida}',
                        fecha_regreso = '${fecha_regreso}',
                        lugares_disp  = '${lugares_disp}', 
                        updated_at    = '${fecha}', 
                        tour_id       = '${tour_id}', 
                        guia_id       = '${guia_id}',
                        geo_llegada   = '${geo_llegada}',
                        geo_salida    = '${geo_salida}',
                        status_viaje  = '${status_viaje}'
                        WHERE id      = ${id}`;

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error: false, msg: "Registro actualizado con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

//set realizado a viajeTour por id
app.put('/setRealizado', async (req, res) => {
    try {
        let idvt = req.body.id;

        let errors = Array();

        if (!idvt) {
            errors.push({ msg: "El campo id debe de contener un valor valido" });
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

        let query = `UPDATE viajeTour SET
                        updated_at    = '${fecha}', 
                        status_viaje  = 'realizado'
                        WHERE id      = ${idvt}`;

        let result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error: false, msg: "Registro actualizado con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

//set en curso a viajeTour por id
app.put('/setEnCurso', async (req, res) => {
    try {
        let idvt = req.body.id;

        let errors = Array();

        if (!idvt) {
            errors.push({ msg: "El campo id debe de contener un valor valido" });
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

        query = `UPDATE viajeTour SET
                        updated_at    = '${fecha}', 
                        status_viaje  = 'en curso'
                        WHERE id      =  ${idvt}`;

        result = await db.pool.query(query);
        result = result[0];

        res.status(200).json({ error: false, msg: "Registro actualizado con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.post('/actualizaHistorial', async (req, res) => {
    try {
        const { id_cliente, correo, opcion } = req.body

        let errors = Array();

        if (!id_cliente) {
            errors.push({ msg: "El campo id_cliente debe de contener un valor valido" });
        }
        if (!correo) {
            errors.push({ msg: "El campo correo debe de contener un valor" });
        }
        if (!opcion) {
            errors.push({ msg: "El campo opcion debe de contener un valor" });
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

        if (opcion == 'Agregar') {
            let query = `UPDATE venta SET
                        cliente_id    = '${id_cliente}',
                        updated_at    = '${fecha}' 
                        WHERE correo = '${correo}' AND cliente_id = 1`;

            let result = await db.pool.query(query);
            result = result[0];

            res.status(200).json({ error: false, msg: "Registro actualizado con exito" })
        }

        if (opcion == 'Omitir') {
            let query = `UPDATE venta SET
                        correo  = CONCAT(correo, '_OMITIR'),
                        updated_at    = '${fecha}' 
                        WHERE correo = '${correo}' AND cliente_id = 1`;

            let result = await db.pool.query(query);
            result = result[0];

            res.status(200).json({ error: false, msg: "Registro actualizado con exito" })
        }

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/delete', async (req, res) => {
    try {
        let viajeTourId = req.body.id;

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE viajeTour SET
                        status     = 0,
                        updated_at = '${fecha}' 
                        WHERE id   = ${viajeTourId}`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            tour: {
                id: result.insertId,
            }
        }

        res.status(200).json({ error: false, msg: "Se ha dado de baja la viajeTour con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/active', async (req, res) => {
    try {
        let viajeTourId = req.body.id;

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE viajeTour SET
                        status     = 1,
                        updated_at = '${fecha}' 
                        WHERE id   = ${viajeTourId}`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            tour: {
                id: result.insertId,
            }
        }

        res.status(200).json({ error: false, msg: "Se ha reactivado el viajeTour con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

module.exports = app