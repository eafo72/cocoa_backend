/* Importing the express module and creating an instance of it. */
const express = require('express')
const app = express.Router()
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const auth = require('../middlewares/authorization')
const db = require('../config/db')
const mailer = require('../controller/mailController')
const helperName = require('../helpers/name')
const QRCode = require('qrcode')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const emailTemplate = require('../templates/emailTemplate-correo_confirmacion_compra');

function generarPassword(longitud = 10) {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+=<>?';
    let password = '';
    for (let i = 0; i < longitud; i++) {
        password += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    return password;
}

function addMinutesToDate(objDate, intMinutes) {
    var numberOfMlSeconds = objDate.getTime();
    var addMlSeconds = intMinutes * 60000;
    var newDateObj = new Date(numberOfMlSeconds + addMlSeconds);
    return newDateObj;
}


function weekDay(fecha) {
    let dayselected;

    if (typeof fecha === 'string') {
        const [year, month, day] = fecha.split('-').map(Number);
        dayselected = new Date(year, month - 1, day); // <-- sin UTC
    } else {
        dayselected = fecha;
    }

    const diasSemana = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    return diasSemana[dayselected.getDay()];
}

// Función para generar el código QR
async function generateQRCode(text) {
    try {
        // Cambiado a toBuffer para devolver un buffer en lugar de un Data URL
        const qrCodeBuffer = await QRCode.toBuffer(text);
        return qrCodeBuffer;
    } catch (err) {
        console.error('Error generating QR Code:', err);
        throw err;
    }
}

// Función para normalizar la hora a formato 24h
const normalizarHora = (horaStr) => {
    if (!horaStr || typeof horaStr !== 'string') return '00:00:00';

    horaStr = horaStr.trim();

    // Caso 1: formato 24h estándar (ej: '13:30', '09:00', '23:15:45')
    if (/^([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(horaStr)) {
        const [h, m, s = '00'] = horaStr.split(':');
        return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
    }

    // Caso 2: formato 12h (ej: '1:30 PM' o '9:00 AM')
    const match12 = horaStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (match12) {
        let [_, h, m, period] = match12;
        h = parseInt(h, 10);
        m = m.padStart(2, '0');

        if (period) {
            period = period.toUpperCase();
            if (period === 'PM' && h < 12) h += 12;
            if (period === 'AM' && h === 12) h = 0;
        }

        return `${h.toString().padStart(2, '0')}:${m}:00`;
    }

    // ✅ Caso 3: formato con 'h' (ej: '13h40', '9h05', '23h00')
    const matchH = horaStr.match(/^(\d{1,2})h(\d{1,2})$/i);
    if (matchH) {
        let [, h, m] = matchH;
        h = h.padStart(2, '0');
        m = m.padStart(2, '0');
        return `${h}:${m}:00`;
    }

    // Caso 4: formato desconocido → intentar rescatar minutos si existen
    console.warn('Formato de hora no reconocido, usando valor original:', horaStr);
    return horaStr.includes(':')
        ? `${horaStr.split(':').slice(0, 2).join(':')}:00`
        : '00:00:00';
};

const verificarDisponibilidad = async (no_boletos, tourId, fecha, hora) => {

    hora = normalizarHora(hora);
    hora = hora.split(':');

    if (no_boletos > 12) {
        return false;
    }

    let query = `SELECT 
                        * 
                        FROM viajeTour 
                        WHERE CAST(fecha_ida AS DATE) = '${fecha}'
                        AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = '${hora[0]}:${hora[1]}'
                        AND tour_id = ${tourId};`;
    let disponibilidad = await db.pool.query(query);

    //si disponibilidad == 0 significa que no hay ningun viajeTour y entonces si hay lugares
    if (disponibilidad[0].length > 0) {
        disponibilidad = disponibilidad[0][0];
        if (disponibilidad.lugares_disp + Number(no_boletos) > 12) {
            return false;
        }
    }
    return true;
}


//////////////////////////////////////////
//                Venta                 //
//////////////////////////////////////////
app.get('/ventas', async (req, res) => {
    try {
        let query = "SELECT * FROM venta";
        let ventas = await db.pool.query(query);

        res.status(200).json(ventas[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//ventas por mes
app.get('/ventaspormes', async (req, res) => {
    try {
        let query = "SELECT MONTHNAME(v.fecha_compra) AS Mes, SUM(v.total) AS Total FROM venta v WHERE YEAR(v.fecha_compra) = '2024' GROUP BY Mes ORDER BY Mes ASC";
        let ventas = await db.pool.query(query);
        res.status(200).json(ventas[0]);
    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//tours vendidos por mes
app.get('/tourspormes', async (req, res) => {
    try {
        //let query = "SELECT MONTHNAME(v.fecha_compra) AS Mes, SUM(v.no_boletos) AS Total FROM venta v WHERE YEAR(v.fecha_compra) = '2024' GROUP BY Mes ORDER BY Mes ASC;";
        let query = `SELECT t.nombre, SUM(v.no_boletos) AS Total FROM venta v 
        INNER JOIN viajeTour AS vt
        ON v.viajeTour_id = vt.id 
        INNER JOIN tour AS t
        ON vt.tour_id = t.id
        WHERE YEAR(v.fecha_compra) = '2024' GROUP BY t.nombre ORDER BY t.nombre ASC;`;

        let ventas = await db.pool.query(query);
        res.status(200).json(ventas[0]);
    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//ventas por mes por empresa
app.get('/ventaspormesbyempresa/:id', async (req, res) => {
    let empresaId = req.params.id;
    try {
        let query = `SELECT MONTHNAME(v.fecha_compra) AS Mes, SUM(v.total) AS Total FROM venta v 
        INNER JOIN viajeTour AS vt ON v.viajeTour_id = vt.id INNER JOIN tour AS t ON vt.tour_id = t.id
        WHERE YEAR(v.fecha_compra) = '2024' AND t.empresa_id = ${empresaId} GROUP BY Mes ORDER BY Mes ASC`;
        let ventas = await db.pool.query(query);
        res.status(200).json(ventas[0]);
    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//tours vendidos por mes por empresa
app.get('/tourspormesbyempresa/:id', async (req, res) => {
    let empresaId = req.params.id;
    try {
        //let query = `SELECT MONTHNAME(v.fecha_compra) AS Mes, SUM(v.no_boletos) AS Total FROM venta v INNER JOIN viajeTour AS vt ON v.viajeTour_id = vt.id INNER JOIN tour AS t ON vt.tour_id = t.id WHERE YEAR(v.fecha_compra) = '2024' AND t.empresa_id = ${empresaId} GROUP BY Mes ORDER BY Mes ASC`;

        let query = `SELECT t.nombre, SUM(v.no_boletos) AS Total FROM venta v 
        INNER JOIN viajeTour AS vt
        ON v.viajeTour_id = vt.id 
        INNER JOIN tour AS t
        ON vt.tour_id = t.id
        WHERE YEAR(v.fecha_compra) = '2024' AND t.empresa_id = ${empresaId} GROUP BY t.nombre ORDER BY t.nombre ASC;`;

        let ventas = await db.pool.query(query);
        res.status(200).json(ventas[0]);
    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//obtener venta por id
app.get('/obtener/:id', async (req, res) => {
    try {
        let ventaId = req.params.id;
        let query = `SELECT u.nombres AS nombreUsuario, u.apellidos AS apellidoUsuario, u.correo AS correoUsuario, v.id, v.no_boletos, 
                        pagado, fecha_compra, comision, status_traspaso, v.created_at, v.updated_at, v.cliente_id, v.viajeTour_id, v.total,
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
                        WHERE v.id=${ventaId}`;
        let venta = await db.pool.query(query);

        res.status(200).json(venta[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//obtener ventas por viajeTour_id
app.get('/obtenerByViajeTourId/:id', async (req, res) => {
    try {
        let ventaId = req.params.id;
        let query = `SELECT * FROM venta WHERE viajeTour_id=${ventaId}`;
        let venta = await db.pool.query(query);

        res.status(200).json(venta[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//la feha esta definida por AAAA-MM-DD y la hora desde 00 hasta 23 Y LOS MINUTOS
app.get('/disponibilidad/:tourid/fecha/:fecha/:hora', async (req, res) => {
    try {
        let fecha = req.params.fecha;
        let tourId = req.params.tourid;
        let hora = req.params.hora;
        let query = `SELECT 
                        * 
                        FROM viajeTour 
                        WHERE CAST(fecha_ida AS DATE) = '${fecha}'
                        AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = '${hora}'
                        AND tour_id = ${tourId};`;
        let disponibilidad = await db.pool.query(query);
        disponibilidad = disponibilidad[0];

        if (disponibilidad.length == 0) {
            return res.status(200).json({ msg: "No hay ninguna reserva todavia, todos los lugares disponibles", error: false, disponible: true, sinReserva: true });
        }

        disponibilidad = disponibilidad[0];

        if (disponibilidad.lugares_disp >= 1) {
            return res.status(200).json({ msg: "Lugares disponibles", error: false, disponible: true, sinReserva: false, lugares_disp: disponibilidad.lugares_disp });
        }

        res.status(200).json({ msg: "Lugares no disponibles", error: false, disponible: false, sinReserva: false, lugares_disp: disponibilidad.lugares_disp });

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

//la feha esta definida por AAAA-MM-DD
app.get('/horarios/:tourid/fecha/:fecha/boletos/:boletos', async (req, res) => {
    try {
        let fecha = req.params.fecha;
        let tourId = req.params.tourid;
        let boletos = parseInt(req.params.boletos);

        // Debug logs para depuración
        // console.log('[HORARIOS] fecha:', fecha, 'tourId:', tourId, 'boletos:', boletos);

        //vemos que dia selecciono 
        let diaSeleccionado = weekDay(fecha);
        //console.log('[HORARIOS] diaSeleccionado:', diaSeleccionado);

        //buscamos los horarios del tour
        let query = `SELECT * FROM fecha WHERE tour_id=${tourId} AND dia = '${diaSeleccionado}' ORDER BY dia, hora_salida ASC`;
        //console.log('[HORARIOS] query horarios:', query);
        let horariosResult = await db.pool.query(query);
        let horarios = horariosResult[0];
        //console.log('[HORARIOS] horarios encontrados:', horarios);


        /*
        /////////////////////////////////////////// inicio fechas especiales //////////////////////////////////////////////
        const fechasEspeciales = ['2025-10-31', '2025-11-01']; // ajusta al formato real de tu campo `dia`

        // 🔹 Si la fecha NO es especial, solo mostrar horarios hasta las 18:00 sino entonces mostrar todos los horarios
        if (!fechasEspeciales.includes(fecha)) {
            
            horarios = horarios.filter(h => {
                const hora = String(h.hora_salida).substring(0, 5); // "HH:MM"
                return hora <= '18:00';
            });
        }
        /////////////////////////////////////////// fin fechas especiales //////////////////////////////////////////////
        */

        // Para cada horario, verificar disponibilidad
        let horariosDisponibles = await Promise.all(horarios.map(async (horario) => {
            // Soportar ambos nombres de campo: hora y hora_salida
            let horaCampo = horario.hora || horario.hora_salida;
            if (!horaCampo || typeof horaCampo !== 'string') {
                // Si no hay hora válida, ignorar este horario
                return {
                    ...horario,
                    disponible: false,
                    lugares_disp: 'sin_hora'
                };
            }

            //let hora = horaCampo.split(":")[0];
            //let queryViaje = `SELECT * FROM viajeTour WHERE CAST(fecha_ida AS DATE) = '${fecha}' AND HOUR(CAST(fecha_ida AS TIME)) = '${hora}' AND tour_id = ${tourId}`;
            let queryViaje = `SELECT * FROM viajeTour WHERE CAST(fecha_ida AS DATE) = '${fecha}' AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = '${horaCampo}' AND tour_id = ${tourId}`;

            //console.log('[HORARIOS] query viajeTour:', queryViaje);
            let viajeResult = await db.pool.query(queryViaje);
            //console.log('[HORARIOS] viajeResult:', viajeResult[0]);
            let disponible = true;
            let lugares_disp = null;
            if (viajeResult[0].length > 0) {
                let viaje = viajeResult[0][0];
                lugares_disp = viaje.lugares_disp;
                disponible = viaje.lugares_disp >= boletos;
            } else {
                // No hay viajeTour, consultar el tour para max_pasajeros
                let queryTour = `SELECT max_pasajeros FROM tour WHERE id = ${tourId}`;
                let tourResult = await db.pool.query(queryTour);
                let max_pasajeros = tourResult[0][0]?.max_pasajeros;
                if (typeof max_pasajeros === 'number') {
                    lugares_disp = max_pasajeros;
                    disponible = max_pasajeros >= boletos;
                } else {
                    lugares_disp = 'sin_info_tour';
                    disponible = false;
                }
            }
            return {
                ...horario,
                disponible,
                lugares_disp
            };
        }));

        res.status(200).json({ error: false, horarios: horariosDisponibles });

    } catch (error) {
        console.error('[HORARIOS] Error:', error);
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})


app.post('/crear', async (req, res) => {
    try {
        let { no_boletos, tipos_boletos, pagado, nombre_cliente, cliente_id, correo, viajeTourId, tourId, fecha_ida, horaCompleta, total } = req.body


        let today = new Date().toLocaleString('es-MX', {
            timeZone: 'America/Mexico_City',
            hour12: false // formato 24 horas sin AM/PM
        });
        // Ejemplo: "29/09/2025, 23:42:08"
        let [datePart, timePart] = today.split(', ');
        let [day, month, year] = datePart.split('/');
        let [hours, minutes, seconds] = timePart.split(':');
        month = month.padStart(2, '0');
        day = day.padStart(2, '0');
        hours = hours.padStart(2, '0');
        minutes = minutes.padStart(2, '0');
        seconds = seconds.padStart(2, '0');
        let fecha = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

        let seCreoRegistro = false;
        let viajeTour = '';
        let query = ``;

        //info tour para calcular fecha de regreso
        query = `SELECT * FROM tour WHERE id = ${tourId} `;
        let tour = await db.pool.query(query);
        tour = tour[0][0];
        let duracion = tour.duracion;
        let max_pasajeros = tour.max_pasajeros;
        //console.log(`Duracion: ${duracion}`);

        if (!viajeTourId) {

            try {
                let hora = horaCompleta.split(':');

                query = `SELECT 
                        * 
                        FROM viajeTour 
                        WHERE CAST(fecha_ida AS DATE) = '${fecha_ida}'
                        AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = '${hora[0]}:${hora[1]}'
                        AND tour_id = ${tourId};`;
                let disponibilidad = await db.pool.query(query);
                disponibilidad = disponibilidad[0];

                if (hora.length < 3) {
                    horaCompleta += ':00'
                }
                //formateo de fechaida
                fecha_ida += ' ' + horaCompleta;
                console.log(fecha_ida);


                //formateo de fecha regreso
                const newfecha = addMinutesToDate(new Date(fecha_ida), parseInt(duracion));
                const fecha_regreso = newfecha.getFullYear() + "-" + ("0" + (newfecha.getMonth() + 1)).slice(-2) + "-" + ("0" + newfecha.getDate()).slice(-2) + " " + ("0" + (newfecha.getHours())).slice(-2) + ":" + ("0" + (newfecha.getMinutes())).slice(-2);
                console.log(fecha_regreso);

                if (disponibilidad.length == 0) {
                    query = `SELECT 
                        * 
                        FROM tour
                        WHERE id = ${tourId}`;
                    let result = await db.pool.query(query);

                    if (result[0].length == 0) {
                        return res.status(400).json({ msg: "Error en la busquda del tour por id", error: true, details: 'nungun registro encontrado' });
                    }

                    result = result[0][0];

                    let guia = result.guias;
                    guia = JSON.parse(guia);

                    query = `INSERT INTO viajeTour 
                        (fecha_ida, fecha_regreso, lugares_disp, created_at, updated_at, tour_id, guia_id, geo_llegada, geo_salida) 
                        VALUES 
                        ('${fecha_ida}', '${fecha_regreso}', '${max_pasajeros}', '${fecha}', '${fecha}', '${tourId}', '${guia[0].value}', '${null}', '${null}')`;

                    result = await db.pool.query(query);
                    result = result[0];

                    viajeTourId = result.insertId;
                    seCreoRegistro = true;

                } else {
                    viajeTour = disponibilidad[0];
                    viajeTourId = disponibilidad[0].id;
                }

            } catch (error) {
                console.log(error);
                return res.status(400).json({ msg: "Error en la creacion del registro viaje tour", error: true, details: error });
            }

        } else {
            query = `SELECT 
                        * 
                        FROM viajeTour
                        WHERE id = ${viajeTourId}`;
            let result = await db.pool.query(query);
            result = result[0];

            if (result.length == 0) {
                return res.status(400).json({ msg: "Error en la busquda del viaje tour por id", error: true, details: 'nungun registro encontrado' });
            }
            viajeTour = result[0];

        }

        let lugares_disp = 0;

        if (seCreoRegistro) {
            lugares_disp = max_pasajeros - no_boletos;
        } else {
            lugares_disp = viajeTour.lugares_disp - no_boletos;
        }
        if (lugares_disp < 0) {
            return res.status(400).json({ msg: "El numero de boletos excede los lugares disponibles", error: true, details: `Lugares disponibles: ${viajeTour.lugares_disp}` });
        }

        query = `INSERT INTO venta 
                        (id_reservacion, no_boletos, tipos_boletos, total, pagado, fecha_compra, comision, status_traspaso, fecha_comprada, created_at, updated_at, nombre_cliente, cliente_id, correo, viajeTour_id) 
                        VALUES 
                        ('V', '${no_boletos}', '${tipos_boletos}', '${total}', '${pagado}', '${fecha}', '0.0', '0', '${fecha_ida}', '${fecha}', '${fecha}', '${nombre_cliente}', '${cliente_id}', '${correo}', '${viajeTourId}')`;

        let result = await db.pool.query(query);
        result = result[0];

        query = `SELECT 
                        * 
                        FROM usuario
                        WHERE id = ${cliente_id}`;
        let client = await db.pool.query(query);

        client = client[0];

        if (client.length == 0) {
            return res.status(400).json({ msg: "Error en la busquda de los datos del cliente", error: true, details: 'nungun registro encontrado' });
        }
        client = client[0];

        let id_reservacion = result.insertId + 'V' + helperName(client.nombres.split(' ')) + helperName(client.apellidos.split(' '));

        //creamos el QR
        const qrCodeBuffer = await generateQRCode(id_reservacion);

        query = `UPDATE viajeTour SET
                    lugares_disp = '${lugares_disp}'
                    WHERE id     = ${viajeTourId}`;

        await db.pool.query(query);

        query = `UPDATE venta SET
                    id_reservacion = '${id_reservacion}'
                    WHERE id       = ${result.insertId}`;

        await db.pool.query(query);

        let html = `<div style="background-color: #eeeeee;padding: 20px; width: 400px;">
        <div align="center" style="padding-top:20px;padding-bottom:40px"><img src="https://museodesarrollo.info/assets/img/ELEMENTOS/logodos.png" style="height:100px"/></div>
        <p>Su compra ha sido exitosa.</p>

        <p style="display: inline-flex">Numero de boletos: ${no_boletos}</p>
        <br>
        <p style="display: inline-flex">Fecha: ${fecha_ida}</p>
        <br>
        <p style="display: inline-flex">Id de reservación: ${id_reservacion}</p>
        <br>
        <img src="cid:qrImage" alt="Código QR"/>
        
        <div style="padding-top:20px;padding-bottom:20px"><hr></div>
        <p style="font-size:10px">Recibiste éste correo porque las preferencias de correo electrónico se configuraron para recibir notificaciones del Museo Casa Kahlo.</p>
        <p style="font-size:10px">Te pedimos que no respondas a este correo electrónico. Si tienes alguna pregunta sobre tu cuenta, contáctanos a través de la aplicación.</p>
        
        <p style="font-size:10px;padding-top:20px">Copyright2025 Museo Casa Kahlo.Todos los derechos reservados.</p></div>`;

        let message = {
            from: process.env.MAIL, // sender address
            to: process.env.MAIL, // list of receivers
            subject: "Compra exitosa", // Subject line
            text: "", // plain text body
            html: `${html}`, // html body
            attachments: [{
                filename: 'qr.png',
                content: qrCodeBuffer,
                cid: 'qrImage'
            }]
        }

        const info = await mailer.sendMail(message);
        console.log(info);

        message = {
            from: process.env.MAIL, // sender address
            to: correo, // list of receivers
            subject: "Compra exitosa", // Subject line
            text: "", // plain text body
            html: `${html}`, // html body
            attachments: [{
                filename: 'qr.png',
                content: qrCodeBuffer,
                cid: 'qrImage'
            }]
        }

        const info2 = await mailer.sendMail(message);
        console.log(info2);

        res.status(200).json({ msg: "Compra exitosa", id_reservacion: id_reservacion, viajeTourId: viajeTourId, error: false });

    } catch (error) {
        console.log(error);
        res.status(400).json({ error: true, details: error })
    }
})

app.post('/crear-admin', async (req, res) => {
    try {
        let { no_boletos, tipos_boletos, pagado, nombre_cliente, apellidos_cliente, correo, telefono, viajeTourId, tourId, fecha_ida, horaCompleta, total } = req.body

        let nombre_completo = nombre_cliente + ' ' + apellidos_cliente;

        let today = new Date().toLocaleString('es-MX', {
            timeZone: 'America/Mexico_City',
            hour12: false // formato 24 horas sin AM/PM
        });
        // Ejemplo: "29/09/2025, 23:42:08"
        let [datePart, timePart] = today.split(', ');
        let [day, month, year] = datePart.split('/');
        let [hours, minutes, seconds] = timePart.split(':');
        month = month.padStart(2, '0');
        day = day.padStart(2, '0');
        hours = hours.padStart(2, '0');
        minutes = minutes.padStart(2, '0');
        seconds = seconds.padStart(2, '0');
        let fecha = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

        let seCreoRegistro = false;
        let viajeTour = '';
        let query = ``;


        //Verificamos si existe el correo en la DB
        let clienteExiste = null;
        let cliente_id = null;
        let password = null;

        query = `SELECT * FROM usuario WHERE correo='${correo}'`;

        let existCorreo = await db.pool.query(query);

        if (existCorreo[0].length >= 1) {
            clienteExiste = true;
            nombre_cliente = existCorreo[0][0].nombres;
            apellidos_cliente = existCorreo[0][0].apellidos;
            correo = existCorreo[0][0].correo;
            nombre_completo = nombre_cliente + ' ' + apellidos_cliente;
            cliente_id = existCorreo[0][0].id;
        } else {
            clienteExiste = false;
            //generamos un password aleatorio
            password = generarPassword();
            const salt = await bcryptjs.genSalt(10);
            const hashedPassword = await bcryptjs.hash(password, salt);

            //damos de alta al cliente
            query = `INSERT INTO usuario 
                            (nombres, apellidos, correo, telefono, password, isClient, created_at, updated_at) 
                            VALUES 
                            ('${nombre_cliente}', '${apellidos_cliente}', '${correo}', '${telefono}', '${hashedPassword}', 1, '${fecha}', '${fecha}')`;


            let newClient = await db.pool.query(query);
            cliente_id = newClient[0].insertId;
        }


        //info tour para calcular fecha de regreso
        query = `SELECT * FROM tour WHERE id = ${tourId} `;
        let tour = await db.pool.query(query);
        tour = tour[0][0];
        let duracion = tour.duracion;
        let max_pasajeros = tour.max_pasajeros;
        //console.log(`Duracion: ${duracion}`);

        if (!viajeTourId) {

            try {
                let hora = horaCompleta.split(':');

                query = `SELECT 
                        * 
                        FROM viajeTour 
                        WHERE CAST(fecha_ida AS DATE) = '${fecha_ida}'
                        AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = '${hora[0]}:${hora[1]}'
                        AND tour_id = ${tourId};`;
                let disponibilidad = await db.pool.query(query);
                disponibilidad = disponibilidad[0];

                if (hora.length < 3) {
                    horaCompleta += ':00'
                }
                //formateo de fechaida
                fecha_ida += ' ' + horaCompleta;
                console.log(fecha_ida);


                //formateo de fecha regreso
                const newfecha = addMinutesToDate(new Date(fecha_ida), parseInt(duracion));
                const fecha_regreso = newfecha.getFullYear() + "-" + ("0" + (newfecha.getMonth() + 1)).slice(-2) + "-" + ("0" + newfecha.getDate()).slice(-2) + " " + ("0" + (newfecha.getHours())).slice(-2) + ":" + ("0" + (newfecha.getMinutes())).slice(-2);
                console.log(fecha_regreso);

                if (disponibilidad.length == 0) {
                    query = `SELECT 
                        * 
                        FROM tour
                        WHERE id = ${tourId}`;
                    let result = await db.pool.query(query);

                    if (result[0].length == 0) {
                        return res.status(400).json({ msg: "Error en la busquda del tour por id", error: true, details: 'nungun registro encontrado' });
                    }

                    result = result[0][0];

                    let guia = result.guias;
                    guia = JSON.parse(guia);

                    query = `INSERT INTO viajeTour 
                        (fecha_ida, fecha_regreso, lugares_disp, created_at, updated_at, tour_id, guia_id, geo_llegada, geo_salida) 
                        VALUES 
                        ('${fecha_ida}', '${fecha_regreso}', '${max_pasajeros}', '${fecha}', '${fecha}', '${tourId}', '${guia[0].value}', '${null}', '${null}')`;

                    result = await db.pool.query(query);
                    result = result[0];

                    viajeTourId = result.insertId;
                    seCreoRegistro = true;

                } else {
                    viajeTour = disponibilidad[0];
                    viajeTourId = disponibilidad[0].id;
                }

            } catch (error) {
                console.log(error);
                return res.status(400).json({ msg: "Error en la creacion del registro viaje tour", error: true, details: error });
            }

        } else {
            query = `SELECT 
                        * 
                        FROM viajeTour
                        WHERE id = ${viajeTourId}`;
            let result = await db.pool.query(query);
            result = result[0];

            if (result.length == 0) {
                return res.status(400).json({ msg: "Error en la busquda del viaje tour por id", error: true, details: 'nungun registro encontrado' });
            }
            viajeTour = result[0];

        }

        let lugares_disp = 0;

        if (seCreoRegistro) {
            lugares_disp = max_pasajeros - no_boletos;
        } else {
            lugares_disp = viajeTour.lugares_disp - no_boletos;
        }
        if (lugares_disp < 0) {
            return res.status(400).json({ msg: "El numero de boletos excede los lugares disponibles", error: true, details: `Lugares disponibles: ${viajeTour.lugares_disp}` });
        }

        query = `INSERT INTO venta 
                        (id_reservacion, no_boletos, tipos_boletos, total, pagado, fecha_compra, comision, status_traspaso, fecha_comprada, created_at, updated_at, nombre_cliente, cliente_id, correo, viajeTour_id) 
                        VALUES 
                        ('V', '${no_boletos}', '${tipos_boletos}', '${total}', '${pagado}', '${fecha}', '0.0', '0', '${fecha_ida}', '${fecha}', '${fecha}', '${nombre_completo}', '${cliente_id}', '${correo}', '${viajeTourId}')`;

        let result = await db.pool.query(query);
        result = result[0];

        query = `SELECT 
                        * 
                        FROM usuario
                        WHERE id = ${cliente_id}`;
        let client = await db.pool.query(query);

        client = client[0];

        if (client.length == 0) {
            return res.status(400).json({ msg: "Error en la busquda de los datos del cliente", error: true, details: 'nungun registro encontrado' });
        }
        client = client[0];

        let id_reservacion = result.insertId + 'V' + helperName(client.nombres.split(' ')) + helperName(client.apellidos.split(' '));

        //creamos el QR
        const qrCodeBuffer = await generateQRCode(id_reservacion);

        query = `UPDATE viajeTour SET
                    lugares_disp = '${lugares_disp}'
                    WHERE id     = ${viajeTourId}`;

        await db.pool.query(query);

        query = `UPDATE venta SET
                    id_reservacion = '${id_reservacion}'
                    WHERE id       = ${result.insertId}`;

        await db.pool.query(query);


        ////////////////////////////////// preparacion de correo//////////////////////////////////
        // Crear la tabla de boletos
        let tiposBoletos = {};

        try {
            tiposBoletos = JSON.parse(tipos_boletos);

            if (typeof tiposBoletos !== 'object' || tiposBoletos === null || Array.isArray(tiposBoletos)) {
                console.error('tipos_boletos no es un objeto válido:', tiposBoletos);
                tiposBoletos = { "General": no_boletos };
            }
        } catch (error) {
            console.error('Error parseando tipos_boletos:', error);
            tiposBoletos = { "General": no_boletos };
        }

        // 
        const precios = {
            tipoA: 270,
            tipoB: 130,
            tipoC: 65
        };

        // 
        const nombres = {
            tipoA: "Entrada General",
            tipoB: "Ciudadano Mexicano",
            tipoC: "Estudiante / Adulto Mayor / Niño (-12) / Capacidades diferentes"
        };

        // 
        let tiposBoletosArray = Object.entries(tiposBoletos).map(([tipo, cantidad]) => {
            return {
                nombre: nombres[tipo] || tipo,   // usa nombre bonito si existe
                precio: precios[tipo] || 0,
                cantidad
            };
        });

        // 
        let tablaBoletos = `
  <table width="100%" cellpadding="5" cellspacing="0" border="1" style="border-collapse:collapse;">
    <tr style="background-color:#f5f5f5">
      <th style="text-align:left">Tipo de boleto</th>
      <th style="text-align:right">Precio</th>
      <th style="text-align:center">Cantidad</th>
      <th style="text-align:right">Subtotal</th>
    </tr>
`;



        tiposBoletosArray.forEach(tipo => {
            let subtotal = Number(tipo.precio) * Number(tipo.cantidad);


            tablaBoletos += `
    <tr>
      <td style="text-align:left">${tipo.nombre}</td>
      <td style="text-align:right">$${Number(tipo.precio).toFixed(2)}</td>
      <td style="text-align:center">${Number(tipo.cantidad)}</td>
      <td style="text-align:right">$${Number(subtotal).toFixed(2)}</td>
    </tr>
  `;
        });

        tablaBoletos += `
  <tr>
    <td colspan="2"></td>
    <td style="text-align:center; font-weight:bold">Total</td>
    <td style="text-align:right; font-weight:bold">$${Number(total).toFixed(2)}</td>
  </tr>
</table>`;



        // Datos para el template
        const emailData = {
            nombre: nombre_cliente,
            password: password,
            fecha: fecha_ida,
            horario: horaCompleta,
            boletos: no_boletos,
            tablaBoletos: tablaBoletos,
            idReservacion: id_reservacion,
            total: total,
            ubicacionUrl: "https://maps.app.goo.gl/9R17eVrZeTkxyNt88"
        };

        // Enviar el correo al admin y al cliente
        const emailHtml = emailTemplate(emailData);

        let message = {
            from: process.env.MAIL,
            to: process.env.MAIL,
            subject: "¡Confirmación de compra - Museo Casa Kahlo!",
            text: "",
            html: emailHtml,
            attachments: [{
                filename: 'qr.png',
                content: qrCodeBuffer,
                cid: 'qrImage'
            }]
        }

        const info = await mailer.sendMail(message);
        console.log('Email enviado al admin:', info);

        message = {
            from: process.env.MAIL,
            to: correo,
            subject: "¡Confirmación de compra - Museo Casa Kahlo!",
            text: "",
            html: emailHtml,
            attachments: [{
                filename: 'qr.png',
                content: qrCodeBuffer,
                cid: 'qrImage'
            }]
        }

        const info2 = await mailer.sendMail(message);
        console.log('Email enviado al cliente:', info2);

        //////////////////////////////////////////// fin correo /////////////////////////////////////



        res.status(200).json({ msg: "Compra exitosa", id_reservacion: id_reservacion, viajeTourId: viajeTourId, clienteExiste: clienteExiste, error: false });

    } catch (error) {
        console.log(error);
        res.status(400).json({ error: true, details: error })
    }
});

app.post('/crear-admin-cortesia', async (req, res) => {
    try {
        let { no_boletos, tipos_boletos, pagado, nombre_cliente, apellidos_cliente, correo, telefono, viajeTourId, tourId, fecha_ida, horaCompleta, total } = req.body

        //caracterizticas del boleto de cortesia
        pagado = 1;
        status_traspaso = 99;
        total = 0;

        let nombre_completo = nombre_cliente + ' ' + apellidos_cliente;

        let today = new Date().toLocaleString('es-MX', {
            timeZone: 'America/Mexico_City',
            hour12: false // formato 24 horas sin AM/PM
        });
        // Ejemplo: "29/09/2025, 23:42:08"
        let [datePart, timePart] = today.split(', ');
        let [day, month, year] = datePart.split('/');
        let [hours, minutes, seconds] = timePart.split(':');
        month = month.padStart(2, '0');
        day = day.padStart(2, '0');
        hours = hours.padStart(2, '0');
        minutes = minutes.padStart(2, '0');
        seconds = seconds.padStart(2, '0');
        let fecha = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

        let seCreoRegistro = false;
        let viajeTour = '';
        let query = ``;


        //Verificamos si existe el correo en la DB
        let clienteExiste = null;
        let cliente_id = null;
        let password = null;

        query = `SELECT * FROM usuario WHERE correo='${correo}'`;

        let existCorreo = await db.pool.query(query);

        if (existCorreo[0].length >= 1) {
            clienteExiste = true;
            nombre_cliente = existCorreo[0][0].nombres;
            apellidos_cliente = existCorreo[0][0].apellidos;
            correo = existCorreo[0][0].correo;
            nombre_completo = nombre_cliente + ' ' + apellidos_cliente;
            cliente_id = existCorreo[0][0].id;
        } else {
            clienteExiste = false;
            //generamos un password aleatorio
            password = generarPassword();
            const salt = await bcryptjs.genSalt(10);
            const hashedPassword = await bcryptjs.hash(password, salt);

            //damos de alta al cliente
            query = `INSERT INTO usuario 
                            (nombres, apellidos, correo, telefono, password, isClient, created_at, updated_at) 
                            VALUES 
                            ('${nombre_cliente}', '${apellidos_cliente}', '${correo}', '${telefono}', '${hashedPassword}', 1, '${fecha}', '${fecha}')`;


            let newClient = await db.pool.query(query);
            cliente_id = newClient[0].insertId;
        }


        //info tour para calcular fecha de regreso
        query = `SELECT * FROM tour WHERE id = ${tourId} `;
        let tour = await db.pool.query(query);
        tour = tour[0][0];
        let duracion = tour.duracion;
        let max_pasajeros = tour.max_pasajeros;
        //console.log(`Duracion: ${duracion}`);

        if (!viajeTourId) {

            try {
                let hora = horaCompleta.split(':');

                query = `SELECT 
                        * 
                        FROM viajeTour 
                        WHERE CAST(fecha_ida AS DATE) = '${fecha_ida}'
                        AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = '${hora[0]}:${hora[1]}'
                        AND tour_id = ${tourId};`;
                let disponibilidad = await db.pool.query(query);
                disponibilidad = disponibilidad[0];

                if (hora.length < 3) {
                    horaCompleta += ':00'
                }
                //formateo de fechaida
                fecha_ida += ' ' + horaCompleta;
                console.log(fecha_ida);


                //formateo de fecha regreso
                const newfecha = addMinutesToDate(new Date(fecha_ida), parseInt(duracion));
                const fecha_regreso = newfecha.getFullYear() + "-" + ("0" + (newfecha.getMonth() + 1)).slice(-2) + "-" + ("0" + newfecha.getDate()).slice(-2) + " " + ("0" + (newfecha.getHours())).slice(-2) + ":" + ("0" + (newfecha.getMinutes())).slice(-2);
                console.log(fecha_regreso);

                if (disponibilidad.length == 0) {
                    query = `SELECT 
                        * 
                        FROM tour
                        WHERE id = ${tourId}`;
                    let result = await db.pool.query(query);

                    if (result[0].length == 0) {
                        return res.status(400).json({ msg: "Error en la busquda del tour por id", error: true, details: 'nungun registro encontrado' });
                    }

                    result = result[0][0];

                    let guia = result.guias;
                    guia = JSON.parse(guia);

                    query = `INSERT INTO viajeTour 
                        (fecha_ida, fecha_regreso, lugares_disp, created_at, updated_at, tour_id, guia_id, geo_llegada, geo_salida) 
                        VALUES 
                        ('${fecha_ida}', '${fecha_regreso}', '${max_pasajeros}', '${fecha}', '${fecha}', '${tourId}', '${guia[0].value}', '${null}', '${null}')`;

                    result = await db.pool.query(query);
                    result = result[0];

                    viajeTourId = result.insertId;
                    seCreoRegistro = true;

                } else {
                    viajeTour = disponibilidad[0];
                    viajeTourId = disponibilidad[0].id;
                }

            } catch (error) {
                console.log(error);
                return res.status(400).json({ msg: "Error en la creacion del registro viaje tour", error: true, details: error });
            }

        } else {
            query = `SELECT 
                        * 
                        FROM viajeTour
                        WHERE id = ${viajeTourId}`;
            let result = await db.pool.query(query);
            result = result[0];

            if (result.length == 0) {
                return res.status(400).json({ msg: "Error en la busquda del viaje tour por id", error: true, details: 'nungun registro encontrado' });
            }
            viajeTour = result[0];

        }

        let lugares_disp = 0;

        if (seCreoRegistro) {
            lugares_disp = max_pasajeros - no_boletos;
        } else {
            lugares_disp = viajeTour.lugares_disp - no_boletos;
        }
        if (lugares_disp < 0) {
            return res.status(400).json({ msg: "El numero de boletos excede los lugares disponibles", error: true, details: `Lugares disponibles: ${viajeTour.lugares_disp}` });
        }

        query = `INSERT INTO venta 
                        (id_reservacion, no_boletos, tipos_boletos, total, pagado, fecha_compra, comision, status_traspaso, fecha_comprada, created_at, updated_at, nombre_cliente, cliente_id, correo, viajeTour_id) 
                        VALUES 
                        ('V', '${no_boletos}', '${tipos_boletos}', '${total}', '${pagado}', '${fecha}', '0.0', '${status_traspaso}', '${fecha_ida}', '${fecha}', '${fecha}', '${nombre_completo}', '${cliente_id}', '${correo}', '${viajeTourId}')`;

        let result = await db.pool.query(query);
        result = result[0];

        query = `SELECT 
                        * 
                        FROM usuario
                        WHERE id = ${cliente_id}`;
        let client = await db.pool.query(query);

        client = client[0];

        if (client.length == 0) {
            return res.status(400).json({ msg: "Error en la busquda de los datos del cliente", error: true, details: 'nungun registro encontrado' });
        }
        client = client[0];

        let id_reservacion = result.insertId + 'V' + helperName(client.nombres.split(' ')) + helperName(client.apellidos.split(' '));

        //creamos el QR
        const qrCodeBuffer = await generateQRCode(id_reservacion);

        query = `UPDATE viajeTour SET
                    lugares_disp = '${lugares_disp}'
                    WHERE id     = ${viajeTourId}`;

        await db.pool.query(query);

        query = `UPDATE venta SET
                    id_reservacion = '${id_reservacion}'
                    WHERE id       = ${result.insertId}`;

        await db.pool.query(query);


        ////////////////////////////////// preparacion de correo//////////////////////////////////
        // Crear la tabla de boletos
        let tiposBoletos = {};

        try {
            tiposBoletos = JSON.parse(tipos_boletos);

            if (typeof tiposBoletos !== 'object' || tiposBoletos === null || Array.isArray(tiposBoletos)) {
                console.error('tipos_boletos no es un objeto válido:', tiposBoletos);
                tiposBoletos = { "General": no_boletos };
            }
        } catch (error) {
            console.error('Error parseando tipos_boletos:', error);
            tiposBoletos = { "General": no_boletos };
        }

        // 
        const precios = {
            tipoA: 270,
            tipoB: 130,
            tipoC: 65
        };

        // 
        const nombres = {
            tipoA: "Entrada General",
            tipoB: "Ciudadano Mexicano",
            tipoC: "Estudiante / Adulto Mayor / Niño (-12) / Capacidades diferentes"
        };

        // 
        let tiposBoletosArray = Object.entries(tiposBoletos).map(([tipo, cantidad]) => {
            return {
                nombre: nombres[tipo] || tipo,   // usa nombre bonito si existe
                precio: precios[tipo] || 0,
                cantidad
            };
        });

        // 
        let tablaBoletos = `
  <table width="100%" cellpadding="5" cellspacing="0" border="1" style="border-collapse:collapse;">
    <tr style="background-color:#f5f5f5">
      <th style="text-align:left">Tipo de boleto</th>
      <th style="text-align:right">Precio</th>
      <th style="text-align:center">Cantidad</th>
      <th style="text-align:right">Subtotal</th>
    </tr>
`;



        tiposBoletosArray.forEach(tipo => {
            let subtotal = Number(tipo.precio) * Number(tipo.cantidad);


            tablaBoletos += `
    <tr>
      <td style="text-align:left">${tipo.nombre}</td>
      <td style="text-align:right">$${Number(tipo.precio).toFixed(2)}</td>
      <td style="text-align:center">${Number(tipo.cantidad)}</td>
      <td style="text-align:right">$${Number(subtotal).toFixed(2)}</td>
    </tr>
  `;
        });

        tablaBoletos += `
  <tr>
    <td colspan="2"></td>
    <td style="text-align:center; font-weight:bold">Total</td>
    <td style="text-align:right; font-weight:bold">$${Number(total).toFixed(2)}</td>
  </tr>
</table>`;



        // Datos para el template
        const emailData = {
            nombre: nombre_cliente,
            password: password,
            fecha: fecha_ida,
            horario: horaCompleta,
            boletos: no_boletos,
            tablaBoletos: tablaBoletos,
            idReservacion: id_reservacion,
            total: total,
            ubicacionUrl: "https://maps.app.goo.gl/9R17eVrZeTkxyNt88"
        };

        // Enviar el correo al admin y al cliente
        const emailHtml = emailTemplate(emailData);

        let message = {
            from: process.env.MAIL,
            to: process.env.MAIL,
            subject: "¡Confirmación de compra - Museo Casa Kahlo!",
            text: "",
            html: emailHtml,
            attachments: [{
                filename: 'qr.png',
                content: qrCodeBuffer,
                cid: 'qrImage'
            }]
        }

        const info = await mailer.sendMail(message);
        console.log('Email enviado al admin:', info);

        message = {
            from: process.env.MAIL,
            to: correo,
            subject: "¡Confirmación de compra - Museo Casa Kahlo!",
            text: "",
            html: emailHtml,
            attachments: [{
                filename: 'qr.png',
                content: qrCodeBuffer,
                cid: 'qrImage'
            }]
        }

        const info2 = await mailer.sendMail(message);
        console.log('Email enviado al cliente:', info2);

        //////////////////////////////////////////// fin correo /////////////////////////////////////



        res.status(200).json({ msg: "Compra exitosa", id_reservacion: id_reservacion, viajeTourId: viajeTourId, clienteExiste: clienteExiste, error: false });

    } catch (error) {
        console.log(error);
        res.status(400).json({ error: true, details: error })
    }
})

/////////////////////////////////////////////////////////// INICIO STRIPE ///////////////////////////////////////////////////////////

app.post('/stripe/create-checkout-session', async (req, res) => {
    try {
        const { lineItems, customerEmail, successUrl, cancelUrl, metadata } = req.body;

        /*
        const { no_boletos, tourId } = metadata;
        let fecha = metadata.fecha_ida;
        let hora = normalizarHora(metadata.horaCompleta);
        hora = hora.split(':');

        if(no_boletos > 12){
            return res.status(200).json({ error:true, msg: "No se pueden comprar mas de 12 boletos"});
        }

        let query = `SELECT 
                        * 
                        FROM viajeTour 
                        WHERE CAST(fecha_ida AS DATE) = '${fecha}'
                        AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = '${hora[0]}:${hora[1]}'
                        AND tour_id = ${tourId};`;
        let disponibilidad = await db.pool.query(query);

        //si disponibilidad == 0 significa que no hay ningun viajeTour y entonces si hay lugares
        if (disponibilidad[0].length > 0) {
            disponibilidad = disponibilidad[0][0];
            console.log(query);
            console.log(disponibilidad);
            if (disponibilidad.lugares_disp + Number(no_boletos) > 12) {
                return res.status(200).json({ error: true, msg: "Lugares no disponibles" });
            }
        }
        */

        // Crea la sesión en la cuenta conectada
        const session = await stripe.checkout.sessions.create(
            {
                payment_method_types: ['card'],
                line_items: lineItems,
                mode: 'payment',
                success_url: successUrl,
                cancel_url: cancelUrl,
                customer_email: customerEmail,
                metadata: metadata,
                billing_address_collection: 'auto',
            },
            {
                stripeAccount: 'acct_1SAz5b3CVvaJXMYX', // 👈 clave: ID de la cuenta conectada osea la cuenta del museo
            }
        );

        res.json({ sessionId: session.id, url: session.url, error: false });

    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(400).json({ error: true, msg: error.message });
    }
});


app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    console.log(' WEBHOOK ENDPOINT ALCANZADO - TIMESTAMP:', new Date().toISOString());
    console.log('');
    console.log('Headers:', req.headers);
    console.log('Body length:', req.body ? req.body.length : 'No body');
    console.log('Method:', req.method);
    console.log('URL:', req.originalUrl);

    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    console.log('Signature:', sig ? 'Presente' : 'Ausente');
    console.log('Endpoint Secret:', endpointSecret ? 'Configurado' : 'No configurado');

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        console.log('');
        console.log('Tipo de evento:', event.type);
    } catch (err) {
        console.log('');
        console.log('Webhook signature verification failed.', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            console.log('');
            console.log('Payment succeeded (checkout.session.completed):', session.id);
            console.log('');
            console.log('Session completa:', JSON.stringify(session, null, 2));
            console.log('');
            console.log('Metadata:', session.metadata);

            // Ejecutar la misma lógica que el endpoint /crear
            if (session.metadata) {
                console.log('');
                console.log('Metadata encontrada, procesando...');
                try {
                    const { no_boletos, tipos_boletos, nombre_cliente, cliente_id, correo, tourId, total } = session.metadata;
                    let fecha_ida_original = session.metadata.fecha_ida; // Variable separada para evitar conflictos
                    let horaCompleta = normalizarHora(session.metadata.horaCompleta); // Variable separada para poder modificarla
                    console.log('Hora normalizada:', { original: session.metadata.horaCompleta, normalizada: horaCompleta });

                    let today = new Date().toLocaleString('es-MX', {
                        timeZone: 'America/Mexico_City',
                        hour12: false // formato 24 horas sin AM/PM
                    });
                    // Ejemplo: "29/09/2025, 23:42:08"
                    let [datePart, timePart] = today.split(', ');
                    let [day, month, year] = datePart.split('/');
                    let [hours, minutes, seconds] = timePart.split(':');
                    month = month.padStart(2, '0');
                    day = day.padStart(2, '0');
                    hours = hours.padStart(2, '0');
                    minutes = minutes.padStart(2, '0');
                    seconds = seconds.padStart(2, '0');
                    let fecha = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

                    let seCreoRegistro = false;
                    let viajeTour = '';
                    let query = ``;
                    let viajeTourId = null;

                    //info tour para calcular fecha de regreso
                    query = `SELECT * FROM tour WHERE id = ${tourId} `;
                    let tour = await db.pool.query(query);
                    tour = tour[0][0];
                    let duracion = tour.duracion;
                    let max_pasajeros = tour.max_pasajeros;


                    const fecha_ida_formateada = `${fecha_ida_original} ${horaCompleta}`;


                    try {
                        let hora = horaCompleta.split(':');

                        query = `SELECT 
                        * 
                        FROM viajeTour 
                        WHERE CAST(fecha_ida AS DATE) = '${fecha_ida_original}'
                        AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = '${hora[0]}:${hora[1]}'
                        AND tour_id = ${tourId};`;
                        let disponibilidad = await db.pool.query(query);
                        disponibilidad = disponibilidad[0];

                        //formateo de fecha regreso
                        const newfecha = addMinutesToDate(new Date(fecha_ida_formateada), parseInt(duracion));
                        const fecha_regreso = newfecha.getFullYear() + "-" + ("0" + (newfecha.getMonth() + 1)).slice(-2) + "-" + ("0" + newfecha.getDate()).slice(-2) + " " + ("0" + (newfecha.getHours())).slice(-2) + ":" + ("0" + (newfecha.getMinutes())).slice(-2);

                        if (disponibilidad.length == 0) {
                            query = `SELECT * FROM tour WHERE id = ${tourId}`;
                            let result = await db.pool.query(query);

                            if (result[0].length == 0) {
                                console.error("Error en la busqueda del tour por id");
                                return;
                            }

                            result = result[0][0];

                            let guia = result.guias;
                            guia = JSON.parse(guia);

                            query = `INSERT INTO viajeTour 
                            (fecha_ida, fecha_regreso, lugares_disp, created_at, updated_at, tour_id, guia_id, geo_llegada, geo_salida) 
                            VALUES 
                            ('${fecha_ida_formateada}', '${fecha_regreso}', '${max_pasajeros}', '${fecha}', '${fecha}', '${tourId}', '${guia[0].value}', '${null}', '${null}')`;

                            result = await db.pool.query(query);
                            result = result[0];

                            viajeTourId = result.insertId;
                            seCreoRegistro = true;

                        } else {
                            viajeTour = disponibilidad[0];
                            viajeTourId = disponibilidad[0].id;
                        }

                    } catch (error) {
                        console.log('Error en creacion viajeTour:', error);
                        return;
                    }

                    let lugares_disp = 0;

                    if (seCreoRegistro) {
                        lugares_disp = max_pasajeros - parseInt(no_boletos);
                    } else {
                        lugares_disp = viajeTour.lugares_disp - parseInt(no_boletos);
                    }
                    /*
                    if (lugares_disp < 0) {
                        console.error("El numero de boletos excede los lugares disponibles");
                        return;
                    }
                    */

                    query = `INSERT INTO venta 
                          (id_reservacion, no_boletos, tipos_boletos, total, pagado, fecha_compra, comision, status_traspaso, fecha_comprada, created_at, updated_at, nombre_cliente, cliente_id, correo, viajeTour_id, session_id) 
                          VALUES 
                          ('V', '${no_boletos}', '${tipos_boletos}', '${total}', '1', '${fecha}', '0.0', '0', '${fecha_ida_formateada}', '${fecha}', '${fecha}', '${nombre_cliente}', '${cliente_id}', '${correo}', '${viajeTourId}', '${session.id}')`;

                    let result = await db.pool.query(query);
                    result = result[0];

                    query = `SELECT 
                          * 
                          FROM usuario
                          WHERE id = ${cliente_id}`;
                    let client = await db.pool.query(query);

                    client = client[0];

                    if (client.length == 0) {
                        console.error("Error en la busqueda de los datos del cliente");
                        return;
                    }
                    client = client[0];

                    let id_reservacion = result.insertId + 'V' + helperName(client.nombres.split(' ')) + helperName(client.apellidos.split(' '));

                    //creamos el QR
                    const qrCodeBuffer = await generateQRCode(id_reservacion);

                    query = `UPDATE viajeTour SET
                      lugares_disp = '${lugares_disp}'
                      WHERE id     = ${viajeTourId}`;

                    await db.pool.query(query);

                    query = `UPDATE venta SET
                      id_reservacion = '${id_reservacion}'
                      WHERE id       = ${result.insertId}`;

                    await db.pool.query(query);

                    // Crear la tabla de boletos
                    let tiposBoletos = {};

                    try {
                        tiposBoletos = JSON.parse(tipos_boletos);

                        if (typeof tiposBoletos !== 'object' || tiposBoletos === null || Array.isArray(tiposBoletos)) {
                            console.error('tipos_boletos no es un objeto válido:', tiposBoletos);
                            tiposBoletos = { "General": no_boletos };
                        }
                    } catch (error) {
                        console.error('Error parseando tipos_boletos:', error);
                        tiposBoletos = { "General": no_boletos };
                    }

                    // 
                    const precios = {
                        tipoA: 270,
                        tipoB: 130,
                        tipoC: 65
                    };

                    // 
                    const nombres = {
                        tipoA: "Entrada General",
                        tipoB: "Ciudadano Mexicano",
                        tipoC: "Estudiante / Adulto Mayor / Niño (-12) / Capacidades diferentes"
                    };

                    // 
                    let tiposBoletosArray = Object.entries(tiposBoletos).map(([tipo, cantidad]) => {
                        return {
                            nombre: nombres[tipo] || tipo,   // usa nombre bonito si existe
                            precio: precios[tipo] || 0,
                            cantidad
                        };
                    });

                    // 
                    let tablaBoletos = `
  <table width="100%" cellpadding="5" cellspacing="0" border="1" style="border-collapse:collapse;">
    <tr style="background-color:#f5f5f5">
      <th style="text-align:left">Tipo de boleto</th>
      <th style="text-align:right">Precio</th>
      <th style="text-align:center">Cantidad</th>
      <th style="text-align:right">Subtotal</th>
    </tr>
`;



                    tiposBoletosArray.forEach(tipo => {
                        let subtotal = Number(tipo.precio) * Number(tipo.cantidad);


                        tablaBoletos += `
    <tr>
      <td style="text-align:left">${tipo.nombre}</td>
      <td style="text-align:right">$${Number(tipo.precio).toFixed(2)}</td>
      <td style="text-align:center">${Number(tipo.cantidad)}</td>
      <td style="text-align:right">$${Number(subtotal).toFixed(2)}</td>
    </tr>
  `;
                    });

                    tablaBoletos += `
  <tr>
    <td colspan="2"></td>
    <td style="text-align:center; font-weight:bold">Total</td>
    <td style="text-align:right; font-weight:bold">$${Number(total).toFixed(2)}</td>
  </tr>
</table>`;


                    // Datos para el template
                    const emailData = {
                        nombre: nombre_cliente,
                        password: null,
                        fecha: fecha_ida_original,
                        horario: horaCompleta,
                        boletos: no_boletos,
                        tablaBoletos: tablaBoletos,
                        idReservacion: id_reservacion,
                        total: total,
                        ubicacionUrl: "https://maps.app.goo.gl/9R17eVrZeTkxyNt88"
                    };

                    // Enviar el correo al admin y al cliente
                    const emailHtml = emailTemplate(emailData);

                    let message = {
                        from: process.env.MAIL,
                        to: process.env.MAIL,
                        subject: "¡Confirmación de compra - Museo Casa Kahlo!",
                        text: "",
                        html: emailHtml,
                        attachments: [{
                            filename: 'qr.png',
                            content: qrCodeBuffer,
                            cid: 'qrImage'
                        }]
                    }

                    const info = await mailer.sendMail(message);
                    console.log('Email enviado al admin:', info);

                    message = {
                        from: process.env.MAIL,
                        to: correo,
                        subject: "¡Confirmación de compra - Museo Casa Kahlo!",
                        text: "",
                        html: emailHtml,
                        attachments: [{
                            filename: 'qr.png',
                            content: qrCodeBuffer,
                            cid: 'qrImage'
                        }]
                    }

                    const info2 = await mailer.sendMail(message);
                    console.log('Email enviado al cliente:', info2);


                    console.log(` Venta creada exitosamente: ${id_reservacion}, viajeTourId: ${viajeTourId}, fecha: ${fecha_ida_original}, hora: ${horaCompleta}`);

                } catch (error) {
                    console.error('Error procesando pago en webhook:', error);
                }
            } else {
                console.log('');
                console.log(' No hay metadata en checkout.session.completed');
                console.log('');
                console.log('Session sin metadata:', JSON.stringify(session, null, 2));
            }
            break;

        // case 'charge.succeeded':
        //   // COMENTADO: No necesario, ya se maneja en checkout.session.completed
        //   console.log('');
        //   console.log('Charge succeeded event ignorado - ya procesado en checkout.session.completed');
        //   break;

        case 'payment_intent.succeeded':
            const paymentIntent_success = event.data.object;
            console.log('');
            console.log('Payment Intent succeeded:', paymentIntent_success.id);
            console.log('PaymentIntent metadata:', paymentIntent_success.metadata);
            // Similar logic could be added here if needed
            break;

        case 'payment_intent.payment_failed':
            const paymentIntent = event.data.object;
            console.log('');
            console.log('Payment failed:', paymentIntent.id);
            break;

        default:
            console.log('');
            console.log('Unhandled event type ${event.type}');
    }

    // Return a 200 response to acknowledge receipt of the event
    res.json({ received: true });
});

// Endpoint para obtener datos de venta por sessionId de Stripe
app.get('/stripe/session-check/:sessionId', async (req, res) => {
    try {
        let sessionId = req.params.sessionId;

        let query = `SELECT 
                        id_reservacion, 
                        viajeTour_id,
                        session_id,
                        id,
                        no_boletos,
                        total,
                        nombre_cliente,
                        correo,
                        fecha_compra,
                        created_at
                        FROM venta 
                        WHERE session_id = '${sessionId}';`;

        let venta = await db.pool.query(query);

        if (venta[0].length === 0) {
            return res.status(404).json({
                msg: 'No se encontró ninguna venta con ese session ID',
                error: true,
                sessionId: sessionId
            });
        }

        //revisamos el status de la venta directamente en stripe OJO especificando el id de la cuenta conectada
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            stripeAccount: 'acct_1SAz5b3CVvaJXMYX',
        });

        if (session.payment_status === 'paid') {
            venta[0][0].payment_status = 'Pagado';
        } else if (session.payment_status === 'unpaid') {
            venta[0][0].payment_status = 'No Pagado';
        } else if (session.payment_status === 'processing') {
            venta[0][0].payment_status = 'Procesando';
        } else {
            venta[0][0].payment_status = session.payment_status;
        }


        res.status(200).json({
            error: false,
            data: venta[0][0],
            msg: 'Venta encontrada exitosamente'
        });

    } catch (error) {
        res.status(500).json({
            msg: 'Hubo un error obteniendo los datos',
            error: true,
            details: error
        });
    }
})

// Endpoint para obtener datos de venta por sessionId de Stripe
app.get('/stripe/session/:sessionId', async (req, res) => {
    try {
        let sessionId = req.params.sessionId;

        let query = `SELECT 
                        id_reservacion, 
                        viajeTour_id,
                        session_id,
                        id,
                        no_boletos,
                        total,
                        nombre_cliente,
                        correo,
                        fecha_compra,
                        created_at
                        FROM venta 
                        WHERE session_id = '${sessionId}';`;

        let venta = await db.pool.query(query);

        if (venta[0].length === 0) {
            return res.status(404).json({
                msg: 'No se encontró ninguna venta con ese session ID',
                error: true,
                sessionId: sessionId
            });
        }

        res.status(200).json({
            error: false,
            data: venta[0][0],
            msg: 'Venta encontrada exitosamente'
        });

    } catch (error) {
        res.status(500).json({
            msg: 'Hubo un error obteniendo los datos',
            error: true,
            details: error
        });
    }
})

////////////////////////LIGAR CUENTA ////////////////////////

// Paso 1: crear la cuenta Standard del museo
app.post('/create-connected-account', async (req, res) => {
    try {
        const account = await stripe.accounts.create({
            type: 'standard', // cuenta propia del museo
            country: 'MX',    // cambia según el país del museo
            email: req.body.email,
        });

        res.json({ accountId: account.id }); // devuelves el acct_xxx
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Paso 2: crear el accountLink para que el museo complete el onboarding
app.post('/create-account-link', async (req, res) => {
    try {
        const accountLink = await stripe.accountLinks.create({
            account: req.body.accountId, // el acct_xxx que guardaste
            refresh_url: 'https://api.museodesarrollo.info/venta/reauth', // si el museo cancela
            return_url: 'https://api.museodesarrollo.info/venta/success', // si el museo termina
            type: 'account_onboarding',
        });

        res.json({ url: accountLink.url });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/reauth', (req, res) => {
    res.send(`
      <h2>Onboarding cancelado</h2>
      <p>Puedes intentarlo de nuevo:</p>
      <a href="/frontend/connect-museum.html">Volver a conectar la cuenta</a>
    `);
});

app.get('/success', (req, res) => {
    res.send('<h2>¡Cuenta conectada correctamente!</h2><p>Ahora puedes empezar a cobrar con Stripe Connect.</p>');
});
////////////////////////FIN LIGAR CUENTA ////////////////////////

/////////////////////////////////////////////////////////// FIN STRIPE ///////////////////////////////////////////////////////////

//la feha esta definida por AAAA-MM-DD y la hora desde 00 hasta 23
app.get('/reservacion/:id', async (req, res) => {
    try {
        let reservacion = req.params.id;

        let query = `SELECT 
  CAST(viajeTour.fecha_ida AS CHAR) AS fecha_ida,
  venta.*
FROM venta
INNER JOIN viajeTour ON venta.viajeTour_id = viajeTour.id
WHERE venta.id_reservacion = '${reservacion}';`;

        let reserva = await db.pool.query(query);

        res.status(200).json(reserva[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})


app.get('/landingInfo/:id', async (req, res) => {
    try {
        let reservacion = req.params.id;

        let query = `SELECT 
                        venta.id_reservacion, venta.viajeTour_id, viajeTour.id, viajeTour.tour_id, viajeTour.fecha_ida, viajeTour.fecha_regreso, viajeTour.status_viaje, tour.id, tour.nombre 
                        FROM venta
                        INNER JOIN viajeTour ON venta.viajeTour_id = viajeTour.id
                        INNER JOIN tour on viajeTour.tour_id = tour.id
                        WHERE venta.id_reservacion = '${reservacion}';`;

        let reserva = await db.pool.query(query);

        res.status(200).json(reserva[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.put('/set', async (req, res) => {
    try {
        const { id, no_boletos, pagado, comision, status_traspaso, cliente_id, viajeTourId } = req.body

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE venta SET
                        no_boletos      = '${no_boletos}',
                        pagado          = '${pagado}', 
                        comision        = '${comision}', 
                        status_traspaso = '${status_traspaso}', 
                        updated_at      = '${fecha}', 
                        cliente_id      = '${cliente_id}', 
                        viajeTour_id   = '${viajeTourId}'
                        WHERE id        = ${id}`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            venta: {
                id: result.insertId,
            }
        }

        res.status(200).json({ error: false, msg: "Registro actualizado con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/setFecha', async (req, res) => {
    try {
        let { id, oldViajeTourId, newViajeTourId, fecha_ida, horaCompleta, tourId, max_pasajeros } = req.body

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;
        let newViajeTour = "";
        let oldViajeTour = "";
        let venta = "";
        let lugares_disp = 0;
        let seCreoRegistro = false;

        if (!newViajeTourId) {

            try {
                let hora = horaCompleta.split(':');

                query = `SELECT 
                        * 
                        FROM viajeTour 
                        WHERE CAST(fecha_ida AS DATE) = '${fecha_ida}'
                        AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = '${horaCompleta}'
                        AND tour_id = ${tourId};`;
                let disponibilidad = await db.pool.query(query);
                disponibilidad = disponibilidad[0];

                if (disponibilidad.length == 0) {

                    if (hora.length > 3) {
                        horaCompleta += ':00'
                    }
                    fecha_ida += ' ' + horaCompleta;

                    query = `SELECT 
                        * 
                        FROM tour
                        WHERE id = ${tourId}`;
                    let result = await db.pool.query(query);

                    if (result[0].length == 0) {
                        return res.status(400).json({ msg: "Error en la busquda del tour por id", error: true, details: 'nungun registro encontrado' });
                    }

                    result = result[0][0];

                    let guia = result.guias;
                    guia = JSON.parse(guia);

                    query = `INSERT INTO viajeTour 
                        (fecha_ida, fecha_regreso, lugares_disp, created_at, updated_at, tour_id, guia_id, geo_llegada, geo_salida) 
                        VALUES 
                        ('${fecha_ida}', '${fecha_ida}', '${max_pasajeros}', '${fecha}', '${fecha}', '${tourId}', '${guia[0].value}', '${null}', '${null}')`;

                    result = await db.pool.query(query);
                    result = result[0];

                    newViajeTourId = result.insertId;
                    seCreoRegistro = true;

                } else {
                    newViajeTour = disponibilidad[0];
                    newViajeTourId = disponibilidad[0].id;
                }

            } catch (error) {
                console.log(error);
                return res.status(400).json({ msg: "Error en la creacion del registro viaje tour", error: true, details: error });
            }

        } else {
            query = `SELECT 
                        * 
                        FROM viajeTour
                        WHERE id = ${newViajeTourId}`;
            let result = await db.pool.query(query);
            result = result[0];

            if (result.length == 0) {
                return res.status(400).json({ msg: "Error en la busquda del viaje tour por id", error: true, details: 'nungun registro encontrado' });
            }
            newViajeTour = result[0];

        }

        query = `SELECT 
                        * 
                        FROM viajeTour
                        WHERE id = ${oldViajeTourId}`;
        let result = await db.pool.query(query);
        result = result[0];

        if (result.length == 0) {
            return res.status(400).json({ msg: "Error en la busquda del viejo viaje tour por id", error: true, details: 'nungun registro encontrado' });
        }
        oldViajeTour = result[0];

        query = `SELECT 
                        * 
                        FROM venta
                        WHERE id = ${id}`;
        result = await db.pool.query(query);
        result = result[0];

        if (result.length == 0) {
            return res.status(400).json({ msg: "Error en la busquda de la venta por id", error: true, details: 'nungun registro encontrado' });
        }
        venta = result[0];

        query = `SELECT 
                        * 
                        FROM usuario
                        WHERE id = ${venta.cliente_id}`;
        let client = await db.pool.query(query);

        client = client[0];

        if (client.length == 0) {
            return res.status(400).json({ msg: "Error en la busquda de los datos del cliente", error: true, details: 'nungun registro encontrado' });
        }
        client = client[0];

        //Lugares disponibles
        if (seCreoRegistro) {
            lugares_disp = max_pasajeros - venta.no_boletos;
        } else {
            lugares_disp = newViajeTour.lugares_disp - venta.no_boletos;
        }
        if (lugares_disp < 0) {
            return res.status(400).json({ msg: "El numero de boletos excede los lugares disponibles", error: true, details: `Lugares disponibles: ${viajeTour.lugares_disp}` });
        }

        oldViajeTour.lugares_disp += venta.no_boletos;

        query = `UPDATE viajeTour SET
                    lugares_disp = '${lugares_disp}',
                    updated_at = '${fecha}' 
                    WHERE id     = ${newViajeTourId}`;

        await db.pool.query(query);

        query = `UPDATE viajeTour SET
                    lugares_disp = '${oldViajeTour.lugares_disp}',
                    updated_at = '${fecha}'
                    WHERE id     = ${oldViajeTourId}`;

        await db.pool.query(query);

        query = `UPDATE venta SET
                    viajeTour_id = '${newViajeTourId}',
                    updated_at = '${fecha}' 
                    WHERE id       = ${id}`;

        await db.pool.query(query);


        let html = venta.no_boletos + newViajeTour.fecha_ida + venta.id_reservacion;

        let message = {
            from: process.env.MAIL, // sender address
            to: 'ferdanymr@gmail.com', // list of receivers
            subject: "Cambio de fecha exitoso", // Subject line
            text: "", // plain text body
            html: `${html}`, // html body
        }

        const info = await mailer.sendMail(message);
        console.log(info);

        message = {
            from: process.env.MAIL, // sender address
            to: client.correo, // list of receivers
            subject: "Cambio de fecha exitoso", // Subject line
            text: "", // plain text body
            html: `${html}`, // html body
        }

        //const info2 = await mailer.sendMail(message);
        //console.log(info2);


        res.status(200).json({ error: false, msg: "Registros actualizados con exito" })

    } catch (error) {
        console.log(error);
        res.status(400).json({ error: true, details: error })
    }
})


app.put('/checkin', async (req, res) => {
    try {
        const { idReservacion } = req.body;
        if (!idReservacion) {
            return res.status(400).json({ error: true, msg: "idReservacion es obligatorio." });
        }
        // Obtener venta + fecha_ida
        const query = `
            SELECT v.*, vt.fecha_ida
            FROM venta AS v
            INNER JOIN viajeTour AS vt ON v.viajeTour_id = vt.id
            WHERE v.id_reservacion = ?;
        `;
        const [ventaResult] = await db.pool.query(query, [idReservacion]);
        if (ventaResult.length === 0) {
            return res.status(404).json({ error: true, msg: "El id de reservacion no existe." });
        }

        const venta = ventaResult[0];

        const pagado = venta.pagado;
        const noBoletos = parseInt(venta.no_boletos);
        const checkinActual = venta.checkin || 0;
        const fechaIdaTourUTC = new Date(venta.fecha_ida);
        const now = new Date();
        const nowCDMX = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
        const fechaIdaTourCDMX = new Date(fechaIdaTourUTC.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));

        //VERIFICAR ESTADO DEL CAMPO PAGADO
        if (pagado != 1) {
            return res.status(403).json({
                error: true,
                msg: `Boleto no encontrado`
            });
        }

        // VERIFICACIÓN DEL DÍA (comentada por ahora)
        if (nowCDMX.toDateString() !== fechaIdaTourCDMX.toDateString()) {
            return res.status(403).json({
                error: true,
                msg: `Check-in solo permitido el día del tour (${fechaIdaTourCDMX.toLocaleDateString("es-MX")}).`
            });
        }

        // --- VERIFICACIÓN DE HORARIO ±140 MINUTOS --- 

        const [horaTourHoras, horaTourMinutos] = fechaIdaTourCDMX.toLocaleTimeString("es-MX", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" }).split(":").map(Number);
        const [ahoraHoras, ahoraMinutos] = nowCDMX.toLocaleTimeString("es-MX", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" }).split(":").map(Number);
        const totalMinutosTour = horaTourHoras * 60 + horaTourMinutos;
        const totalMinutosAhora = ahoraHoras * 60 + ahoraMinutos;
        // const diferencia = totalMinutosAhora - totalMinutosTour; // diferencia en minutos
        /*
               if (Math.abs(diferencia) > 140) {
                   return res.status(403).json({
                       error: true,
                       msg: "Check-in no válido. El tour está fuera del rango permitido ±120 minutos.",
                       hora_tour_utc: fechaIdaTourUTC.toISOString(),
                       hora_tour_cdmx: fechaIdaTourCDMX.toLocaleTimeString("es-MX", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" }),
                       ahora_utc: now.toISOString(),    
                       ahora_cdmx: nowCDMX.toLocaleTimeString("es-MX", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" }),
                       diferencia_minutos: diferencia,
                       rango_inicio: new Date(fechaIdaTourCDMX.getTime() - 120 * 60000).toLocaleTimeString("es-MX", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" }),
                       rango_fin: new Date(fechaIdaTourCDMX.getTime() + 120 * 60000).toLocaleTimeString("es-MX", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" })
                   });
               }
                   */

        // Verificar que no exceda boletos
        if (checkinActual >= noBoletos) {
            return res.status(403).json({
                error: true,
                msg: `No se puede hacer checkin. Ya se han registrado ${checkinActual} de ${noBoletos} boletos comprados.`
            });
        }
        const nuevoCheckin = checkinActual + 1;
        // Guardar fecha actual formateada (CDMX)
        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;
        const queryUpdate = `
            UPDATE venta
            SET checkin = ?, updated_at = ?
            WHERE id_reservacion = ?;
        `;
        await db.pool.query(queryUpdate, [nuevoCheckin, fecha, idReservacion]);
        const fechaTourLocal = fechaIdaTourCDMX.toLocaleDateString("es-MX");
        const horaTourLocal = fechaIdaTourCDMX.toLocaleTimeString("es-MX", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "America/Mexico_City"
        });
        res.status(200).json({
            error: false,
            msg: "Checkin realizado con éxito",
            data: {
                nombre_cliente: venta.nombre_cliente,
                cantidad: noBoletos,
                checkin_actual: nuevoCheckin,
                boletos_restantes: noBoletos - nuevoCheckin,
                fecha_salida: fechaTourLocal,
                hora_salida: horaTourLocal + " (hora CDMX)"
            }
        });
    } catch (error) {
        console.error("Error en el checkin:", error);
        res.status(500).json({
            error: true,
            msg: "Ocurrió un error inesperado. Por favor, intente de nuevo.",
            details: error.message
        });
    }
});


app.put('/delete', async (req, res) => {
    try {
        let ventaId = req.body.id;

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE venta SET
                        status     = 0,
                        updated_at = '${fecha}' 
                        WHERE id   = ${ventaId}`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            venta: {
                id: result.insertId,
            }
        }

        res.status(200).json({ error: false, msg: "Se ha dado de baja la venta con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
})

app.put('/active', async (req, res) => {
    try {
        let ventaId = req.body.id;

        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
        let fecha = date + ' ' + time;

        let query = `UPDATE venta SET
                        status     = 1,
                        updated_at = '${fecha}' 
                        WHERE id   = ${ventaId}`;

        let result = await db.pool.query(query);
        result = result[0];

        const payload = {
            tour: {
                id: result.insertId,
            }
        }

        res.status(200).json({ error: false, msg: "Se ha reactivado la venta con exito" })

    } catch (error) {
        res.status(400).json({ error: true, details: error })
    }
});


app.post('/verificarQr', async (req, res) => {
    try {
        const { idReservacion } = req.body;

        // Revisa si existe el número de reservación
        let query = `SELECT id_reservacion FROM venta WHERE id_reservacion = '${idReservacion}'`;
        let existReservacion = await db.pool.query(query);

        if (existReservacion[0].length < 1) {
            return res.status(200).json({ error: true, msg: "El QR de reservación no existe." });
        }

        // Si existe, manda el id por UDP con #
        const mensaje = Buffer.from(`#${idReservacion}`);
        udpClient.send(mensaje, UDP_PORT, UDP_IP, (err) => {
            if (err) {
                console.error('Error enviando UDP:', err);
                // No bloqueamos la respuesta al usuario por un fallo en UDP
            } else {
                console.log(`Boleto enviado por UDP: #${idReservacion}`);
            }
        });

        // Devuelve un mensaje de éxito
        res.status(200).json({
            error: false,
            msg: "El QR de reservación es válido y se envió por UDP."
        });

    } catch (error) {
        console.log(error);
        res.status(400).json({ error: true, details: error });
    }
});



// Historial de compras por usuario (cliente_id)
app.get('/compras/:clienteId', async (req, res) => {
    try {
        const clienteId = req.params.clienteId;
        let query = `
      SELECT 
        v.id, 
        v.id_reservacion, 
        v.no_boletos, 
        v.total, 
        v.fecha_compra,
        v.pagado,
        t.nombre AS nombreTour, 
        vt.fecha_ida, 
        vt.fecha_regreso
      FROM venta v
      INNER JOIN viajeTour vt ON v.viajeTour_id = vt.id
      INNER JOIN tour t ON vt.tour_id = t.id
      WHERE v.cliente_id = ${clienteId}
      ORDER BY v.fecha_compra DESC
    `;
        let compras = await db.pool.query(query);
        res.status(200).json({ error: false, data: compras[0] });
    } catch (error) {
        console.error("Error en historial de compras:", error);
        res.status(500).json({ error: true, msg: "Error obteniendo historial", details: error });
    }
});

// 🚀 NUEVO ENDPOINT: Verifica si una reserva específica pertenece al usuario logueado.
// POST /venta/verificar-reserva
// BODY: { "id_reservacion": "ID123" }
// Requiere Token JWT (auth) para obtener req.usuario.id
// -------------------------------------------------------------------------
app.post('/verificar-reserva', auth, async (req, res) => {
    try {
        const { id_reservacion } = req.body;
        // El ID del usuario se obtiene del middleware 'auth'
        const usuarioId = req.user.id;
        if (!id_reservacion) {
            return res.status(400).json({
                msg: "Falta el ID de reservación en el cuerpo de la solicitud.",
                error: true
            });
        }
        if (!usuarioId) {
            return res.status(400).json({
                msg: "No se pudo obtener el usuarioId del token",
                error: true
            });
        }
        // Query para verificar que la reserva exista Y pertenezca al usuario logeado
        let query = `
            SELECT 
                id_reservacion
            FROM venta
            WHERE id_reservacion = ? AND cliente_id = ?; 
        `;
        let [venta] = await db.pool.query(query, [id_reservacion, usuarioId]);

        if (venta.length === 0) {
            // Si no se encuentra la reserva o no pertenece al usuario
            return res.status(404).json({
                msg: "Reserva no encontrada o no pertenece al usuario.",
                esPropietario: false,
                error: false
            });
        }
        // Si se encuentra y pertenece al usuario
        res.status(200).json({
            msg: "La reserva fue verificada y pertenece a tu cuenta.",
            esPropietario: true,
            error: false
        });
    } catch (error) {
        console.error("Error al verificar la propiedad de la reserva:", error);
        res.status(500).json({ msg: 'Hubo un error interno al procesar la verificación', error: true, details: error });
    }
});


app.get('/modificar-check', auth, async (req, res) => {

    const MAX_CUPOS = 12;
    const id_reservacion = req.query.reserva;
    const nueva_fecha_ida = req.query.fecha;
    const nueva_hora_salida = req.query.hora;

    if (!id_reservacion || !nueva_fecha_ida || !nueva_hora_salida) {
        return res.status(400).json({ msg: 'Faltan parámetros: reserva, fecha y hora.', error: true });
    }
    try {
        const nueva_fecha_hora = `${nueva_fecha_ida} ${nueva_hora_salida}`;
        const fechaActual = new Date();
        console.log('🕒 Fecha actual:', fechaActual);
        console.log('🔹 Parámetros recibidos:', { id_reservacion, nueva_fecha_hora });
        // 1️⃣ Obtener venta
        let [ventaResult] = await db.pool.query(
            `SELECT no_boletos, viajeTour_id, checkin FROM venta WHERE id_reservacion = ?`,
            [id_reservacion]
        );
        if (ventaResult.length === 0) {
            console.log('❌ Venta no encontrada');
            return res.status(404).json({ msg: 'ID de reservación no encontrado.', error: true });
        }
        const no_boletos = ventaResult[0].no_boletos;
        const viejo_viajeTour_id = ventaResult[0].viajeTour_id;
        const checkin_status = ventaResult[0].checkin;
        console.log('🧾 Datos de venta:', { no_boletos, viejo_viajeTour_id, checkin_status });
        // 2️⃣ Obtener viaje origen
        let [viajeOrigen] = await db.pool.query(
            `SELECT id, lugares_disp, fecha_ida, tour_id, guia_id FROM viajeTour WHERE id = ?`,
            [viejo_viajeTour_id]
        );
        if (viajeOrigen.length === 0) {
            console.log('❌ Viaje original no encontrado');
            return res.status(404).json({ msg: 'Viaje original no encontrado.', error: true });
        }
        const lugares_disp_origen = viajeOrigen[0].lugares_disp;
        const viejaFechaIda = viajeOrigen[0].fecha_ida;
        console.log('🚌 Viaje origen:', { lugares_disp_origen, viejaFechaIda });
        // 3️⃣ Validaciones básicas
        let esPosible = true;
        let msgFallo = 'VIABLE';
        const nuevaFechaHoraObj = new Date(nueva_fecha_hora);
        const viejaFechaObj = new Date(viejaFechaIda);
        if (checkin_status != 0) {
            esPosible = false;
            msgFallo = 'FALLO: Reserva ya utilizada (check-in realizado).';
        } else if (viejaFechaObj < fechaActual) {
            esPosible = false;
            msgFallo = 'FALLO: Fecha/hora del viaje original ya pasó.';
        } else if (nuevaFechaHoraObj < fechaActual) {
            esPosible = false;
            msgFallo = 'FALLO: Fecha/hora destino ya pasó o es hora actual.';
        }
        console.log('✅ Validaciones básicas:', { esPosible, msgFallo });
        // 4️⃣ Buscar viaje destino
        let [buscarDestino] = await db.pool.query(
            `SELECT id, lugares_disp FROM viajeTour WHERE fecha_ida = ?`,
            [nueva_fecha_hora]
        );
        let viajeDestinoExistente = false;
        let viajeDestinoId = null;
        let cupoDestinoDespues = MAX_CUPOS;
        if (buscarDestino.length > 0) {
            viajeDestinoExistente = true;
            viajeDestinoId = buscarDestino[0].id;
            cupoDestinoDespues = buscarDestino[0].lugares_disp - no_boletos;
            if (cupoDestinoDespues < 0) {
                esPosible = false;
                msgFallo = `FALLO: Cupo insuficiente en viaje existente.`;
            }
        } else {
            cupoDestinoDespues = MAX_CUPOS - no_boletos;
            if (cupoDestinoDespues < 0) {
                esPosible = false;
                msgFallo = 'FALLO: La reserva excede cupo máximo para viaje nuevo.';
            }
        }
        console.log('🚦 Viaje destino:', { viajeDestinoExistente, viajeDestinoId, cupoDestinoDespues });
        // 5️⃣ Preparar respuesta
        const response = {
            error: false,
            es_posible_traspaso: esPosible,
            msg: esPosible ? 'Traspaso viable' : msgFallo,
            datos_para_horario: {
                id_reservacion,
                no_boletos,
                viejo_viajeTour_id,
                checkin_status,
                nueva_fecha_hora,
                viajeDestinoExistente,
                viajeDestinoId,
                tour_id: viajeOrigen[0].tour_id,
                guia_id: viajeOrigen[0].guia_id
            },
            inventario: {
                origen_lugares_disp: lugares_disp_origen,
                destino_cupo_despues: cupoDestinoDespues
            }
        };
        // 🔹 Log de la respuesta completa
        console.log('📝 /modificar-test Response:', JSON.stringify(response, null, 2));
        // 6️⃣ Enviar respuesta al cliente
        res.status(200).json(response);
    } catch (error) {
        console.error('Error en /modificar-test:', error);
        res.status(500).json({ msg: 'Error interno', error: true, details: error.message });
    }
});

app.post('/modificar-horario', auth, async (req, res) => {
    const MAX_CUPOS = 12;
    try {
        const {
            id_reservacion,
            no_boletos,
            viejo_viajeTour_id,
            checkin_status,
            nueva_fecha_hora,
            viajeDestinoExistente,
            viajeDestinoId,
            tour_id,
            guia_id
        } = req.body.datos_para_horario; // directamente desde /modificar-test
        if (!id_reservacion || !nueva_fecha_hora || !no_boletos || !viejo_viajeTour_id) {
            return res.status(400).json({ msg: 'Faltan parámetros obligatorios.', error: true });
        }
        if (checkin_status != 0) {
            return res.status(400).json({ msg: 'Reserva ya utilizada (check-in realizado).', error: true });
        }
        // -------------------------------------------------------------
        // 1️⃣ Iniciar transacción
        // -------------------------------------------------------------
        const connection = await db.pool.getConnection();
        await connection.beginTransaction();
        try {
            let destinoIdFinal = viajeDestinoId;
            // -------------------------------------------------------------
            // 2️⃣ Crear viaje si no existe
            // -------------------------------------------------------------
            if (!viajeDestinoExistente) {

                //info tour para calcular fecha de regreso
                query = `SELECT * FROM tour WHERE id = ${tour_id} `;
                let tour = await db.pool.query(query);
                tour = tour[0][0];
                let duracion = tour.duracion;
                //formateo de fecha regreso
                const newfecha = addMinutesToDate(new Date(nueva_fecha_hora), parseInt(duracion));
                const fecha_regreso = newfecha.getFullYear() + "-" + ("0" + (newfecha.getMonth() + 1)).slice(-2) + "-" + ("0" + newfecha.getDate()).slice(-2) + " " + ("0" + (newfecha.getHours())).slice(-2) + ":" + ("0" + (newfecha.getMinutes())).slice(-2);


                const crearQuery = `
          INSERT INTO viajeTour (fecha_ida, fecha_regreso, lugares_disp, created_at, updated_at, tour_id, guia_id, status_viaje)
          VALUES (?, ?, ?, NOW(), NOW(), ?, ?, 'proximo')
        `;
                const [crearResult] = await connection.query(crearQuery, [nueva_fecha_hora, fecha_regreso, MAX_CUPOS - no_boletos, tour_id, guia_id]);
                destinoIdFinal = crearResult.insertId;
                console.log('✅ Nuevo viaje creado:', destinoIdFinal);
            } else {
                // -------------------------------------------------------------
                // 3️⃣ Si existe, descontar inventario
                // -------------------------------------------------------------
                const descontarQuery = `
          UPDATE viajeTour
          SET lugares_disp = lugares_disp - ?
          WHERE id = ?
        `;
                await connection.query(descontarQuery, [no_boletos, destinoIdFinal]);
                console.log('✅ Cupos descontados en viaje existente:', destinoIdFinal);
            }
            // -------------------------------------------------------------
            // 4️⃣ Revertir inventario del viaje origen
            // -------------------------------------------------------------
            const revertirQuery = `
        UPDATE viajeTour
        SET lugares_disp = LEAST(lugares_disp + ?, ?)
        WHERE id = ?
      `;
            await connection.query(revertirQuery, [no_boletos, MAX_CUPOS, viejo_viajeTour_id]);
            console.log('🔄 Cupos revertidos en viaje origen:', viejo_viajeTour_id);
            // -------------------------------------------------------------
            // 5️⃣ Actualizar venta
            // -------------------------------------------------------------
            const actualizarVentaQuery = `
        UPDATE venta
        SET viajeTour_id = ?, fecha_comprada = ?, updated_at = NOW()
        WHERE id_reservacion = ?
      `;
            await connection.query(actualizarVentaQuery, [destinoIdFinal, nueva_fecha_hora, id_reservacion]);
            console.log('✏️ Venta actualizada:', id_reservacion, '→', destinoIdFinal);
            // -------------------------------------------------------------
            // 6️⃣ Finalizar transacción
            // -------------------------------------------------------------
            await connection.commit();
            connection.release();
            res.status(200).json({
                error: false,
                msg: `Reserva ${id_reservacion} traspasada con éxito.`,
                detalles: {
                    viaje_origen_id: viejo_viajeTour_id,
                    viaje_destino_id: destinoIdFinal,
                    boletos_movidos: no_boletos,
                    accion: viajeDestinoExistente ? 'Traspasado a viaje existente' : 'Viaje creado y traspasado'
                }
            });
        } catch (transactionError) {
            await connection.rollback();
            connection.release();
            throw transactionError;
        }
    } catch (error) {
        console.error('Error en /modificar-horario:', error);
        res.status(500).json({ msg: 'Error interno', error: true, details: error.message });
    }
});


app.post('/cancelar', auth, async (req, res) => {

    try {
        const { id_reservacion } = req.body

        if (!id_reservacion) {
            return res.status(400).json({ msg: 'Faltan parámetros obligatorios.', error: true });
        }

        let query = `SELECT status_traspaso FROM venta WHERE id_reservacion = ? AND status_traspaso = 99`;
        let cancelable = await db.pool.query(query, [id_reservacion]);
        cancelable = cancelable[0];

        if (cancelable.length > 0) {
            return res.status(500).json({ msg: "La reserva ya fue cancelada anteriormente", error: true });
        }

        let today = new Date().toLocaleString('es-MX', {
            timeZone: 'America/Mexico_City',
            hour12: false // formato 24 horas sin AM/PM
        });
        // Ejemplo: "29/09/2025, 23:42:08"
        let [datePart, timePart] = today.split(', ');
        let [day, month, year] = datePart.split('/');
        let [hours, minutes, seconds] = timePart.split(':');
        month = month.padStart(2, '0');
        day = day.padStart(2, '0');
        hours = hours.padStart(2, '0');
        minutes = minutes.padStart(2, '0');
        seconds = seconds.padStart(2, '0');
        let fecha = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

        const cancelarQuery = `UPDATE venta AS v
            INNER JOIN viajeTour AS vt ON v.viajeTour_id = vt.id
            SET 
                vt.lugares_disp = LEAST(vt.lugares_disp + v.no_boletos, 12),
                v.total = 0.00,
                v.checkin = 0,
                v.pagado = 0,
                v.comision = 0.0,
                v.status_traspaso = 99, 
                v.id_reservacion = CONCAT(v.id_reservacion, '_ANULADO'),
                v.updated_at = ?
            WHERE 
                v.id_reservacion = ? 
            `;

        await db.pool.query(cancelarQuery, [fecha, id_reservacion]);


        res.status(200).json({
            error: false,
            msg: `Reserva ${id_reservacion} cancelada.`
        });

    } catch (error) {
        console.error('Error en /cancelar:', error);
        res.status(500).json({ msg: 'Error interno', error: true, details: error.message });
    }
});

app.post("/limpieza-viajes", async (req, res) => {
    const connection = db.pool; // tu conexión MySQL
    try {
        // =========================
        // 1️⃣ Consolidar viajes con fecha_ida '0000-00-00 00:00:00'
        // =========================
        const [viajesMalos] = await connection.query(
            `SELECT id, lugares_disp
       FROM viajeTour
       WHERE fecha_ida = '0000-00-00 00:00:00'
       ORDER BY lugares_disp DESC, id ASC`
        );

        if (viajesMalos.length > 0) {
            const id_fijo_malos = viajesMalos[0].id;
            const fijo_lugares_disp = Number(viajesMalos[0].lugares_disp) || 0;
            const a_eliminar = viajesMalos.slice(1).map(v => v.id);

            if (a_eliminar.length > 0) {
                await connection.query(
                    `UPDATE venta
           SET viajeTour_id = ?
           WHERE viajeTour_id IN (?);`,
                    [id_fijo_malos, a_eliminar]
                );

                await connection.query(
                    `DELETE FROM viajeTour
           WHERE id IN (?);`,
                    [a_eliminar]
                );
            }

            // Actualizar lugares_disp
            const [sumaBoletosRes] = await connection.query(
                `SELECT SUM(no_boletos) AS total_boletos
         FROM venta
         WHERE viajeTour_id = ?;`,
                [id_fijo_malos]
            );
            const totalBoletos = Number(sumaBoletosRes[0].total_boletos) || 0;
            const nuevos_lugares_disp = Math.max(0, fijo_lugares_disp - totalBoletos);

            await connection.query(
                `UPDATE viajeTour
         SET lugares_disp = ?
         WHERE id = ?;`,
                [nuevos_lugares_disp, id_fijo_malos]
            );
        }

        // =========================
        // 2️⃣ Procesar duplicados normales
        // =========================
        const [grupos] = await connection.query(
            `SELECT DATE_FORMAT(fecha_ida, '%Y-%m-%d %H:%i') AS fecha_hora,
              COUNT(*) AS cantidad
       FROM viajeTour
       WHERE fecha_ida > '2025-09-03 11:00:00'
       GROUP BY fecha_hora
       HAVING cantidad > 1
       ORDER BY fecha_hora ASC`
        );

        const resultados = [];

        for (const g of grupos) {
            const fechaHora = g.fecha_hora;

            const [viajes] = await connection.query(
                `SELECT id, fecha_ida, lugares_disp
         FROM viajeTour
         WHERE DATE_FORMAT(fecha_ida, '%Y-%m-%d %H:%i') = ?
         ORDER BY lugares_disp DESC, id ASC`,
                [fechaHora]
            );

            if (!viajes || viajes.length < 2) continue;

            const viajesIds = viajes.map(v => v.id);
            const id_fijo = viajes[0].id;
            const fijo_lugares_disp = Number(viajes[0].lugares_disp) || 0;
            const a_eliminar = viajesIds.filter(id => id !== id_fijo);

            let totalBoletos = 0;

            if (a_eliminar.length > 0) {
                // Mover ventas al viaje fijo
                await connection.query(
                    `UPDATE venta
           SET viajeTour_id = ?
           WHERE viajeTour_id IN (?);`,
                    [id_fijo, a_eliminar]
                );

                // Borrar los viajes duplicados
                await connection.query(
                    `DELETE FROM viajeTour
           WHERE id IN (?);`,
                    [a_eliminar]
                );
            }

            // Actualizar lugares_disp
            const [sumaBoletosRes] = await connection.query(
                `SELECT SUM(no_boletos) AS total_boletos
         FROM venta
         WHERE viajeTour_id = ?;`,
                [id_fijo]
            );
            totalBoletos = Number(sumaBoletosRes[0].total_boletos) || 0;
            const nuevos_lugares_disp = Math.max(0, fijo_lugares_disp - totalBoletos);

            await connection.query(
                `UPDATE viajeTour
         SET lugares_disp = ?
         WHERE id = ?;`,
                [nuevos_lugares_disp, id_fijo]
            );

            resultados.push({
                fecha_hora: fechaHora,
                id_fijo,
                a_eliminar,
                total_boletos_mover: totalBoletos
            });
        }

        res.json({
            mensaje: "✅ Limpieza completada con éxito.",
            total_grupos_procesados: resultados.length,
            resultados
        });

    } catch (error) {
        console.error("Error en /limpieza-viajes:", error);
        res.status(500).json({
            error: "Error al ejecutar la limpieza.",
            detalles: error.message
        });
    }
});


module.exports = app
