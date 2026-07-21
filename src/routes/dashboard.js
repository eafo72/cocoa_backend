/* Importing the express module and creating an instance of it. */
const express = require('express')
const app = express.Router()
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const auth = require('../middlewares/authorization')
const db = require('../config/db')

function normalizarFechaSoloDia(fecha) {
    if (!fecha) {
        return null;
    }

    if (fecha instanceof Date) {
        return fecha.toISOString().split('T')[0];
    }

    return String(fecha).split(/[ T]/)[0] || null;
}

const DASHBOARD_TICKET_PRICES = {
    tipoA: 270,
    tipoB: 130,
    tipoC: 65,
    tipoD: 250,
    tipoE: 65,
    tipoF: 65,
    tipoG: 215,
    tipoH: 65,
};

const DASHBOARD_TICKET_LABELS = {
    generalInternacional: 'General internacional',
    generalNacional: 'General nacional',
    descuentos: 'Descuentos',
    especiales: 'Boletos especiales',
};

const DASHBOARD_PAYMENT_LABELS = {
    Stripe: 'Stripe (web)',
    Efectivo: 'Efectivo',
    Pos_tarjeta: 'Terminal de tarjeta',
    Cortesia: 'Cortesias',
    Otro: 'Otro',
};

function parseDashboardDate(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }

    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return value;
}

function formatDateToIso(date) {
    return new Date(date.getTime() - (date.getTimezoneOffset() * 60000))
        .toISOString()
        .slice(0, 10);
}

function addDaysToIso(isoDate, days) {
    const date = new Date(`${isoDate}T00:00:00`);
    date.setDate(date.getDate() + days);
    return formatDateToIso(date);
}

function getDashboardRange(query) {
    const today = new Date();
    const todayIso = formatDateToIso(today);
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const defaultFrom = formatDateToIso(firstDayOfMonth);

    const from = parseDashboardDate(query.from) || defaultFrom;
    const to = parseDashboardDate(query.to) || todayIso;

    if (from > to) {
        return { error: 'El rango de fechas es inválido.' };
    }

    const rangeDays = Math.floor((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1;
    const previousTo = addDaysToIso(from, -1);
    const previousFrom = addDaysToIso(previousTo, -(rangeDays - 1));

    return {
        from,
        to,
        previousFrom,
        previousTo,
        rangeDays,
    };
}

function buildDailyComparisonSeries(from, previousFrom, rangeDays, currentRows, previousRows) {
    const currentMap = new Map(currentRows.map((row) => [normalizarFechaSoloDia(row.fecha), row]));
    const previousMap = new Map(previousRows.map((row) => [normalizarFechaSoloDia(row.fecha), row]));
    const series = [];

    for (let index = 0; index < rangeDays; index += 1) {
        const currentDate = addDaysToIso(from, index);
        const previousDate = addDaysToIso(previousFrom, index);
        const currentRow = currentMap.get(currentDate);
        const previousRow = previousMap.get(previousDate);

        series.push({
            currentDate,
            previousDate,
            currentRevenue: Number(currentRow?.revenue || 0),
            previousRevenue: Number(previousRow?.revenue || 0),
            currentTickets: Number(currentRow?.tickets || 0),
            previousTickets: Number(previousRow?.tickets || 0),
        });
    }

    return series;
}

function getDashboardCapacityExpression(vtAlias = 'vt', tAlias = 't') {
    const weekdayCase = `CASE DAYOFWEEK(${vtAlias}.fecha_ida)
        WHEN 1 THEN 'Domingo'
        WHEN 2 THEN 'Lunes'
        WHEN 3 THEN 'Martes'
        WHEN 4 THEN 'Miércoles'
        WHEN 5 THEN 'Jueves'
        WHEN 6 THEN 'Viernes'
        WHEN 7 THEN 'Sábado'
    END`;

    return `COALESCE((
        SELECT f.max_personas
        FROM fecha AS f
        WHERE f.tour_id = ${vtAlias}.tour_id
          AND f.status = 2
          AND f.max_personas IS NOT NULL
          AND f.dia = ${weekdayCase}
          AND DATE_FORMAT(f.hora_salida, '%H:%i') = DATE_FORMAT(${vtAlias}.fecha_ida, '%H:%i')
          AND (f.fecha_inicio_cupo IS NULL OR DATE(${vtAlias}.fecha_ida) >= f.fecha_inicio_cupo)
          AND (f.fecha_fin_cupo IS NULL OR DATE(${vtAlias}.fecha_ida) <= f.fecha_fin_cupo)
        ORDER BY f.id DESC
        LIMIT 1
    ), ${tAlias}.max_pasajeros, 0)`;
}

app.get('/dashboard/resumen', auth, async (req, res) => {
    try {
        const range = getDashboardRange(req.query);

        if (range.error) {
            return res.status(400).json({ error: true, msg: range.error });
        }

        const { from, to, previousFrom, previousTo, rangeDays } = range;
        const salesWhere = `v.pagado = 1 AND COALESCE(v.status_traspaso, 0) <> 99 AND DATE(v.fecha_compra) BETWEEN ? AND ?`;
        const operationsWhere = `v.pagado = 1 AND COALESCE(v.status_traspaso, 0) <> 99 AND DATE(vt.fecha_ida) BETWEEN ? AND ?`;
        const paymentMethodCase = `CASE
            WHEN COALESCE(v.status_traspaso, 0) = 98 THEN 'Cortesia'
            WHEN v.session_id IS NOT NULL AND v.session_id <> '' THEN 'Stripe'
            WHEN LOWER(COALESCE(v.metodo_pago, '')) IN ('pos_tarjeta', 'clip', 'terminal', 'tarjeta', 'pos') THEN 'Pos_tarjeta'
            WHEN LOWER(COALESCE(v.metodo_pago, '')) IN ('efectivo', '') THEN 'Efectivo'
            ELSE 'Otro'
        END`;
        const capacityExpr = getDashboardCapacityExpression('vt', 't');

        const [summaryRows] = await db.pool.query(
            `SELECT
                COALESCE(SUM(v.total), 0) AS grossRevenue,
                COALESCE(SUM(v.no_boletos), 0) AS ticketsSold,
                COUNT(*) AS transactions
            FROM venta AS v
            WHERE ${salesWhere}`,
            [from, to]
        );

        const [ticketRows] = await db.pool.query(
            `SELECT
                COALESCE(SUM(v.no_boletos), 0) AS totalTickets,
                COALESCE(SUM(v.total), 0) AS totalRevenue,
                COALESCE(SUM(CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoA')), '0') AS UNSIGNED)), 0) AS tipoA,
                COALESCE(SUM(CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoB')), '0') AS UNSIGNED)), 0) AS tipoB,
                COALESCE(SUM(CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoC')), '0') AS UNSIGNED)), 0) AS tipoC,
                COALESCE(SUM(CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoD')), '0') AS UNSIGNED)), 0) AS tipoD,
                COALESCE(SUM(CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoE')), '0') AS UNSIGNED)), 0) AS tipoE,
                COALESCE(SUM(CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoF')), '0') AS UNSIGNED)), 0) AS tipoF,
                COALESCE(SUM(CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoG')), '0') AS UNSIGNED)), 0) AS tipoG,
                COALESCE(SUM(CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.tipos_boletos, '$.tipoH')), '0') AS UNSIGNED)), 0) AS tipoH
            FROM venta AS v
            WHERE ${salesWhere}`,
            [from, to]
        );

        const [paymentRows] = await db.pool.query(
            `SELECT
                ${paymentMethodCase} AS method,
                COALESCE(SUM(v.total), 0) AS revenue,
                COALESCE(SUM(v.no_boletos), 0) AS tickets
            FROM venta AS v
            WHERE ${salesWhere}
            GROUP BY method
            ORDER BY revenue DESC`,
            [from, to]
        );

        const [currentSalesRows] = await db.pool.query(
            `SELECT
                DATE(v.fecha_compra) AS fecha,
                COALESCE(SUM(v.total), 0) AS revenue,
                COALESCE(SUM(v.no_boletos), 0) AS tickets
            FROM venta AS v
            WHERE ${salesWhere}
            GROUP BY DATE(v.fecha_compra)
            ORDER BY DATE(v.fecha_compra) ASC`,
            [from, to]
        );

        const [previousSalesRows] = await db.pool.query(
            `SELECT
                DATE(v.fecha_compra) AS fecha,
                COALESCE(SUM(v.total), 0) AS revenue,
                COALESCE(SUM(v.no_boletos), 0) AS tickets
            FROM venta AS v
            WHERE ${salesWhere}
            GROUP BY DATE(v.fecha_compra)
            ORDER BY DATE(v.fecha_compra) ASC`,
            [previousFrom, previousTo]
        );

        const [occupancyRows] = await db.pool.query(
            `SELECT
                COALESCE(SUM(slot_data.soldTickets), 0) AS soldTickets,
                COALESCE(SUM(slot_data.capacity), 0) AS capacity,
                COALESCE(SUM(slot_data.totalCheckins), 0) AS totalCheckins
            FROM (
                SELECT
                    v.viajeTour_id,
                    COALESCE(SUM(v.no_boletos), 0) AS soldTickets,
                    COALESCE(SUM(v.checkin), 0) AS totalCheckins,
                    MAX(${capacityExpr}) AS capacity
                FROM venta AS v
                INNER JOIN viajeTour AS vt ON vt.id = v.viajeTour_id
                INNER JOIN tour AS t ON t.id = vt.tour_id
                WHERE ${operationsWhere}
                GROUP BY v.viajeTour_id
            ) AS slot_data`,
            [from, to]
        );

        const [checkinsByHourRows] = await db.pool.query(
            `SELECT
                HOUR(v.updated_at) AS hour,
                COALESCE(SUM(v.checkin), 0) AS totalCheckins
            FROM venta AS v
            INNER JOIN viajeTour AS vt ON vt.id = v.viajeTour_id
            WHERE ${operationsWhere} AND COALESCE(v.checkin, 0) > 0
            GROUP BY HOUR(v.updated_at)
            ORDER BY HOUR(v.updated_at) ASC`,
            [from, to]
        );

        const [heatmapRows] = await db.pool.query(
            `SELECT
                WEEKDAY(v.fecha_compra) AS weekday,
                HOUR(v.fecha_compra) AS hour,
                COUNT(*) AS totalTransactions,
                COALESCE(SUM(v.total), 0) AS revenue
            FROM venta AS v
            WHERE ${salesWhere}
            GROUP BY WEEKDAY(v.fecha_compra), HOUR(v.fecha_compra)
            ORDER BY WEEKDAY(v.fecha_compra), HOUR(v.fecha_compra)`,
            [from, to]
        );

        const [leadTimeRows] = await db.pool.query(
            `SELECT
                CASE
                    WHEN DATEDIFF(DATE(vt.fecha_ida), DATE(v.fecha_compra)) <= 0 THEN 'Mismo día'
                    WHEN DATEDIFF(DATE(vt.fecha_ida), DATE(v.fecha_compra)) = 1 THEN '1 día'
                    WHEN DATEDIFF(DATE(vt.fecha_ida), DATE(v.fecha_compra)) BETWEEN 2 AND 3 THEN '2-3 días'
                    WHEN DATEDIFF(DATE(vt.fecha_ida), DATE(v.fecha_compra)) BETWEEN 4 AND 7 THEN '4-7 días'
                    WHEN DATEDIFF(DATE(vt.fecha_ida), DATE(v.fecha_compra)) BETWEEN 8 AND 14 THEN '8-14 días'
                    ELSE '15+ días'
                END AS bucket,
                COALESCE(SUM(v.no_boletos), 0) AS tickets,
                ROUND(AVG(DATEDIFF(DATE(vt.fecha_ida), DATE(v.fecha_compra))), 2) AS averageDays
            FROM venta AS v
            INNER JOIN viajeTour AS vt ON vt.id = v.viajeTour_id
            WHERE ${operationsWhere}
            GROUP BY bucket
            ORDER BY MIN(DATEDIFF(DATE(vt.fecha_ida), DATE(v.fecha_compra))) ASC`,
            [from, to]
        );

        const [alertsRows] = await db.pool.query(
            `SELECT
                vt.id AS viajeTourId,
                t.nombre AS tourName,
                DATE(vt.fecha_ida) AS visitDate,
                DATE_FORMAT(vt.fecha_ida, '%H:%i') AS visitTime,
                COALESCE(SUM(v.no_boletos), 0) AS soldTickets,
                MAX(${capacityExpr}) AS capacity,
                ROUND((COALESCE(SUM(v.no_boletos), 0) / NULLIF(MAX(${capacityExpr}), 0)) * 100, 2) AS occupancyRate
            FROM viajeTour AS vt
            INNER JOIN tour AS t ON t.id = vt.tour_id
            LEFT JOIN venta AS v
                ON v.viajeTour_id = vt.id
               AND v.pagado = 1
               AND COALESCE(v.status_traspaso, 0) <> 99
            WHERE DATE(vt.fecha_ida) BETWEEN ? AND ?
            GROUP BY vt.id, t.nombre, DATE(vt.fecha_ida), DATE_FORMAT(vt.fecha_ida, '%H:%i')
            HAVING capacity > 0 AND occupancyRate >= 75
            ORDER BY occupancyRate DESC, visitDate ASC, visitTime ASC
            LIMIT 8`,
            [from, to]
        );

        const [cancellationRows] = await db.pool.query(
            `SELECT
                COUNT(*) AS cancellationsCount,
                COALESCE(SUM(total), 0) AS cancellationsAmount
            FROM venta AS v
            WHERE COALESCE(v.status_traspaso, 0) = 99
              AND DATE(v.updated_at) BETWEEN ? AND ?`,
            [from, to]
        );

        const summary = summaryRows[0] || {};
        const ticketSummary = ticketRows[0] || {};
        const occupancySummary = occupancyRows[0] || {};
        const cancellationSummary = cancellationRows[0] || {};

        const grossRevenue = Number(summary.grossRevenue || 0);
        const ticketsSold = Number(summary.ticketsSold || 0);
        const transactions = Number(summary.transactions || 0);
        const averageTicket = transactions > 0 ? grossRevenue / transactions : 0;
        const soldForOccupancy = Number(occupancySummary.soldTickets || 0);
        const capacity = Number(occupancySummary.capacity || 0);
        const totalCheckins = Number(occupancySummary.totalCheckins || 0);
        const occupancyRate = capacity > 0 ? (soldForOccupancy / capacity) * 100 : 0;
        const attendanceRate = soldForOccupancy > 0 ? (totalCheckins / soldForOccupancy) * 100 : 0;

        const generalInternacionalTickets = Number(ticketSummary.tipoA || 0);
        const generalNacionalTickets = Number(ticketSummary.tipoB || 0);
        const descuentosTickets = Number(ticketSummary.tipoC || 0)
            + Number(ticketSummary.tipoE || 0)
            + Number(ticketSummary.tipoF || 0)
            + Number(ticketSummary.tipoH || 0);
        const knownSpecialTickets = Number(ticketSummary.tipoD || 0) + Number(ticketSummary.tipoG || 0);

        const estimatedKnownRevenue = (generalInternacionalTickets * DASHBOARD_TICKET_PRICES.tipoA)
            + (generalNacionalTickets * DASHBOARD_TICKET_PRICES.tipoB)
            + (descuentosTickets * DASHBOARD_TICKET_PRICES.tipoC)
            + (Number(ticketSummary.tipoD || 0) * DASHBOARD_TICKET_PRICES.tipoD)
            + (Number(ticketSummary.tipoG || 0) * DASHBOARD_TICKET_PRICES.tipoG);

        const remainingTickets = Math.max(0, Number(ticketSummary.totalTickets || 0) - (
            generalInternacionalTickets + generalNacionalTickets + descuentosTickets + knownSpecialTickets
        ));
        const remainingRevenue = Math.max(0, Number(ticketSummary.totalRevenue || 0) - estimatedKnownRevenue);

        const salesByType = [
            {
                key: 'generalInternacional',
                label: DASHBOARD_TICKET_LABELS.generalInternacional,
                tickets: generalInternacionalTickets,
                revenue: generalInternacionalTickets * DASHBOARD_TICKET_PRICES.tipoA,
            },
            {
                key: 'generalNacional',
                label: DASHBOARD_TICKET_LABELS.generalNacional,
                tickets: generalNacionalTickets,
                revenue: generalNacionalTickets * DASHBOARD_TICKET_PRICES.tipoB,
            },
            {
                key: 'descuentos',
                label: DASHBOARD_TICKET_LABELS.descuentos,
                tickets: descuentosTickets,
                revenue: descuentosTickets * DASHBOARD_TICKET_PRICES.tipoC,
            },
            {
                key: 'especiales',
                label: DASHBOARD_TICKET_LABELS.especiales,
                tickets: knownSpecialTickets + remainingTickets,
                revenue: (Number(ticketSummary.tipoD || 0) * DASHBOARD_TICKET_PRICES.tipoD)
                    + (Number(ticketSummary.tipoG || 0) * DASHBOARD_TICKET_PRICES.tipoG)
                    + remainingRevenue,
            },
        ];

        const paymentMethods = paymentRows.map((row) => ({
            key: row.method,
            label: DASHBOARD_PAYMENT_LABELS[row.method] || row.method,
            revenue: Number(row.revenue || 0),
            tickets: Number(row.tickets || 0),
        }));

        const onlineRevenue = paymentMethods
            .filter((item) => item.key === 'Stripe')
            .reduce((sum, item) => sum + item.revenue, 0);
        const boxOfficeRevenue = paymentMethods
            .filter((item) => item.key === 'Efectivo' || item.key === 'Pos_tarjeta')
            .reduce((sum, item) => sum + item.revenue, 0);
        const stripeFeesEstimated = onlineRevenue * 0.036;

        const comparisonSeries = buildDailyComparisonSeries(
            from,
            previousFrom,
            rangeDays,
            currentSalesRows,
            previousSalesRows
        );

        return res.status(200).json({
            error: false,
            range: {
                from,
                to,
                previousFrom,
                previousTo,
                rangeDays,
            },
            kpis: {
                grossRevenue,
                ticketsSold,
                transactions,
                averageTicket,
                occupancyRate,
                attendanceRate,
                estimatedStripeFees: stripeFeesEstimated,
                onlineRevenue,
                boxOfficeRevenue,
                onlineContributionRate: grossRevenue > 0 ? (onlineRevenue / grossRevenue) * 100 : 0,
                boxOfficeContributionRate: grossRevenue > 0 ? (boxOfficeRevenue / grossRevenue) * 100 : 0,
                cancellationsCount: Number(cancellationSummary.cancellationsCount || 0),
                cancellationsAmount: Number(cancellationSummary.cancellationsAmount || 0),
            },
            breakdowns: {
                salesByType,
                paymentMethods,
                salesChannels: [
                    {
                        key: 'online',
                        label: 'Venta online',
                        revenue: onlineRevenue,
                        share: grossRevenue > 0 ? (onlineRevenue / grossRevenue) * 100 : 0,
                    },
                    {
                        key: 'boxOffice',
                        label: 'Venta en taquilla',
                        revenue: boxOfficeRevenue,
                        share: grossRevenue > 0 ? (boxOfficeRevenue / grossRevenue) * 100 : 0,
                    },
                ],
                capacityAlerts: alertsRows.map((row) => ({
                    viajeTourId: row.viajeTourId,
                    tourName: row.tourName,
                    visitDate: normalizarFechaSoloDia(row.visitDate),
                    visitTime: row.visitTime,
                    soldTickets: Number(row.soldTickets || 0),
                    capacity: Number(row.capacity || 0),
                    occupancyRate: Number(row.occupancyRate || 0),
                    level: Number(row.occupancyRate || 0) >= 90 ? 'critical' : 'warning',
                })),
            },
            series: {
                salesComparison: comparisonSeries,
                checkinsByHour: checkinsByHourRows.map((row) => ({
                    hour: Number(row.hour),
                    label: `${String(row.hour).padStart(2, '0')}:00`,
                    totalCheckins: Number(row.totalCheckins || 0),
                    approximate: true,
                })),
                purchaseHeatmap: heatmapRows.map((row) => ({
                    weekday: Number(row.weekday),
                    hour: Number(row.hour),
                    totalTransactions: Number(row.totalTransactions || 0),
                    revenue: Number(row.revenue || 0),
                })),
                leadTime: leadTimeRows.map((row) => ({
                    bucket: row.bucket,
                    tickets: Number(row.tickets || 0),
                    averageDays: Number(row.averageDays || 0),
                })),
            },
            availability: {
                visitorOrigin: false,
                campaigns: false,
                discountCodes: false,
                automatedCashCut: false,
                realTimeCheckinEvents: false,
            },
            missingCapabilities: [
                {
                    key: 'visitorOrigin',
                    label: 'Origen del visitante',
                    reason: 'La venta no persiste país o ciudad de origen para construir geolocalización confiable.',
                },
                {
                    key: 'campaigns',
                    label: 'Eficiencia de campañas',
                    reason: 'No hay campos persistidos para UTM source, medium o campaign en la compra.',
                },
                {
                    key: 'discountCodes',
                    label: 'Uso de códigos de descuento',
                    reason: 'No se detectó un modelo de cupones o promociones asociado a la venta.',
                },
                {
                    key: 'automatedCashCut',
                    label: 'Corte de caja automatizado',
                    reason: 'Falta una entidad de conciliación que registre efectivo contado y vouchers físicos por corte.',
                },
                {
                    key: 'realTimeCheckinEvents',
                    label: 'Flujo exacto de check-ins por escaneo',
                    reason: 'Hoy solo existe un contador agregado por reservación; para precisión por hora hace falta una bitácora por escaneo.',
                },
            ],
        });
    } catch (error) {
        console.error('Error en /dashboard/resumen:', error);
        return res.status(500).json({ msg: 'Hubo un error generando el dashboard', error: true, details: error.message });
    }
});

module.exports = app