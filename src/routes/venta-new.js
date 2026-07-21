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

// Función para generar el código QR
async function generateQRCode(text) {
    try {
        const qrCodeBuffer = await QRCode.toBuffer(text);
        return qrCodeBuffer;
    } catch (err) {
        console.error('Error generating QR Code:', err);
        throw err;
    }
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
        dayselected = new Date(year, month - 1, day);
    } else {
        dayselected = fecha;
    }

    const diasSemana = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    return diasSemana[dayselected.getDay()];
}

//funcion para validar fecha seleccionada (que no sea martes) y que la fecha no pertenezca a fechas bloqueadas
async function validarDiaPermitido(fecha, tourId) {
    const dia = weekDay(fecha);
    if (dia === 'Martes') {
        const error = new Error('No hay recorridos disponibles los martes');
        error.status = 403;
        throw error;
    }

    //obtener fechas bloqueadas
    let query = `SELECT * FROM tour WHERE id = ${tourId}`;
    let resultado = await db.pool.query(query);

    const fechasDeshabilitadas = resultado[0][0].fechas_no_disponibles;

    const arrayFechasDeshabilitadas = fechasDeshabilitadas
        .split(";")
        .filter(f => f !== "")
        .map(f => {
            const [d, m, y] = f.split("-");
            return new Date(y, m - 1, d);
        });

    const fechaStr = new Date(fecha).toISOString().split('T')[0];

    const existe = arrayFechasDeshabilitadas.some(d =>
        d.toISOString().split('T')[0] === fechaStr
    );

    if (existe) {
        const error = new Error(`La fecha ${fecha} no está disponible`);
        error.status = 403;
        throw error;
    }
}

//funcion para verificar si un horario específico está bloqueado
async function verificarHorarioBloqueado(fecha, hora, tourId) {
    let query = `SELECT fechashorarios_no_disponibles FROM tour WHERE id = ${tourId}`;
    let resultado = await db.pool.query(query);

    if (!resultado[0] || resultado[0].length === 0 || !resultado[0][0].fechashorarios_no_disponibles) {
        return false;
    }

    const fechashorariosDeshabilitados = resultado[0][0].fechashorarios_no_disponibles;

    const horariosBloqueados = fechashorariosDeshabilitados
        .split(";")
        .filter(f => f !== "")
        .map(f => f.trim());

    const horaNormalizada = hora.split(':').slice(0, 2).join(':');
    const fechaHoraStr = `${fecha} ${horaNormalizada}`;

    return horariosBloqueados.includes(fechaHoraStr);
}

const verificarDisponibilidad = async (no_boletos, tourId, fecha, hora, tipos_boletos = null) => {
    hora = hora.split(':');

    let query = `SELECT 
                        * 
                        FROM viajeTour 
                        WHERE CAST(fecha_ida AS DATE) = '${fecha}'
                        AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = '${hora[0]}:${hora[1]}'
                        AND tour_id = ${tourId};`;
    let disponibilidad = await db.pool.query(query);
    disponibilidad = disponibilidad[0];

    if (disponibilidad.length > 0) {
        disponibilidad = disponibilidad[0];
        if (disponibilidad.lugares_disp < Number(no_boletos)) {
            return false;
        }
    } else {
        if (tipos_boletos) {
            let parsedTiposBoletos = {};
            try {
                if (typeof tipos_boletos === 'string') {
                    parsedTiposBoletos = JSON.parse(tipos_boletos);
                } else {
                    parsedTiposBoletos = tipos_boletos;
                }

                if (parsedTiposBoletos.tipoD > 0) {
                    if (no_boletos > 51) {
                        return false;
                    }
                } else {
                    if (no_boletos > 12) {
                        return false;
                    }
                    let queryTour = `SELECT max_pasajeros FROM tour WHERE id = ${tourId}`;
                    let tourResult = await db.pool.query(queryTour);
                    let max_pasajeros = tourResult[0][0]?.max_pasajeros;
                    if (typeof max_pasajeros === 'number' && no_boletos > max_pasajeros) {
                        return false;
                    }
                }
            } catch (error) {
                console.error('Error parseando tipos_boletos en verificarDisponibilidad:', error);
                if (no_boletos > 12) {
                    return false;
                }
            }
        } else {
            if (no_boletos > 12) {
                return false;
            }
        }
    }

    return true;
}

const getFecha = () => {
    let today = new Date().toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        hour12: false
    });
    let [datePart, timePart] = today.split(', ');
    let [day, month, year] = datePart.split('/');
    let [hours, minutes, seconds] = timePart.split(':');
    month = month.padStart(2, '0');
    day = day.padStart(2, '0');
    hours = hours.padStart(2, '0');
    minutes = minutes.padStart(2, '0');
    seconds = seconds.padStart(2, '0');
    let fecha = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    return fecha;
}

// Función para cargar el template de correo según el idioma
function getEmailTemplate(lang = 'es') {
    try {
        return require(`../templates/emailTemplate-correo_confirmacion_compra-${lang}`);
    } catch (error) {
        return require('../templates/emailTemplate-correo_confirmacion_compra');
    }
}

// Template por defecto (español)
const emailTemplate = getEmailTemplate();

// Template para tour operador
const emailTemplateTourOperador = require('../templates/emailTemplate-tour-operador');

// Función para enviar correo de confirmación de tour operador
async function enviarCorreoTourOperador(emailData, correo) {
    try {
        // Generar HTML del correo
        const emailHtml = emailTemplateTourOperador(emailData);

        // Enviar correo al cliente
        let message = {
            from: process.env.MAIL,
            to: correo,
            subject: "¡Confirmación de Compras Múltiples - Museo Casa Kahlo!",
            text: "",
            html: emailHtml
        };

        const info = await mailer.sendMail(message);
        console.log('Email enviado al cliente:', info);

        // Enviar copia al admin
        message.to = process.env.MAIL;
        message.subject = "COPIA - Confirmación de Compras Múltiples - Tour Operador";

        const infoAdmin = await mailer.sendMail(message);
        console.log('Email enviado al admin:', infoAdmin);

        return { success: true, info, infoAdmin };
    } catch (error) {
        console.error("Falló envío de correo:", error.message);
        return { success: false, error: error.message };
    }
}
app.post('/crear-touroperador', async (req, res) => {
    try {
        let { no_boletos, cart_items, nombre_cliente, cliente_id, correo, telefono, tourId, total, payment_method } = req.body;

        // Validar que el método de pago sea balance
        if (payment_method !== 'balance') {
            return res.status(400).json({ error: true, msg: "Método de pago no válido. Se requiere 'balance'" });
        }

        // Parsear cart_items
        let cartItems = [];
        try {
            cartItems = JSON.parse(cart_items);
            if (!Array.isArray(cartItems)) {
                return res.status(400).json({ error: true, msg: "cart_items debe ser un array" });
            }
        } catch (error) {
            return res.status(400).json({ error: true, msg: "Error parseando cart_items" });
        }

        // Validar que el usuario exista y obtener su saldo
        let query = `SELECT * FROM usuario WHERE id = ${cliente_id}`;
        let clientResult = await db.pool.query(query);
        let client = clientResult[0];
        
        if (client.length === 0) {
            return res.status(400).json({ error: true, msg: "Cliente no encontrado" });
        }
        client = client[0];

        // Verificar saldo suficiente
        if (parseFloat(client.balance) < parseFloat(total)) {
            return res.status(400).json({ 
                error: true, 
                msg: "Saldo insuficiente", 
                details: `Saldo actual: $${client.balance}, Total requerido: $${total}` 
            });
        }

        // Validar correo
        if (!correo) {
            return res.status(400).json({ error: true, msg: "El correo es obligatorio" });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(correo)) {
            return res.status(400).json({ error: true, msg: "El formato del correo no es válido" });
        }

        let fecha = getFecha();

        // Primero validar disponibilidad de todos los items antes de procesar
        for (let item of cartItems) {
            let { fecha_ida, horaCompleta, boletos, tipos_boletos } = item;

            await validarDiaPermitido(fecha_ida, tourId);
            
            const estaBloqueado = await verificarHorarioBloqueado(fecha_ida, horaCompleta, tourId);
            if (estaBloqueado) {
                return res.status(403).json({
                    error: true,
                    msg: `El horario ${fecha_ida} ${horaCompleta} está bloqueado y no está disponible`
                });
            }

            let parsedTiposBoletos = {};
            try {
                parsedTiposBoletos = JSON.parse(tipos_boletos);
                if (typeof parsedTiposBoletos !== 'object' || parsedTiposBoletos === null || Array.isArray(parsedTiposBoletos)) {
                    parsedTiposBoletos = {};
                }
            } catch (error) {
                console.error('Error parseando tipos_boletos:', error);
                parsedTiposBoletos = {};
            }

            const disponible = await verificarDisponibilidad(boletos, tourId, fecha_ida, horaCompleta, parsedTiposBoletos);
            if (!disponible) {
                return res.status(400).json({ 
                    error: true, 
                    msg: "Cupo no disponible", 
                    details: `Fecha: ${fecha_ida}, Hora: ${horaCompleta}, Boletos: ${boletos}`,
                    item_sin_disponibilidad: {
                        fecha: fecha_ida,
                        hora: horaCompleta,
                        boletos_solicitados: boletos
                    }
                });
            }
        }

        // Si todas las validaciones pasan, iniciar transacción
        const connection = await db.pool.getConnection();
        await connection.beginTransaction();

        try {
            // Procesar cada item del carrito dentro de la transacción
            let reservaciones = [];
            let totalBoletosProcesados = 0;

            for (let item of cartItems) {
                let { fecha_ida, horaCompleta, boletos, tipos_boletos } = item;

                // Obtener información del tour para duración y max_pasajeros
                let duracion, max_pasajeros;
                let parsedTiposBoletos = {};
                try {
                    parsedTiposBoletos = JSON.parse(tipos_boletos);
                } catch (error) {
                    parsedTiposBoletos = {};
                }

                if (parsedTiposBoletos.tipoD > 0) {
                    duracion = 13;
                    max_pasajeros = 51;
                } else {
                    query = `SELECT * FROM tour WHERE id = ${tourId}`;
                    let tour = await connection.query(query);
                    tour = tour[0][0];
                    duracion = tour.duracion;
                    max_pasajeros = tour.max_pasajeros;
                }

                // Procesar viajeTour
                let fecha_ida_formateada = `${fecha_ida} ${horaCompleta}`;
                let viajeTourId = null;
                let seCreoRegistro = false;

                let hora = horaCompleta.split(':');
                query = `SELECT * FROM viajeTour 
                         WHERE CAST(fecha_ida AS DATE) = '${fecha_ida}'
                         AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = '${hora[0]}:${hora[1]}'
                         AND tour_id = ${tourId}`;
                let disponibilidad = await connection.query(query);
                disponibilidad = disponibilidad[0];

                // Calcular fecha de regreso
                const newfecha = addMinutesToDate(new Date(fecha_ida_formateada), parseInt(duracion));
                const fecha_regreso = newfecha.getFullYear() + "-" + ("0" + (newfecha.getMonth() + 1)).slice(-2) + "-" + ("0" + newfecha.getDate()).slice(-2) + " " + ("0" + (newfecha.getHours())).slice(-2) + ":" + ("0" + (newfecha.getMinutes())).slice(-2);

                if (disponibilidad.length === 0) {
                    // Crear nuevo viajeTour
                    query = `SELECT * FROM tour WHERE id = ${tourId}`;
                    let result = await connection.query(query);
                    result = result[0][0];

                    let guia = result.guias;
                    guia = JSON.parse(guia);

                    query = `INSERT INTO viajeTour 
                             (fecha_ida, fecha_regreso, lugares_disp, created_at, updated_at, tour_id, guia_id, geo_llegada, geo_salida) 
                             VALUES 
                             ('${fecha_ida_formateada}', '${fecha_regreso}', '${max_pasajeros}', '${fecha}', '${fecha}', '${tourId}', '${guia[0].value}', '${null}', '${null}')`;
                    
                    result = await connection.query(query);
                    result = result[0];
                    viajeTourId = result.insertId;
                    seCreoRegistro = true;
                } else {
                    viajeTourId = disponibilidad[0].id;
                }

                // Verificar disponibilidad actualizada (por si otro proceso la modificó)
                let lugares_disp;
                if (seCreoRegistro) {
                    lugares_disp = max_pasajeros - parseInt(boletos);
                } else {
                    // Volver a consultar para obtener el valor más reciente
                    query = `SELECT lugares_disp FROM viajeTour WHERE id = ${viajeTourId}`;
                    let currentDisp = await connection.query(query);
                    currentDisp = currentDisp[0][0];
                    lugares_disp = currentDisp.lugares_disp - parseInt(boletos);
                }

                if (lugares_disp < 0) {
                    await connection.rollback();
                    return res.status(400).json({ 
                        error: true, 
                        msg: "El número de boletos excede los lugares disponibles", 
                        details: `Fecha: ${fecha_ida}, Hora: ${horaCompleta}, Disponibilidad actual: ${lugares_disp + parseInt(boletos)}`,
                        item_sin_disponibilidad: {
                            fecha: fecha_ida,
                            hora: horaCompleta,
                            boletos_solicitados: boletos,
                            disponibilidad_actual: lugares_disp + parseInt(boletos)
                        }
                    });
                }

                query = `UPDATE viajeTour SET lugares_disp = '${lugares_disp}' WHERE id = ${viajeTourId}`;
                await connection.query(query);

                // Crear venta
                query = `INSERT INTO venta 
                         (id_reservacion, no_boletos, tipos_boletos, total, pagado, fecha_compra, comision, status_traspaso, fecha_comprada, created_at, updated_at, nombre_cliente, cliente_id, correo, viajeTour_id) 
                         VALUES 
                         ('V', '${boletos}', '${tipos_boletos}', '0', '1', '${fecha}', '0.0', '0', '${fecha_ida_formateada}', '${fecha}', '${fecha}', '${nombre_cliente}', '${cliente_id}', '${correo}', '${viajeTourId}')`;
                
                let ventaResult = await connection.query(query);
                ventaResult = ventaResult[0];

                let id_reservacion = ventaResult.insertId + 'V' + helperName(client.nombres.split(' ')) + helperName(client.apellidos.split(' '));

                // Actualizar id_reservacion
                query = `UPDATE venta SET id_reservacion = '${id_reservacion}' WHERE id = ${ventaResult.insertId}`;
                await connection.query(query);

                reservaciones.push({
                    id_reservacion,
                    fecha_ida,
                    horaCompleta,
                    boletos,
                    viajeTourId
                });

                totalBoletosProcesados += parseInt(boletos);
            }

            // Descontar saldo del usuario
            let nuevoSaldo = parseFloat(client.balance) - parseFloat(total);
            query = `UPDATE usuario SET balance = '${nuevoSaldo}' WHERE id = ${cliente_id}`;
            await connection.query(query);

            // Confirmar transacción
            await connection.commit();

            // Preparar datos para el correo con descripción de las compras
            const reservacionesConSubtotal = reservaciones.map((reservacion, index) => ({
                ...reservacion,
                subtotal: cartItems[index].subtotal || 0
            }));

            const emailData = {
                nombre_cliente: nombre_cliente,
                reservaciones: reservacionesConSubtotal,
                total_boletos: totalBoletosProcesados,
                total_descontado: total,
                saldo_restante: nuevoSaldo
            };

            // Enviar correo de confirmación con descripción de las compras
            const emailResult = await enviarCorreoTourOperador(emailData, correo);
            if (!emailResult.success) {
                console.error("Falló envío de correo:", emailResult.error);
            }

            // Generar QR para cada reservación (para registro interno)
            for (let reservacion of reservaciones) {
                try {
                    const qrCodeBuffer = await generateQRCode(reservacion.id_reservacion);
                    console.log(`Reservación creada: ${reservacion.id_reservacion}`);
                } catch (error) {
                    console.error('Error generando QR para reservación:', reservacion.id_reservacion, error);
                }
            }

            res.status(200).json({ 
                msg: "Reservas creadas exitosamente", 
                reservaciones: reservaciones,
                total_boletos: totalBoletosProcesados,
                total_descontado: total,
                saldo_restante: nuevoSaldo,
                error: false 
            });

        } catch (error) {
            await connection.rollback();
            console.error('Error en transacción:', error);
            res.status(400).json({ 
                error: true, 
                msg: "Error procesando las reservas", 
                details: error.message 
            });
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('Error en crear-touroperador:', error);
        res.status(400).json({ 
            error: true, 
            msg: error.message || 'Error procesando las reservas', 
            details: error 
        });
    }
});