const db = require('../config/db');

const getFechaHoyMexico = () => {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
};

const parseFechaSolicitada = (fecha) => {
    if (!fecha) {
        return getFechaHoyMexico();
    }

    const str = String(fecha).trim();
    const match = str.match(/^(\d{4}-\d{2}-\d{2})/);

    if (!match) {
        return null;
    }

    return match[1];
};

const resolveTourId = async (tourIdOrViajeTourId) => {
    const candidate = Number(tourIdOrViajeTourId);

    if (!Number.isInteger(candidate) || candidate <= 0) {
        return null;
    }

    const [tourRows] = await db.pool.query('SELECT id FROM tour WHERE id = ? LIMIT 1', [candidate]);

    if (tourRows.length > 0) {
        return candidate;
    }

    const [viajeRows] = await db.pool.query(
        'SELECT tour_id FROM viajeTour WHERE id = ? LIMIT 1',
        [candidate]
    );

    if (viajeRows.length === 0) {
        return null;
    }

    const resolvedTourId = Number(viajeRows[0].tour_id);
    return Number.isInteger(resolvedTourId) && resolvedTourId > 0 ? resolvedTourId : null;
};

const PROMO_JOIN_SQL = `
    LEFT JOIN precios_promocionales pp ON pp.id = (
        SELECT id FROM precios_promocionales
        WHERE precio_id = p.id AND activo = 1
            AND tour_id = p.tour_id
            AND ? BETWEEN fecha_inicio_promo AND fecha_fin_promo
        ORDER BY fecha_inicio_promo DESC, id DESC
        LIMIT 1
    )
`;

const getCatalogoPreciosPorContexto = async (contexto, fechaSolicitada, tourIdOrViajeTourId = null) => {
    const fecha = parseFechaSolicitada(fechaSolicitada);

    if (!fecha) {
        throw new Error('Formato de fecha inválido. Use YYYY-MM-DD');
    }

    const tourId = await resolveTourId(tourIdOrViajeTourId);
    const hasTourContext = tourIdOrViajeTourId !== null && tourIdOrViajeTourId !== undefined && String(tourIdOrViajeTourId).trim() !== '';

    if (hasTourContext && !tourId) {
        return [];
    }

    const tourFilterSql = tourId ? ' AND p.tour_id = ?' : '';

    const [rows] = await db.pool.query(
        `SELECT p.id, p.clave, p.nombre, p.precio AS precio_base, p.price_id, p.contexto, p.tour_id,
                pp.id AS promo_id, pp.precio_promocional, pp.fecha_inicio_promo, pp.fecha_fin_promo,
                COALESCE(pp.precio_promocional, p.precio) AS precio
         FROM precios p
         ${PROMO_JOIN_SQL}
         WHERE p.contexto = ? AND p.activo = 1${tourFilterSql}
         ORDER BY p.clave`,
        tourId ? [fecha, contexto, tourId] : [fecha, contexto]
    );

    return rows.map((row) => ({
        id: row.id,
        clave: row.clave,
        nombre: row.nombre,
        precio_base: Number(row.precio_base) || 0,
        precio: Number(row.precio) || 0,
        price_id: row.price_id,
        contexto: row.contexto,
        tour_id: row.tour_id,
        es_promocional: row.promo_id != null,
        promo_id: row.promo_id,
        fecha_inicio_promo: row.fecha_inicio_promo,
        fecha_fin_promo: row.fecha_fin_promo
    }));
};

const getPreciosPorContexto = async (contexto, tiposBoletos, fechaSolicitada, tourIdOrViajeTourId = null) => {
    const claves = [...new Set(Object.keys(tiposBoletos || {}).map((clave) => String(clave).trim()).filter(Boolean))];

    if (claves.length === 0) {
        return {};
    }

    const fecha = parseFechaSolicitada(fechaSolicitada);

    if (!fecha) {
        throw new Error('Formato de fecha inválido. Use YYYY-MM-DD');
    }

    const tourId = await resolveTourId(tourIdOrViajeTourId);
    const hasTourContext = tourIdOrViajeTourId !== null && tourIdOrViajeTourId !== undefined && String(tourIdOrViajeTourId).trim() !== '';

    if (hasTourContext && !tourId) {
        return {};
    }

    const placeholders = claves.map(() => '?').join(', ');
    const tourFilterSql = tourId ? ' AND p.tour_id = ?' : '';
    const [rows] = await db.pool.query(
        `SELECT p.clave, p.precio AS precio_base, p.tour_id,
                COALESCE(pp.precio_promocional, p.precio) AS precio
         FROM precios p
         ${PROMO_JOIN_SQL}
         WHERE p.contexto = ? AND p.activo = 1${tourFilterSql} AND p.clave IN (${placeholders})`,
        tourId ? [fecha, contexto, tourId, ...claves] : [fecha, contexto, ...claves]
    );

    const precios = rows.reduce((acc, row) => {
        acc[row.clave] = Number(row.precio);
        return acc;
    }, {});

    const faltantes = claves.filter((clave) => !Number.isFinite(precios[clave]));
    if (faltantes.length > 0) {
        throw new Error(`No hay precios configurados en la tabla precios para el contexto '${contexto}' y las claves: ${faltantes.join(', ')}`);
    }

    return precios;
};

module.exports = {
    getFechaHoyMexico,
    parseFechaSolicitada,
    getCatalogoPreciosPorContexto,
    getPreciosPorContexto,
    resolveTourId
};
