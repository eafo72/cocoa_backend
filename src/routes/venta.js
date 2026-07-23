/* Importing the express module and creating an instance of it. */
const express = require('express')
const app = express.Router()
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const auth = require('../middlewares/authorization')
const db = require('../config/db')
const mailer = require('../controller/mailController')
const helperName = require('../helpers/name')
const {
    parseFechaSolicitada,
    getCatalogoPreciosPorContexto,
    getPreciosPorContexto
} = require('../helpers/precios')
const QRCode = require('qrcode')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

//funcion para validar fecha seleccionada (que no sea martes) y que la fecha no pertenezca a fechas bloqueadas
async function validarDiaPermitido(fecha, tourId) {
    const dia = weekDay(fecha); // usa tu función existente
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
            return new Date(y, m - 1, d); // mes -1 porque JS empieza en 0
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
    // Obtener horarios bloqueados desde la base de datos
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

    // Normalizar la hora: quitar segundos si existen
    const horaNormalizada = hora.split(':').slice(0, 2).join(':');
    const fechaHoraStr = `${fecha} ${horaNormalizada}`;

    //console.log("validando", fecha + " " + horaNormalizada);
    //console.log(horariosBloqueados.includes(fechaHoraStr));

    return horariosBloqueados.includes(fechaHoraStr);
}

// Función para cargar el template de correo según el idioma
function getEmailTemplate(lang = 'es') {
    try {
        return require(`../templates/emailTemplate-correo_confirmacion_compra-${lang}`);
    } catch (error) {
        // Si el template del idioma no existe, cargar el español por defecto
        return require('../templates/emailTemplate-correo_confirmacion_compra');
    }
}

// Template por defecto (español)
const emailTemplate = getEmailTemplate();

const emailTemplateTourOperador = require('../templates/emailTemplate-tour-operador');

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

function debeMostrarHorarioPorFecha(fechaRow, fechaIda) {
    if (!fechaRow) {
        return false;
    }

    const fechaViaje = normalizarFechaSoloDia(fechaIda);
    const fechaInicioCupo = normalizarFechaSoloDia(fechaRow.fecha_inicio_cupo);
    const fechaFinCupo = normalizarFechaSoloDia(fechaRow.fecha_fin_cupo);

    if (!fechaViaje) {
        return false;
    }

    if (!fechaInicioCupo && !fechaFinCupo) {
        return true;
    }

    if (!fechaInicioCupo || !fechaFinCupo) {
        return false;
    }

    return fechaViaje >= fechaInicioCupo && fechaViaje <= fechaFinCupo;
}

async function obtenerCapacidadFechaVigente(queryRunner, tourId, fechaIda, horaCompleta) {
    const diaSeleccionado = weekDay(fechaIda);
    const hora = horaCompleta.split(':');
    const horaNormalizada = `${hora[0]}:${hora[1]}`;
    const queryFecha = `SELECT * FROM fecha WHERE tour_id = ${tourId} AND dia = '${diaSeleccionado}' AND DATE_FORMAT(hora_salida, '%H:%i') = '${horaNormalizada}' AND status = 2 LIMIT 1`;
    const fechaRes = await queryRunner.query(queryFecha);
    const fechaRow = (fechaRes[0] && fechaRes[0][0]) ? fechaRes[0][0] : null;
    const usarCapacidadFecha = aplicaCapacidadFecha(fechaRow, fechaIda);

    return {
        fechaRow,
        usarCapacidadFecha,
        fechaCapacity: usarCapacidadFecha ? parseInt(fechaRow.max_personas, 10) : null,
    };
}

// Función para determinar si una fecha es el último miércoles del mes
function esUltimoMiercolesDelMes(fecha) {
    let fechaObj;

    if (typeof fecha === 'string') {
        const [year, month, day] = fecha.split('-').map(Number);
        fechaObj = new Date(year, month - 1, day);
    } else {
        fechaObj = fecha;
    }

    // Verificar si es miércoles
    if (fechaObj.getDay() !== 3) { // 3 = miércoles en JavaScript (0 = domingo)
        return false;
    }

    // Obtener el último día del mes
    const ultimoDiaMes = new Date(fechaObj.getFullYear(), fechaObj.getMonth() + 1, 0);

    // Encontrar el último miércoles del mes
    let ultimoMiercoles = new Date(ultimoDiaMes);
    while (ultimoMiercoles.getDay() !== 3) {
        ultimoMiercoles.setDate(ultimoMiercoles.getDate() - 1);
    }

    // Comparar si la fecha dada es el último miércoles
    return fechaObj.getDate() === ultimoMiercoles.getDate();
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

function separarFechaHora(fecha_comprada) {
    if (fecha_comprada == null) {
        throw new Error("fecha_comprada es null o undefined");
    }

    // Si es número (timestamp), convertir a Date
    if (typeof fecha_comprada === "number") {
        fecha_comprada = new Date(fecha_comprada);
    }

    // Si es objeto Date, obtener su ISO (UTC) como base
    if (fecha_comprada instanceof Date) {
        // toISOString -> "2025-11-12T09:30:00.000Z"
        fecha_comprada = fecha_comprada.toISOString();
    }

    // A estas alturas asumimos que es string (si no lo es, lanzar)
    if (typeof fecha_comprada !== "string") {
        throw new Error("fecha_comprada debe ser string, number o Date");
    }

    // Normalizar:
    // 1) cambiar 'T' por espacio
    // 2) quitar milisegundos (".123") si vienen
    // 3) quitar zona horaria final: "Z" o "+02:00" o "-0500" etc.
    // Resultado esperado: "YYYY-MM-DD HH:mm:ss" (si vienen segundos)
    const limpio = fecha_comprada
        .replace("T", " ")
        .replace(/\.\d+/, "")                // quita .000 (milisegundos)
        .replace(/(Z|[+-]\d{2}:?\d{2})$/, "") // quita Z o +02:00 o -0500
        .trim();

    // separar por el primer espacio (fecha y resto)
    const partes = limpio.split(" ");
    const fecha = partes[0] || "";
    const hora = partes.slice(1).join(" ") || ""; // en caso de que haya espacio en la zona original

    return { fecha, hora };
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

    //si disponibilidad == 0 significa que no hay ningun viajeTour y entonces si hay lugares
    if (disponibilidad[0].length > 0) {
        disponibilidad = disponibilidad[0][0];
        if (disponibilidad.lugares_disp < Number(no_boletos)) {
            return false;
        }
    } else {
        // No hay viajeTour, verificar si hay tipoD para aplicar cupo máximo especial
        if (tipos_boletos) {
            let parsedTiposBoletos = {};
            try {
                if (typeof tipos_boletos === 'string') {
                    parsedTiposBoletos = JSON.parse(tipos_boletos);
                } else {
                    parsedTiposBoletos = tipos_boletos;
                }

                if (parsedTiposBoletos.tipoD > 0) {
                    // Para tipoD, el cupo máximo es 51
                    if (no_boletos > 51) {
                        return false;
                    }
                } else {
                    // Para otros tipos, aplicar límite de 12 y consultar el tour para max_pasajeros
                    if (no_boletos > 12) {
                        return false;
                    }

                    let max_pasajeros;
                    const { fechaCapacity } = await obtenerCapacidadFechaVigente(db.pool, tourId, fecha, hora);

                    query = `SELECT * FROM tour WHERE id = ${tourId} `;
                    let tour = await db.pool.query(query);
                    tour = tour[0][0];

                    if (fechaCapacity !== null && typeof fechaCapacity !== 'undefined') {
                        max_pasajeros = parseInt(fechaCapacity, 10);
                    } else {
                        max_pasajeros = tour.max_pasajeros;
                    }

                    if (typeof max_pasajeros === 'number' && no_boletos > max_pasajeros) {
                        return false;
                    }
                }
            } catch (error) {
                console.error('Error parseando tipos_boletos en verificarDisponibilidad:', error);
                // Si hay error, aplicar validación normal de 12 boletos
                if (no_boletos > 12) {
                    return false;
                }
            }
        } else {
            // Si no hay tipos_boletos, aplicar validación normal de 12 boletos
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
    return fecha;
}

const parseTiposBoletos = (tipos_boletos, no_boletos, fallbackKey = 'tipoA') => {
    try {
        const parsed = JSON.parse(tipos_boletos);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch (error) {
        console.error('Error parseando tipos_boletos:', error);
    }

    return { [fallbackKey]: Number(no_boletos) || 0 };
};

const CONTEXTO_PRECIO_MUSEO = 'museo_general';

const mapTiposBoletosConPrecios = (tiposBoletos, nombres, precios) => Object.entries(tiposBoletos).map(([tipo, cantidad]) => ({
    nombre: nombres[tipo] || tipo,
    precio: Number(precios[tipo]) || 0,
    cantidad: Number(cantidad) || 0
}));

app.get('/precios/museo-general', async (req, res) => {
    try {
        const { fecha, tour_id } = req.query;

        if (!fecha) {
            return res.status(400).json({
                error: true,
                msg: 'El parámetro fecha es requerido (formato YYYY-MM-DD)'
            });
        }

        const fechaConsulta = parseFechaSolicitada(fecha);
        if (!fechaConsulta) {
            return res.status(400).json({
                error: true,
                msg: 'Formato de fecha inválido. Use YYYY-MM-DD'
            });
        }

        const precios = await getCatalogoPreciosPorContexto(CONTEXTO_PRECIO_MUSEO, fechaConsulta, tour_id);
        return res.status(200).json({
            error: false,
            fecha_consultada: fechaConsulta,
            tour_id: Number(tour_id) || null,
            data: precios
        });
    } catch (error) {
        console.error('Error obteniendo precios museo_general:', error);
        return res.status(500).json({ error: true, msg: 'Error obteniendo precios', details: error.message });
    }
});

const getEventoEspecialBoletos = async (eventoId, tiposBoletos) => {
    const boletoIds = Object.keys(tiposBoletos)
        .map((tipo) => {
            const match = String(tipo).match(/^tipo_(\d+)$/);
            return match ? Number(match[1]) : null;
        })
        .filter((id) => Number.isInteger(id));

    if (boletoIds.length === 0) {
        return Object.entries(tiposBoletos).map(([tipo, cantidad]) => ({
            nombre: tipo,
            precio: 0,
            cantidad: Number(cantidad) || 0
        }));
    }

    const placeholders = boletoIds.map(() => '?').join(', ');
    const [rows] = await db.pool.query(
        `SELECT id, titulo, precio FROM eventos_especiales_boletos WHERE evento_id = ? AND id IN (${placeholders})`,
        [eventoId, ...boletoIds]
    );

    const boletosMap = new Map(rows.map((row) => [String(row.id), row]));

    return Object.entries(tiposBoletos).map(([tipo, cantidad]) => {
        const match = String(tipo).match(/^tipo_(\d+)$/);
        const boleto = match ? boletosMap.get(match[1]) : null;

        return {
            nombre: boleto?.titulo || tipo,
            precio: Number(boleto?.precio) || 0,
            cantidad: Number(cantidad) || 0
        };
    });
};

const getEventoEspecialHorario = async (connection, venta) => {
    const tiposBoletos = parseTiposBoletos(venta?.tipos_boletos, venta?.no_boletos, 'tipo_evento');
    const esEventoEspecial = Object.keys(tiposBoletos).some((key) => key.startsWith('tipo_'));

    if (!esEventoEspecial) {
        return { esEventoEspecial: false, horario: null };
    }

    const [viajeTourRows] = await connection.query(
        'SELECT tour_id, fecha_ida FROM viajeTour WHERE id = ?',
        [venta.viajeTour_id]
    );

    if (!viajeTourRows.length) {
        throw new Error('No se encontró el viajeTour relacionado con la venta');
    }

    const tourId = viajeTourRows[0].tour_id;
    const fechaTour = viajeTourRows[0].fecha_ida.toISOString().split('T')[0];
    const horaTour = viajeTourRows[0].fecha_ida.toISOString().split('T')[1].substring(0, 8);

    const [horarios] = await connection.query(
        'SELECT id FROM eventos_especiales_horarios WHERE evento_id = ? AND fecha = ? AND activo = 1 AND hora_inicio = ? LIMIT 1',
        [tourId, fechaTour, horaTour]
    );

    if (!horarios.length) {
        throw new Error('Horario no encontrado para ese evento especial');
    }

    return { esEventoEspecial: true, horario: horarios[0] };
};

const handleSuccessfulPayment = async (session) => {
    let fecha = getFecha();
    let connection;

    try {
        const metadata = session.metadata || {};
        const { no_boletos, tipos_boletos, nombre_cliente, correo, tourId } = metadata;
        const flow = metadata.flow || 'ticket_purchase';
        const isEventoEspecial = flow === 'evento_especial' || metadata.evento_especial === 'true';
        const eventoId = Number(metadata.eventoId || metadata.evento_id || tourId);
        let fecha_ida_original = metadata.fecha_ida || metadata.fecha || '';
        let horaCompleta = normalizarHora(metadata.horaCompleta || metadata.hora || '');
        let id_reservacion = '';
        let idVenta = '';
        let viajeTourId = '';

        connection = await db.pool.getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT * FROM venta WHERE session_id = ?', [session.id]);

        if (rows.length === 0 && metadata.ventaId) {
            [rows] = await connection.query('SELECT * FROM venta WHERE id = ?', [metadata.ventaId]);
        }

        if (rows.length === 0) {
            console.log('No se encontró la venta');
            await connection.rollback();
            connection.release();
            return;
        }

        if (rows[0].pagado === 1) {
            console.log('⚠️ Pago ya procesado, se omite repetición');
            await connection.rollback();
            connection.release();
            return;
        }

        id_reservacion = rows[0].id_reservacion;
        idVenta = rows[0].id;
        viajeTourId = rows[0].viajeTour_id;

        const totalMetadata = Number(metadata.total);
        const totalSession = session.amount_total != null ? Number(session.amount_total) / 100 : null;
        let total = Number.isFinite(totalMetadata)
            ? totalMetadata
            : (Number.isFinite(totalSession) ? totalSession : Number(rows[0].total || 0));

        // Marcar como pagado
        await connection.query(
            'UPDATE venta SET pagado = 1, total = ?, updated_at = ? WHERE id = ?',
            [total, fecha, idVenta]
        );

        await connection.commit();
        connection.release();

        // ==========================
        // Aquí seguimos fuera de la transacción
        // ==========================

        // Obtener el idioma de los metadatos de la sesión o usar español por defecto
        const lang = session.metadata?.language || 'es';

        // Textos traducidos
        const i18n = {
            es: {
                ticketType: "Tipo de boleto",
                price: "Precio",
                quantity: "Cantidad",
                subtotal: "Subtotal",
                total: "Total",
                ticketTypes: {
                    tipoA: "Entrada General",
                    tipoB: "Ciudadano Mexicano",
                    tipoC: "Estudiante",
                    tipoD: "Noche de Museos",
                    tipoE: "Adulto Mayor",
                    tipoF: "Infancias",
                    tipoG: "Tour Operador",
                    tipoH: "Capacidades Diferentes"
                }
            },
            en: {
                ticketType: "Ticket Type",
                price: "Price",
                quantity: "Quantity",
                subtotal: "Subtotal",
                total: "Total",
                ticketTypes: {
                    tipoA: "General Admission",
                    tipoB: "Mexican Citizen",
                    tipoC: "Student",
                    tipoD: "Museum Night",
                    tipoE: "Senior",
                    tipoF: "Children",
                    tipoG: "Tour Operator",
                    tipoH: "Disability"
                }
            },
            fr: {
                ticketType: "Type de billet",
                price: "Prix",
                quantity: "Quantité",
                subtotal: "Sous-total",
                total: "Total",
                ticketTypes: {
                    tipoA: "Entrée générale",
                    tipoB: "Citoyen mexicain",
                    tipoC: "Étudiant",
                    tipoD: "Nuit des Musées",
                    tipoE: "Senior",
                    tipoF: "Enfants",
                    tipoG: "Opérateur touristique",
                    tipoH: "Handicap"
                }
            }
        };

        // Usar el diccionario de idiomas o español por defecto
        const t = i18n[lang] || i18n.es;

        // Generamos el QR
        const qrCodeBuffer = await generateQRCode(id_reservacion);

        // Crear la tabla de boletos
        const tiposBoletos = parseTiposBoletos(tipos_boletos, no_boletos, isEventoEspecial ? 'tipo_evento' : 'tipoA');
        const precios = isEventoEspecial
            ? null
            : await getPreciosPorContexto(CONTEXTO_PRECIO_MUSEO, tiposBoletos, fecha_ida_original, viajeTourId);

        let tiposBoletosArray = isEventoEspecial
            ? await getEventoEspecialBoletos(eventoId, tiposBoletos)
            : mapTiposBoletosConPrecios(tiposBoletos, t.ticketTypes, precios);

        tiposBoletosArray = tiposBoletosArray.filter((tipo) => Number(tipo.cantidad) > 0);

        const totalCalculado = tiposBoletosArray.reduce(
            (sum, tipo) => sum + (Number(tipo.precio) * Number(tipo.cantidad)),
            0
        );

        if (!Number.isFinite(total) || total <= 0) {
            total = totalCalculado;
        }

        let tablaBoletos = `
            <table width="100%" cellpadding="5" cellspacing="0" border="1" style="border-collapse:collapse;">
                <tr style="background-color:#f5f5f5">
                    <th style="text-align:left">${t.ticketType}</th>
                    <th style="text-align:right">${t.price}</th>
                    <th style="text-align:center">${t.quantity}</th>
                    <th style="text-align:right">${t.subtotal}</th>
                </tr>`;

        tiposBoletosArray.forEach(tipo => {
            let subtotal = Number(tipo.precio) * Number(tipo.cantidad);
            tablaBoletos += `
                <tr>
                    <td style="text-align:left">${tipo.nombre}</td>
                    <td style="text-align:right">$${Number(tipo.precio).toFixed(2)}</td>
                    <td style="text-align:center">${Number(tipo.cantidad)}</td>
                    <td style="text-align:right">$${Number(subtotal).toFixed(2)}</td>
                </tr>`;
        });

        tablaBoletos += `
            <tr>
                <td colspan="2"></td>
                <td style="text-align:center; font-weight:bold">${t.total}</td>
                <td style="text-align:right; font-weight:bold">$${Number(total).toFixed(2)}</td>
            </tr>
            </table>`;

        const emailData = {
            nombre: nombre_cliente,
            password: null,
            fecha: fecha_ida_original,
            horario: horaCompleta,
            boletos: no_boletos,
            tablaBoletos,
            idReservacion: id_reservacion,
            total,
            ubicacionUrl: "https://maps.app.goo.gl/9R17eVrZeTkxyNt88"
        };


        const emailHtml = getEmailTemplate(lang)(emailData);

        // Enviar correos
        await mailer.sendMail({
            from: process.env.MAIL,
            to: process.env.MAIL,
            subject: lang === 'en'
                ? "Purchase Confirmation - Casa Kahlo Museum!"
                : lang === 'fr'
                    ? "Confirmation d'achat - Musée Casa Kahlo!"
                    : "¡Confirmación de compra - Museo Casa Kahlo!",
            html: emailHtml,
            attachments: [{ filename: 'qr.png', content: qrCodeBuffer, cid: 'qrImage' }]
        });

        // Enviar correo al cliente con el idioma correspondiente
        await mailer.sendMail({
            from: process.env.MAIL,
            to: correo,
            subject: lang === 'en'
                ? "Purchase Confirmation - Casa Kahlo Museum!"
                : lang === 'fr'
                    ? "Confirmation d'achat - Musée Casa Kahlo!"
                    : "¡Confirmación de compra - Museo Casa Kahlo!",
            html: emailHtml,
            attachments: [{ filename: 'qr.png', content: qrCodeBuffer, cid: 'qrImage' }]
        });

        console.log(`✅ Venta procesada exitosamente: ${id_reservacion}, tourId: ${viajeTourId}`);
    } catch (error) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        console.error('❌ Error procesando pago en webhook:', error);
    } finally {
        if (connection) connection.release();
    }
};

// Ruta de prueba para handleSuccessfulPayment_NEW
app.get('/test-payment', async (req, res) => {
    try {
        const testSession = {
            id: 'test_session_123',
            metadata: {
                no_boletos: 3,
                tipos_boletos: JSON.stringify({ tipoA: 1, tipoB: 2, tipoC: 0 }),
                nombre_cliente: 'Alex Flores',
                cliente_id: 26,
                correo: 'alex@agencianuba.com',
                tourId: 24,
                total: '400.00',
                fecha_ida: '2025-12-15',
                horaCompleta: '15:00:00'
            }
        };

        await handleSuccessfulPayment_NEW(testSession);
        res.status(200).json({
            success: true,
            message: 'Pago de prueba procesado exitosamente'
        });
    } catch (error) {
        console.error('Error en el endpoint de prueba:', error);
        res.status(500).json({
            success: false,
            message: 'Error procesando pago de prueba',
            error: error.message
        });
    }
});

const handleFailedPayment = async (session) => {
    let fecha = getFecha();
    let connection;

    try {
        const metadata = session.metadata || {};
        let fecha_ida_original = metadata.fecha_ida || metadata.fecha || '';
        let horaCompleta = normalizarHora(metadata.horaCompleta || metadata.hora || '');

        connection = await db.pool.getConnection();
        await connection.beginTransaction();

        let [rows] = await connection.query('SELECT * FROM venta WHERE session_id = ?', [session.id]);

        if (rows.length === 0 && metadata.ventaId) {
            [rows] = await connection.query('SELECT * FROM venta WHERE id = ?', [metadata.ventaId]);
        }

        if (rows.length === 0) {
            console.log('No se encontró la venta');
            await connection.rollback();
            connection.release();
            return;
        }

        const venta = rows[0];
        const id_reservacion = venta.id_reservacion;
        const idVenta = venta.id;
        const viajeTourId = venta.viajeTour_id;
        const boletos_devueltos = venta.boletos_devueltos;
        const nombre_cliente = metadata.nombre_cliente || metadata.nombre || venta.nombre_cliente;
        const correo = metadata.correo || venta.correo;
        const total = Number.isFinite(Number(metadata.total)) ? Number(metadata.total) : Number(venta.total || 0);
        const no_boletos = metadata.no_boletos || venta.no_boletos;
        const fechaHoraVenta = separarFechaHora(venta.fecha_comprada);
        const { esEventoEspecial, horario } = await getEventoEspecialHorario(connection, venta);

        if (boletos_devueltos === 1) {
            console.log('Boletos ya devueltos');
            await connection.rollback();
            connection.release();
            return;
        }

        await connection.query(
            'UPDATE venta SET boletos_devueltos = 1, status_traspaso = 99, updated_at = ? WHERE id = ?',
            [fecha, idVenta]
        );

        const boletos = Number(no_boletos) || 0;
        await connection.query(
            'UPDATE viajeTour SET lugares_disp = lugares_disp + ?, updated_at = ? WHERE id = ?',
            [boletos, fecha, viajeTourId]
        );

        if (esEventoEspecial) {
            await connection.query(
                'UPDATE eventos_especiales_horarios SET cupo_disponible = cupo_disponible + ?, updated_at = ? WHERE id = ?',
                [boletos, fecha, horario.id]
            );
        }

        await connection.commit();
        connection.release();

        // =====================
        // Enviar correos fuera de la transacción
        // =====================
        const emailHtml = `
            <h1>Pago fallido</h1>
            <p>El pago de la reservación ${id_reservacion} ha fallado.</p>
            <p>Nombre: ${nombre_cliente}</p>
            <p>Correo: ${correo}</p>
            <p>Fecha: ${fecha_ida_original}</p>
            <p>Horario: ${horaCompleta}</p>
            <p>Boletos: ${no_boletos}</p>
            <p>Total: ${total}</p>
        `;

        await mailer.sendMail({
            from: process.env.MAIL,
            to: process.env.MAIL,
            subject: "¡Pago fallido - Museo Casa Kahlo!",
            html: emailHtml
        });

        await mailer.sendMail({
            from: process.env.MAIL,
            to: correo,
            subject: "¡Pago fallido - Museo Casa Kahlo!",
            html: emailHtml
        });

        console.log(`⚠️ Pago fallido procesado correctamente: ${id_reservacion}`);
    } catch (error) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        console.error('❌ Error procesando pago en webhook:', error);
    } finally {
        if (connection) connection.release();
    }
};

const handleWalletTopup = async (session) => {

    const customerId = session.metadata.customer_id;
    const amount = parseFloat(session.metadata.amount_mxn);
    const sessionId = session.id;

    // 🔒 IDEMPOTENCIA
    const [existing] = await db.pool.query(
        'SELECT id FROM movimientos WHERE stripe_session_id = ?',
        [sessionId]
    );

    if (existing.length > 0) {
        console.log('⚠️ Recarga ya procesada:', sessionId);
        return;
    }

    await db.pool.query('START TRANSACTION');

    try {

        const [userRows] = await db.pool.query(
            'SELECT saldo FROM usuario WHERE id = ? FOR UPDATE',
            [customerId]
        );

        if (userRows.length === 0) {
            throw new Error('Usuario no encontrado');
        }

        const saldoAnterior = parseFloat(userRows[0].saldo);
        const saldoNuevo = saldoAnterior + amount;

        await db.pool.query(
            'UPDATE usuario SET saldo = ? WHERE id = ?',
            [saldoNuevo, customerId]
        );

        await db.pool.query(`
      INSERT INTO movimientos (
        usuario_id,
        tipo_movimiento,
        monto,
        saldo_anterior,
        saldo_nuevo,
        descripcion,
        referencia,
        stripe_session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
            customerId,
            'recarga',
            amount,
            saldoAnterior,
            saldoNuevo,
            'Recarga de saldo via Stripe',
            `STRIPE-${sessionId.slice(-8)}`,
            sessionId
        ]);

        await db.pool.query('COMMIT');

        console.log('✅ Recarga aplicada correctamente:', sessionId);

        // Obtener información completa del cliente para el correo
        const [clientInfo] = await db.pool.query(
            'SELECT nombres, apellidos, correo FROM usuario WHERE id = ?',
            [customerId]
        );

        if (clientInfo.length > 0) {
            const client = clientInfo[0];
            const nombreCompleto = `${client.nombres} ${client.apellidos}`;

            // Generar HTML del correo de recarga
            const emailHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8" />
                    <title>Confirmación de Recarga - Museo Casa Kahlo</title>
                </head>
                <body style="margin:0; padding:0; background-color:#FFFFFF; font-family: Arial, sans-serif;">
                    <table width="600" cellpadding="0" cellspacing="0" border="0" style="margin:auto; background-color: #FFFFFF;">
                        <tr>
                            <td align="center" style="padding: 20px 0;">
                                <h1 style="color: #a01e24; margin: 0;">¡Recarga Exitosa!</h1>
                                <h2 style="color: #1D1A14; margin: 10px 0;">Museo Casa Kahlo</h2>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 20px 40px;">
                                <p style="font-size: 16px; color: #1D1A14; line-height: 1.5;">
                                    Estimado/a <strong>${nombreCompleto}</strong>,
                                </p>
                                <p style="font-size: 16px; color: #1D1A14; line-height: 1.5;">
                                    Tu recarga se ha procesado exitosamente. A continuación los detalles:
                                </p>
                                
                                <table width="100%" cellpadding="10" cellspacing="0" border="1" style="border-collapse: collapse; margin: 20px 0;">
                                    <tr style="background-color: #f5f5f5;">
                                        <th style="text-align: left; padding: 10px;">Concepto</th>
                                        <th style="text-align: right; padding: 10px;">Monto</th>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px;">Saldo Anterior</td>
                                        <td style="padding: 10px; text-align: right;">$${saldoAnterior.toFixed(2)}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px;">Recarga</td>
                                        <td style="padding: 10px; text-align: right; color: #28a745;">+$${amount.toFixed(2)}</td>
                                    </tr>
                                    <tr style="background-color: #f9f9f9; font-weight: bold;">
                                        <td style="padding: 10px;">Saldo Nuevo</td>
                                        <td style="padding: 10px; text-align: right;">$${saldoNuevo.toFixed(2)}</td>
                                    </tr>
                                </table>
                                
                                <p style="font-size: 14px; color: #666; margin-top: 20px;">
                                    <strong>ID de Transacción:</strong> ${sessionId}
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 20px 40px; text-align: center; border-top: 1px solid #eee;">
                                <p style="font-size: 12px; color: #666; margin: 0;">
                                    Este es un correo automático. Por favor no responder.
                                </p>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
            `;

            // Enviar correo al cliente
            let message = {
                from: process.env.MAIL,
                to: client.correo,
                subject: "¡Recarga Exitosa - Museo Casa Kahlo!",
                text: "",
                html: emailHtml
            };

            const info = await mailer.sendMail(message);
            console.log('📧 Email de recarga enviado a:', client.correo, 'ID:', info.messageId);
        }

    } catch (error) {
        await db.pool.query('ROLLBACK');
        console.error('❌ Error en recarga:', error);
        throw error;
    }

}

const handleWalletTopupFailed = async (session) => {
    const customerId = session.metadata.customer_id;
    const amount = parseFloat(session.metadata.amount_mxn);
    const sessionId = session.id;

    try {
        // Obtener información del cliente
        const [clientInfo] = await db.pool.query(
            'SELECT nombres, apellidos, correo FROM usuario WHERE id = ?',
            [customerId]
        );

        if (clientInfo.length > 0) {
            const client = clientInfo[0];
            const nombreCompleto = `${client.nombres} ${client.apellidos}`;

            // Generar HTML del correo de fallo
            const emailHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8" />
                    <title>Recarga Fallida - Museo Casa Kahlo</title>
                </head>
                <body style="margin:0; padding:0; background-color:#FFFFFF; font-family: Arial, sans-serif;">
                    <table width="600" cellpadding="0" cellspacing="0" border="0" style="margin:auto; background-color: #FFFFFF;">
                        <tr>
                            <td align="center" style="padding: 20px 0;">
                                <h1 style="color: #dc3545; margin: 0;">Recarga Fallida</h1>
                                <h2 style="color: #1D1A14; margin: 10px 0;">Museo Casa Kahlo</h2>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 20px 40px;">
                                <p style="font-size: 16px; color: #1D1A14; line-height: 1.5;">
                                    Estimado/a <strong>${nombreCompleto}</strong>,
                                </p>
                                <p style="font-size: 16px; color: #1D1A14; line-height: 1.5;">
                                    Lamentamos informarte que tu recarga no pudo ser procesada. A continuación los detalles:
                                </p>
                                
                                <table width="100%" cellpadding="10" cellspacing="0" border="1" style="border-collapse: collapse; margin: 20px 0;">
                                    <tr style="background-color: #f5f5f5;">
                                        <th style="text-align: left; padding: 10px;">Concepto</th>
                                        <th style="text-align: right; padding: 10px;">Monto</th>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px;">Monto Intentado</td>
                                        <td style="padding: 10px; text-align: right;">$${amount.toFixed(2)}</td>
                                    </tr>
                                    <tr style="background-color: #f9f9f9;">
                                        <td style="padding: 10px;">Estado</td>
                                        <td style="padding: 10px; text-align: right; color: #dc3545; font-weight: bold;">Fallido</td>
                                    </tr>
                                </table>
                                
                                <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px; padding: 15px; margin: 20px 0;">
                                    <p style="margin: 0; color: #856404; font-size: 14px;">
                                        <strong>Posibles causas:</strong><br>
                                        • Fondos insuficientes en tu tarjeta<br>
                                        • Tarjeta rechazada por el banco<br>
                                        • Problemas de conexión con Stripe<br>
                                        • Información de pago incorrecta
                                    </p>
                                </div>
                                
                                <p style="font-size: 14px; color: #666; margin-top: 20px;">
                                    <strong>ID de Transacción:</strong> ${sessionId}
                                </p>
                                
                                <p style="font-size: 16px; color: #1D1A14; line-height: 1.5; margin-top: 20px;">
                                    Por favor, intenta nuevamente o contacta a tu banco si el problema persiste.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 20px 40px; text-align: center; border-top: 1px solid #eee;">
                                <p style="font-size: 12px; color: #666; margin: 0;">
                                    Este es un correo automático. Por favor no responder.
                                </p>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
            `;

            // Enviar correo al cliente
            let message = {
                from: process.env.MAIL,
                to: client.correo,
                subject: "Recarga Fallida - Museo Casa Kahlo",
                text: "",
                html: emailHtml
            };

            const info = await mailer.sendMail(message);
            console.log('📧 Email de fallo de recarga enviado a:', client.correo, 'ID:', info.messageId);
        }

        console.log('❌ Recarga fallida notificada:', sessionId);

    } catch (error) {
        console.error('❌ Error notificando fallo de recarga:', error);
    }
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

        //validamos que no sea martes
        await validarDiaPermitido(fecha, tourId);

        let hora = req.params.hora;

        // verificamos que el horario no esté bloqueado
        const estaBloqueado = await verificarHorarioBloqueado(fecha, hora, tourId);
        if (estaBloqueado) {
            return res.status(200).json({ msg: "Lugares no disponibles", error: false, disponible: false, sinReserva: false, lugares_disp: 0 });
        }

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
        res.status(500).json({ msg: error.message || 'Error obteniendo horarios', error: true, details: error })
    }
})

app.get('/horarios/:tourid/fecha/:fecha/boletos/:boletos', async (req, res) => {
    try {
        let fecha = req.params.fecha;
        let tourId = req.params.tourid;

        //verificamos que no sea martes
        await validarDiaPermitido(fecha, tourId);

        let boletos = parseInt(req.params.boletos);

        // Recibir y parsear tipos_boletos de los query params
        let tiposBoletos = {};
        if (req.query.tipos_boletos) {
            try {
                tiposBoletos = JSON.parse(req.query.tipos_boletos);
                if (typeof tiposBoletos !== 'object' || tiposBoletos === null || Array.isArray(tiposBoletos)) {
                    tiposBoletos = {};
                }
            } catch (error) {
                console.error('Error parseando tipos_boletos:', error);
                tiposBoletos = {};
            }

            // Validar que si hay tipoD, no haya otros tipos de boletos
            if (tiposBoletos.tipoD > 0) {
                const otrosTipos = Object.keys(tiposBoletos).filter(tipo => tipo !== 'tipoD' && tiposBoletos[tipo] > 0);
                if (otrosTipos.length > 0) {
                    return res.status(400).json({
                        error: true,
                        msg: 'Si selecciona boletos tipoD, no puede seleccionar otros tipos de boletos'
                    });
                }
            }
        }
        // Si no se recibe tipos_boletos, continuar con la ejecución normal

        // Debug logs para depuración
        // console.log('[HORARIOS] fecha:', fecha, 'tourId:', tourId, 'boletos:', boletos, 'tipos_boletos:', tiposBoletos);

        //vemos que dia selecciono 
        let diaSeleccionado = weekDay(fecha);
        //console.log('[HORARIOS] diaSeleccionado:', diaSeleccionado);

        // Verificar si es el último miércoles del mes para aplicar regla especial
        let esUltimoMiercoles = esUltimoMiercolesDelMes(fecha);
        //console.log('[HORARIOS] esUltimoMiercoles:', esUltimoMiercoles);

        // Obtener mes (0 = enero, 11 = diciembre)
        let mes = new Date(fecha).getMonth();
        // Enero => status 1, cualquier otro => 2
        let status = mes === 0 ? 1 : 2;

        //buscamos los horarios del tour
        let query = `SELECT * FROM fecha WHERE tour_id=${tourId} AND dia = '${diaSeleccionado}' AND status = ${status} ORDER BY dia, hora_salida ASC`;

        //console.log('[HORARIOS] query horarios:', query);
        let horariosResult = await db.pool.query(query);
        let horarios = horariosResult[0];
        //console.log('[HORARIOS] horarios encontrados:', horarios);

        // Si es el último miércoles del mes Y el tipo de boleto es tipoD, filtrar para mostrar solo horario de 18:00
        if (esUltimoMiercoles && tiposBoletos.tipoD > 0) {
            const horariosFiltrados = horarios.filter(h => {
                const hora = String(h.hora_salida).substring(0, 5); // "HH:MM"
                return hora === '18:00';
            });

            // Si no existe el horario de 18:00, agregarlo manualmente
            if (horariosFiltrados.length === 0) {
                horarios = [{
                    id: null,
                    tour_id: parseInt(tourId),
                    dia: diaSeleccionado,
                    hora_salida: '18:00:00',
                    status: status,
                    applyForOperator: 0,
                    idioma: 'Noche Museos'

                }];
            } else {
                horarios = horariosFiltrados;
            }
        } else {
            horarios = horarios.filter((horario) => debeMostrarHorarioPorFecha(horario, fecha));
        }



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

            let horaCampo = (horario.hora_salida).split(':').slice(0, 2).join(':');

            if (!horaCampo || typeof horaCampo !== 'string') {
                // Si no hay hora válida, ignorar este horario
                return {
                    ...horario,
                    disponible: false,
                    lugares_disp: 'sin_hora'
                };
            }

            // Verificar si el horario está bloqueado
            const estaBloqueado = await verificarHorarioBloqueado(fecha, horaCampo, tourId);
            if (estaBloqueado) {
                return {
                    ...horario,
                    disponible: false,
                    lugares_disp: 0
                };
            }

            if (parseInt(horario.max_personas, 10) === 0) {
                return {
                    ...horario,
                    disponible: false,
                    lugares_disp: 0
                };
            }

            //let hora = horaCampo.split(":")[0];
            //let queryViaje = `SELECT * FROM viajeTour WHERE CAST(fecha_ida AS DATE) = '${fecha}' AND HOUR(CAST(fecha_ida AS TIME)) = '${hora}' AND tour_id = ${tourId}`;
            let queryViaje = `SELECT * FROM viajeTour WHERE CAST(fecha_ida AS DATE) = '${fecha}' AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = '${horaCampo}' AND tour_id = ${tourId}`;

            //console.log(queryViaje);
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
                // No hay viajeTour: priorizar capacidad configurada en fecha
                // horario puede venir con campo max_personas (NULL = heredar, 0 = cerrado)
                if (aplicaCapacidadFecha(horario, fecha)) {
                    if (parseInt(horario.max_personas, 10) === 0) {
                        // horario cerrado
                        lugares_disp = 0;
                        disponible = false;
                    } else {
                        lugares_disp = parseInt(horario.max_personas, 10);
                        disponible = lugares_disp >= boletos;
                    }
                } else {
                    // No hay capacidad definida en fecha: aplicar reglas anteriores
                    if (esUltimoMiercoles && horaCampo === '18:00') {
                        lugares_disp = 51;
                        disponible = 51 >= boletos;
                    } else {
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
        return res.status(error.status || 500).json({
            error: true,
            msg: error.message || 'Error obteniendo horarios'
        });
    }
})


app.post('/crear', async (req, res) => {
    try {
        let { no_boletos, tipos_boletos, pagado, nombre_cliente, cliente_id, correo, viajeTourId, tourId, fecha_ida, horaCompleta, total } = req.body

        //validamos que no sea martes
        await validarDiaPermitido(fecha_ida, tourId);

        // verificamos que el horario no esté bloqueado
        const estaBloqueado = await verificarHorarioBloqueado(fecha_ida, horaCompleta, tourId);
        if (estaBloqueado) {
            return res.status(403).json({
                error: true,
                msg: `El horario ${fecha_ida} ${horaCompleta} está bloqueado y no está disponible`
            });
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
        res.status(400).json({ error: true, msg: error.message || 'Error obteniendo los datos', details: error })

    }
})

app.post('/crear-admin', async (req, res) => {
    try {
        let { no_boletos, tipos_boletos, pagado, nombre_cliente, apellidos_cliente, correo, telefono, viajeTourId, tourId, fecha_ida, horaCompleta, total, metodo_pago } = req.body

        // validamos que no sea martes
        await validarDiaPermitido(fecha_ida, tourId);

        // verificamos que el horario no esté bloqueado
        const estaBloqueado = await verificarHorarioBloqueado(fecha_ida, horaCompleta, tourId);
        if (estaBloqueado) {
            return res.status(403).json({
                error: true,
                msg: `El horario ${fecha_ida} ${horaCompleta} está bloqueado y no está disponible`
            });
        }

        if (!correo) {
            return res.status(400).json({
                error: true,
                msg: "El correo es obligatorio"
            });
        }

        // Expresión regular simple para email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(correo)) {
            return res.status(400).json({
                error: true,
                msg: "El formato del correo no es válido"
            });
        }

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
        let tiposBoletos = {};
        try {
            tiposBoletos = JSON.parse(tipos_boletos);
            if (typeof tiposBoletos !== 'object' || tiposBoletos === null || Array.isArray(tiposBoletos)) {
                console.error('tipos_boletos no es un objeto válido:', tiposBoletos);
                tiposBoletos = {};
            }
        } catch (error) {
            console.error('Error parseando tipos_boletos:', error);
            tiposBoletos = {};
        }

        //info tour para calcular fecha de regreso
        // Si hay tipoD, usar valores especiales
        let duracion, max_pasajeros;
        if (tiposBoletos.tipoD > 0) {
            duracion = 13;
            max_pasajeros = 51;
        } else {
            const { fechaCapacity } = await obtenerCapacidadFechaVigente(db.pool, tourId, fecha_ida, horaCompleta);

            query = `SELECT * FROM tour WHERE id = ${tourId} `;
            let tour = await db.pool.query(query);
            tour = tour[0][0];
            duracion = tour.duracion;
            if (fechaCapacity !== null && typeof fechaCapacity !== 'undefined') {
                max_pasajeros = parseInt(fechaCapacity, 10);
            } else {
                max_pasajeros = tour.max_pasajeros;
            }
        }
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
                        (id_reservacion, no_boletos, tipos_boletos, total, pagado, fecha_compra, comision, status_traspaso, fecha_comprada, created_at, updated_at, nombre_cliente, cliente_id, correo, viajeTour_id, metodo_pago) 
                        VALUES 
                        ('V', '${no_boletos}', '${tipos_boletos}', '${total}', '${pagado}', '${fecha}', '0.0', '0', '${fecha_ida}', '${fecha}', '${fecha}', '${nombre_completo}', '${cliente_id}', '${correo}', '${viajeTourId}', '${metodo_pago}')`;

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
        tiposBoletos = {};

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
        const precios = await getPreciosPorContexto(CONTEXTO_PRECIO_MUSEO, tiposBoletos, fecha_ida, viajeTourId);

        // 
        const nombres = {
            tipoA: "Entrada General",
            tipoB: "Ciudadano Mexicano",
            tipoC: "Estudiante",
            tipoD: "Noche de Museos",
            tipoE: "Adulto Mayor",
            tipoF: "Infancias",
            tipoG: "Tour Operador",
            tipoH: "Capacidades Diferentes"
        };

        // 
        let tiposBoletosArray = mapTiposBoletosConPrecios(tiposBoletos, nombres, precios);

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

        try {
            const info = await mailer.sendMail(message);
            console.log('Email enviado al admin:', info);
        } catch (e) {
            console.error("Falló envio de correo al admin:", e.message);
        }

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

        try {
            const info2 = await mailer.sendMail(message);
            console.log('Email enviado al cliente:', info2);
        } catch (e) {
            console.error("Falló envio de correo al cliente:", e.message);
        }

        //////////////////////////////////////////// fin correo /////////////////////////////////////


        res.status(200).json({ msg: "Compra exitosa", id_reservacion: id_reservacion, viajeTourId: viajeTourId, clienteExiste: clienteExiste, error: false });


    } catch (error) {
        console.log(error);
        res.status(400).json({ error: true, msg: error.message || 'Error obteniendo los datos', details: error })
    }
});

app.post('/crear-touroperador', async (req, res) => {
    try {
        let { cart_items, nombre_cliente, cliente_id, correo, tourId, total, payment_method } = req.body;

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
        if (parseFloat(client.saldo) < parseFloat(total)) {
            return res.status(400).json({
                error: true,
                msg: "Saldo insuficiente",
                details: `Saldo actual: $${client.saldo}, Total requerido: $${total}`
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
                let { fecha_ida, horaCompleta, boletos, tipos_boletos, subtotal } = item;

                // Obtener información del tour para duración y max_pasajeros
                let duracion, max_pasajeros;
                let fechaCapacity = null;
                let parsedTiposBoletos = {};
                try {
                    parsedTiposBoletos = JSON.parse(tipos_boletos);
                } catch (error) {
                    parsedTiposBoletos = {};
                }

                query = `SELECT * FROM tour WHERE id = ${tourId}`;
                let tourResult = await connection.query(query);
                if (!tourResult[0].length) {
                    await connection.rollback();
                    return res.status(400).json({ error: true, msg: "Tour no encontrado" });
                }
                const tour = tourResult[0][0];

                if (parsedTiposBoletos.tipoD > 0) {
                    duracion = 13;
                    max_pasajeros = 51;
                } else {

                    const capacidadFecha = await obtenerCapacidadFechaVigente(connection, tourId, fecha_ida, horaCompleta);
                    fechaCapacity = capacidadFecha.fechaCapacity;
                    duracion = tour.duracion;
                    if (fechaCapacity !== null && typeof fechaCapacity !== 'undefined') {
                        max_pasajeros = parseInt(fechaCapacity, 10);
                    } else {
                        max_pasajeros = tour.max_pasajeros;
                    }

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
                    let guia = tour.guias;
                    guia = JSON.parse(guia);;

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

                // Generar session_id único similar a Stripe para esta reservación
                const sessionId = 'nuba_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();

                // Insertar un registro en venta por cada boleto
                for (let i = 0; i < parseInt(boletos); i++) {
                    // Crear venta para un boleto
                    query = `INSERT INTO venta 
                             (id_reservacion, no_boletos, tipos_boletos, total, pagado, fecha_compra, comision, status_traspaso, fecha_comprada, created_at, updated_at, nombre_cliente, cliente_id, correo, viajeTour_id, session_id) 
                             VALUES 
                             ('V', '1', '${tipos_boletos}', '${subtotal / parseInt(boletos)}', '1', '${fecha}', '0.0', '0', '${fecha_ida_formateada}', '${fecha}', '${fecha}', '${nombre_cliente}', '${cliente_id}', '${correo}', '${viajeTourId}', '${sessionId}')`;

                    let ventaResult = await connection.query(query);
                    ventaResult = ventaResult[0];

                    let id_reservacion = ventaResult.insertId + 'V' + helperName(client.nombres.split(' ')) + helperName(client.apellidos.split(' '));

                    // Actualizar id_reservacion
                    query = `UPDATE venta SET id_reservacion = '${id_reservacion}' WHERE id = ${ventaResult.insertId}`;
                    await connection.query(query);

                    // Actualizar saldo del cliente por este boleto
                    const saldoAnterior = parseFloat(client.saldo);
                    const saldoNuevo = saldoAnterior - parseFloat(subtotal / parseInt(boletos));

                    query = `UPDATE usuario SET saldo = '${saldoNuevo}' WHERE id = ${cliente_id}`;
                    await connection.query(query);

                    // Actualizar saldo del cliente para la siguiente iteración
                    client.saldo = saldoNuevo;

                    // Registrar movimiento de compra en tabla movimientos
                    const movimientoDescripcion = `Compra de reservación ${id_reservacion} - 1 boleto para ${fecha_ida} ${horaCompleta}`;

                    query = `INSERT INTO movimientos 
                             (usuario_id, monto, tipo_movimiento, descripcion, fecha_creacion, saldo_anterior, saldo_nuevo, referencia) 
                             VALUES 
                             ('${cliente_id}', '${subtotal / parseInt(boletos)}', 'compra', '${movimientoDescripcion}', '${fecha}', '${saldoAnterior}', '${saldoNuevo}', '${sessionId}')`;
                    await connection.query(query);

                    reservaciones.push({
                        id_reservacion,
                        fecha_ida,
                        horaCompleta,
                        boletos: 1,
                        viajeTourId,
                        subtotal: subtotal / parseInt(boletos)
                    });
                }

                totalBoletosProcesados += parseInt(boletos);
            }

            // Confirmar transacción
            await connection.commit();

            // Preparar datos para el correo con descripción de las compras
            const reservacionesConSubtotal = reservaciones.map((reservacion) => ({
                ...reservacion,
                subtotal: reservacion.subtotal || 0
            }));

            const emailData = {
                nombre_cliente: nombre_cliente,
                reservaciones: reservacionesConSubtotal,
                total_boletos: totalBoletosProcesados,
                total_descontado: total,
                saldo_restante: parseFloat(client.saldo)
            };

            // Enviar correo de confirmación con descripción de las compras
            const emailResult = await enviarCorreoTourOperador(emailData, correo);
            if (!emailResult.success) {
                console.error("Falló envío de correo:", emailResult.error);
            }


            res.status(200).json({
                msg: "Reservas creadas exitosamente",
                reservaciones: reservaciones,
                total_boletos: totalBoletosProcesados,
                total_descontado: total,
                saldo_restante: parseFloat(client.saldo),
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

app.post('/crear-admin-cortesia', async (req, res) => {
    try {
        let { no_boletos, tipos_boletos, pagado, nombre_cliente, apellidos_cliente, correo, telefono, viajeTourId, tourId, fecha_ida, horaCompleta, total, metodo_pago } = req.body

        // validamos que no sea martes
        await validarDiaPermitido(fecha_ida, tourId);

        // verificamos que el horario no esté bloqueado
        const estaBloqueado = await verificarHorarioBloqueado(fecha_ida, horaCompleta, tourId);
        if (estaBloqueado) {
            return res.status(403).json({
                error: true,
                msg: `El horario ${fecha_ida} ${horaCompleta} está bloqueado y no está disponible`
            });
        }

        //caracterizticas del boleto de cortesia
        pagado = 1;
        status_traspaso = 98;
        total = 0;

        if (!correo) {
            return res.status(400).json({
                error: true,
                msg: "El correo es obligatorio"
            });
        }

        // Expresión regular simple para email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(correo)) {
            return res.status(400).json({
                error: true,
                msg: "El formato del correo no es válido"
            });
        }

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

        let tiposBoletos = {};
        try {
            tiposBoletos = JSON.parse(tipos_boletos);
            if (typeof tiposBoletos !== 'object' || tiposBoletos === null || Array.isArray(tiposBoletos)) {
                console.error('tipos_boletos no es un objeto válido:', tiposBoletos);
                tiposBoletos = {};
            }
        } catch (error) {
            console.error('Error parseando tipos_boletos:', error);
            tiposBoletos = {};
        }

        //info tour para calcular fecha de regreso
        // Si hay tipoD, usar valores especiales
        let duracion, max_pasajeros;
        if (tiposBoletos.tipoD > 0) {
            duracion = 13;
            max_pasajeros = 51;
        } else {

            const { fechaCapacity } = await obtenerCapacidadFechaVigente(db.pool, tourId, fecha_ida, horaCompleta);

            query = `SELECT * FROM tour WHERE id = ${tourId} `;
            let tour = await db.pool.query(query);
            tour = tour[0][0];
            duracion = tour.duracion;
            if (fechaCapacity !== null && typeof fechaCapacity !== 'undefined') {
                max_pasajeros = parseInt(fechaCapacity, 10);
            } else {
                max_pasajeros = tour.max_pasajeros;
            }
        }
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
                        (id_reservacion, no_boletos, tipos_boletos, total, pagado, fecha_compra, comision, status_traspaso, fecha_comprada, created_at, updated_at, nombre_cliente, cliente_id, correo, viajeTour_id, metodo_pago) 
                        VALUES 
                        ('V', '${no_boletos}', '${tipos_boletos}', '${total}', '${pagado}', '${fecha}', '0.0', '${status_traspaso}', '${fecha_ida}', '${fecha}', '${fecha}', '${nombre_completo}', '${cliente_id}', '${correo}', '${viajeTourId}', '${metodo_pago}')`;

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
        tiposBoletos = {};

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
        const precios = await getPreciosPorContexto(CONTEXTO_PRECIO_MUSEO, tiposBoletos, fecha_ida, viajeTourId);

        // 
        const nombres = {
            tipoA: "Entrada General",
            tipoB: "Ciudadano Mexicano",
            tipoC: "Estudiante",
            tipoD: "Noche de Museos",
            tipoE: "Adulto Mayor",
            tipoF: "Infancias",
            tipoG: "Tour Operador",
            tipoH: "Capacidades Diferentes"
        };

        // 
        let tiposBoletosArray = mapTiposBoletosConPrecios(tiposBoletos, nombres, precios);

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


        try {
            const info = await mailer.sendMail(message);
            console.log('Email enviado al admin:', info);
        } catch (e) {
            console.error("Falló envio de correo al admin:", e.message);
        }


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

        try {
            const info2 = await mailer.sendMail(message);
            console.log('Email enviado al cliente:', info2);
        } catch (e) {
            console.error("Falló envio de correo al cliente:", e.message);
        }


        //////////////////////////////////////////// fin correo /////////////////////////////////////



        res.status(200).json({ msg: "Compra exitosa", id_reservacion: id_reservacion, viajeTourId: viajeTourId, clienteExiste: clienteExiste, error: false });

    } catch (error) {
        console.log(error);
        res.status(400).json({ error: true, msg: error.message || 'Error obteniendo los datos', details: error })
    }
})

/////////////////////////////////////////////////////////// INICIO STRIPE ///////////////////////////////////////////////////////////
app.post('/stripe/create-balance-session', async (req, res) => {
    try {
        const { amount, customerEmail, successUrl, cancelUrl, metadata } = req.body;

        // Validar que el monto sea válido
        if (!amount || amount <= 0) {
            return res.status(400).json({
                error: true,
                msg: 'El monto debe ser mayor a 0'
            });
        }

        // Validar monto máximo
        if (amount > 50000) {
            return res.status(400).json({
                error: true,
                msg: 'El monto máximo permitido es $50,000.00 MXN'
            });
        }

        // Convertir el monto a centavos (Stripe trabaja en centavos)
        const amountInCents = Math.round(amount * 100);

        // Crear line item para la carga de saldo
        const lineItems = [{
            price_data: {
                currency: 'mxn',
                product_data: {
                    name: 'Recarga de Saldo',
                    description: `Recarga de saldo por $${amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`,
                },
                unit_amount: amountInCents,
            },
            quantity: 1,
        }];

        // Crea la sesión en la cuenta conectada
        const session = await stripe.checkout.sessions.create(
            {
                payment_method_types: ['card'],
                line_items: lineItems,
                mode: 'payment',
                success_url: successUrl,
                cancel_url: cancelUrl,
                customer_email: customerEmail,
                metadata: {
                    ...metadata,
                    balance_load: 'true',
                    amount_cents: amountInCents.toString(),
                    amount_mxn: amount.toString()
                },
                billing_address_collection: 'auto',
                payment_intent_data: {
                    metadata: {
                        ...metadata,
                        balance_load: 'true',
                        amount_cents: amountInCents.toString(),
                        amount_mxn: amount.toString()
                    }
                }
            },
            {
                stripeAccount: 'acct_1SAz5b3CVvaJXMYX', // Cuenta conectada del museo
            }
        );

        res.json({
            sessionId: session.id,
            url: session.url,
            error: false,
            amount: amount,
            amountInCents: amountInCents
        });

    } catch (error) {
        console.error('Error creating balance session:', error);
        res.status(400).json({
            error: true,
            msg: error.message || 'Error al crear la sesión de carga de saldo'
        });
    }
});

app.post('/stripe/create-checkout-session', async (req, res) => {
    try {
        const { lineItems, customerEmail, successUrl, cancelUrl, metadata } = req.body;

        const { no_boletos, tipos_boletos, nombre_cliente, cliente_id, correo, tourId, total } = metadata;
        let fecha_ida_original = metadata.fecha_ida;
        let horaCompleta = normalizarHora(metadata.horaCompleta);

        // Parsear tipos_boletos para verificar si hay tipoD
        let parsedTiposBoletos = {};
        try {
            parsedTiposBoletos = JSON.parse(tipos_boletos);
            if (typeof parsedTiposBoletos !== 'object' || parsedTiposBoletos === null || Array.isArray(parsedTiposBoletos)) {
                console.error('tipos_boletos no es un objeto válido:', parsedTiposBoletos);
                parsedTiposBoletos = {};
            }
        } catch (error) {
            console.error('Error parseando tipos_boletos:', error);
            parsedTiposBoletos = {};
        }

        //verificamos que no sea martes
        await validarDiaPermitido(fecha_ida_original, tourId);

        // verificamos que el horario no esté bloqueado
        const estaBloqueado = await verificarHorarioBloqueado(fecha_ida_original, horaCompleta, tourId);
        if (estaBloqueado) {
            return res.status(403).json({
                error: true,
                msg: `El horario ${fecha_ida_original} ${horaCompleta} está bloqueado y no está disponible`
            });
        }


        // 1.- Verificar disponibilidad
        const disponible = verificarDisponibilidad(no_boletos, tourId, fecha_ida_original, horaCompleta, parsedTiposBoletos);
        if (disponible == false) {
            return res.status(200).json({ error: true, msg: "Cupo no disponible" });
        }

        // 2.- Crear preventa pagado = 0, total = 0
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
        // Si hay tipoD, usar valores especiales
        let duracion, max_pasajeros;
        if (parsedTiposBoletos.tipoD > 0) {
            duracion = 13;
            max_pasajeros = 51;
        } else {

            const { fechaCapacity } = await obtenerCapacidadFechaVigente(db.pool, tourId, fecha_ida_original, horaCompleta);

            query = `SELECT * FROM tour WHERE id = ${tourId} `;
            let tour = await db.pool.query(query);
            tour = tour[0][0];
            duracion = tour.duracion;
            if (fechaCapacity !== null && typeof fechaCapacity !== 'undefined') {
                max_pasajeros = parseInt(fechaCapacity, 10);
            } else {
                max_pasajeros = tour.max_pasajeros;
            }
        }


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


        // 3.- Crea la sesión en la cuenta conectada
        const session = await stripe.checkout.sessions.create(
            {
                payment_method_types: ['card'],
                line_items: lineItems,
                mode: 'payment',
                success_url: successUrl,
                cancel_url: `${cancelUrl}?session_id={CHECKOUT_SESSION_ID}`,
                customer_email: customerEmail,
                metadata: metadata,
                expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // expira en 30 minutos
                billing_address_collection: 'auto',
            },
            {
                stripeAccount: 'acct_1SAz5b3CVvaJXMYX', // ID de la cuenta conectada osea la cuenta del museo
            }
        );

        query = `INSERT INTO venta
                          (id_reservacion, no_boletos, tipos_boletos, total, pagado, fecha_compra, comision, status_traspaso, fecha_comprada, created_at, updated_at, nombre_cliente, cliente_id, correo, viajeTour_id, session_id) 
                          VALUES 
                          ('V', '${no_boletos}', '${tipos_boletos}', '0', '0', '${fecha}', '0.0', '0', '${fecha_ida_formateada}', '${fecha}', '${fecha}', '${nombre_cliente}', '${cliente_id}', '${correo}', '${viajeTourId}', '${session.id}')`;

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

        query = `UPDATE viajeTour SET
                      lugares_disp = '${lugares_disp}'
                      WHERE id     = ${viajeTourId}`;

        await db.pool.query(query);

        query = `UPDATE venta SET
                      id_reservacion = '${id_reservacion}'
                      WHERE id       = ${result.insertId}`;

        await db.pool.query(query);


        // 4.- guardar en ventas el sessionId de stripe
        query = `UPDATE venta SET
                      session_id = '${session.id}'
                      WHERE id   = ${result.insertId}`;

        await db.pool.query(query);

        res.json({ sessionId: session.id, url: session.url, error: false });

    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(400).json({ error: true, msg: error.message });
    }
});

app.post('/stripe/create-checkout-session-operator', async (req, res) => {
    try {
        const { lineItems, customerEmail, successUrl, cancelUrl, metadata } = req.body;

        const { no_boletos, nombre_cliente, cliente_id, correo, tourId, total } = metadata;

        const tipos_boletos = JSON.stringify({
            tipoA: 1
        })
        let fecha_ida_original = metadata.fecha_ida;
        let horaCompleta = normalizarHora(metadata.horaCompleta);

        //verificamos que no sea martes
        await validarDiaPermitido(fecha_ida_original, tourId);

        // verificamos que el horario no esté bloqueado
        const estaBloqueado = await verificarHorarioBloqueado(fecha_ida_original, horaCompleta, tourId);
        if (estaBloqueado) {
            return res.status(403).json({
                error: true,
                msg: `El horario ${fecha_ida_original} ${horaCompleta} está bloqueado y no está disponible`
            });
        }

        // 1.- Verificar disponibilidad
        const disponible = verificarDisponibilidad(no_boletos, tourId, fecha_ida_original, horaCompleta);
        if (disponible == false) {
            return res.status(200).json({ error: true, msg: "Cupo no disponible" });
        }

        // 2.- Crear preventa pagado = 0, total = 0
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

        let duracion, max_pasajeros;

        const { fechaCapacity } = await obtenerCapacidadFechaVigente(db.pool, tourId, fecha_ida_original, horaCompleta);

        query = `SELECT * FROM tour WHERE id = ${tourId} `;
        let tour = await db.pool.query(query);
        tour = tour[0][0];
        duracion = tour.duracion;
        if (fechaCapacity !== null && typeof fechaCapacity !== 'undefined') {
            max_pasajeros = parseInt(fechaCapacity, 10);
        } else {
            max_pasajeros = tour.max_pasajeros;
        }


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


        // 3.- Crea la sesión en la cuenta conectada
        const session = await stripe.checkout.sessions.create(
            {
                payment_method_types: ['card'],
                line_items: lineItems,
                mode: 'payment',
                success_url: successUrl,
                cancel_url: `${cancelUrl}?session_id={CHECKOUT_SESSION_ID}`,
                customer_email: customerEmail,
                metadata: metadata,
                expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // expira en 30 minutos
                billing_address_collection: 'auto',
            },
            {
                stripeAccount: 'acct_1SAz5b3CVvaJXMYX', // ID de la cuenta conectada osea la cuenta del museo
            }
        );

        //info del tour operador
        query = `SELECT * FROM usuario WHERE id = ${cliente_id}`;
        let client = await db.pool.query(query);
        client = client[0];
        if (client.length == 0) {
            console.error("Error en la busqueda de los datos del cliente");
            return;
        }
        client = client[0];

        //actualizar los lugares disponibles
        query = `UPDATE viajeTour SET
                      lugares_disp = '${lugares_disp}'
                      WHERE id     = ${viajeTourId}`;
        await db.pool.query(query);

        //crear una venta por cada boleto
        for (let i = 1; i <= parseInt(no_boletos); i++) {
            query = `INSERT INTO venta
                          (id_reservacion, no_boletos, tipos_boletos, total, pagado, fecha_compra, comision, status_traspaso, fecha_comprada, created_at, updated_at, nombre_cliente, cliente_id, correo, viajeTour_id, session_id) 
                          VALUES 
                          ('V', '1', '${tipos_boletos}', '0', '0', '${fecha}', '0.0', '0', '${fecha_ida_formateada}', '${fecha}', '${fecha}', '${nombre_cliente}', '${cliente_id}', '${correo}', '${viajeTourId}', '${session.id}')`;

            let result = await db.pool.query(query);
            result = result[0];

            //creamos el ide de reservacion
            let id_reservacion = result.insertId + 'V' + helperName(client.nombres.split(' ')) + helperName(client.apellidos.split(' '));

            // 4.- guardar en ventas el sessionId de stripe y el id de reservacion
            query = `UPDATE venta SET
                      id_reservacion = '${id_reservacion}',
                      session_id = '${session.id}'
                      WHERE id  = ${result.insertId}`;
            await db.pool.query(query);

        }

        res.json({ sessionId: session.id, url: session.url, error: false });

    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(400).json({ error: true, msg: error.message });
    }
});

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {

    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const session = event.data.object;

    // Return a 200 response to acknowledge receipt of the event
    res.sendStatus(200);

    try {
        // Handle the event
        switch (event.type) {
            case 'checkout.session.completed':
                if (session.payment_status === 'paid') {
                    if (session.metadata) {

                        if (!session.metadata?.flow) {
                            console.log('⚠️ No hay flow en metadata:', session.id);
                            break;
                        }

                        if (session.metadata.flow === 'ticket_purchase' || session.metadata.flow === 'evento_especial') {
                            await handleSuccessfulPayment(session);
                        }

                        if (session.metadata.flow === 'wallet_topup') {
                            await handleWalletTopup(session);
                        }

                    } else {
                        console.log('');
                        console.log(' No hay metadata en checkout.session.completed');
                        console.log('');
                        console.log('Session sin metadata:', JSON.stringify(session, null, 2));
                    }
                }
                break;

            case 'checkout.session.async_payment_succeeded':
                if (session.payment_status === 'paid') {
                    if (session.metadata) {

                        if (!session.metadata?.flow) {
                            console.log('⚠️ No hay flow en metadata:', session.id);
                            break;
                        }

                        if (session.metadata.flow === 'ticket_purchase' || session.metadata.flow === 'evento_especial') {
                            await handleSuccessfulPayment(session);
                        }
                        if (session.metadata.flow === 'wallet_topup') {
                            await handleWalletTopup(session);
                        }

                    } else {
                        console.log('');
                        console.log(' No hay metadata en checkout.session.completed');
                        console.log('');
                        console.log('Session sin metadata:', JSON.stringify(session, null, 2));
                    }
                }
                break;


            /* =======================================================
                PAGOS FALLIDOS O EXPIRADOS
            ======================================================= */
            case 'checkout.session.async_payment_failed':
                if (session.metadata) {
                    if (!session.metadata?.flow) {
                        console.log('⚠️ No hay flow en metadata:', session.id);
                        break;
                    }

                    if (session.metadata.flow === 'ticket_purchase' || session.metadata.flow === 'evento_especial') {
                        handleFailedPayment(session);
                    }
                    if (session.metadata.flow === 'wallet_topup') {
                        handleWalletTopupFailed(session);
                        console.log('⚠️ Recarga fallida:', session.id);
                    }

                } else {
                    console.log('');
                    console.log(' No hay metadata en checkout.session.completed');
                    console.log('');
                    console.log('Session sin metadata:', JSON.stringify(session, null, 2));
                }

                break;


            case "checkout.session.expired":
                if (session.metadata) {
                    if (!session.metadata?.flow) {
                        console.log('⚠️ No hay flow en metadata:', session.id);
                        break;
                    }

                    if (session.metadata.flow === 'ticket_purchase' || session.metadata.flow === 'evento_especial') {
                        handleFailedPayment(session);
                    }
                    if (session.metadata.flow === 'wallet_topup') {
                        handleWalletTopupFailed(session);
                        console.log('⚠️ Recarga fallida:', session.id);
                    }

                } else {
                    console.log('');
                    console.log(' No hay metadata en checkout.session.completed');
                    console.log('');
                    console.log('Session sin metadata:', JSON.stringify(session, null, 2));
                }
                break;

            /* =======================================================
              EVENTOS DE PAYMENT INTENT (solo logging por ahora)
            ======================================================= */

            case 'payment_intent.succeeded':
                const paymentIntent_success = event.data.object;
                console.log('Payment Intent succeeded:', paymentIntent_success.id);
                console.log('PaymentIntent metadata:', paymentIntent_success.metadata);
                break;

            case 'payment_intent.payment_failed':
                const paymentIntent = event.data.object;
                console.log('Payment failed:', paymentIntent.id);
                break;

            case 'payment_intent.canceled':
                console.log("⚠️ Payment Intent canceled:", event.data.object.id);
                break;

            default:
                console.log(`Unhandled event type ${event.type}`);

        }
    } catch (error) {
        console.error('❌ Error procesando evento:', error);
    }

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

//endpoint de da detalles de un pago apartir de session_id
app.get('/stripe/session-detail/:sessionId', async (req, res) => {
    const { sessionId } = req.params;

    try {
        // 1️⃣ Obtener la sesión de checkout
        const session = await stripe.checkout.sessions.retrieve(
            sessionId,
            {
                expand: ['payment_intent'],
            },
            {
                stripeAccount: 'acct_1SAz5b3CVvaJXMYX',
            }
        );

        if (!session.payment_intent) {
            return res.status(404).json({
                ok: false,
                msg: 'La sesión no tiene PaymentIntent',
            });
        }

        const paymentIntent = session.payment_intent;

        // 2️⃣ Obtener el charge (opcional pero muy útil)
        let charge = null;
        if (paymentIntent.latest_charge) {
            charge = await stripe.charges.retrieve(
                paymentIntent.latest_charge,
                {
                    stripeAccount: 'acct_1SAz5b3CVvaJXMYX',
                }
            );
        }

        // 3️⃣ Respuesta final
        res.json({
            ok: true,
            session: {
                id: session.id,
                amount_total: session.amount_total,
                currency: session.currency,
                payment_status: session.payment_status,
                customer_details: session.customer_details,
                metadata: session.metadata,
            },
            payment_intent: {
                id: paymentIntent.id,
                status: paymentIntent.status,
                amount: paymentIntent.amount,
                payment_method: paymentIntent.payment_method,
            },
            charge,
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            error: error.message,
        });
    }
});

// Endpoint para obtener datos de venta por sessionId de Stripe
app.get('/stripe/session-old/:sessionId', async (req, res) => {
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
});

app.get('/stripe/session-operator/:sessionId', async (req, res) => {
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
            data: venta[0],
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


app.put('/checkin-old', async (req, res) => {
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

app.put('/checkin', async (req, res) => {
    try {
        const { idReservacion, tipo = "entrada" } = req.body;
        if (!idReservacion) {
            return res.status(400).json({ error: true, msg: "idReservacion es obligatorio." });
        }

        // Determinar el formato del idReservacion
        const idParts = idReservacion.split('-');
        const isNuevoFormato = idParts.length === 3;
        const baseId = idParts[0]; // Primera parte es el ID base (ej: 4ALX)
        let numeroBoleto = 1; // Valor por defecto para el formato antiguo
        let tipoBoleto = 'A'; // Valor por defecto para el formato antiguo



        // Detectar colaborador
        const esColaborador = isNuevoFormato && idParts[2].toUpperCase() === 'Z';
        if (esColaborador) {

            // obtener los numeros del inicio del idReservacion 
            const match = idReservacion.match(/^(\d+)/);

            if (!match) {
                return res.status(400).json({
                    error: true,
                    msg: "ID de colaborador inválido"
                });
            }

            const idColaborador = match[1];

            const queryColaborador = `
                SELECT id, nombres, apellidos, status
                FROM usuario
                WHERE id = ? AND status = 1
                LIMIT 1;
            `;
            const [colabResult] = await db.pool.query(queryColaborador, [idColaborador]);

            if (colabResult.length === 0) {
                return res.status(403).json({
                    error: true,
                    msg: "Colaborador no válido o inactivo"
                });
            }

            //obtener letras del idReservacion
            const letrasMatch = idReservacion.match(/^\d+([A-Za-z]+)/);
            if (!letrasMatch) {
                return res.status(400).json({
                    error: true,
                    msg: "Formato de idReservacion inválido"
                });
            }

            const letrasId = letrasMatch[1].toUpperCase(); // ej. "TUBA"

            //obtener letras de nombres y apellidos del colaborador de la BD 
            // Normalizar texto (por si hay acentos)
            const normalize = (text) =>
                text
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .toUpperCase()
                    .trim();

            const nombres = normalize(colabResult[0].nombres);
            const apellidos = normalize(colabResult[0].apellidos);

            const letrasBD = nombres.substring(0, 2) + apellidos.substring(0, 2); // ej. "TUBA"

            //comparar para ver si es el colaborador
            if (letrasId !== letrasBD) {
                return res.status(403).json({
                    error: true,
                    msg: "El idReservacion no corresponde al colaborador"
                });
            }

            //vemos si ya hizo checkin previamente
            const queryCheckin = `SELECT * FROM checkin WHERE id_usuario = ? AND DATE(hora) = CURDATE()`;
            const [checkinResult] = await db.pool.query(queryCheckin, [idColaborador]);
            //guardamos el checkin en la tabla checkin
            let query = '';
            let NoAbrirTorniquete = false;
            if (checkinResult.length > 0) {



                query = `INSERT INTO checkin 
                        (id_usuario, hora, tipo) 
                        VALUES 
                        ('${idColaborador}',CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-06:00'), 'salida')`;

                NoAbrirTorniquete = true;

            } else {

                query = `INSERT INTO checkin 
                        (id_usuario, hora, tipo) 
                        VALUES 
                        ('${idColaborador}',CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-06:00'), 'entrada')`;
            }



            result = await db.pool.query(query);


            // Check-in exitoso para colaborador
            //si no se abre el torniquete, significa que ya habia hecho checkin previamente y solo va a registrar su salida
            return res.status(200).json({
                error: NoAbrirTorniquete,
                msg: NoAbrirTorniquete ? "Checkin realizado con éxito, no se abre el torniquete" : "Checkin realizado con éxito",
                data: {
                    tipo: "colaborador",
                    nombre_colaborador: `${colabResult[0].nombres} ${colabResult[0].apellidos}`,
                }
            });
        }

        // Si es el formato nuevo (ID/NUMERO/TIPO)
        if (isNuevoFormato) {
            numeroBoleto = parseInt(idParts[1]); // Segunda parte es el número de boleto
            tipoBoleto = idParts[2]; // Tercera parte es el tipo de boleto (ej: A)

            if (isNaN(numeroBoleto) || numeroBoleto <= 0) {
                return res.status(400).json({
                    error: true,
                    msg: "Número de boleto inválido. Debe ser un número mayor a 0"
                });
            }
        }


        // Obtener venta + fecha_ida usando solo el ID base
        const query = `
            SELECT v.*, vt.fecha_ida
            FROM venta AS v
            INNER JOIN viajeTour AS vt ON v.viajeTour_id = vt.id
            WHERE v.id_reservacion = ?;
        `;
        const [ventaResult] = await db.pool.query(query, [baseId]);
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
        // Inicializar variables para la actualización
        let updateCheckinTiposBoletos = null;

        // Solo procesar checkin_tipos_boletos si es el formato nuevo
        if (isNuevoFormato) {
            // Inicializar la estructura base con todos los tipos de boletos en 0
            const estructuraBase = {
                tipoA: 0,
                tipoB: 0,
                tipoC: 0
            };

            // Cargar los datos existentes de checkin_tipos_boletos
            let checkinTiposBoletos = { ...estructuraBase }; // Inicializar con valores por defecto

            try {
                if (venta.checkin_tipos_boletos) {
                    const parsed = JSON.parse(venta.checkin_tipos_boletos);
                    // Combinar con la estructura base para asegurar que todos los tipos estén presentes
                    checkinTiposBoletos = { ...estructuraBase, ...parsed };
                }
            } catch (e) {
                console.error('Error al parsear checkin_tipos_boletos:', e);
                // En caso de error, mantener la estructura base
            }

            // Verificar que el tipo de boleto sea válido (tipoA, tipoB o tipoC)
            const tipoBoletoCompleto = `tipo${tipoBoleto.toUpperCase()}`;
            if (!(tipoBoletoCompleto in checkinTiposBoletos)) {
                return res.status(400).json({
                    error: true,
                    msg: `Tipo de boleto inválido. Debe ser A, B o C`
                });
            }

            // Incrementar el contador para este tipo de boleto
            checkinTiposBoletos[tipoBoletoCompleto] += 1;
            updateCheckinTiposBoletos = JSON.stringify(checkinTiposBoletos);
        }

        // Construir la consulta de actualización dinámicamente según el formato
        let queryUpdate;
        let queryParams;

        if (isNuevoFormato) {
            queryUpdate = `
                UPDATE venta
                SET checkin = ?, 
                    checkin_tipos_boletos = ?,
                    updated_at = ?
                WHERE id_reservacion = ?;
            `;
            queryParams = [nuevoCheckin, updateCheckinTiposBoletos, fecha, baseId];
        } else {
            // Para el formato antiguo, solo actualizamos el campo checkin
            queryUpdate = `
                UPDATE venta
                SET checkin = ?,
                    updated_at = ?
                WHERE id_reservacion = ?;
            `;
            queryParams = [nuevoCheckin, fecha, baseId];
        }

        await db.pool.query(queryUpdate, queryParams);
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
                tipo: "cliente",
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

app.get('/checkin-data', async (req, res) => {
    try {

        let query = `
            SELECT 
            checkin.*,
            DATE_FORMAT(checkin.hora, '%Y-%m-%d %H:%i:%s') AS hora,
            CONCAT(usuario.nombres, ' ', usuario.apellidos) AS nombre_completo
            FROM checkin
            INNER JOIN usuario ON checkin.id_usuario = usuario.id
            ORDER BY checkin.hora DESC
        `;

        let data = await db.pool.query(query);
        res.json(data[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
});

app.post('/checador/entrada', async (req, res) => {
    console.log("Body recibido en entrada:", req.body); // <--- AGREGA ESTO
    try {
        console.log("====================================");
        console.log("📥 NUEVA SOLICITUD DE ENTRADA");

        const { qr } = req.body;

        // 1️⃣ VALIDAR QR
        if (!qr || typeof qr !== 'string' || !qr.endsWith('-Z')) {
            console.log("❌ QR inválido:", qr);
            return res.json({ error: true, message: 'QR inválido' });
        }

        const match = qr.match(/^\d+/);
        if (!match) {
            console.log("❌ QR formato incorrecto");
            return res.json({ error: true, message: 'QR formato incorrecto' });
        }

        const usuarioId = parseInt(match[0]);
        console.log("👤 Usuario ID detectado:", usuarioId);

        // 2️⃣ BUSCAR USUARIO
        const [usuarioRows] = await db.pool.query(
            `SELECT id, status, isEventual FROM usuario WHERE id = ? LIMIT 1`,
            [usuarioId]
        );

        if (!usuarioRows.length) {
            console.log("❌ Usuario no encontrado");
            return res.json({ error: true, message: 'Usuario no encontrado' });
        }

        if (usuarioRows[0].status !== 1) {
            console.log("❌ Usuario inactivo");
            return res.json({ error: true, message: 'Usuario inactivo' });
        }

        const usuario = usuarioRows[0];

        // 3️⃣ HORA CDMX
        const ahoraUTC = new Date();
        const ahoraCDMX = new Date(
            ahoraUTC.toLocaleString("en-US", { timeZone: "America/Mexico_City" })
        );

        const fechaMysql = ahoraCDMX
            .toLocaleString("sv-SE")
            .replace('T', ' ');

        const fechaHoy = fechaMysql.split(' ')[0];

        const inicioDia = fechaHoy + " 00:00:00";
        const finDia = fechaHoy + " 23:59:59";

        // 🚨 VALIDAR SI AYER QUEDÓ TURNO ABIERTO
        const [salidaAyer] = await db.pool.query(
            `SELECT tipo_evento, fecha_hora
  FROM checador_movimientos
  WHERE colaborador_id = ?
  ORDER BY fecha_hora DESC
  LIMIT 1`,
            [usuario.id]
        );

        if (salidaAyer.length) {

            const fechaUltimo = salidaAyer[0].fecha_hora.toISOString().split('T')[0];

            // SOLO SI EL MOVIMIENTO FUE OTRO DÍA
            if (
                fechaUltimo !== fechaHoy &&
                salidaAyer[0].tipo_evento !== 'salida_final' &&
                salidaAyer[0].tipo_evento !== 'salida_eventual'
            ) {
                console.log("⚠️ TURNO ANTERIOR SIN CERRAR");

                // 🔥 AUTOCIERRE
                const fechaCierre = fechaUltimo + " 23:59:59";

                console.log("🛠 AUTOCIERRE DE TURNO ANTERIOR:", fechaCierre);

                await db.pool.query(
                    `INSERT INTO checador_movimientos
            (colaborador_id, tipo, fecha_hora, minutos_retardo, clasificacion, autorizado, tipo_evento)
            VALUES (?, 'salida', ?, 0, 'auto', 1, 'salida_final')`,
                    [usuario.id, fechaCierre]
                );

                console.log("✅ Turno anterior autocerrado");
            }
        }

        // 4️⃣ VERIFICAR ÚLTIMO MOVIMIENTO (Solo para colaboradores normales)
        let tipoEvento = usuario.isEventual === 1 ? 'entrada_inicial_eventual' : 'entrada_inicial';

        if (usuario.isEventual !== 1) {

            const [ultimoRows] = await db.pool.query(
                `SELECT tipo_evento 
         FROM checador_movimientos 
         WHERE colaborador_id = ? 
         AND fecha_hora BETWEEN ? AND ?
         ORDER BY fecha_hora DESC 
         LIMIT 1`,
                [usuario.id, inicioDia, finDia]
            );

            if (ultimoRows.length) {
                const ultimo = ultimoRows[0].tipo_evento;

                // 🚫 BLOQUEAR REINGRESO DESPUÉS DE SALIDA FINAL
                if (ultimo === 'salida_final') {
                    console.log("⛔ Intento de reingreso después de salida final");
                    return res.json({
                        error: true,
                        message: 'Ya registraste tu salida final hoy'
                    });
                }

                if (ultimo === 'salida_comida') {
                    tipoEvento = 'regreso_comida';
                } else if (ultimo === 'intento_bloqueado') {
                    tipoEvento = 'entrada_inicial';
                } else if (
                    ultimo === 'entrada_inicial' ||
                    ultimo === 'entrada_autorizada' ||
                    ultimo === 'entrada_perdonada' ||
                    ultimo === 'regreso_comida'
                ) {
                    return res.json({ error: true, message: 'Ya tienes una entrada registrada hoy' });
                }
            }

            // 🚫 BLOQUEAR SEGUNDA ENTRADA SOLO SI ES entrada_inicial
            const [entradaHoy] = await db.pool.query(
                `SELECT id 
         FROM checador_movimientos
         WHERE colaborador_id = ?
         AND tipo_evento = 'entrada_inicial'
         AND fecha_hora BETWEEN ? AND ?
         LIMIT 1`,
                [usuario.id, inicioDia, finDia]
            );

            if (entradaHoy.length && tipoEvento === 'entrada_inicial') {
                console.log("⛔ SEGUNDA ENTRADA BLOQUEADA");
                return res.json({ error: true, message: 'Ya registraste tu entrada hoy' });
            }
        }

        // 5️⃣ OBTENER HORARIO
        let horaProgramada = null;
        let horarioEventualId = null; // Para marcarlo como usado después

        if (usuario.isEventual === 1) {
            const horaActual = ahoraCDMX.toTimeString().split(' ')[0];
            console.log("👷 Buscando en horarios_eventuales un horario disponible...");


            // Buscamos el horario más cercano a la hora actual que NO haya sido utilizado
            const [eventualRows] = await db.pool.query(
                `SELECT id, hora_entrada 
                 FROM horarios_eventuales 
                 WHERE id_usuario = ? 
                 AND fecha_especifica = ? 
                 AND activo = 1 
                 AND utilizado = 0
                 ORDER BY ABS(TIME_TO_SEC(TIMEDIFF(hora_entrada, ?)))
                 LIMIT 1`,
                [usuario.id, fechaHoy, horaActual]
            );

            if (!eventualRows.length) {
                console.log("❌ Eventual sin citas pendientes para hoy");
                return res.json({ error: true, message: 'No tienes visitas programadas pendientes para hoy' });
            }

            horarioEventualId = eventualRows[0].id;
            horaProgramada = eventualRows[0].hora_entrada;

        } else {
            let diaSemana = ahoraCDMX.getDay();
            if (diaSemana === 0) diaSemana = 7;

            const [horarioRows] = await db.pool.query(
                `SELECT hora_entrada 
                 FROM horarios_semanales 
                 WHERE id_usuario = ? 
                 AND dia_semana = ? 
                 AND activo = 1 
                 LIMIT 1`,
                [usuario.id, diaSemana]
            );

            if (!horarioRows.length) {
                console.log("❌ Normal sin horario asignado");
                return res.json({ error: true, message: 'No tienes horario asignado para hoy' });
            }

            horaProgramada = horarioRows[0].hora_entrada;
        }

        // 6️⃣ CALCULAR RETARDO
        const horaActualMin = ahoraCDMX.getHours() * 60 + ahoraCDMX.getMinutes();
        const [h, m] = horaProgramada.split(':');
        const horaEntradaMin = parseInt(h) * 60 + parseInt(m);

        let minutosRetardo = horaActualMin - horaEntradaMin;
        if (minutosRetardo < 0) minutosRetardo = 0;

        let clasificacion = 'normal';
        if (minutosRetardo > 0 && minutosRetardo <= 15) {
            clasificacion = 'retardo_menor';
        } else if (minutosRetardo > 15 && minutosRetardo <= 30) {
            clasificacion = 'retardo_mayor';
        } else if (minutosRetardo > 30) {
            clasificacion = 'sin_pase';
        }

        // 7️⃣ REGRESO COMIDA (Solo aplica a NO eventuales por lógica de empresa)
        if (tipoEvento === 'regreso_comida') {
            await db.pool.query(
                `INSERT INTO checador_movimientos
                (colaborador_id, tipo, fecha_hora, minutos_retardo, clasificacion, autorizado, tipo_evento)
                VALUES (?, 'entrada', ?, 0, 'normal', 0, 'regreso_comida')`,
                [usuario.id, fechaMysql]
            );
            console.log(`🍽 REGRESO_COMIDA registrada para ID: ${usuario.id}`);
            return res.json({ error: false, message: 'Regreso de comida exitoso' });
        }

        // 8️⃣ BLOQUEO >30 MIN (Aplica a ambos, pero el eventual consume su horario si es autorizado)
        if (clasificacion === 'sin_pase') {
            const [authRows] = await db.pool.query(
                `SELECT id, estado
                 FROM autorizaciones_ingreso
                 WHERE id_usuario = ?
                 AND fecha = ?
                 AND estado IN ('aprobado','perdonado')
                 AND usada = 0
                 LIMIT 1`,
                [usuario.id, fechaHoy]
            );

            if (authRows.length) {
                const autorizacionId = authRows[0].id;
                const estadoAutorizacion = authRows[0].estado;

                let minutosFinal = minutosRetardo;
                let clasificacionFinal = 'sin_pase';
                // Dentro del Punto 8, antes del INSERT de autorizados:
                let tipoEventoFinal = usuario.isEventual === 1 ? 'entrada_autorizada_eventual' : 'entrada_autorizada';

                if (estadoAutorizacion === 'perdonado') {
                    minutosFinal = 0;
                    clasificacionFinal = 'normal';
                    tipoEventoFinal = 'entrada_perdonada';
                }

                await db.pool.query(
                    `INSERT INTO checador_movimientos
                    (colaborador_id, autorizacion_id, tipo, fecha_hora, minutos_retardo, clasificacion, autorizado, tipo_evento)
                    VALUES (?, ?, 'entrada', ?, ?, ?, 1, ?)`,
                    [usuario.id, autorizacionId, fechaMysql, minutosFinal, clasificacionFinal, tipoEventoFinal]
                );

                await db.pool.query(
                    `UPDATE autorizaciones_ingreso SET usada = 1, updated_at = ? WHERE id = ?`,
                    [fechaMysql, autorizacionId]
                );

                // SI ES EVENTUAL, MARCAMOS EL HORARIO COMO USADO
                if (usuario.isEventual === 1 && horarioEventualId) {
                    await db.pool.query(
                        `UPDATE horarios_eventuales SET utilizado = 1, updated_at = NOW() WHERE id = ?`,
                        [horarioEventualId]
                    );
                }

                console.log("✅ Entrada autorizada correctamente");
                return res.json({ error: false, message: estadoAutorizacion === 'perdonado' ? 'Bienvenido (Retardo Perdonado)' : 'Bienvenido (Autorizado)' });

            } else {
                const [pendiente] = await db.pool.query(
                    `SELECT id FROM autorizaciones_ingreso WHERE id_usuario = ? AND fecha = ? AND estado = 'pendiente' LIMIT 1`,
                    [usuario.id, fechaHoy]
                );

                if (pendiente.length) {
                    return res.json({ error: true, message: 'Tu solicitud sigue pendiente. Pide al administrador que la apruebe.' });
                }

                const [movResult] = await db.pool.query(
                    `INSERT INTO checador_movimientos
                    (colaborador_id, tipo, fecha_hora, minutos_retardo, clasificacion, autorizado, tipo_evento)
                    VALUES (?, 'entrada', ?, ?, 'sin_pase', 0, 'intento_bloqueado')`,
                    [usuario.id, fechaMysql, minutosRetardo]
                );

                await db.pool.query(
                    `INSERT INTO autorizaciones_ingreso
                    (id_usuario, movimiento_id, fecha, hora_solicitud, estado, usada, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 'pendiente', 0, ?, ?)`,
                    [usuario.id, movResult.insertId, fechaHoy, fechaMysql.split(' ')[1], fechaMysql, fechaMysql]
                );

                return res.json({ error: true, message: 'Requiere autorización (Excedió 30 min). Solicitud enviada.' });
            }
        }

        // 9️⃣ ENTRADA NORMAL con eventual
        await db.pool.query(
            `INSERT INTO checador_movimientos
              (colaborador_id, tipo, fecha_hora, minutos_retardo, clasificacion, autorizado, tipo_evento)
               VALUES (?, 'entrada', ?, ?, ?, 0, ?)`, // <--- El último ? es para tipoEvento
            [usuario.id, fechaMysql, minutosRetardo, clasificacion, tipoEvento]
        );

        // SI ES EVENTUAL, MARCAMOS EL HORARIO COMO USADO
        if (usuario.isEventual === 1 && horarioEventualId) {
            await db.pool.query(
                `UPDATE horarios_eventuales SET utilizado = 1, updated_at = NOW() WHERE id = ?`,
                [horarioEventualId]
            );
            console.log(`✅ Horario eventual ${horarioEventualId} marcado como utilizado`);
        }

        console.log("✅ Entrada guardada correctamente");
        return res.json({ error: false, message: 'Bienvenido' });

    } catch (error) {
        console.error('🔥 ERROR CRÍTICO EN CHECADOR:', error);
        return res.json({
            error: true,
            message: 'Error interno',
            detalle: error.message
        });
    }
});

app.post('/checador/salida', async (req, res) => {
    try {
        console.log("====================================");
        console.log("📤 NUEVA SOLICITUD DE SALIDA");
        console.log("Body:", req.body);

        const { qr } = req.body;

        // 1️⃣ VALIDAR QR
        if (!qr || typeof qr !== 'string') {
            console.log("❌ QR requerido");
            return res.json({ error: true, message: 'QR requerido' });
        }

        const partes = qr.split('-');
        if (partes.length !== 3) {
            console.log("❌ QR inválido estructura");
            return res.json({ error: true, message: 'QR inválido' });
        }

        const codigoBase = partes[0];
        const tipoSalida = partes[1]; // '1' para comida, '2' para final
        const idUsuarioRaw = partes[2];

        if (codigoBase !== 'SALIDA2026') {
            console.log("❌ Código base inválido");
            return res.json({ error: true, message: 'Código inválido' });
        }

        if (tipoSalida !== '1' && tipoSalida !== '2') {
            console.log("❌ Tipo salida inválido");
            return res.json({ error: true, message: 'Tipo inválido' });
        }

        const idUsuario = parseInt(idUsuarioRaw);
        if (isNaN(idUsuario)) {
            console.log("❌ ID usuario inválido");
            return res.json({ error: true, message: 'Usuario inválido' });
        }

        // 🕒 Hora CDMX REAL
        const ahoraCDMX = new Date(
            new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" })
        );

        const fechaMysql = ahoraCDMX
            .toLocaleString("sv-SE")
            .replace('T', ' ');

        const fechaHoy = fechaMysql.split(' ')[0];
        const inicioDia = fechaHoy + " 00:00:00";
        const finDia = fechaHoy + " 23:59:59";

        // 2️⃣ VALIDAR USUARIO ACTIVO Y OBTENER TIPO
        const [usuarioRows] = await db.pool.query(
            `SELECT id, status, isEventual FROM usuario WHERE id = ? LIMIT 1`,
            [idUsuario]
        );

        if (!usuarioRows.length || usuarioRows[0].status !== 1) {
            console.log("❌ Usuario no válido");
            return res.json({ error: true, message: 'Usuario no válido' });
        }

        const usuario = usuarioRows[0];

        // 3️⃣ OBTENER ÚLTIMO MOVIMIENTO (DE CUALQUIER DÍA)
        const [ultimoRows] = await db.pool.query(
            `SELECT tipo_evento, fecha_hora
   FROM checador_movimientos
   WHERE colaborador_id = ?
   ORDER BY fecha_hora DESC
   LIMIT 1`,
            [idUsuario]
        );

        if (!ultimoRows.length) {
            console.log("❌ No tiene entrada previa");
            return res.json({ error: true, message: 'No tiene registros previos' });
        }

        const ultimoEvento = ultimoRows[0].tipo_evento;
        console.log("🔎 Último evento detectado:", ultimoEvento);

        let nuevoEvento = null;

        // --- LÓGICA DIFERENCIADA PARA EVENTUALES ---
        if (usuario.isEventual === 1) {
            // Para el eventual no validamos si es comida o final, 
            // simplemente registramos que está saliendo de su visita.
            nuevoEvento = 'salida_eventual';
        }
        // --- LÓGICA PARA COLABORADORES NORMALES (Tú código original) ---
        else {
            // 🔒 BLOQUEAR SI YA TIENE SALIDA FINAL
            if (ultimoEvento === 'salida_final') {
                console.log("❌ Ya tiene salida final");
                return res.json({ error: true, message: 'Ya registró salida final' });
            }

            // 🔹 LÓGICA SALIDA COMIDA (TIPO 1)
            if (tipoSalida === '1') {
                if (
                    ultimoEvento !== 'entrada_inicial' &&
                    ultimoEvento !== 'entrada_autorizada' &&
                    ultimoEvento !== 'entrada_perdonada'
                ) {
                    console.log("❌ Secuencia inválida para comida");
                    return res.json({ error: true, message: 'Debes estar en turno para salir a comer' });
                }
                nuevoEvento = 'salida_comida';
            }

            // 🔹 LÓGICA SALIDA FINAL (TIPO 2)
            if (tipoSalida === '2') {
                if (
                    ultimoEvento !== 'entrada_inicial' &&
                    ultimoEvento !== 'regreso_comida' &&
                    ultimoEvento !== 'entrada_autorizada' &&
                    ultimoEvento !== 'entrada_perdonada'
                ) {
                    console.log("❌ Secuencia inválida para salida final");
                    return res.json({ error: true, message: 'Secuencia de salida no permitida' });
                }
                nuevoEvento = 'salida_final';
            }
        }

        if (!nuevoEvento) {
            return res.json({ error: true, message: 'Error al procesar tipo de salida' });
        }

        // 🛡 RECHECK ANTIDOBLE CLIC (OPCIONAL PERO RECOMENDADO)
        const [recheckRows] = await db.pool.query(
            `SELECT tipo_evento FROM checador_movimientos
       WHERE colaborador_id = ? AND fecha_hora BETWEEN ? AND ?
       ORDER BY fecha_hora DESC LIMIT 1`,
            [idUsuario, inicioDia, finDia]
        );

        if (recheckRows.length && recheckRows[0].tipo_evento === nuevoEvento) {
            console.log("⚠️ Registro duplicado evitado");
            return res.json({ error: true, message: 'Registro ya procesado' });
        }

        // 4️⃣ INSERTAR MOVIMIENTO
        await db.pool.query(
            `INSERT INTO checador_movimientos
       (colaborador_id, tipo, fecha_hora, minutos_retardo, clasificacion, autorizado, tipo_evento)
       VALUES (?, 'salida', ?, 0, 'normal', 0, ?)`,
            [idUsuario, fechaMysql, nuevoEvento]
        );

        console.log(`✅ ${nuevoEvento.toUpperCase()} registrada para ID: ${idUsuario}`);
        console.log("====================================");

        return res.json({
            error: false,
            message: `Salida (${nuevoEvento.replace('_', ' ')}) registrada con éxito`
        });

    } catch (error) {
        console.error('🔥 ERROR EN SALIDA:', error);
        return res.json({ error: true, message: 'Error interno del servidor', detalle: error.message });
    }
});

app.get('/checador/movimientos', async (req, res) => {
    try {

        let query = `SELECT 
        checador_movimientos.*, 
        CONCAT(usuario.nombres, ' ', usuario.apellidos) AS nombre_colaborador
        FROM checador_movimientos 
        INNER JOIN usuario 
        ON checador_movimientos.colaborador_id = usuario.id`;
        let movimientos = await db.pool.query(query);
        res.json(movimientos[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
})

app.post('/checador/biometrico', async (req, res) => {
    try {

        console.log("====================================");
        console.log("🧠 BIOMÉTRICO - Nueva lectura");

        const { qr } = req.body;

        // 1️⃣ VALIDAR QR
        if (!qr || typeof qr !== 'string' || !qr.endsWith('-Z')) {
            return res.json({ error: true, message: 'QR inválido' });
        }

        const match = qr.match(/^\d+/);
        if (!match) {
            return res.json({ error: true, message: 'QR formato incorrecto' });
        }

        const usuarioId = parseInt(match[0]);

        // 2️⃣ VALIDAR USUARIO
        const [usuarioRows] = await db.pool.query(
            `SELECT id, status FROM usuario WHERE id = ? LIMIT 1`,
            [usuarioId]
        );

        if (!usuarioRows.length || usuarioRows[0].status !== 1) {
            return res.json({ error: true, message: 'Usuario no válido' });
        }

        // 🕒 3️⃣ FECHA CDMX
        const ahoraCDMX = new Date(
            new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" })
        );

        const fechaMysql = ahoraCDMX
            .toLocaleString("sv-SE")
            .replace('T', ' ');

        const fechaHoy = fechaMysql.split(' ')[0];

        const inicioDia = `${fechaHoy} 00:00:00`;
        const finDia = `${fechaHoy} 23:59:59`;

        // 4️⃣ ÚLTIMO MOVIMIENTO DEL DÍA
        const [ultimoRows] = await db.pool.query(
            `SELECT tipo_evento
       FROM checador_movimientos
       WHERE colaborador_id = ?
       AND fecha_hora BETWEEN ? AND ?
       ORDER BY id DESC
       LIMIT 1`,
            [usuarioId, inicioDia, finDia]
        );

        const ultimoEvento = ultimoRows.length
            ? ultimoRows[0].tipo_evento
            : null;

        console.log("🔎 Último evento hoy:", ultimoEvento);

        let destino = null;
        let qrSalida = null;

        // 5️⃣ DECISIÓN INTELIGENTE (FLUJO LIMPIO)
        if (!ultimoEvento) {
            // 👉 No ha checado hoy
            destino = "entrada";

        } else if (
            ultimoEvento === 'salida_comida' ||
            ultimoEvento === 'intento_bloqueado'
        ) {
            // 👉 Regresa a trabajar
            destino = "entrada";

        } else if (
            ultimoEvento === 'entrada_inicial' ||
            ultimoEvento === 'entrada_autorizada' ||
            ultimoEvento === 'entrada_perdonada'
        ) {
            // 👉 Se va a comida
            destino = "salida";
            qrSalida = `SALIDA2026-1-${usuarioId}`;

        } else if (ultimoEvento === 'regreso_comida') {
            // 👉 Sale definitivamente
            destino = "salida";
            qrSalida = `SALIDA2026-2-${usuarioId}`;

        } else if (ultimoEvento === 'salida_final') {
            return res.json({
                error: true,
                message: 'Ya registraste tu salida final hoy'
            });
        }

        // 6️⃣ REDIRECCIÓN

        if (destino === "entrada") {

            console.log("➡️ ENTRADA");

            const response = await fetch('http://127.0.0.1:4000/venta/checador/entrada', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qr })
            });

            const data = await response.json();
            console.log("📥 RESPUESTA ENTRADA:", data);
            return res.json(data);
        }

        if (destino === "salida") {

            console.log("➡️ SALIDA:", qrSalida);

            const response = await fetch('http://127.0.0.1:4000/venta/checador/salida', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qr: qrSalida })
            });

            const data = await response.json();
            return res.json(data);
        }

        // ⚠️ fallback
        return res.json({
            error: true,
            message: 'No se pudo determinar acción'
        });

    } catch (error) {

        console.error("🔥 ERROR BIOMÉTRICO:", error);

        return res.json({
            error: true,
            message: 'Error interno',
            detalle: error.message
        });

    }
});

// ==========================================
// ENDPOINTS DE ADMINISTRACIÓN DE ASISTENCIA
// ==========================================

// 1. OBTENER SOLICITUDES PENDIENTES DEL DÍA
app.get('/autorizaciones/pendientes', async (req, res) => {
    try {
        console.log("📋 CONSULTANDO AUTORIZACIONES PENDIENTES");

        const ahoraCDMX = new Date(
            new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" })
        );

        const fechaHoy = ahoraCDMX.toLocaleString("sv-SE").split(' ')[0];

        console.log("📅 Fecha CDMX usada:", fechaHoy);

        const [rows] = await db.pool.query(
            `SELECT 
                ai.id,
                ai.id_usuario,
                ai.fecha,
                ai.hora_solicitud,
                ai.motivo,
                u.nombres,
                u.apellido
             FROM autorizaciones_ingreso ai
             INNER JOIN usuario u ON u.id = ai.id_usuario
             WHERE ai.estado = 'pendiente'
             AND ai.fecha = ?
             ORDER BY ai.hora_solicitud ASC`,
            [fechaHoy]
        );

        return res.json({
            error: false,
            data: rows
        });

    } catch (error) {
        console.error("🔥 ERROR EN PENDIENTES:", error);
        return res.json({
            error: true,
            message: 'Error al obtener pendientes'
        });
    }
});

// 2. APROBAR AUTORIZACIÓN DE INGRESO
app.post('/autorizaciones/aprobar', async (req, res) => {
    try {
        console.log("✅ APROBANDO AUTORIZACIÓN");
        const { autorizacion_id, admin_id } = req.body;

        if (!autorizacion_id || !admin_id) {
            return res.json({ error: true, message: 'Datos incompletos' });
        }

        const ahoraCDMX = new Date(
            new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" })
        );

        const fechaHora = ahoraCDMX.toLocaleString("sv-SE").replace('T', ' ');
        const horaSolo = fechaHora.split(' ')[1];

        const [rows] = await db.pool.query(
            `SELECT * FROM autorizaciones_ingreso WHERE id = ? AND estado = 'pendiente' LIMIT 1`,
            [autorizacion_id]
        );

        if (!rows.length) {
            return res.json({ error: true, message: 'Autorización no válida o ya procesada' });
        }

        await db.pool.query(
            `UPDATE autorizaciones_ingreso
             SET estado = 'aprobado',
                 autorizado_por = ?,
                 hora_autorizacion = ?,
                 updated_at = ?
             WHERE id = ?`,
            [admin_id, horaSolo, fechaHora, autorizacion_id]
        );

        console.log("✔ Autorización aprobada correctamente");
        return res.json({ error: false, message: 'Autorización aprobada' });

    } catch (error) {
        console.error("🔥 ERROR EN APROBAR:", error);
        return res.json({ error: true, message: 'Error al aprobar' });
    }
});

// 3. RECHAZAR AUTORIZACIÓN DE INGRESO
app.post('/autorizaciones/rechazar', async (req, res) => {
    try {
        console.log("❌ RECHAZANDO AUTORIZACIÓN");
        const { autorizacion_id, admin_id, motivo } = req.body;

        if (!autorizacion_id || !admin_id) {
            return res.json({ error: true, message: 'Datos incompletos' });
        }

        const ahoraCDMX = new Date(
            new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" })
        );

        const fechaHora = ahoraCDMX.toLocaleString("sv-SE").replace('T', ' ');

        const [rows] = await db.pool.query(
            `SELECT * FROM autorizaciones_ingreso WHERE id = ? AND estado = 'pendiente' LIMIT 1`,
            [autorizacion_id]
        );

        if (!rows.length) {
            return res.json({ error: true, message: 'Autorización no válida' });
        }

        await db.pool.query(
            `UPDATE autorizaciones_ingreso
             SET estado = 'rechazado',
                 autorizado_por = ?,
                 motivo = ?,
                 updated_at = ?
             WHERE id = ?`,
            [admin_id, motivo || 'Sin motivo especificado', fechaHora, autorizacion_id]
        );

        console.log("✔ Autorización rechazada correctamente");
        return res.json({ error: false, message: 'Autorización rechazada' });

    } catch (error) {
        console.error("🔥 ERROR EN RECHAZAR:", error);
        return res.json({ error: true, message: 'Error al rechazar' });
    }
});

// 4. PERDONAR RETARDO (ASISTENCIA / NÓMINA) - VERSIÓN COMPLETA
app.post('/autorizaciones/perdonar', async (req, res) => {
    const connection = await db.pool.getConnection(); // Usamos conexión manual para la transacción
    try {
        await connection.beginTransaction();

        console.log("💰 INICIANDO PROCESO DE PERDÓN DE RETARDO");
        const {
            id_usuario_colaborador,
            id_usuario_admin,
            fecha, // Formato YYYY-MM-DD
            minutos_retraso,
            motivo,
            tipo_autorizacion
        } = req.body;

        // Validaciones básicas
        if (!id_usuario_colaborador || !fecha) {
            return res.json({ error: true, message: 'Faltan datos esenciales (colaborador o fecha)' });
        }

        const ahoraCDMX = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
        const fechaHoraRegistro = ahoraCDMX.toLocaleString("sv-SE").replace('T', ' ');

        // 1️⃣ REGISTRO EN AUDITORÍA (Lo que ya tenías)
        await connection.query(
            `INSERT INTO autorizaciones_asistencia 
            (id_usuario_colaborador, id_usuario_admin, fecha, minutos_retraso, motivo, tipo_autorizacion, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id_usuario_colaborador, id_usuario_admin, fecha, minutos_retraso, motivo, tipo_autorizacion, fechaHoraRegistro]
        );

        // 2️⃣ CORREGIR EL MOVIMIENTO EN EL CHECADOR
        // Buscamos el 'intento_bloqueado' de hoy para ese usuario y lo convertimos en entrada válida sin retardo
        const [movimientoUpdate] = await connection.query(
            `UPDATE checador_movimientos 
             SET tipo_evento = 'entrada_perdonada', 
                 minutos_retardo = 0, 
                 clasificacion = 'normal',
                 autorizado = 1 
             WHERE colaborador_id = ? 
             AND DATE(fecha_hora) = ? 
             AND tipo_evento = 'intento_bloqueado'`,
            [id_usuario_colaborador, fecha]
        );

        // 3️⃣ CERRAR LA SOLICITUD DE INGRESO
        // Marcamos la autorización como 'perdonado' y 'usada' para que el checador no la busque más
        await connection.query(
            `UPDATE autorizaciones_ingreso 
             SET estado = 'perdonado', 
                 usada = 1, 
                 autorizado_por = ?,
                 updated_at = ?
             WHERE id_usuario = ? 
             AND fecha = ? 
             AND estado = 'pendiente'`,
            [id_usuario_admin, fechaHoraRegistro, id_usuario_colaborador, fecha]
        );

        await connection.commit();
        console.log("✅ TODO ACTUALIZADO: Auditoría guardada, movimiento corregido y solicitud cerrada.");

        return res.json({
            error: false,
            message: 'Retardo perdonado. El registro de asistencia se ha corregido a 0 minutos.'
        });

    } catch (error) {
        await connection.rollback(); // Si algo falla, deshacemos todos los cambios
        console.error('🔥 ERROR CRÍTICO AL PERDONAR:', error);
        return res.json({ error: true, message: 'No se pudo procesar el perdón: ' + error.message });
    } finally {
        connection.release(); // Liberamos la conexión al pool
    }
});

//lista de autorizaciones asistencia
app.get('/autorizaciones/asistencia', async (req, res) => {
    try {

        let query = `SELECT 
        autorizaciones_asistencia.*, 
        CONCAT(u.nombres, ' ', u.apellidos) AS nombre_colaborador,
        CONCAT(a.nombres, ' ', a.apellidos) AS nombre_administrador
        FROM autorizaciones_asistencia 
        INNER JOIN usuario u ON autorizaciones_asistencia.id_usuario_colaborador = u.id
        LEFT  JOIN usuario a ON autorizaciones_asistencia.id_usuario_admin = a.id`;
        let autorizaciones = await db.pool.query(query);
        res.json(autorizaciones[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
    }
});

//lista de autorizaciones ingreso
app.get('/autorizaciones/ingreso', async (req, res) => {
    try {

        let query = `SELECT 
        autorizaciones_ingreso.*, 
        CONCAT(u.nombres, ' ', u.apellidos) AS nombre_colaborador
        FROM autorizaciones_ingreso 
        INNER JOIN usuario u ON autorizaciones_ingreso.id_usuario = u.id`;
        let autorizaciones = await db.pool.query(query);
        res.json(autorizaciones[0]);

    } catch (error) {
        res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
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

app.post('/verificarIdReservacion', async (req, res) => {
    try {
        const { idReservacion } = req.body;



        // Revisa si existe el número de reservación y si la fecha coincide con hoy
        let query = `
    SELECT id_reservacion 
    FROM venta 
    WHERE id_reservacion = '${idReservacion}'
    AND DATE(fecha_comprada) = CURDATE()
`;



        let existReservacion = await db.pool.query(query);

        if (existReservacion[0].length < 1) {
            return res.status(200).json({ error: true, msg: "El id de reservación no existe." });
        }

        // Devuelve un mensaje de éxito
        res.status(200).json({
            error: false,
            msg: "El id de reservación es válido."
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
        v.checkin,
        v.status_traspaso,
        t.nombre AS nombreTour, 
        vt.fecha_ida, 
        vt.fecha_regreso
      FROM venta v
      INNER JOIN viajeTour vt ON v.viajeTour_id = vt.id
      INNER JOIN tour t ON vt.tour_id = t.id
      WHERE v.cliente_id = ${clienteId} OR v.cliente_id_asignado = ${clienteId}
      ORDER BY v.fecha_compra DESC
    `;
        let compras = await db.pool.query(query);
        res.status(200).json({ error: false, data: compras[0] });
    } catch (error) {
        console.error("Error en historial de compras:", error);
        res.status(500).json({ error: true, msg: "Error obteniendo historial", details: error });
    }
});

app.get('/comprasByOperator/:clienteId', async (req, res) => {
    try {
        const clienteId = req.params.clienteId;
        let query = `
  SELECT 
    MIN(v.id) AS id,
    GROUP_CONCAT(v.id_reservacion ORDER BY v.id_reservacion SEPARATOR ',') AS id_reservaciones,
    SUM(v.no_boletos) AS no_boletos,
    SUM(v.total) AS total,
    DATE_FORMAT(MAX(v.fecha_compra), '%Y-%m-%d %H:%i:%s') AS fecha_compra,
    MAX(v.pagado) AS pagado,
    MAX(v.checkin) AS checkin,
    v.session_id,
    t.nombre AS nombreTour, 
    DATE_FORMAT(vt.fecha_ida, '%Y-%m-%d %H:%i:%s') AS fecha_ida,
    vt.fecha_regreso
  FROM venta v
  INNER JOIN viajeTour vt ON v.viajeTour_id = vt.id
  INNER JOIN tour t ON vt.tour_id = t.id
  WHERE v.cliente_id = ${clienteId} AND v.status_traspaso = 0
  GROUP BY v.session_id
  ORDER BY fecha_compra DESC
`;

        let compras = await db.pool.query(query);
        res.status(200).json({ error: false, data: compras[0] });
    } catch (error) {
        console.error("Error en historial de compras:", error);
        res.status(500).json({ error: true, msg: "Error obteniendo historial del tour operador", details: error });
    }
});

app.get('/boletos-por-session/:sessionId', async (req, res) => {
    try {
        const sessionId = req.params.sessionId;

        let query = `
            SELECT 
                v.id,
                v.id_reservacion,
                v.no_boletos,
                v.total,
                v.nombre_cliente,
                v.correo,
                v.nombre_cliente_asignado,
                v.correo_asignado,
                DATE_FORMAT(v.fecha_compra, '%Y-%m-%d %H:%i:%s') AS fecha_compra,
                v.pagado,
                v.checkin,
                v.session_id,
                t.nombre AS nombreTour,
                DATE_FORMAT(vt.fecha_ida, '%Y-%m-%d %H:%i:%s') AS fecha_ida,
                vt.fecha_regreso
            FROM venta v
            INNER JOIN viajeTour vt ON v.viajeTour_id = vt.id
            INNER JOIN tour t ON vt.tour_id = t.id
            WHERE v.session_id = ?
            ORDER BY v.id_reservacion
        `;

        const [boletos] = await db.pool.query(query, [sessionId]);

        if (boletos.length === 0) {
            return res.status(404).json({
                error: true,
                msg: "No se encontraron boletos para la sesión proporcionada"
            });
        }

        res.status(200).json({
            error: false,
            data: boletos,
            msg: "Boletos encontrados exitosamente"
        });

    } catch (error) {
        console.error("Error al obtener boletos por sesión:", error);
        res.status(500).json({
            error: true,
            msg: "Error al obtener los boletos de la sesión",
            details: error.message
        });
    }
});

// Función para enviar correo de boleto asignado con código QR
async function enviarCorreoBoletoAsignado(boletoInfo) {
    try {
        const { id_reservacion, nombre_cliente, correo, fecha, hora, no_boletos, total, tipos_boletos, password } = boletoInfo;

        // Usar idioma español por defecto
        const lang = 'es';

        // Textos en español
        const t = {
            ticketType: "Tipo de boleto",
            price: "Precio",
            quantity: "Cantidad",
            subtotal: "Subtotal",
            total: "Total",
            ticketTypes: {
                tipoA: "Entrada General"
            }
        };

        // Parsear tipos_boletos
        let tiposBoletos = {};
        try {
            tiposBoletos = JSON.parse(tipos_boletos);
            if (typeof tiposBoletos !== 'object' || tiposBoletos === null || Array.isArray(tiposBoletos)) {
                tiposBoletos = { "tipoA": no_boletos };
            }
        } catch (error) {
            console.error('Error parseando tipos_boletos:', error);
            tiposBoletos = { "tipoA": no_boletos };
        }

        // Generar un solo código QR para la reservación
        const qrCodeBuffer = await generateQRCode(id_reservacion);

        const precios = await getPreciosPorContexto(CONTEXTO_PRECIO_MUSEO, tiposBoletos, fecha, viajeTourId);

        let tiposBoletosArray = mapTiposBoletosConPrecios(tiposBoletos, t.ticketTypes, precios);

        let tablaBoletos = `
            <table width="100%" cellpadding="5" cellspacing="0" border="1" style="border-collapse:collapse;">
                <tr style="background-color:#f5f5f5">
                    <th style="text-align:left">${t.ticketType}</th>
                    <th style="text-align:center">${t.quantity}</th>
                </tr>`;
        tiposBoletosArray.forEach(tipo => {
            let subtotal = Number(tipo.precio) * Number(tipo.cantidad);
            tablaBoletos += `
                <tr>
                    <td style="text-align:left">${tipo.nombre}</td>
                    <td style="text-align:center">${Number(tipo.cantidad)}</td>
                </tr>`;
        });
        tablaBoletos += `
            </table>`;

        // Preparar datos para el template del correo
        const emailData = {
            nombre: nombre_cliente,
            password: password, // Será undefined si el usuario ya existía, o tendrá valor si es nuevo
            fecha: fecha,
            horario: hora,
            boletos: no_boletos,
            tablaBoletos,
            idReservacion: id_reservacion,
            total,
            ubicacionUrl: "https://maps.app.goo.gl/9R17eVrZeTkxyNt88"
        };

        const emailHtml = getEmailTemplate(lang)(emailData);

        // Enviar correo al cliente con el QR en el cuerpo del correo
        await mailer.sendMail({
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
        });

        console.log(`✅ Correo enviado exitosamente para boleto asignado: ${id_reservacion}`);
    } catch (error) {
        console.error('❌ Error enviando correo de boleto asignado:', error);
    }
}

app.put('/asignar-boletos/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { boletos, enviar_correos } = req.body;
    if (!Array.isArray(boletos)) {
        return res.status(400).json({
            error: true,
            msg: "Formato de datos inválido. Se esperaba un arreglo de boletos."
        });
    }
    const connection = await db.pool.getConnection();

    try {
        await connection.beginTransaction();

        // Array para almacenar la información de los boletos actualizados para enviar correos
        const boletosParaCorreo = [];

        for (const boleto of boletos) {
            const { id, nombre_cliente, correo } = boleto;

            if (!id || !nombre_cliente || !correo) {
                await connection.rollback();
                return res.status(400).json({
                    error: true,
                    msg: `Faltan campos requeridos para el boleto con ID: ${id}`
                });
            }
            // Verificar que el boleto pertenezca a la sesión y obtener información completa
            const [verification] = await connection.query(
                `SELECT v.*, vt.fecha_ida, vt.tour_id, DATE_FORMAT(v.fecha_comprada, '%Y-%m-%d %H:%i:%s') AS fecha_comprada 
                 FROM venta v INNER JOIN viajeTour vt ON v.viajeTour_id = vt.id 
                 WHERE v.id = ? AND v.session_id = ?`,
                [id, sessionId]
            );
            if (verification.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    error: true,
                    msg: `Boleto con ID ${id} no encontrado en la sesión`
                });
            }

            const ventaData = verification[0];

            //Verificamos si existe el correo en la DB
            let clienteExiste = null;
            let cliente_id = null;
            let password = null;

            let query = `SELECT * FROM usuario WHERE correo='${correo}'`;

            let existCorreo = await connection.query(query);

            if (existCorreo[0].length >= 1) {
                clienteExiste = true;

                cliente_id = existCorreo[0][0].id;
            } else {
                clienteExiste = false;
                //generamos la fecha
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

                //generamos un password aleatorio
                password = generarPassword();
                const salt = await bcryptjs.genSalt(10);
                const hashedPassword = await bcryptjs.hash(password, salt);

                //dividimos el nombre_cliente en nombre y apellidos
                let nombre = nombre_cliente.split(' ')[0];
                let apellidos = nombre_cliente.split(' ').slice(1).join(' ');

                //damos de alta al cliente
                query = `INSERT INTO usuario 
                                (nombres, apellidos, correo, password, isClient, created_at, updated_at) 
                                VALUES 
                                ('${nombre}', '${apellidos}', '${correo}', '${hashedPassword}', 1, '${fecha}', '${fecha}')`;


                let newClient = await connection.query(query);
                cliente_id = newClient[0].insertId;
            }

            // Actualizar el boleto con los nuevos campos
            await connection.query(
                `UPDATE venta 
                 SET nombre_cliente_asignado = ?, correo_asignado = ?, cliente_id_asignado = ?
                 WHERE id = ? AND session_id = ?`,
                [nombre_cliente, correo, cliente_id, id, sessionId]
            );

            // Si se deben enviar correos, guardar la información del boleto
            if (enviar_correos === true) {
                //console.log(ventaData.fecha_comprada);
                const { fecha, hora } = separarFechaHora(ventaData.fecha_comprada);
                const horaCompleta = normalizarHora(hora);

                boletosParaCorreo.push({
                    id: id,
                    id_reservacion: ventaData.id_reservacion,
                    nombre_cliente: nombre_cliente,
                    correo: correo,
                    fecha: fecha,
                    hora: horaCompleta,
                    no_boletos: ventaData.no_boletos,
                    total: ventaData.total,
                    tipos_boletos: ventaData.tipos_boletos,
                    password: password // Solo tendrá valor si se creó un nuevo usuario
                });
            }
        }
        await connection.commit();

        // ==========================
        // Enviar correos fuera de la transacción
        // ==========================
        if (enviar_correos === true && boletosParaCorreo.length > 0) {
            for (const boletoInfo of boletosParaCorreo) {
                try {
                    await enviarCorreoBoletoAsignado(boletoInfo);
                } catch (error) {
                    console.error(`Error enviando correo para boleto ${boletoInfo.id_reservacion}:`, error);
                    // Continuar con el siguiente boleto sin romper la ejecución
                }
            }
        }

        res.status(200).json({
            error: false,
            msg: "Información de los boletos actualizada correctamente",
            data: { boletosActualizados: boletos.length }
        });
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error("Error al actualizar boletos:", error);
        res.status(500).json({
            error: true,
            msg: "Error al actualizar la información de los boletos",
            details: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
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
    //agregar la validacion de checkin > 0 ya no se puede solo si checkin = 0

    try {
        const { id_reservacion } = req.body

        if (!id_reservacion) {
            return res.status(400).json({ msg: 'Faltan parámetros obligatorios.', error: true });
        }

        //revisamos si ya se hizo checkin
        let query = `SELECT checkin FROM venta WHERE id_reservacion = ? AND checkin != 0`;
        let cancelable = await db.pool.query(query, [id_reservacion]);
        cancelable = cancelable[0];
        if (cancelable.length > 0) {
            return res.status(500).json({ msg: "La reserva ya fue utilizada y no se puede cancelar", error: true });
        }

        //revisamos si ya fue cancelada anteriormente
        query = `SELECT status_traspaso FROM venta WHERE id_reservacion = ? AND status_traspaso = 99`;
        cancelable = await db.pool.query(query, [id_reservacion]);
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
    vt.lugares_disp = vt.lugares_disp + v.no_boletos,
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

app.post('/stripe/cancelar-compra', async (req, res) => {

    const { sessionId } = req.body;

    if (!sessionId) {
        return res.status(400).json({ msg: 'Faltan parámetros obligatorios.', error: true });
    }


    let fecha = getFecha();
    let connection;

    try {
        connection = await db.pool.getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT * FROM venta WHERE session_id = ?', [sessionId]);
        if (rows.length === 0) {
            console.log('No se encontró la venta');
            await connection.rollback();
            connection.release();
            return;
        }

        const id_reservacion = rows[0].id_reservacion;
        const idVenta = rows[0].id;
        const viajeTourId = rows[0].viajeTour_id;
        const boletos_devueltos = rows[0].boletos_devueltos;
        const no_boletos = rows[0].no_boletos;
        const nombre_cliente = rows[0].nombre_cliente;
        const correo = rows[0].correo;
        const total = rows[0].total;

        const tipos_boletos = rows[0].tipos_boletos;
        const boletosObj = JSON.parse(tipos_boletos);
        const keys = Object.keys(boletosObj);

        // verificar si existe alguna key que empiece con "tipo_"  devuelve true o false
        const esEventoEspecial = keys.some(key => key.startsWith('tipo_'));

        // Si es evento especial, obtener el horario para actualizar su cupo
        let horario = null;
        if (esEventoEspecial) {
            //obtener el evento_id del viajeTour
            const [viajeTourRows] = await connection.query('SELECT tour_id, fecha_ida FROM viajeTour WHERE id = ?', [viajeTourId]);
            const tourId = viajeTourRows[0].tour_id;
            const fechaTour = viajeTourRows[0].fecha_ida.toISOString().split('T')[0]; // obtener solo la fecha en formato YYYY-MM-DD
            const horaTour = viajeTourRows[0].fecha_ida.toISOString().split('T')[1].substring(0, 8); // obtener solo la hora en formato HH:MM

            //obtener el id del horario de eventos especiales relacionado con ese tour_id, fecha y hora
            const selectQuery = `SELECT id FROM eventos_especiales_horarios WHERE evento_id = ? AND fecha = ? AND activo = 1 AND hora_inicio = ?`;
            const [rows] = await connection.query(selectQuery, [tourId, fechaTour, horaTour]);
            horario = rows[0];

            if (!horario) {
                await connection.rollback();
                connection.release();
                return res.status(404).json({ error: true, msg: 'Horario no encontrado para ese evento/fecha/hora' });
            }
        }

        const fechaHora = separarFechaHora(rows[0].fecha_comprada);

        if (boletos_devueltos === 1) {
            console.log('Boletos ya devueltos');
            await connection.rollback();
            connection.release();
            return;
        }

        await connection.query(
            'UPDATE venta SET boletos_devueltos = 1, status_traspaso = 99, updated_at = ? WHERE id = ?',
            [fecha, idVenta]
        );

        const boletos = Number(no_boletos) || 0;
        await connection.query(
            'UPDATE viajeTour SET lugares_disp = lugares_disp + ?, updated_at = ? WHERE id = ?',
            [boletos, fecha, viajeTourId]
        );

        if (esEventoEspecial) {
            await connection.query('UPDATE eventos_especiales_horarios SET cupo_disponible = cupo_disponible + ?, updated_at = ? WHERE id = ?', [boletos, fecha, horario.id]);
        }

        await connection.commit();
        connection.release();

        // =====================
        // Enviar correos fuera de la transacción
        // =====================
        const emailHtml = `
            <h1>Compra cancelada</h1>
            <p>Id de la reservación ${id_reservacion}</p>
            <p>Nombre: ${nombre_cliente}</p>
            <p>Correo: ${correo}</p>
            <p>Fecha: ${fechaHora.fecha}</p>
            <p>Hora: ${fechaHora.hora}</p>
            <p>Boletos: ${no_boletos}</p>
        `;

        await mailer.sendMail({
            from: process.env.MAIL,
            to: process.env.MAIL,
            subject: "¡Compra cancelada - Museo Casa Kahlo!",
            html: emailHtml
        });

        await mailer.sendMail({
            from: process.env.MAIL,
            to: correo,
            subject: "¡Compra cancelada - Museo Casa Kahlo!",
            html: emailHtml
        });

        console.log(`⚠️ Compra cancelada procesada correctamente: ${id_reservacion}`);
    } catch (error) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        console.error('❌ Error procesando la cancelación de la compra:', error);
    } finally {
        if (connection) connection.release();
    }

    res.json({ msj: "✅ Compra cancelada con éxito." });

});

app.post('/stripe/cancelar-compra-operator', async (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
        return res.status(400).json({ msg: 'Faltan parámetros obligatorios.', error: true });
    }

    let fecha = getFecha();
    let connection;

    try {
        connection = await db.pool.getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.query(
            'SELECT * FROM venta WHERE session_id = ?',
            [sessionId]
        );

        if (rows.length === 0) {
            await connection.rollback();
            return res.json({ msg: 'No se encontraron ventas', error: true });
        }

        // =====================
        // Procesar TODAS las ventas
        // =====================
        for (const venta of rows) {

            if (venta.boletos_devueltos === 1) {
                console.log(`⏭ Venta ${venta.id} ya estaba devuelta`);
                continue; // saltar esta y seguir con las demás
            }

            // 1. Marcar venta como cancelada
            await connection.query(
                `UPDATE venta 
                 SET boletos_devueltos = 1, status_traspaso = 99, updated_at = ? 
                 WHERE id = ?`,
                [fecha, venta.id]
            );

            // 2. Regresar lugares al viaje
            const boletos = Number(venta.no_boletos) || 0;
            await connection.query(
                `UPDATE viajeTour 
                 SET lugares_disp = lugares_disp + ?, updated_at = ? 
                 WHERE id = ?`,
                [boletos, fecha, venta.viajeTour_id]
            );
        }

        await connection.commit();

        // =====================
        // Enviar correos (uno por cada venta)
        // =====================
        for (const venta of rows) {

            const fechaHora = separarFechaHora(venta.fecha_comprada);

            const emailHtml = `
                <h1>Compra cancelada</h1>
                <p>Id de la reservación ${venta.id_reservacion}</p>
                <p>Nombre: ${venta.nombre_cliente}</p>
                <p>Correo: ${venta.correo}</p>
                <p>Fecha: ${fechaHora.fecha}</p>
                <p>Hora: ${fechaHora.hora}</p>
                <p>Boletos: ${venta.no_boletos}</p>
            `;

            await mailer.sendMail({
                from: process.env.MAIL,
                to: process.env.MAIL,
                subject: "¡Compra cancelada - Museo Casa Kahlo!",
                html: emailHtml
            });

            await mailer.sendMail({
                from: process.env.MAIL,
                to: venta.correo,
                subject: "¡Compra cancelada - Museo Casa Kahlo!",
                html: emailHtml
            });

            console.log(`⚠️ Compra cancelada: ${venta.id_reservacion}`);
        }

        res.json({
            msj: `✅ ${rows.length} compras canceladas correctamente`
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error procesando la cancelación:', error);
        res.status(500).json({ error: true, msg: 'Error interno' });
    } finally {
        if (connection) connection.release();
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


app.get('/verificarDisponibilidad-test', async (req, res) => {


    let { no_boletos, tourId, fecha, hora } = req.body;


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
    console.log(query);
    let disponibilidad = await db.pool.query(query);
    console.log(disponibilidad);

    //si disponibilidad == 0 significa que no hay ningun viajeTour y entonces si hay lugares
    if (disponibilidad[0].length > 0) {
        disponibilidad = disponibilidad[0][0];
        if (disponibilidad.lugares_disp < Number(no_boletos)) {
            res.json({ disponible: false });
        }


    }
    res.json({ disponible: true });
});

app.get('/horarios-usuario/:id_usuario', async (req, res) => {
    try {
        const { id_usuario } = req.params;

        if (!id_usuario) {
            return res.status(400).json({
                error: true,
                message: 'El id_usuario es requerido'
            });
        }

        const query = `
            SELECT 
                hs.id,
                hs.dia_semana,
                hs.hora_entrada,
                hs.hora_salida,
                hs.tolerancia_minutos,
                hs.descanso,
                hs.activo,
                hs.created_at,
                hs.updated_at,
                CASE 
                    WHEN hs.dia_semana = 1 THEN 'Lunes'
                    WHEN hs.dia_semana = 2 THEN 'Martes'
                    WHEN hs.dia_semana = 3 THEN 'Miércoles'
                    WHEN hs.dia_semana = 4 THEN 'Jueves'
                    WHEN hs.dia_semana = 5 THEN 'Viernes'
                    WHEN hs.dia_semana = 6 THEN 'Sábado'
                    WHEN hs.dia_semana = 7 THEN 'Domingo'
                    ELSE 'Desconocido'
                END as nombre_dia
            FROM horarios_semanales hs
            WHERE hs.id_usuario = ?
            ORDER BY hs.dia_semana ASC
        `;

        const [horarios] = await db.pool.query(query, [id_usuario]);

        return res.json({
            error: false,
            data: horarios,
            total: horarios.length
        });

    } catch (error) {
        console.error('Error obteniendo horarios del usuario:', error);
        return res.status(500).json({
            error: true,
            message: 'Error obteniendo los horarios',
            details: error.message
        });
    }
});

app.get('/horarios-usuario-eventual/:id_usuario', async (req, res) => {
    try {
        const { id_usuario } = req.params;

        if (!id_usuario) {
            return res.status(400).json({
                error: true,
                message: 'El id_usuario es requerido'
            });
        }

        const query = `
            SELECT 
                he.id,
                he.id_usuario,
                he.fecha_especifica,
                he.hora_entrada,
                he.hora_salida,
                he.utilizado,
                he.activo,
                he.created_at,
                he.updated_at,
                DATE_FORMAT(he.fecha_especifica, '%d/%m/%Y') as fecha_formateada,
                CASE 
                    WHEN he.utilizado = 1 THEN 'Utilizado'
                    ELSE 'Pendiente'
                END as estado_utilizacion,
                CASE 
                    WHEN he.activo = 1 THEN 'Activo'
                    ELSE 'Inactivo'
                END as estado_horario
            FROM horarios_eventuales he
            WHERE he.id_usuario = ?
            ORDER BY he.fecha_especifica ASC
        `;

        const [horariosEventuales] = await db.pool.query(query, [id_usuario]);

        return res.json({
            error: false,
            data: horariosEventuales,
            total: horariosEventuales.length
        });

    } catch (error) {
        console.error('Error obteniendo horarios eventuales del usuario:', error);
        return res.status(500).json({
            error: true,
            message: 'Error obteniendo los horarios eventuales',
            details: error.message
        });
    }
});

app.post('/horarios-usuario-crear', async (req, res) => {
    try {
        const { id_usuario, horarios } = req.body;

        if (!id_usuario || !horarios || !Array.isArray(horarios)) {
            return res.status(400).json({
                error: true,
                message: 'Se requiere id_usuario y horarios (array)'
            });
        }

        const connection = await db.pool.getConnection();
        await connection.beginTransaction();

        try {
            // Eliminar horarios existentes del usuario
            await connection.query(
                'DELETE FROM horarios_semanales WHERE id_usuario = ?',
                [id_usuario]
            );

            // Insertar nuevos horarios
            for (const horario of horarios) {
                const {
                    dia_semana,
                    tolerancia_minutos = 15,
                    activo = 1
                } = horario;

                // Extraer hora_entrada y hora_salida como variables mutables
                let { hora_entrada, hora_salida } = horario;

                // Validar campos requeridos
                if (!dia_semana) {
                    await connection.rollback();
                    return res.status(400).json({
                        error: true,
                        message: 'Cada horario requiere dia_semana'
                    });
                }

                // Validar que dia_semana esté entre 1 y 7
                if (dia_semana < 1 || dia_semana > 7) {
                    await connection.rollback();
                    return res.status(400).json({
                        error: true,
                        message: 'dia_semana debe estar entre 1 (Lunes) y 7 (Domingo)'
                    });
                }

                // Determinar si es día de descanso (cuando activo = 0)
                const descanso = activo === 0 ? 1 : 0;

                // Si es día laboral (descanso = 0), requiere horas
                if (descanso === 0) {
                    if (!hora_entrada || !hora_salida || hora_entrada.trim() === '' || hora_salida.trim() === '') {
                        await connection.rollback();
                        return res.status(400).json({
                            error: true,
                            message: 'Los días laborales requieren hora_entrada y hora_salida'
                        });
                    }
                } else {
                    // Si es día de descanso, las horas pueden ser vacías o nulas
                    hora_entrada = hora_entrada && hora_entrada.trim() !== '' ? hora_entrada : null;
                    hora_salida = hora_salida && hora_salida.trim() !== '' ? hora_salida : null;
                }

                await connection.query(
                    `INSERT INTO horarios_semanales 
                     (id_usuario, dia_semana, hora_entrada, hora_salida, tolerancia_minutos, descanso, activo, created_at, updated_at) 
                     VALUES 
                     (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                    [id_usuario, dia_semana, hora_entrada, hora_salida, tolerancia_minutos, descanso, activo]
                );
            }

            await connection.commit();

            return res.json({
                error: false,
                message: 'Horarios creados exitosamente',
                total: horarios.length,
                horarios_creados: horarios
            });

        } catch (error) {
            await connection.rollback();
            console.error('Error creando horarios:', error);
            return res.status(500).json({
                error: true,
                message: 'Error creando los horarios',
                details: error.message
            });
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('Error en horarios-usuario-crear:', error);
        return res.status(500).json({
            error: true,
            message: 'Error interno del servidor',
            details: error.message
        });
    }
});

app.post('/horarios-usuario-actualizar', async (req, res) => {
    try {
        let { id, id_usuario, dia_semana, hora_entrada, hora_salida, tolerancia_minutos, activo = 1 } = req.body;

        // Validar campos requeridos
        if (!id || !id_usuario || dia_semana === undefined) {
            return res.status(400).json({
                error: true,
                message: 'Se requiere id, id_usuario y dia_semana'
            });
        }

        const connection = await db.pool.getConnection();
        await connection.beginTransaction();

        try {
            // Verificar que el horario existe y pertenece al usuario
            const [existingHorario] = await connection.query(
                'SELECT * FROM horarios_semanales WHERE id = ? AND id_usuario = ?',
                [id, id_usuario]
            );

            if (existingHorario.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    error: true,
                    message: 'Horario no encontrado o no pertenece al usuario'
                });
            }

            // Validar que dia_semana esté entre 1 y 7
            if (dia_semana < 1 || dia_semana > 7) {
                await connection.rollback();
                return res.status(400).json({
                    error: true,
                    message: 'dia_semana debe estar entre 1 (Lunes) y 7 (Domingo)'
                });
            }

            // Determinar si es día laboral o de descanso (seguimos la misma lógica que en crear)
            const descanso = activo === 0 ? 1 : 0;

            // Validar campos según si es día laboral
            if (activo === 1) {
                if (!hora_entrada || !hora_salida || hora_entrada.trim() === '' || hora_salida.trim() === '') {
                    await connection.rollback();
                    return res.status(400).json({
                        error: true,
                        message: 'Los días laborales requieren hora_entrada y hora_salida'
                    });
                }
            } else {
                // Si es día de descanso, las horas pueden ser vacías o nulas
                hora_entrada = hora_entrada && hora_entrada.trim() !== '' ? hora_entrada : null;
                hora_salida = hora_salida && hora_salida.trim() !== '' ? hora_salida : null;
            }

            // Actualizar el horario
            await connection.query(
                `UPDATE horarios_semanales 
                 SET hora_entrada = ?, hora_salida = ?, tolerancia_minutos = ?, descanso = ?, activo = ?, updated_at = NOW()
                 WHERE id = ? AND id_usuario = ?`,
                [hora_entrada, hora_salida, tolerancia_minutos || 15, descanso, activo, id, id_usuario]
            );

            await connection.commit();

            // Obtener el horario actualizado para devolverlo (no existe tabla dias_semana, usamos CASE)
            const [updatedHorario] = await connection.query(
                `SELECT
                    hs.*,
                    CASE
                        WHEN hs.dia_semana = 1 THEN 'Lunes'
                        WHEN hs.dia_semana = 2 THEN 'Martes'
                        WHEN hs.dia_semana = 3 THEN 'Miércoles'
                        WHEN hs.dia_semana = 4 THEN 'Jueves'
                        WHEN hs.dia_semana = 5 THEN 'Viernes'
                        WHEN hs.dia_semana = 6 THEN 'Sábado'
                        WHEN hs.dia_semana = 7 THEN 'Domingo'
                        ELSE 'Desconocido'
                    END as nombre_dia
                FROM horarios_semanales hs
                WHERE hs.id = ?`,
                [id]
            );

            return res.json({
                error: false,
                message: 'Horario actualizado exitosamente',
                horario: updatedHorario[0]
            });

        } catch (error) {
            await connection.rollback();
            console.error('Error actualizando horario:', error);
            return res.status(500).json({
                error: true,
                message: 'Error actualizando el horario',
                details: error.message
            });
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('Error en horarios-usuario-actualizar:', error);
        return res.status(500).json({
            error: true,
            message: 'Error interno del servidor',
            details: error.message
        });
    }
});


app.post('/horarios-usuario-eventual-crear', async (req, res) => {
    try {
        const { id_usuario, fecha_especifica, hora_entrada, hora_salida } = req.body;

        // Validar campos requeridos
        if (!id_usuario || !fecha_especifica || !hora_entrada || !hora_salida) {
            return res.status(400).json({
                error: true,
                message: 'Se requieren id_usuario, fecha_especifica, hora_entrada y hora_salida'
            });
        }

        // Validar formato de fecha (YYYY-MM-DD)
        const fechaRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!fechaRegex.test(fecha_especifica)) {
            return res.status(400).json({
                error: true,
                message: 'La fecha_especifica debe tener formato YYYY-MM-DD'
            });
        }

        // Validar formato de hora (HH:MM o HH:MM:SS)
        const horaRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])(:([0-5][0-9]))?$/;
        if (!horaRegex.test(hora_entrada) || !horaRegex.test(hora_salida)) {
            return res.status(400).json({
                error: true,
                message: 'Las horas deben tener formato HH:MM o HH:MM:SS'
            });
        }

        // Validar que hora_salida sea posterior a hora_entrada
        const [hEntrada, mEntrada] = hora_entrada.split(':');
        const [hSalida, mSalida] = hora_salida.split(':');
        const minutosEntrada = parseInt(hEntrada) * 60 + parseInt(mEntrada);
        const minutosSalida = parseInt(hSalida) * 60 + parseInt(mSalida);

        if (minutosSalida <= minutosEntrada) {
            return res.status(400).json({
                error: true,
                message: 'La hora_salida debe ser posterior a la hora_entrada'
            });
        }

        const connection = await db.pool.getConnection();
        await connection.beginTransaction();

        try {
            // Verificar que el usuario exista
            const [usuarioRows] = await connection.query(
                'SELECT id FROM usuario WHERE id = ? LIMIT 1',
                [id_usuario]
            );

            if (!usuarioRows.length) {
                await connection.rollback();
                return res.status(400).json({
                    error: true,
                    message: 'El usuario no existe'
                });
            }

            // Verificar si ya existe un horario eventual para esa fecha
            const [existenteRows] = await connection.query(
                `SELECT id FROM horarios_eventuales 
                 WHERE id_usuario = ? AND fecha_especifica = ? LIMIT 1`,
                [id_usuario, fecha_especifica]
            );

            if (existenteRows.length) {
                await connection.rollback();
                return res.status(400).json({
                    error: true,
                    message: 'Ya existe un horario eventual para esa fecha'
                });
            }

            // Insertar horario eventual
            const [result] = await connection.query(
                `INSERT INTO horarios_eventuales 
                 (id_usuario, fecha_especifica, hora_entrada, hora_salida, utilizado, activo, created_at, updated_at) 
                 VALUES (?, ?, ?, ?, 0, 1, NOW(), NOW())`,
                [id_usuario, fecha_especifica, hora_entrada, hora_salida]
            );

            await connection.commit();

            return res.json({
                error: false,
                message: 'Horario eventual creado exitosamente',
                horario_creado: {
                    id: result.insertId,
                    id_usuario,
                    fecha_especifica,
                    hora_entrada,
                    hora_salida,
                    activo: 1,
                    utilizado: 0
                }
            });

        } catch (error) {
            await connection.rollback();
            console.error('Error creando horario eventual:', error);
            return res.status(500).json({
                error: true,
                message: 'Error creando el horario eventual',
                details: error.message
            });
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('Error en horarios-usuario-eventual-crear:', error);
        return res.status(500).json({
            error: true,
            message: 'Error interno del servidor',
            details: error.message
        });
    }
});

app.delete('/horarios-eventuales-eliminar/:horarioId', async (req, res) => {
    try {
        const { horarioId } = req.params;

        if (!horarioId) {
            return res.status(400).json({
                error: true,
                message: 'El horarioId es requerido'
            });
        }

        // Validar que sea un número
        if (isNaN(parseInt(horarioId))) {
            return res.status(400).json({
                error: true,
                message: 'El horarioId debe ser un número válido'
            });
        }

        const connection = await db.pool.getConnection();
        await connection.beginTransaction();

        try {
            // Verificar que el horario eventual exista
            const [horarioRows] = await connection.query(
                `SELECT id, id_usuario, fecha_especifica, hora_entrada, hora_salida, utilizado
                 FROM horarios_eventuales 
                 WHERE id = ? LIMIT 1`,
                [horarioId]
            );

            if (!horarioRows.length) {
                await connection.rollback();
                return res.status(404).json({
                    error: true,
                    message: 'Horario eventual no encontrado'
                });
            }

            const horario = horarioRows[0];

            // No permitir eliminar si ya fue utilizado
            if (horario.utilizado === 1) {
                await connection.rollback();
                return res.status(400).json({
                    error: true,
                    message: 'No se puede eliminar un horario que ya fue utilizado'
                });
            }

            // Eliminar el horario eventual
            await connection.query(
                'DELETE FROM horarios_eventuales WHERE id = ?',
                [horarioId]
            );

            await connection.commit();

            return res.json({
                error: false,
                message: 'Horario eventual eliminado exitosamente',
                horario_eliminado: {
                    id: horario.id,
                    id_usuario: horario.id_usuario,
                    fecha_especifica: horario.fecha_especifica,
                    hora_entrada: horario.hora_entrada,
                    hora_salida: horario.hora_salida
                }
            });

        } catch (error) {
            await connection.rollback();
            console.error('Error eliminando horario eventual:', error);
            return res.status(500).json({
                error: true,
                message: 'Error eliminando el horario eventual',
                details: error.message
            });
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('Error en horarios-eventuales-eliminar:', error);
        return res.status(500).json({
            error: true,
            message: 'Error interno del servidor',
            details: error.message
        });
    }
});


/* ============================================
   CONFIGURACIÓN CLIP
============================================ */

const emailTemplateTotem = require('../templates/emailTemplate-totem-clip');

async function enviarCorreoTotem(data) {
    try {
        const html = emailTemplateTotem(data);

        const message = {
            from: process.env.MAIL,
            to: 'galeria@museocasakahlo.org',
            subject: 'Nueva venta Totem - Museo Casa Kahlo',
            html
        };

        const info = await mailer.sendMail(message);
        console.log('📧 Email enviado:', info);

        return true;

    } catch (error) {
        console.error('❌ Error enviando correo:', error.message);
        return false;
    }
}

/* ============================================
   CONFIGURACIÓN Y LLAVES
============================================ */

const CLIP_CONFIG = {
    baseURL: process.env.CLIP_API_BASE_URL || 'https://api.payclip.io',
    apiId: process.env.CLIP_API_ID,
    apiSecret: process.env.CLIP_API_SECRET,
    serial: process.env.CLIP_TERMINAL_SERIAL_NUMBER
};

const basicAuthToken = Buffer
    .from(`${CLIP_CONFIG.apiId}:${CLIP_CONFIG.apiSecret}`)
    .toString('base64');


/* ============================================
    🏆 CONFIGURACIÓN Y CONTROL GLOBAL
============================================ */
const TOTEM_ID = "TOTEM-1";

// Usamos un Map para guardar el pinpad_request_id y su estatus actual
if (!global.pagosClip) global.pagosClip = new Map();

/* ============================================
   1. CREAR PAGO
============================================ */
/* ============================================
    1. CREAR PAGO (CON AUDITORÍA DE ERRORES)
============================================ */
app.post('/clip/crear-pago', async (req, res) => {
    try {
        const { total } = req.body;
        const totalNumber = Number(total);

        if (!totalNumber || isNaN(totalNumber)) {
            return res.status(400).json({ error: true, msg: "Total inválido" });
        }

        const referencia = `${TOTEM_ID}-${Date.now()}`;

        const payload = {
            amount: totalNumber.toFixed(2),
            reference: referencia,
            serial_number_pos: CLIP_CONFIG.serial,
            preferences: {
                is_auto_return_enabled: true,
                is_tip_enabled: false,
                is_retry_enabled: true
            }
        };

        console.log("🚀 ENVIANDO A CLIP:", JSON.stringify(payload, null, 2));

        const response = await fetch(`${CLIP_CONFIG.baseURL}/f2f/pinpad/v1/payment`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basicAuthToken}`,
                'Content-Type': 'application/json',
                'Pinpad-Wait-Response': 'false'
            },
            body: JSON.stringify(payload)
        });

        // Capturamos el status code de Clip
        console.log(`📡 CLIP HTTP STATUS: ${response.status}`);

        const data = await response.json();

        if (!response.ok) {
            console.error("❌ CLIP RECHAZÓ LA PETICIÓN:", JSON.stringify(data, null, 2));
            return res.status(response.status).json({ error: true, msg: "Error Clip", detalle: data });
        }

        const requestId = data.id || data.pinpad_request_id;

        // Si llegamos aquí, el pago se creó en Clip
        console.log(`✅ PAGO CREADO EXITOSAMENTE: ${requestId}`);

        const timeout = setTimeout(async () => {
            console.log(`⏱️ Timeout backend → cancelando ${requestId}`);
            await cancelarPagoInterno(requestId);
        }, 2 * 60 * 1000);

        global.pagosClip.set(requestId, {
            status: 'PENDING',
            reference: referencia,
            amount: totalNumber,
            createdAt: Date.now(),
            timeout
        });

        res.json({ error: false, payment_request_id: requestId });

    } catch (error) {
        console.error("❌ ERROR CRÍTICO EN CREAR PAGO:", error);
        res.status(500).json({ error: true, msg: "Error interno del servidor" });
    }
});


/* ============================================
   2. CANCELAR
============================================ */
app.delete('/clip/cancelar/:id', async (req, res) => {
    try {
        await cancelarPagoInterno(req.params.id);
        res.json({ error: false });
    } catch (e) {
        res.status(500).json({ error: true });
    }
});

async function cancelarPagoInterno(requestId) {
    try {
        console.log(`📡 Solicitando cancelación física a Clip: ${requestId}`);

        // 1. Llamada directa según documentación de Clip
        const response = await fetch(`${CLIP_CONFIG.baseURL}/f2f/pinpad/v1/payment/${requestId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Basic ${basicAuthToken}`,
                'Content-Type': 'application/json'
            }
        });

        // 2. Obtener el registro actual para limpiar el timeout
        const reg = global.pagosClip.get(requestId);
        if (reg?.timeout) clearTimeout(reg.timeout);

        // 3. Actualizar estado local a FAILED de inmediato
        global.pagosClip.set(requestId, {
            ...reg,
            status: 'FAILED'
        });

        if (response.ok) {
            console.log(`🚫 TERMINAL LIBERADA: ${requestId}`);
        } else {
            const errorData = await response.json().catch(() => ({}));
            console.error(`⚠️ Clip rechazó el DELETE:`, errorData);
        }

        // 4. Programar limpieza de memoria (no borrar de inmediato para que el front alcance a ver el 'FAILED')
        limpiarPago(requestId);

    } catch (error) {
        console.error(`❌ Error crítico en cancelación:`, error.message);
    }
}

/* ============================================
   3. WEBHOOK
============================================ */
app.post('/clip/webhook', express.json(), async (req, res) => {
    try {
        const { event_type, id } = req.body;

        if (event_type === "PINPAD_INTENT_STATUS_CHANGED" && id) {
            console.log(`🔔 Webhook recibido: ${id}`);
            await actualizarEstatusDesdeClip(id);
        }

        res.sendStatus(200);
    } catch (e) {
        console.error("❌ Webhook error:", e.message);
        res.sendStatus(200);
    }
});


/* ============================================
   4. ACTUALIZAR ESTATUS DESDE CLIP
============================================ */
async function actualizarEstatusDesdeClip(id) {

    try {
        const response = await fetch(
            `${CLIP_CONFIG.baseURL}/f2f/pinpad/v1/payment?pinpadRequestId=${id}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${basicAuthToken}`,
                    'Pinpad-Include-Detail': 'true'
                }
            }
        );

        const data = await response.json();

        // 🔥 LOG MAESTRO: Aquí veremos exactamente qué responde Clip
        console.log("================ CLIP API RESPONSE ================");
        console.log(JSON.stringify(data, null, 2));
        console.log("===================================================");

        if (!response.ok || !data.status) {
            console.warn(`⚠️ Respuesta inválida de Clip: ${id}`);
            return;
        }

        let status = data.status;

        // 🔄 NORMALIZACIÓN
        if (['CREATED', 'IN_PROGRESS', 'PENDING'].includes(status)) status = 'PENDING';
        if (['COMPLETED', 'APPROVED'].includes(status)) status = 'COMPLETED';
        if (['FAILED', 'REJECTED', 'CANCELLED', 'CANCELED'].includes(status)) status = 'FAILED';

        const reg = global.pagosClip.get(id);

        // 🔥 IMPORTANTE: si no existe, ignoramos
        if (!reg) {
            console.warn(`⚠️ Pago no encontrado en memoria: ${id}`);
            return;
        }

        // 🔒 evitar duplicados SOLO en éxito
        if (reg.status === 'COMPLETED') {
            console.log(`⛔ Ya estaba completado: ${id}`);
            return;
        }

        /* ========= SUCCESS ========= */
        if (status === 'COMPLETED') {
            if (reg.timeout) clearTimeout(reg.timeout);

            console.log(`✅ COMPLETADO: ${id}`);

            global.pagosClip.set(id, {
                ...reg,
                status: 'COMPLETED'
            });

            await enviarCorreoTotem({
                total: data.amount,
                cantidad: Math.round(Number(data.amount) / 150),
                clipId: id
            });

            limpiarPago(id);
        }

        /* ========= FAILED ========= */
        else if (status === 'FAILED') {
            if (reg.timeout) clearTimeout(reg.timeout);

            console.log(`❌ CANCELADO EN TERMINAL: ${id}`);

            global.pagosClip.set(id, {
                ...reg,
                status: 'FAILED'
            });

            limpiarPago(id);
        }

    } catch (error) {
        console.error(`❌ Error Clip status (${id}):`, error.message);
    }
}


/* ============================================
   5. ESTATUS PARA FRONT
============================================ */
app.get('/clip/estatus/:id', (req, res) => {
    const pago = global.pagosClip.get(req.params.id);

    if (!pago) {
        return res.json({ status: 'NOT_FOUND' });
    }

    res.json({ status: pago.status });
});


/* ============================================
   6. LIMPIEZA MEMORIA
============================================ */
function limpiarPago(id) {
    setTimeout(() => {
        console.log(`🧹 Eliminando de memoria: ${id}`);
        global.pagosClip.delete(id);
    }, 10 * 60 * 1000); // 10 minutos
}

// Crear sesión de Stripe para eventos especiales (solo total global)
app.post('/stripe/create-checkout-session-evento-especial', async (req, res) => {
    // Este endpoint valida disponibilidad y aparta boletos antes de crear la sesión de Stripe.
    const { total, customerEmail, successUrl, cancelUrl, metadata } = req.body;

    if (!total || total <= 0) {
        return res.status(400).json({ error: true, msg: 'El total debe ser mayor a 0' });
    }

    const amountInCents = Math.round(total * 100);
    const no_boletos = Number(metadata?.no_boletos);
    const eventoId = metadata?.tourId || metadata?.eventoId || null;
    const fecha = metadata?.fecha_ida; // expected 'YYYY-MM-DD'
    const horaRaw = metadata?.horaCompleta; // expected 'HH:mm' or 'HH:mm:ss'

    // Validar que venga cliente_id (no debe ser null/0/indefinido)
    const clienteIdRaw = metadata?.cliente_id ?? metadata?.clienteId ?? null;
    const clienteId = clienteIdRaw != null ? Number(clienteIdRaw) : null;
    if (!clienteId || isNaN(clienteId) || clienteId <= 0) {
        return res.status(400).json({ error: true, msg: 'Falta parámetro obligatorio: cliente_id' });
    }

    if (!eventoId || !fecha || !horaRaw) {
        return res.status(400).json({ error: true, msg: 'Faltan parámetros de evento (eventoId, fecha, hora, no_boletos)' });
    }

    const hora = normalizarHora(horaRaw);

    let connection;

    try {
        connection = await db.pool.getConnection();

        // Iniciamos transacción para bloquear cupo
        await connection.beginTransaction();

        // Buscar horario del evento y bloquear fila (hora_inicio debe coincidir exactamente)
        const selectQuery = `SELECT id, evento_id, fecha, hora_inicio, cupo_total, cupo_disponible FROM eventos_especiales_horarios WHERE evento_id = ? AND fecha = ? AND activo = 1 AND hora_inicio = ? LIMIT 1 FOR UPDATE`;
        const [rows] = await connection.query(selectQuery, [eventoId, fecha, hora]);
        const horario = rows[0];

        if (!horario) {
            await connection.rollback();
            connection.release();
            return res.status(200).json({ error: true, msg: 'Horario no encontrado para ese evento/fecha/hora' });
        }

        const cupoMaxDisponible = Number(horario.cupo_total);
        if (cupoMaxDisponible < no_boletos) {
            await connection.rollback();
            connection.release();
            return res.status(200).json({ error: true, msg: 'Cupo no disponible' });
        }

        // Formatear fecha/hora para campos created_at/updated_at
        let now = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', hour12: false });
        let [datePart, timePart] = now.split(', ');
        let [day, month, year] = datePart.split('/');
        let [hours, minutes, seconds] = timePart.split(':');
        month = month.padStart(2, '0');
        day = day.padStart(2, '0');
        hours = hours.padStart(2, '0');
        minutes = minutes.padStart(2, '0');
        seconds = seconds.padStart(2, '0');
        const fechaNow = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

        // 1) Preparar datos para venta (preventa) con pagado=0 y total=0 para reservar
        const tipos_boletos = metadata?.tipos_boletos ? metadata.tipos_boletos : JSON.stringify({ tipoA: no_boletos });
        const nombre_cliente = metadata?.nombre_cliente || metadata?.nombre || '';
        const correo = metadata?.correo || customerEmail || '';
        const fecha_evento_hora = `${fecha} ${hora}`;

        // Asegurar que exista un registro en `viajeTour` para este horario del evento.
        // Usaremos `viajeTour` para referenciar en `venta` y para manejar disponibilidad.
        let viajeTourId = null;
        let disponibilidad = 0;

        const horaDividida = hora.split(':');
        let query = `SELECT 
                        * 
                        FROM viajeTour 
                        WHERE CAST(fecha_ida AS DATE) = '${fecha}'
                        AND DATE_FORMAT(CAST(fecha_ida AS TIME), '%H:%i') = '${horaDividida[0]}:${horaDividida[1]}'
                        AND tour_id = ${eventoId};`;

        const [vtRows] = await connection.query(query);
        if (vtRows && vtRows[0]) {
            viajeTourId = vtRows[0].id;
            disponibilidad = vtRows[0].lugares_disp;
            if (disponibilidad < Number(no_boletos)) {
                await connection.rollback();
                connection.release();
                return res.status(200).json({ error: true, msg: "Cupo no disponible" });
            }
        } else {
            // Al crear, asegurarnos de almacenar el tour_id (eventoId) — no puede ser NULL
            const [insVt] = await connection.query(`INSERT INTO viajeTour (fecha_ida, fecha_regreso, lugares_disp, created_at, updated_at, tour_id) VALUES (?, ?, ?, ?, ?, ?)`, [fecha_evento_hora, fecha_evento_hora, horario.cupo_total, fechaNow, fechaNow, eventoId]);
            viajeTourId = insVt.insertId;
            disponibilidad = horario.cupo_total;
        }

        const insertQuery = `INSERT INTO venta (id_reservacion, no_boletos, tipos_boletos, total, pagado, fecha_compra, comision, status_traspaso, fecha_comprada, created_at, updated_at, nombre_cliente, correo, cliente_id, viajeTour_id) VALUES (?, ?, ?, '0', '0', ?, '0.0', '0', ?, ?, ?, ?, ?, ?, ?)`;
        const clienteIdParam = Number(metadata?.cliente_id);
        const [ins] = await connection.query(insertQuery, ['E', no_boletos, tipos_boletos, fechaNow, fecha_evento_hora, fechaNow, fechaNow, nombre_cliente, correo, clienteIdParam, viajeTourId]);
        const ventaId = ins.insertId;

        // Generar id_reservacion similar al flujo normal: <insertId>E<nombre><apellido>
        let id_reservacion = `E${ventaId}`;
        if (metadata?.cliente_id) {
            const [clientRows] = await connection.query('SELECT nombres, apellidos FROM usuario WHERE id = ? LIMIT 1', [metadata.cliente_id]);
            if (clientRows && clientRows[0]) {
                const c = clientRows[0];
                id_reservacion = `${ventaId}E${helperName((c.nombres || '').split(' '))}${helperName((c.apellidos || '').split(' '))}`;
            }
        }

        await connection.query('UPDATE venta SET id_reservacion = ? WHERE id = ?', [id_reservacion, ventaId]);

        // 2) Reducir cupo disponible en el horario
        const newCupo = Math.max(0, disponibilidad - no_boletos);

        //actualizar cupo en viajeTour
        await connection.query('UPDATE viajeTour SET lugares_disp = ?, updated_at = ? WHERE id = ?', [newCupo, fechaNow, viajeTourId]);

        //actualizar cupo en horarios
        await connection.query('UPDATE eventos_especiales_horarios SET cupo_disponible = ?, updated_at = ? WHERE id = ?', [newCupo, fechaNow, horario.id]);




        // Commit para confirmar la reserva temporal
        await connection.commit();
        connection.release();

        // 3) Crear la sesión de Stripe
        const lineItems = [
            {
                price_data: {
                    currency: 'mxn',
                    product_data: {
                        name: 'Evento Especial',
                        description: 'Pago de evento especial'
                    },
                    unit_amount: amountInCents
                },
                quantity: 1
            }
        ];

        let session;
        try {
            session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: lineItems,
                mode: 'payment',
                success_url: successUrl,
                cancel_url: `${cancelUrl}?session_id={CHECKOUT_SESSION_ID}`,
                customer_email: customerEmail,
                metadata: { ...metadata, evento_especial: 'true', total: total.toString(), ventaId: String(ventaId) },
                expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
                billing_address_collection: 'auto'
            },
                {
                    stripeAccount: 'acct_1SAz5b3CVvaJXMYX', // ID de la cuenta conectada osea la cuenta del museo
                }
            );
        } catch (stripeError) {
            // Si falla Stripe, intentar restaurar cupo y marcar venta como devuelta
            try {
                const revertConn = await db.pool.getConnection();
                await revertConn.beginTransaction();
                await revertConn.query('UPDATE eventos_especiales_horarios SET cupo_disponible = cupo_disponible + ? WHERE id = ?', [no_boletos, horario.id]);
                await revertConn.query(`UPDATE venta SET boletos_devueltos = 1, status_traspaso = 99, updated_at = ? WHERE id = ?`, [fechaNow, ventaId]);
                await revertConn.commit();
                revertConn.release();
            } catch (revertErr) {
                console.error('Error revirtiendo reserva tras fallo Stripe:', revertErr);
            }

            console.error('Error creando sesión de Stripe para evento especial:', stripeError);
            return res.status(400).json({ error: true, msg: stripeError.message || 'Error al crear sesión Stripe' });
        }

        // 4) Actualizar venta con session_id e id_reservacion
        try {
            const conn2 = await db.pool.getConnection();
            await conn2.query('UPDATE venta SET session_id = ? WHERE id = ?', [session.id, ventaId]);
            conn2.release();
        } catch (updErr) {
            console.error('Error actualizando venta con session_id:', updErr);
        }

        return res.json({ sessionId: session.id, url: session.url, error: false });

    } catch (error) {
        if (connection) {
            try { await connection.rollback(); } catch (e) { }
            try { connection.release(); } catch (e) { }
        }
        console.error('Error creando sesión de Stripe para evento especial:', error);
        return res.status(500).json({ error: true, msg: error.message || 'Error interno' });
    }
});

// Endpoint para crear la venta completa de un evento especial (sin Stripe)
app.post('/crear/evento-especial', express.json(), async (req, res) => {
    // Esta ruta replica la lógica de '/stripe/create-checkout-session-evento-especial'
    // pero en lugar de crear una sesión de Stripe, crea la venta definitiva
    const { total, evento_id, fecha, horario_id, hora, no_boletos, items, tipos_boletos, cliente, metadata, metodo_pago } = req.body;

    if (!total || Number(total) <= 0) {
        return res.status(400).json({ error: true, msg: 'El total debe ser mayor a 0' });
    }

    const eventoId = evento_id || (metadata && (metadata.eventoId || metadata.evento_id));
    const fechaVal = fecha || (metadata && metadata.fecha);
    const horaVal = hora || (metadata && metadata.hora);
    const boletosNum = Number(no_boletos || (metadata && metadata.no_boletos) || 0);

    if (!eventoId || !fechaVal || !horaVal || !boletosNum || boletosNum <= 0) {
        return res.status(400).json({ error: true, msg: 'Faltan parámetros de evento (eventoId, fecha, hora, no_boletos)' });
    }

    let connection;
    try {
        connection = await db.pool.getConnection();
        await connection.beginTransaction();

        // Buscar horario del evento (aseguramos coincidencia exacta de hora)
        const selectQuery = `SELECT id, evento_id, fecha, hora_inicio, cupo_total FROM eventos_especiales_horarios WHERE evento_id = ? AND fecha = ? AND activo = 1 AND hora_inicio = ? LIMIT 1 FOR UPDATE`;
        const [rows] = await connection.query(selectQuery, [eventoId, fechaVal, horaVal]);
        const horario = rows[0];

        if (!horario) {
            await connection.rollback();
            connection.release();
            return res.status(200).json({ error: true, msg: 'Horario no encontrado para ese evento/fecha/hora' });
        }

        // Verificar disponibilidad usando la función existente
        const disponible = verificarDisponibilidad(boletosNum, eventoId, fechaVal, horaVal);
        if (disponible == false) {
            await connection.rollback();
            connection.release();
            return res.status(200).json({ error: true, msg: 'Cupo no disponible' });
        }

        // Fecha/hora para campos
        let now = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', hour12: false });
        let [datePart, timePart] = now.split(', ');
        let [day, month, year] = datePart.split('/');
        let [hours, minutes, seconds] = timePart.split(':');
        month = month.padStart(2, '0');
        day = day.padStart(2, '0');
        hours = hours.padStart(2, '0');
        minutes = minutes.padStart(2, '0');
        seconds = seconds.padStart(2, '0');
        const fechaNow = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

        // Asegurar existencia de registro en viajeTour
        const fecha_evento_hora = `${fechaVal} ${horaVal}`;
        let viajeTourId = null;
        let cupoDisponible = null;
        const [vtRows] = await connection.query('SELECT id, lugares_disp FROM viajeTour WHERE fecha_ida = ? AND tour_id = ? LIMIT 1', [fecha_evento_hora, eventoId]);
        if (vtRows && vtRows[0]) {
            viajeTourId = vtRows[0].id;
            cupoDisponible = Number(vtRows[0].lugares_disp);
            // Reducir cupo inmediatamente
            const nuevoCupo = Math.max(0, cupoDisponible - boletosNum);
            await connection.query('UPDATE viajeTour SET lugares_disp = ?, updated_at = ? WHERE id = ?', [nuevoCupo, fechaNow, viajeTourId]);
        } else {
            // Crear viajeTour con cupo inicial igual al cupo del horario menos los boletos que acabamos de vender
            const initialCupo = Math.max(0, Number(horario.cupo_total) - boletosNum);
            const [insVt] = await connection.query(`INSERT INTO viajeTour (fecha_ida, fecha_regreso, lugares_disp, created_at, updated_at, tour_id) VALUES (?, ?, ?, ?, ?, ?)`, [fecha_evento_hora, fecha_evento_hora, initialCupo, fechaNow, fechaNow, eventoId]);
            viajeTourId = insVt.insertId;
        }

        // Preparar campos para insertar venta
        const tiposBoletosStr = (typeof tipos_boletos === 'string') ? tipos_boletos : JSON.stringify(tipos_boletos || {});
        let nombre_cliente = cliente?.nombres ? `${cliente.nombres} ${cliente.apellidos || ''}`.trim() : ((metadata && (metadata.nombre_cliente || metadata.nombre)) || '');
        const correo = cliente?.correo || (metadata && (metadata.customerEmail || metadata.customer_email)) || '';

        // Si no se proporciona cliente_id, buscar por correo y crear usuario si no existe
        let clienteIdParam = null;
        let clienteExiste = null;
        let password = null;
        if (!clienteIdParam) {
            if (!correo) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({ error: true, msg: 'Falta correo del cliente' });
            }

            const [existCorreo] = await connection.query('SELECT * FROM usuario WHERE correo = ? LIMIT 1', [correo]);
            if (existCorreo && existCorreo[0]) {
                clienteExiste = true;
                clienteIdParam = existCorreo[0].id;
                // prefer names from DB
                nombre_cliente = `${existCorreo[0].nombres || ''} ${existCorreo[0].apellidos || ''}`.trim();
            } else {
                clienteExiste = false;
                // generar password y crear usuario
                password = generarPassword();
                const salt = await bcryptjs.genSalt(10);
                const hashedPassword = await bcryptjs.hash(password, salt);
                const nowDate = fechaNow;
                const insertUserQuery = `INSERT INTO usuario (nombres, apellidos, correo, telefono, password, isClient, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`;
                const nombresVal = cliente?.nombres || (metadata && metadata.nombre_cliente) || '';
                const apellidosVal = cliente?.apellidos || (metadata && metadata.apellidos_cliente) || '';
                const telefonoVal = cliente?.telefono || '';
                const [newClient] = await connection.query(insertUserQuery, [nombresVal, apellidosVal, correo, telefonoVal, hashedPassword, nowDate, nowDate]);
                clienteIdParam = newClient.insertId;
                nombre_cliente = `${nombresVal} ${apellidosVal}`.trim();
            }
        }

        const metodoPagoVal = metodo_pago;
        const insertQuery = `INSERT INTO venta (id_reservacion, no_boletos, tipos_boletos, total, pagado, fecha_compra, comision, status_traspaso, fecha_comprada, created_at, updated_at, nombre_cliente, correo, metodo_pago, cliente_id, viajeTour_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const pagadoFlag = 1; // venta completa pagada (sin Stripe)
        const [ins] = await connection.query(insertQuery, ['E', boletosNum, tiposBoletosStr, Number(total).toFixed(2), pagadoFlag, fechaNow, '0.0', '0', fecha_evento_hora, fechaNow, fechaNow, nombre_cliente, correo, metodoPagoVal, clienteIdParam, viajeTourId]);
        const ventaId = ins.insertId;

        // Generar id_reservacion
        let id_reservacion = `E${ventaId}`;
        if (clienteIdParam) {
            try {
                const [clientRows] = await connection.query('SELECT nombres, apellidos FROM usuario WHERE id = ? LIMIT 1', [clienteIdParam]);
                if (clientRows && clientRows[0]) {
                    const c = clientRows[0];
                    id_reservacion = `E${ventaId}${String(c.nombres || '').substring(0, 3)}${String(c.apellidos || '').substring(0, 3)}`;
                }
            } catch (e) {
                // ignore
            }
        }

        await connection.query('UPDATE venta SET id_reservacion = ? WHERE id = ?', [id_reservacion, ventaId]);

        await connection.commit();
        connection.release();

        // Enviar correo de confirmación (intento, sin bloquear la respuesta)
        try {
            await enviarCorreoBoletoAsignado({ id_reservacion, nombre_cliente, correo, fecha: fechaVal, hora: horaVal, no_boletos: boletosNum, total: Number(total).toFixed(2), tipos_boletos: tipos_boletos });
        } catch (e) {
            console.warn('No se pudo enviar correo de confirmación:', e.message || e);
        }

        return res.status(200).json({ error: false, msg: 'Venta creada correctamente', data: { ventaId, id_reservacion } });

    } catch (error) {
        if (connection) {
            try { await connection.rollback(); } catch (e) { }
            try { connection.release(); } catch (e) { }
        }
        console.error('Error creando venta evento especial:', error);
        return res.status(500).json({ error: true, msg: error.message || 'Error interno' });
    }
});

module.exports = app