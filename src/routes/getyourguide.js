const express = require('express');
const bcryptjs = require('bcryptjs');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');

const app = express.Router();

const db = require('../config/db');
const helperName = require('../helpers/name');
const { getPreciosPorContexto } = require('../helpers/precios');

const GYG_CANCEL_STATUS = 99;
const CONTEXTO_PRECIO_MUSEO = 'museo_general';

const TICKET_NAMES = {
    tipoA: 'Entrada General',
    tipoB: 'Ciudadano Mexicano',
    tipoC: 'Estudiante',
    tipoD: 'Noche de Museos',
    tipoE: 'Adulto Mayor',
    tipoF: 'Infancias',
    tipoG: 'Tour Operador',
    tipoH: 'Capacidades Diferentes',
};

function generarPassword(longitud = 10) {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+=<>?';
    let password = '';

    for (let index = 0; index < longitud; index += 1) {
        password += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }

    return password;
}

function addMinutesToDate(objDate, intMinutes) {
    const numberOfMlSeconds = objDate.getTime();
    const addMlSeconds = intMinutes * 60000;
    return new Date(numberOfMlSeconds + addMlSeconds);
}

function weekDay(fecha) {
    let dayselected;

    if (typeof fecha === 'string') {
        const [year, month, day] = fecha.split('-').map(Number);
        dayselected = new Date(year, month - 1, day);
    } else {
        dayselected = fecha;
    }

    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    return diasSemana[dayselected.getDay()];
}

function esUltimoMiercolesDelMes(fecha) {
    let fechaObj;

    if (typeof fecha === 'string') {
        const [year, month, day] = fecha.split('-').map(Number);
        fechaObj = new Date(year, month - 1, day);
    } else {
        fechaObj = fecha;
    }

    if (fechaObj.getDay() !== 3) {
        return false;
    }

    const ultimoDiaMes = new Date(fechaObj.getFullYear(), fechaObj.getMonth() + 1, 0);
    const ultimoMiercoles = new Date(ultimoDiaMes);

    while (ultimoMiercoles.getDay() !== 3) {
        ultimoMiercoles.setDate(ultimoMiercoles.getDate() - 1);
    }

    return fechaObj.getDate() === ultimoMiercoles.getDate();
}

function getFecha() {
    const today = new Date().toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        hour12: false,
    });
    const [datePart, timePart] = today.split(', ');
    let [day, month, year] = datePart.split('/');
    let [hours, minutes, seconds] = timePart.split(':');

    month = month.padStart(2, '0');
    day = day.padStart(2, '0');
    hours = hours.padStart(2, '0');
    minutes = minutes.padStart(2, '0');
    seconds = seconds.padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function normalizarHora(horaStr) {
    if (!horaStr || typeof horaStr !== 'string') {
        return '00:00:00';
    }

    const horaLimpia = horaStr.trim();

    if (/^([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(horaLimpia)) {
        const [hours, minutes, seconds = '00'] = horaLimpia.split(':');
        return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
    }

    const match12 = horaLimpia.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (match12) {
        let [, hours, minutes, period] = match12;
        let parsedHours = parseInt(hours, 10);

        if (period) {
            period = period.toUpperCase();
            if (period === 'PM' && parsedHours < 12) {
                parsedHours += 12;
            }
            if (period === 'AM' && parsedHours === 12) {
                parsedHours = 0;
            }
        }

        return `${String(parsedHours).padStart(2, '0')}:${minutes.padStart(2, '0')}:00`;
    }

    const matchH = horaLimpia.match(/^(\d{1,2})h(\d{1,2})$/i);
    if (matchH) {
        const [, hours, minutes] = matchH;
        return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:00`;
    }

    return horaLimpia.includes(':')
        ? `${horaLimpia.split(':').slice(0, 2).join(':')}:00`
        : '00:00:00';
}

function normalizarFechaSoloDia(fecha) {
    if (!fecha) {
        return null;
    }

    if (fecha instanceof Date) {
        return fecha.toISOString().split('T')[0];
    }

    return String(fecha).split(/[ T]/)[0] || null;
}

function aplicaCapacidadFecha(fechaRow, fechaIda) {
    if (!fechaRow || typeof fechaRow.max_personas === 'undefined' || fechaRow.max_personas === null) {
        return false;
    }

    const fechaViaje = normalizarFechaSoloDia(fechaIda);
    const fechaInicioCupo = normalizarFechaSoloDia(fechaRow.fecha_inicio_cupo);
    const fechaFinCupo = normalizarFechaSoloDia(fechaRow.fecha_fin_cupo);

    if (!fechaViaje || !fechaInicioCupo || !fechaFinCupo) {
        return false;
    }

    return fechaViaje >= fechaInicioCupo && fechaViaje <= fechaFinCupo;
}

function parseTiposBoletos(tipos_boletos, no_boletos = 0, fallbackKey = 'tipoA') {
    if (tipos_boletos && typeof tipos_boletos === 'object' && !Array.isArray(tipos_boletos)) {
        return tipos_boletos;
    }

    if (typeof tipos_boletos === 'string') {
        try {
            const parsed = JSON.parse(tipos_boletos);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch (error) {
            console.error('Error parseando tipos_boletos:', error.message);
        }
    }

    return { [fallbackKey]: Number(no_boletos) || 0 };
}

function contarBoletos(tiposBoletos) {
    return Object.values(tiposBoletos).reduce((total, cantidad) => total + (Number(cantidad) || 0), 0);
}

async function calcularTotalTiposBoletos(tiposBoletos, fechaSolicitada, tourId = null) {
    const precios = await getPreciosPorContexto(CONTEXTO_PRECIO_MUSEO, tiposBoletos, fechaSolicitada, tourId);

    return Object.entries(tiposBoletos).reduce((total, [tipo, cantidad]) => {
        const subtotal = (Number(precios[tipo]) || 0) * (Number(cantidad) || 0);
        return total + subtotal;
    }, 0);
}

async function generateQRCode(text) {
    return QRCode.toBuffer(text);
}

async function generateBarcode(text) {
    return bwipjs.toBuffer({
        bcid: 'code128',
        text,
        scale: 3,
        height: 12,
        includetext: true,
        textxalign: 'center',
    });
}

function obtenerBasicAuthConfig() {
    return {
        user: process.env.GETYOURGUIDE_BASIC_AUTH_USER || process.env.GYG_BASIC_AUTH_USER || null,
        password: process.env.GETYOURGUIDE_BASIC_AUTH_PASSWORD || process.env.GYG_BASIC_AUTH_PASSWORD || null,
    };
}

function getFirstDefined(source, keys) {
    for (const key of keys) {
        if (typeof source[key] !== 'undefined' && source[key] !== null && source[key] !== '') {
            return source[key];
        }
    }

    return undefined;
}

function requireGetYourGuideBasicAuth(req, res, next) {
    const { user, password } = obtenerBasicAuthConfig();

    if (!user || !password) {
        return res.status(500).json({
            error: true,
            msg: 'GetYourGuide Basic Auth no está configurado',
        });
    }

    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Basic ')) {
        res.set('WWW-Authenticate', 'Basic realm="GetYourGuide"');
        return res.status(401).json({ error: true, msg: 'Basic Auth requerida' });
    }

    const encodedCredentials = authorization.slice(6).trim();
    let decodedCredentials = '';

    try {
        decodedCredentials = Buffer.from(encodedCredentials, 'base64').toString('utf8');
    } catch (error) {
        res.set('WWW-Authenticate', 'Basic realm="GetYourGuide"');
        return res.status(401).json({ error: true, msg: 'Credenciales Basic Auth inválidas' });
    }

    const separatorIndex = decodedCredentials.indexOf(':');
    if (separatorIndex === -1) {
        res.set('WWW-Authenticate', 'Basic realm="GetYourGuide"');
        return res.status(401).json({ error: true, msg: 'Credenciales Basic Auth inválidas' });
    }

    const providedUser = decodedCredentials.slice(0, separatorIndex);
    const providedPassword = decodedCredentials.slice(separatorIndex + 1);

    if (providedUser !== user || providedPassword !== password) {
        res.set('WWW-Authenticate', 'Basic realm="GetYourGuide"');
        return res.status(401).json({ error: true, msg: 'Basic Auth no autorizada' });
    }

    next();
}

function normalizarPayloadDisponibilidad(payload = {}) {
    return {
        tourId: getFirstDefined(payload, ['tourId', 'tour_id', 'option_id', 'product_id']),
        fecha: getFirstDefined(payload, ['fecha', 'date', 'travel_date', 'start_date']),
        horaCompleta: getFirstDefined(payload, ['horaCompleta', 'hora_completa', 'time', 'start_time']),
        boletos: getFirstDefined(payload, ['boletos', 'no_boletos', 'tickets', 'ticket_count']) || 1,
        tipos_boletos: getFirstDefined(payload, ['tipos_boletos', 'ticket_types', 'tickets_by_type']),
    };
}

function normalizarPayloadReserva(payload = {}) {
    return {
        tourId: getFirstDefined(payload, ['tourId', 'tour_id', 'option_id', 'product_id']),
        fecha_ida: getFirstDefined(payload, ['fecha_ida', 'fecha', 'date', 'travel_date', 'start_date']),
        horaCompleta: getFirstDefined(payload, ['horaCompleta', 'hora_completa', 'time', 'start_time']),
        tipos_boletos: getFirstDefined(payload, ['tipos_boletos', 'ticket_types', 'tickets_by_type']),
        no_boletos: getFirstDefined(payload, ['no_boletos', 'boletos', 'tickets', 'ticket_count']),
        total: getFirstDefined(payload, ['total', 'amount', 'price_total']),
        nombre_cliente: getFirstDefined(payload, ['nombre_cliente', 'first_name', 'customer_first_name', 'name']),
        apellidos_cliente: getFirstDefined(payload, ['apellidos_cliente', 'last_name', 'customer_last_name', 'surname']),
        correo: getFirstDefined(payload, ['correo', 'email', 'customer_email']),
        telefono: getFirstDefined(payload, ['telefono', 'phone', 'customer_phone']),
        external_reference: getFirstDefined(payload, ['external_reference', 'externalReference', 'reference', 'booking_reference', 'reservation_reference']),
    };
}

function normalizarPayloadConfirmacion(payload = {}) {
    return {
        external_reference: getFirstDefined(payload, ['external_reference', 'externalReference', 'reference', 'booking_reference', 'reservation_reference']),
        paid: typeof payload.paid === 'undefined' ? true : payload.paid,
        total: getFirstDefined(payload, ['total', 'amount', 'price_total']),
    };
}

function normalizarPayloadCancelacion(payload = {}) {
    return {
        external_reference: getFirstDefined(payload, ['external_reference', 'externalReference', 'reference', 'booking_reference', 'reservation_reference']),
        id_reservacion: getFirstDefined(payload, ['id_reservacion', 'reservation_id', 'booking_id']),
        motivo: getFirstDefined(payload, ['motivo', 'reason', 'cancellation_reason']) || 'Cancelado desde GetYourGuide',
    };
}

async function validarDiaPermitido(fecha, tourId) {
    const dia = weekDay(fecha);
    if (dia === 'Martes') {
        const error = new Error('No hay recorridos disponibles los martes');
        error.status = 403;
        throw error;
    }

    const [resultado] = await db.pool.query('SELECT fechas_no_disponibles FROM tour WHERE id = ?', [tourId]);
    if (!resultado.length || !resultado[0].fechas_no_disponibles) {
        return;
    }

    const arrayFechasDeshabilitadas = resultado[0].fechas_no_disponibles
        .split(';')
        .filter((valor) => valor !== '')
        .map((valor) => {
            const [day, month, year] = valor.split('-');
            return new Date(year, month - 1, day);
        });

    const fechaStr = new Date(fecha).toISOString().split('T')[0];
    const existe = arrayFechasDeshabilitadas.some((diaBloqueado) => diaBloqueado.toISOString().split('T')[0] === fechaStr);

    if (existe) {
        const error = new Error(`La fecha ${fecha} no está disponible`);
        error.status = 403;
        throw error;
    }
}

async function verificarHorarioBloqueado(fecha, hora, tourId) {
    const [resultado] = await db.pool.query('SELECT fechashorarios_no_disponibles FROM tour WHERE id = ?', [tourId]);

    if (!resultado.length || !resultado[0].fechashorarios_no_disponibles) {
        return false;
    }

    const horariosBloqueados = resultado[0].fechashorarios_no_disponibles
        .split(';')
        .filter((valor) => valor !== '')
        .map((valor) => valor.trim());

    const horaNormalizada = hora.split(':').slice(0, 2).join(':');
    return horariosBloqueados.includes(`${fecha} ${horaNormalizada}`);
}

async function obtenerCapacidadFechaVigente(queryRunner, tourId, fechaIda, horaCompleta) {
    const diaSeleccionado = weekDay(fechaIda);
    const [hours, minutes] = horaCompleta.split(':');
    const queryFecha = `SELECT * FROM fecha WHERE tour_id = ? AND dia = ? AND DATE_FORMAT(hora_salida, '%H:%i') = ? AND status = 2 LIMIT 1`;
    const [fechaRows] = await queryRunner.query(queryFecha, [tourId, diaSeleccionado, `${hours}:${minutes}`]);
    const fechaRow = fechaRows[0] || null;
    const usarCapacidadFecha = aplicaCapacidadFecha(fechaRow, fechaIda);

    return {
        fechaRow,
        usarCapacidadFecha,
        fechaCapacity: usarCapacidadFecha ? parseInt(fechaRow.max_personas, 10) : null,
    };
}

async function verificarDisponibilidad(no_boletos, tourId, fecha, hora, tipos_boletos = null) {
    const [hours, minutes] = hora.split(':');
    const [viajes] = await db.pool.query(
        `SELECT * FROM viajeTour WHERE CAST(fecha_ida AS DATE) = ? AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = ? AND tour_id = ?`,
        [fecha, `${hours}:${minutes}`, tourId]
    );

    if (viajes.length > 0) {
        return viajes[0].lugares_disp >= Number(no_boletos);
    }

    const parsedTiposBoletos = parseTiposBoletos(tipos_boletos, no_boletos);
    if (parsedTiposBoletos.tipoD > 0) {
        return Number(no_boletos) <= 51;
    }

    if (Number(no_boletos) > 12) {
        return false;
    }

    const { fechaCapacity } = await obtenerCapacidadFechaVigente(db.pool, tourId, fecha, hora);
    const [tours] = await db.pool.query('SELECT max_pasajeros FROM tour WHERE id = ?', [tourId]);
    const maxPasajeros = fechaCapacity !== null && typeof fechaCapacity !== 'undefined'
        ? parseInt(fechaCapacity, 10)
        : tours[0]?.max_pasajeros;

    if (typeof maxPasajeros === 'number') {
        return Number(no_boletos) <= maxPasajeros;
    }

    return false;
}

async function obtenerTour(tourId) {
    const [rows] = await db.pool.query('SELECT * FROM tour WHERE id = ?', [tourId]);
    if (!rows.length) {
        throw new Error('No se encontró el tour');
    }

    return rows[0];
}

async function obtenerOCrearCliente({ nombre_cliente, apellidos_cliente, correo, telefono }) {
    if (!correo) {
        throw new Error('El correo es obligatorio');
    }

    const [rows] = await db.pool.query('SELECT * FROM usuario WHERE correo = ?', [correo]);
    if (rows.length) {
        return rows[0];
    }

    const password = generarPassword();
    const salt = await bcryptjs.genSalt(10);
    const hashedPassword = await bcryptjs.hash(password, salt);
    const fecha = getFecha();

    const [result] = await db.pool.query(
        `INSERT INTO usuario (nombres, apellidos, correo, telefono, password, isClient, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [nombre_cliente || 'Cliente', apellidos_cliente || 'GetYourGuide', correo, telefono || '', hashedPassword, fecha, fecha]
    );

    const [clienteRows] = await db.pool.query('SELECT * FROM usuario WHERE id = ?', [result.insertId]);
    return clienteRows[0];
}

async function obtenerOViajeTour(connection, { tourId, fecha_ida, horaCompleta, no_boletos, tiposBoletos }) {
    const tour = await obtenerTour(tourId);
    let duracion = tour.duracion;
    let maxPasajeros = tour.max_pasajeros;

    if (tiposBoletos.tipoD > 0) {
        duracion = 13;
        maxPasajeros = 51;
    } else {
        const { fechaCapacity } = await obtenerCapacidadFechaVigente(connection, tourId, fecha_ida, horaCompleta);
        if (fechaCapacity !== null && typeof fechaCapacity !== 'undefined') {
            maxPasajeros = parseInt(fechaCapacity, 10);
        }
    }

    const [hours, minutes] = horaCompleta.split(':');
    const [disponibilidad] = await connection.query(
        `SELECT * FROM viajeTour WHERE CAST(fecha_ida AS DATE) = ? AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = ? AND tour_id = ?`,
        [fecha_ida, `${hours}:${minutes}`, tourId]
    );

    const fecha_ida_formateada = `${fecha_ida} ${horaCompleta}`;
    const fechaCreacion = getFecha();

    if (!disponibilidad.length) {
        let guiaId = null;

        if (tour.guias) {
            try {
                const guias = JSON.parse(tour.guias);
                guiaId = guias[0]?.value || null;
            } catch (error) {
                console.error('Error parseando guias del tour:', error.message);
            }
        }

        const fechaRegresoDate = addMinutesToDate(new Date(fecha_ida_formateada), parseInt(duracion, 10));
        const fecha_regreso = `${fechaRegresoDate.getFullYear()}-${String(fechaRegresoDate.getMonth() + 1).padStart(2, '0')}-${String(fechaRegresoDate.getDate()).padStart(2, '0')} ${String(fechaRegresoDate.getHours()).padStart(2, '0')}:${String(fechaRegresoDate.getMinutes()).padStart(2, '0')}`;

        const [insertResult] = await connection.query(
            `INSERT INTO viajeTour (fecha_ida, fecha_regreso, lugares_disp, created_at, updated_at, tour_id, guia_id, geo_llegada, geo_salida)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [fecha_ida_formateada, fecha_regreso, maxPasajeros, fechaCreacion, fechaCreacion, tourId, guiaId, null, null]
        );

        return {
            viajeTourId: insertResult.insertId,
            lugaresDisp: maxPasajeros - Number(no_boletos),
            fechaIdaFormateada: fecha_ida_formateada,
            seCreoRegistro: true,
        };
    }

    const viajeTour = disponibilidad[0];
    return {
        viajeTourId: viajeTour.id,
        lugaresDisp: viajeTour.lugares_disp - Number(no_boletos),
        fechaIdaFormateada: fecha_ida_formateada,
        seCreoRegistro: false,
    };
}

async function actualizarLugares(connection, viajeTourId, lugaresDisp) {
    await connection.query('UPDATE viajeTour SET lugares_disp = ? WHERE id = ?', [lugaresDisp, viajeTourId]);
}

async function construirConfirmacion(venta) {
    const qrCodeBuffer = await generateQRCode(venta.id_reservacion);
    const barcodeBuffer = await generateBarcode(venta.id_reservacion);

    return {
        id_reservacion: venta.id_reservacion,
        external_reference: venta.session_id,
        barcode_text: venta.id_reservacion,
        qr_base64: qrCodeBuffer.toString('base64'),
        barcode_base64: barcodeBuffer.toString('base64'),
    };
}

async function consultarDisponibilidad(payload) {
    const { tourId, fecha, horaCompleta, boletos = 1, tipos_boletos } = normalizarPayloadDisponibilidad(payload);

    if (!tourId || !fecha) {
        return {
            statusCode: 400,
            body: { error: true, msg: 'tourId y fecha son obligatorios' },
        };
    }

    await validarDiaPermitido(fecha, tourId);
    const tiposBoletos = parseTiposBoletos(tipos_boletos, boletos);

    if (horaCompleta) {
        const horaNormalizada = normalizarHora(horaCompleta);
        const estaBloqueado = await verificarHorarioBloqueado(fecha, horaNormalizada, tourId);

        if (estaBloqueado) {
            return {
                statusCode: 200,
                body: {
                    error: false,
                    disponible: false,
                    lugares_disp: 0,
                    hora: horaNormalizada,
                },
            };
        }

        const disponible = await verificarDisponibilidad(boletos, tourId, fecha, horaNormalizada, tiposBoletos);
        const [hours, minutes] = horaNormalizada.split(':');
        const [viajes] = await db.pool.query(
            `SELECT lugares_disp FROM viajeTour WHERE CAST(fecha_ida AS DATE) = ? AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = ? AND tour_id = ?`,
            [fecha, `${hours}:${minutes}`, tourId]
        );

        return {
            statusCode: 200,
            body: {
                error: false,
                disponible,
                lugares_disp: viajes[0]?.lugares_disp ?? null,
                hora: horaNormalizada,
            },
        };
    }

    const diaSeleccionado = weekDay(fecha);
    const mes = new Date(fecha).getMonth();
    const status = mes === 0 ? 1 : 2;
    const [horarios] = await db.pool.query(
        'SELECT * FROM fecha WHERE tour_id = ? AND dia = ? AND status = ? ORDER BY dia, hora_salida ASC',
        [tourId, diaSeleccionado, status]
    );

    const horariosDisponibles = await Promise.all(horarios.map(async (horario) => {
        const horaCampo = String(horario.hora_salida).split(':').slice(0, 2).join(':');
        const estaBloqueado = await verificarHorarioBloqueado(fecha, horaCampo, tourId);

        if (estaBloqueado || parseInt(horario.max_personas, 10) === 0) {
            return {
                ...horario,
                disponible: false,
                lugares_disp: 0,
            };
        }

        const disponible = await verificarDisponibilidad(boletos, tourId, fecha, `${horaCampo}:00`, tiposBoletos);
        const [viajes] = await db.pool.query(
            `SELECT lugares_disp FROM viajeTour WHERE CAST(fecha_ida AS DATE) = ? AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = ? AND tour_id = ?`,
            [fecha, horaCampo, tourId]
        );

        let lugaresDisp = viajes[0]?.lugares_disp ?? null;
        if (lugaresDisp === null) {
            if (aplicaCapacidadFecha(horario, fecha)) {
                lugaresDisp = parseInt(horario.max_personas, 10);
            } else {
                const [tourRows] = await db.pool.query('SELECT max_pasajeros FROM tour WHERE id = ?', [tourId]);
                lugaresDisp = tourRows[0]?.max_pasajeros ?? 0;
            }
        }

        return {
            ...horario,
            disponible,
            lugares_disp: lugaresDisp,
        };
    }));

    return {
        statusCode: 200,
        body: { error: false, horarios: horariosDisponibles },
    };
}

async function crearReservacionGetYourGuide(payload) {
    let connection;

    try {
        const {
            tourId,
            fecha_ida,
            horaCompleta,
            tipos_boletos,
            no_boletos,
            total,
            nombre_cliente,
            apellidos_cliente,
            correo,
            telefono,
            external_reference,
        } = normalizarPayloadReserva(payload);

        if (!tourId || !fecha_ida || !horaCompleta || !correo || !external_reference) {
            return {
                statusCode: 400,
                body: {
                    error: true,
                    msg: 'tourId, fecha_ida, horaCompleta, correo y external_reference son obligatorios',
                },
            };
        }

        const horaNormalizada = normalizarHora(horaCompleta);
        const tiposBoletos = parseTiposBoletos(tipos_boletos, no_boletos);
        const boletos = Number(no_boletos) || contarBoletos(tiposBoletos);
        const totalCalculado = Number(total) || await calcularTotalTiposBoletos(tiposBoletos, fecha_ida, tourId);

        await validarDiaPermitido(fecha_ida, tourId);

        const estaBloqueado = await verificarHorarioBloqueado(fecha_ida, horaNormalizada, tourId);
        if (estaBloqueado) {
            return {
                statusCode: 403,
                body: { error: true, msg: `El horario ${fecha_ida} ${horaNormalizada} está bloqueado` },
            };
        }

        const disponible = await verificarDisponibilidad(boletos, tourId, fecha_ida, horaNormalizada, tiposBoletos);
        if (!disponible) {
            return {
                statusCode: 409,
                body: { error: true, msg: 'Cupo no disponible' },
            };
        }

        const [ventaExistente] = await db.pool.query('SELECT * FROM venta WHERE session_id = ? LIMIT 1', [external_reference]);
        if (ventaExistente.length) {
            return {
                statusCode: 200,
                body: {
                    error: false,
                    msg: 'La reserva ya existe',
                    reservation: {
                        id_reservacion: ventaExistente[0].id_reservacion,
                        external_reference,
                        pagado: ventaExistente[0].pagado === 1,
                    },
                },
            };
        }

        const cliente = await obtenerOCrearCliente({ nombre_cliente, apellidos_cliente, correo, telefono });
        const fechaCreacion = getFecha();
        connection = await db.pool.getConnection();
        await connection.beginTransaction();

        const viajeData = await obtenerOViajeTour(connection, {
            tourId,
            fecha_ida,
            horaCompleta: horaNormalizada,
            no_boletos: boletos,
            tiposBoletos,
        });

        if (viajeData.lugaresDisp < 0) {
            await connection.rollback();
            return {
                statusCode: 409,
                body: { error: true, msg: 'El número de boletos excede los lugares disponibles' },
            };
        }

        const nombreCompleto = `${cliente.nombres} ${cliente.apellidos}`.trim();
        const [ventaInsert] = await connection.query(
            `INSERT INTO venta (id_reservacion, no_boletos, tipos_boletos, total, pagado, fecha_compra, comision, status_traspaso, fecha_comprada, created_at, updated_at, nombre_cliente, cliente_id, correo, viajeTour_id, session_id, metodo_pago)
             VALUES ('V', ?, ?, ?, 0, ?, '0.0', '0', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [boletos, JSON.stringify(tiposBoletos), totalCalculado, fechaCreacion, viajeData.fechaIdaFormateada, fechaCreacion, fechaCreacion, nombreCompleto, cliente.id, correo, viajeData.viajeTourId, external_reference, 'getyourguide']
        );

        const idReservacion = `${ventaInsert.insertId}V${helperName(cliente.nombres.split(' '))}${helperName(cliente.apellidos.split(' '))}`;

        await connection.query('UPDATE venta SET id_reservacion = ? WHERE id = ?', [idReservacion, ventaInsert.insertId]);
        await actualizarLugares(connection, viajeData.viajeTourId, viajeData.lugaresDisp);
        await connection.commit();

        return {
            statusCode: 201,
            body: {
                error: false,
                msg: 'Reserva creada exitosamente',
                reservation: {
                    id_reservacion: idReservacion,
                    external_reference,
                    viajeTourId: viajeData.viajeTourId,
                    pagado: false,
                    total: totalCalculado,
                    currency: 'MXN',
                },
            },
        };
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        return {
            statusCode: 500,
            body: { error: true, msg: error.message || 'Error creando la reserva' },
        };
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

async function confirmarReservacionGetYourGuide(payload) {
    let connection;

    try {
        const { external_reference, paid = true, total } = normalizarPayloadConfirmacion(payload);
        if (!external_reference) {
            return {
                statusCode: 400,
                body: { error: true, msg: 'external_reference es obligatorio' },
            };
        }

        const [ventas] = await db.pool.query('SELECT * FROM venta WHERE session_id = ? LIMIT 1', [external_reference]);
        if (!ventas.length) {
            return {
                statusCode: 404,
                body: { error: true, msg: 'No se encontró una reserva con esa referencia externa' },
            };
        }

        const venta = ventas[0];

        if (!paid) {
            return {
                statusCode: 200,
                body: {
                    error: false,
                    msg: 'Confirmación recibida sin pago aplicado',
                    reservation: {
                        id_reservacion: venta.id_reservacion,
                        external_reference,
                        pagado: venta.pagado === 1,
                    },
                },
            };
        }

        if (venta.pagado !== 1) {
            connection = await db.pool.getConnection();
            await connection.beginTransaction();
            await connection.query('UPDATE venta SET pagado = 1, total = ?, updated_at = ? WHERE id = ?', [Number(total) || Number(venta.total || 0), getFecha(), venta.id]);
            await connection.commit();
            connection.release();
            connection = null;
        }

        const confirmation = await construirConfirmacion(venta);

        return {
            statusCode: 200,
            body: {
                error: false,
                msg: 'Confirmación procesada exitosamente',
                reservation: {
                    id_reservacion: venta.id_reservacion,
                    external_reference,
                    pagado: true,
                    total: Number(total) || Number(venta.total || 0),
                    currency: 'MXN',
                },
                assets: {
                    qr_format: 'png-base64',
                    barcode_format: 'code128-png-base64',
                    ...confirmation,
                },
            },
        };
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        return {
            statusCode: 500,
            body: { error: true, msg: error.message || 'Error procesando la confirmación' },
        };
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

async function cancelarReservacionGetYourGuide(payload) {
    let connection;

    try {
        const { external_reference, id_reservacion, motivo } = normalizarPayloadCancelacion(payload);
        if (!external_reference && !id_reservacion) {
            return {
                statusCode: 400,
                body: { error: true, msg: 'external_reference o id_reservacion es obligatorio' },
            };
        }

        const query = external_reference
            ? 'SELECT * FROM venta WHERE session_id = ? LIMIT 1'
            : 'SELECT * FROM venta WHERE id_reservacion = ? LIMIT 1';
        const [ventas] = await db.pool.query(query, [external_reference || id_reservacion]);

        if (!ventas.length) {
            return {
                statusCode: 404,
                body: { error: true, msg: 'No se encontró una reserva para cancelar' },
            };
        }

        const venta = ventas[0];
        if (Number(venta.status_traspaso) === GYG_CANCEL_STATUS) {
            return {
                statusCode: 200,
                body: {
                    error: false,
                    msg: 'La reserva ya estaba cancelada',
                    reservation: {
                        id_reservacion: venta.id_reservacion,
                        external_reference: venta.session_id,
                        cancelada: true,
                    },
                },
            };
        }

        connection = await db.pool.getConnection();
        await connection.beginTransaction();

        const fechaActualizacion = getFecha();
        await connection.query(
            'UPDATE venta SET boletos_devueltos = 1, status_traspaso = ?, updated_at = ? WHERE id = ?',
            [GYG_CANCEL_STATUS, fechaActualizacion, venta.id]
        );

        if (venta.viajeTour_id) {
            await connection.query(
                'UPDATE viajeTour SET lugares_disp = lugares_disp + ?, updated_at = ? WHERE id = ?',
                [Number(venta.no_boletos) || 0, fechaActualizacion, venta.viajeTour_id]
            );
        }

        await connection.commit();

        return {
            statusCode: 200,
            body: {
                error: false,
                msg: 'Reserva cancelada correctamente',
                reservation: {
                    id_reservacion: venta.id_reservacion,
                    external_reference: venta.session_id,
                    cancelada: true,
                    motivo,
                },
            },
        };
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        return {
            statusCode: 500,
            body: { error: true, msg: error.message || 'Error cancelando la reserva' },
        };
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

async function handleAvailabilityRequest(req, res) {
    try {
        const payload = req.method === 'GET' ? req.query : req.body;
        const result = await consultarDisponibilidad(payload);
        return res.status(result.statusCode).json(result.body);
    } catch (error) {
        return res.status(error.status || 500).json({ error: true, msg: error.message || 'Error consultando disponibilidad' });
    }
}

async function handleReservationsRequest(req, res) {
    const result = await crearReservacionGetYourGuide(req.body);
    return res.status(result.statusCode).json(result.body);
}

async function handleConfirmationsRequest(req, res) {
    const result = await confirmarReservacionGetYourGuide(req.body);
    return res.status(result.statusCode).json(result.body);
}

async function handleVersionedBookRequest(req, res) {
    const reservationResult = await crearReservacionGetYourGuide(req.body);
    if (reservationResult.body?.error) {
        return res.status(reservationResult.statusCode).json(reservationResult.body);
    }

    const confirmationResult = await confirmarReservacionGetYourGuide({
        ...req.body,
        external_reference: reservationResult.body?.reservation?.external_reference || req.body.external_reference,
        paid: true,
    });

    return res.status(confirmationResult.statusCode).json({
        ...confirmationResult.body,
        reservation: {
            ...reservationResult.body?.reservation,
            ...confirmationResult.body?.reservation,
            pagado: true,
        },
    });
}

async function handleVersionedCancelRequest(req, res) {
    const result = await cancelarReservacionGetYourGuide(req.body);
    return res.status(result.statusCode).json(result.body);
}

app.get('/horarios/:tourid/fecha/:fecha/boletos/:boletos', async (req, res) => {
    try {
        const fecha = req.params.fecha;
        const tourId = req.params.tourid;
        const boletos = parseInt(req.params.boletos, 10);

        await validarDiaPermitido(fecha, tourId);

        let tiposBoletos = {};
        if (req.query.tipos_boletos) {
            tiposBoletos = parseTiposBoletos(req.query.tipos_boletos, boletos);

            if (tiposBoletos.tipoD > 0) {
                const otrosTipos = Object.keys(tiposBoletos).filter((tipo) => tipo !== 'tipoD' && tiposBoletos[tipo] > 0);
                if (otrosTipos.length > 0) {
                    return res.status(400).json({
                        error: true,
                        msg: 'Si selecciona boletos tipoD, no puede seleccionar otros tipos de boletos'
                    });
                }
            }
        }

        const diaSeleccionado = weekDay(fecha);
        const esUltimoMiercoles = esUltimoMiercolesDelMes(fecha);
        const mes = new Date(fecha).getMonth();
        const status = mes === 0 ? 1 : 2;

        const [horariosResult] = await db.pool.query(
            'SELECT * FROM fecha WHERE tour_id = ? AND dia = ? AND status = ? ORDER BY dia, hora_salida ASC',
            [tourId, diaSeleccionado, status]
        );

        let horarios = horariosResult;

        if (esUltimoMiercoles && tiposBoletos.tipoD > 0) {
            const horariosFiltrados = horarios.filter((horario) => String(horario.hora_salida).substring(0, 5) === '18:00');
            horarios = horariosFiltrados.length > 0 ? horariosFiltrados : [{
                id: null,
                tour_id: parseInt(tourId, 10),
                dia: diaSeleccionado,
                hora_salida: '18:00:00',
                status,
                applyForOperator: 0,
                idioma: 'Noche Museos'
            }];
        }

        const horariosDisponibles = await Promise.all(horarios.map(async (horario) => {
            const horaCampo = String(horario.hora_salida).split(':').slice(0, 2).join(':');
            const estaBloqueado = await verificarHorarioBloqueado(fecha, horaCampo, tourId);

            if (estaBloqueado || parseInt(horario.max_personas, 10) === 0) {
                return {
                    ...horario,
                    disponible: false,
                    lugares_disp: 0
                };
            }

            const [viajeResult] = await db.pool.query(
                `SELECT * FROM viajeTour WHERE CAST(fecha_ida AS DATE) = ? AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = ? AND tour_id = ?`,
                [fecha, horaCampo, tourId]
            );

            let disponible = true;
            let lugares_disp = null;

            if (viajeResult.length > 0) {
                const viaje = viajeResult[0];
                lugares_disp = viaje.lugares_disp;
                disponible = viaje.lugares_disp >= boletos;
            } else {
                if (aplicaCapacidadFecha(horario, fecha)) {
                    if (parseInt(horario.max_personas, 10) === 0) {
                        lugares_disp = 0;
                        disponible = false;
                    } else {
                        lugares_disp = parseInt(horario.max_personas, 10);
                        disponible = lugares_disp >= boletos;
                    }
                } else if (esUltimoMiercoles && horaCampo === '18:00') {
                    lugares_disp = 51;
                    disponible = 51 >= boletos;
                } else {
                    const [tourRows] = await db.pool.query('SELECT max_pasajeros FROM tour WHERE id = ?', [tourId]);
                    const max_pasajeros = tourRows[0]?.max_pasajeros;
                    if (typeof max_pasajeros === 'number') {
                        lugares_disp = max_pasajeros;
                        disponible = max_pasajeros >= boletos;
                    } else {
                        lugares_disp = 'sin_info_tour';
                        disponible = false;
                    }
                }
            }

            return {
                ...horario,
                disponible,
                lugares_disp
            };
        }));

        return res.status(200).json({
            error: false,
            horarios: horariosDisponibles
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            error: true,
            msg: error.message || 'Error obteniendo horarios'
        });
    }
});

app.post('/availability', handleAvailabilityRequest);

async function handlePrices(req, res) {
    try {
        const { tipos_boletos, no_boletos, fecha, fecha_ida, tour_id, tourId } = req.body;
        const tiposBoletos = parseTiposBoletos(tipos_boletos, no_boletos);
        const fechaConsulta = fecha || fecha_ida;
        const tourContextId = tour_id || tourId || null;
        const totalBoletos = contarBoletos(tiposBoletos);
        const precios = await getPreciosPorContexto(CONTEXTO_PRECIO_MUSEO, tiposBoletos, fechaConsulta, tourContextId);
        const total = await calcularTotalTiposBoletos(tiposBoletos, fechaConsulta, tourContextId);
        const breakdown = Object.entries(tiposBoletos)
            .filter(([, cantidad]) => Number(cantidad) > 0)
            .map(([tipo, cantidad]) => ({
                tipo,
                nombre: TICKET_NAMES[tipo] || tipo,
                cantidad: Number(cantidad),
                precio_unitario: Number(precios[tipo]) || 0,
                subtotal: (Number(precios[tipo]) || 0) * Number(cantidad),
            }));

        return res.status(200).json({
            error: false,
            total_boletos: totalBoletos,
            total,
            currency: 'MXN',
            breakdown,
        });
    } catch (error) {
        return res.status(500).json({ error: true, msg: error.message || 'Error consultando precios' });
    }
}

app.post('/prices', handlePrices);
app.post('/pricing', handlePrices);

app.post('/reservations', handleReservationsRequest);

app.post('/confirmations', handleConfirmationsRequest);

app.get('/get-availabilities', requireGetYourGuideBasicAuth, handleAvailabilityRequest);
app.post('/get-availabilities', requireGetYourGuideBasicAuth, handleAvailabilityRequest);
app.post('/reserve', requireGetYourGuideBasicAuth, handleReservationsRequest);
app.post('/book', requireGetYourGuideBasicAuth, handleVersionedBookRequest);
app.post('/cancel-reservation', requireGetYourGuideBasicAuth, handleVersionedCancelRequest);
app.post('/cancel-booking', requireGetYourGuideBasicAuth, handleVersionedCancelRequest);

module.exports = app;