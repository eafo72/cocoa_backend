const express = require('express');
const app = express.Router();
const db = require('../config/db');
const {
    parseFechaSolicitada,
    getCatalogoPreciosPorContexto,
    resolveTourId
} = require('../helpers/precios');

const getFechaActual = () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    const time = `${today.getHours()}:${today.getMinutes()}:${today.getSeconds()}`;
    return `${date} ${time}`;
};

const PROMO_JOIN_SQL = `
    LEFT JOIN precios_promocionales pp ON pp.id = (
        SELECT id FROM precios_promocionales
        WHERE precio_id = p.id AND activo = 1
            AND ? BETWEEN fecha_inicio_promo AND fecha_fin_promo
        ORDER BY fecha_inicio_promo DESC, id DESC
        LIMIT 1
    )
`;

app.get('/precios', async (req, res) => {
    try {
        const { contexto, fecha, tour_id } = req.query;
        const tourId = await resolveTourId(tour_id);

        if (fecha) {
            const fechaConsulta = parseFechaSolicitada(fecha);
            if (!fechaConsulta) {
                return res.status(400).json({ msg: 'Formato de fecha inválido. Use YYYY-MM-DD', error: true });
            }

            if (!contexto) {
                return res.status(400).json({ msg: 'El parámetro contexto es requerido cuando se consulta por fecha', error: true });
            }

            const precios = await getCatalogoPreciosPorContexto(contexto, fechaConsulta, tourId);
            return res.status(200).json({
                fecha_consultada: fechaConsulta,
                tour_id: tourId,
                data: precios
            });
        }

        let query = `SELECT p.id, p.clave, p.nombre, p.precio, p.price_id, p.contexto, p.tour_id,
                            t.nombre AS tour_nombre, t.titulo AS tour_titulo,
                            p.activo, p.created_at, p.updated_at
                     FROM precios p
                     LEFT JOIN tour t ON t.id = p.tour_id`;
        const params = [];
        const whereParts = [];

        if (contexto) {
            whereParts.push('p.contexto = ?');
            params.push(contexto);
        }

        if (tourId) {
            whereParts.push('p.tour_id = ?');
            params.push(tourId);
        }

        if (whereParts.length > 0) {
            query += ` WHERE ${whereParts.join(' AND ')}`;
        }

        query += ' ORDER BY p.contexto, p.tour_id, p.clave';

        const [rows] = await db.pool.query(query, params);
        return res.status(200).json(rows);
    } catch (error) {
        return res.status(500).json({ msg: 'Hubo un error obteniendo los precios', error: true, details: error.message });
    }
});

app.get('/obtener/:id', async (req, res) => {
    try {
        const precioId = Number(req.params.id);
        const { fecha } = req.query;

        if (!Number.isInteger(precioId) || precioId <= 0) {
            return res.status(400).json({ msg: 'Id inválido', error: true });
        }

        if (fecha) {
            const fechaConsulta = parseFechaSolicitada(fecha);
            if (!fechaConsulta) {
                return res.status(400).json({ msg: 'Formato de fecha inválido. Use YYYY-MM-DD', error: true });
            }

            const [rows] = await db.pool.query(
                `SELECT p.id, p.clave, p.nombre, p.precio AS precio_base, p.price_id, p.contexto, p.tour_id,
                        t.nombre AS tour_nombre, t.titulo AS tour_titulo, p.activo,
                        p.created_at, p.updated_at,
                        pp.id AS promo_id, pp.precio_promocional, pp.fecha_inicio_promo, pp.fecha_fin_promo,
                        COALESCE(pp.precio_promocional, p.precio) AS precio
                 FROM precios p
                 ${PROMO_JOIN_SQL}
                 LEFT JOIN tour t ON t.id = p.tour_id
                 WHERE p.id = ?`,
                [fechaConsulta, precioId]
            );

            if (rows.length === 0) {
                return res.status(404).json({ msg: 'Precio no encontrado', error: true });
            }

            const row = rows[0];
            return res.status(200).json({
                ...row,
                precio_base: Number(row.precio_base) || 0,
                precio: Number(row.precio) || 0,
                es_promocional: row.promo_id != null,
                fecha_consultada: fechaConsulta
            });
        }

        const [rows] = await db.pool.query(
            `SELECT p.id, p.clave, p.nombre, p.precio, p.price_id, p.contexto, p.tour_id,
                    t.nombre AS tour_nombre, t.titulo AS tour_titulo,
                    p.activo, p.created_at, p.updated_at
             FROM precios p
             LEFT JOIN tour t ON t.id = p.tour_id
             WHERE p.id = ?`,
            [precioId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ msg: 'Precio no encontrado', error: true });
        }

        return res.status(200).json(rows[0]);
    } catch (error) {
        return res.status(500).json({ msg: 'Hubo un error obteniendo el precio', error: true, details: error.message });
    }
});

app.get('/promocionales', async (req, res) => {
    try {
        const { precio_id, tour_id } = req.query;
        const tourId = await resolveTourId(tour_id);
        let query = `
            SELECT pp.id, pp.precio_id, pp.tour_id, pp.precio_promocional, pp.fecha_inicio_promo, pp.fecha_fin_promo,
                   pp.activo, pp.created_at, pp.updated_at,
                   p.clave, p.nombre, p.contexto, p.precio AS precio_base,
                   p.tour_id AS precio_tour_id, t.nombre AS tour_nombre, t.titulo AS tour_titulo
            FROM precios_promocionales pp
            INNER JOIN precios p ON p.id = pp.precio_id
            LEFT JOIN tour t ON t.id = p.tour_id
        `;
        const params = [];
        const whereParts = [];

        if (precio_id) {
            whereParts.push('pp.precio_id = ?');
            params.push(Number(precio_id));
        }

        if (tourId) {
            whereParts.push('p.tour_id = ?');
            params.push(tourId);
        }

        if (whereParts.length > 0) {
            query += ` WHERE ${whereParts.join(' AND ')}`;
        }

        query += ' ORDER BY pp.fecha_inicio_promo DESC, pp.id DESC';

        const [rows] = await db.pool.query(query, params);
        return res.status(200).json(rows);
    } catch (error) {
        return res.status(500).json({ msg: 'Hubo un error obteniendo precios promocionales', error: true, details: error.message });
    }
});

app.post('/promocionales', async (req, res) => {
    try {
        const { precio_id, precio_promocional, fecha_inicio_promo, fecha_fin_promo, activo = 1 } = req.body;
        const errors = [];

        const precioId = Number(precio_id);
        const precioPromo = Number(precio_promocional);

        if (!Number.isInteger(precioId) || precioId <= 0) {
            errors.push({ msg: 'El campo precio_id debe ser un id válido' });
        }

        if (!Number.isFinite(precioPromo) || precioPromo < 0) {
            errors.push({ msg: 'El campo precio_promocional debe ser un número válido mayor o igual a 0' });
        }

        if (!parseFechaSolicitada(fecha_inicio_promo)) {
            errors.push({ msg: 'El campo fecha_inicio_promo debe tener formato YYYY-MM-DD' });
        }

        if (!parseFechaSolicitada(fecha_fin_promo)) {
            errors.push({ msg: 'El campo fecha_fin_promo debe tener formato YYYY-MM-DD' });
        }

        if (parseFechaSolicitada(fecha_inicio_promo) && parseFechaSolicitada(fecha_fin_promo)
            && parseFechaSolicitada(fecha_inicio_promo) > parseFechaSolicitada(fecha_fin_promo)) {
            errors.push({ msg: 'fecha_inicio_promo no puede ser posterior a fecha_fin_promo' });
        }

        if (errors.length >= 1) {
            return res.status(400).json({
                msg: 'Errores en los parametros',
                error: true,
                details: errors
            });
        }

        const [precioRows] = await db.pool.query('SELECT id, tour_id FROM precios WHERE id = ?', [precioId]);
        if (precioRows.length === 0) {
            return res.status(404).json({ msg: 'Precio base no encontrado', error: true });
        }

        const tourId = Number(precioRows[0].tour_id);
        if (!Number.isInteger(tourId) || tourId <= 0) {
            return res.status(400).json({ msg: 'El precio base no tiene tour_id asignado', error: true });
        }

        const fecha = getFechaActual();
        const [result] = await db.pool.query(
            `INSERT INTO precios_promocionales
                (precio_id, tour_id, precio_promocional, fecha_inicio_promo, fecha_fin_promo, activo, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [precioId, tourId, precioPromo, fecha_inicio_promo, fecha_fin_promo, activo ? 1 : 0, fecha, fecha]
        );

        return res.status(201).json({ error: false, msg: 'Precio promocional creado con exito', id: result.insertId });
    } catch (error) {
        return res.status(400).json({ error: true, details: error.message });
    }
});

app.put('/promocionales/set', async (req, res) => {
    try {
        const { id, precio_promocional, fecha_inicio_promo, fecha_fin_promo, activo } = req.body;
        const errors = [];

        const promoId = Number(id);
        if (!Number.isInteger(promoId) || promoId <= 0) {
            errors.push({ msg: 'El campo id debe de contener un valor válido' });
        }

        if (precio_promocional !== undefined) {
            const precioPromo = Number(precio_promocional);
            if (!Number.isFinite(precioPromo) || precioPromo < 0) {
                errors.push({ msg: 'El campo precio_promocional debe ser un número válido mayor o igual a 0' });
            }
        }

        if (fecha_inicio_promo !== undefined && !parseFechaSolicitada(fecha_inicio_promo)) {
            errors.push({ msg: 'El campo fecha_inicio_promo debe tener formato YYYY-MM-DD' });
        }

        if (fecha_fin_promo !== undefined && !parseFechaSolicitada(fecha_fin_promo)) {
            errors.push({ msg: 'El campo fecha_fin_promo debe tener formato YYYY-MM-DD' });
        }

        if (errors.length >= 1) {
            return res.status(400).json({
                msg: 'Errores en los parametros',
                error: true,
                details: errors
            });
        }

        const fecha = getFechaActual();
        const updates = ['updated_at = ?'];
        const params = [fecha];

        if (precio_promocional !== undefined) {
            updates.push('precio_promocional = ?');
            params.push(Number(precio_promocional));
        }

        if (fecha_inicio_promo !== undefined) {
            updates.push('fecha_inicio_promo = ?');
            params.push(fecha_inicio_promo);
        }

        if (fecha_fin_promo !== undefined) {
            updates.push('fecha_fin_promo = ?');
            params.push(fecha_fin_promo);
        }

        if (activo !== undefined) {
            updates.push('activo = ?');
            params.push(activo ? 1 : 0);
        }

        params.push(promoId);

        const [result] = await db.pool.query(
            `UPDATE precios_promocionales SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ msg: 'Precio promocional no encontrado', error: true });
        }

        return res.status(200).json({ error: false, msg: 'Precio promocional actualizado con exito' });
    } catch (error) {
        return res.status(400).json({ error: true, details: error.message });
    }
});

app.delete('/promocionales/:id', async (req, res) => {
    try {
        const promoId = Number(req.params.id);

        if (!Number.isInteger(promoId) || promoId <= 0) {
            return res.status(400).json({ msg: 'Id inválido', error: true });
        }

        const [result] = await db.pool.query('DELETE FROM precios_promocionales WHERE id = ?', [promoId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ msg: 'Precio promocional no encontrado', error: true });
        }

        return res.status(200).json({ error: false, msg: 'Precio promocional eliminado con exito' });
    } catch (error) {
        return res.status(400).json({ error: true, details: error.message });
    }
});

app.put('/set', async (req, res) => {
    try {
        const { id, precio } = req.body;
        const errors = [];

        if (!id) {
            errors.push({ msg: 'El campo id debe de contener un valor' });
        }

        const precioNumero = Number(precio);
        if (!Number.isFinite(precioNumero) || precioNumero < 0) {
            errors.push({ msg: 'El campo precio debe ser un número válido mayor o igual a 0' });
        }

        if (errors.length >= 1) {
            return res.status(400).json({
                msg: 'Errores en los parametros',
                error: true,
                details: errors
            });
        }

        const fecha = getFechaActual();

        const [result] = await db.pool.query(
            `UPDATE precios SET
                precio = ?,
                updated_at = ?
            WHERE id = ?`,
            [precioNumero, fecha, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ msg: 'Precio no encontrado', error: true });
        }

        return res.status(200).json({ error: false, msg: 'Precio actualizado con exito' });
    } catch (error) {
        return res.status(400).json({ error: true, details: error.message });
    }
});

module.exports = app;
