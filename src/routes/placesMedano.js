const express = require("express");
const router = express.Router();
require("dotenv").config();
const fetch = require("node-fetch");

// ⚙️ Tu API key de Google Maps
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// 📍 CONSTANTES GEOGRÁFICAS: DISTRITO MEDANO (Centro aprox: Mango Deck / The Office)
const MEDANO_LAT = "22.8895359";
const MEDANO_LNG = "-109.9035611";
const MEDANO_RADIUS = "2000"; // 1.2km para cubrir toda la franja

// ============================================================================
// 1) /places-medano/lugares → Búsqueda manual
// ============================================================================
router.get("/lugares", async (req, res) => {
    try {
        const lat = req.query.lat || MEDANO_LAT;
        const lng = req.query.lng || MEDANO_LNG;
        const radius = req.query.radius || MEDANO_RADIUS;
        const type = req.query.type || null;
        const keyword = req.query.keyword || null;

        let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&key=${API_KEY}`;

        if (type) url += `&type=${type}`;
        if (keyword) url += `&keyword=${keyword}`;

        const response = await fetch(url);
        const data = await response.json();

        return res.json({
            ok: true,
            lugares: data.results,
            next_page_token: data.next_page_token || null
        });

    } catch (error) {
        console.error("Error en /places-medano/lugares:", error);
        res.status(500).json({ ok: false, error: "Error obteniendo lugares del Medano" });
    }
});

// ============================================================================
// 2) Helper → Función interna para paginación
// ============================================================================
async function buscarCategoria(type, lat, lng, radius) {
    let resultados = [];
    let nextPageToken = null;

    for (let i = 0; i < 3; i++) {
        let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${type}&key=${API_KEY}`;

        if (nextPageToken) url += `&pagetoken=${nextPageToken}`;

        const resp = await fetch(url);
        const data = await resp.json();

        if (data.results) resultados = resultados.concat(data.results);

        if (!data.next_page_token) break;

        nextPageToken = data.next_page_token;
        // Espera obligatoria de Google entre páginas
        await new Promise(r => setTimeout(r, 2000));
    }

    return resultados;
}

// ============================================================================
// 3) /places-medano/todo → Genera la "Base de Datos" local
// ============================================================================
router.get("/todo", async (req, res) => {
    try {
        const categorias = {
            restaurantes: "restaurant",
            bares: "bar",
            hoteles: "lodging",
            actividades: "tourist_attraction",
            spas: "spa",
            vida_nocturna: "night_club",
            cafes: "cafe"
        };

        let resultadosFinales = [];

        console.log("⚡ Iniciando escaneo de Distrito Medano...");

        for (const [nombre, type] of Object.entries(categorias)) {
            // console.log(`Scraping categoría: ${nombre}...`);
            const datos = await buscarCategoria(type, MEDANO_LAT, MEDANO_LNG, MEDANO_RADIUS);

            const mapeados = datos.map(x => ({
                place_id: x.place_id,
                nombre: x.name,
                categoria: nombre,
                direccion: x.vicinity,
                ubicacion: x.geometry?.location,
                rating: x.rating,
                user_ratings_total: x.user_ratings_total,
                types: x.types,
                foto: x.photos ? x.photos[0]?.photo_reference : null
            }));

            resultadosFinales = resultadosFinales.concat(mapeados);
        }

        // Eliminar duplicados
        const unicos = Object.values(
            resultadosFinales.reduce((acc, obj) => {
                if (!acc[obj.place_id]) {
                    acc[obj.place_id] = obj;
                }
                return acc;
            }, {})
        );

        res.json({
            ok: true,
            zona: "Distrito Medano",
            total: unicos.length,
            lugares: unicos
        });

    } catch (error) {
        console.error("Error en /places-medano/todo:", error);
        res.status(500).json({ ok: false, error: "Error generando todo Medano" });
    }
});

// ============================================================================
// 4) /places-medano/empresa/:place_id → Detalles individuales
// ============================================================================
router.get("/empresa/:place_id", async (req, res) => {
    try {
        const { place_id } = req.params;
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&key=${API_KEY}&language=es`;

        const resp = await fetch(url);
        const data = await resp.json();

        res.json({
            ok: true,
            empresa: data.result
        });

    } catch (error) {
        console.error("Error en /empresa:", error);
        res.status(500).json({ ok: false, error: "Error obteniendo detalles" });
    }
});

// ============================================================================
// 5) /places-medano/foto/:ref → Proxy de imágenes (CORREGIDO CORS)
// ============================================================================
router.get("/foto/:ref", async (req, res) => {
    try {
        const ref = req.params.ref;
        // Maxwidth 800 es buen balance
        const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${API_KEY}`;
        
        const response = await fetch(url);

        // --- Headers de seguridad para evitar bloqueos del navegador (Cross-Origin) ---
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Access-Control-Expose-Headers", "*");

        // Copiamos los headers útiles de Google y eliminamos los que causan conflictos
        response.headers.forEach((value, key) => {
            const lowerKey = key.toLowerCase();
            if (
                lowerKey !== "x-content-type-options" &&
                lowerKey !== "content-security-policy" &&
                lowerKey !== "access-control-allow-origin"
            ) {
                res.setHeader(key, value);
            }
        });

        // Enviamos la imagen
        response.body.pipe(res);

    } catch (error) {
        console.error("Error en /foto:", error);
        res.status(500).send("Error descargando foto");
    }
});

// ============================================================================
// 6) /places-medano/mapa-js → Cargar Google Maps JS de forma segura (NUEVO)
// ============================================================================
router.get("/mapa-js", async (req, res) => {
    try {
        // Construir la URL del script de Google Maps
        const url =
            `https://maps.googleapis.com/maps/api/js?` +
            `key=${API_KEY}` +
            `&callback=iniciarMapa` +
            `&libraries=geometry`;

        const response = await fetch(url);
        const script = await response.text();

        // ---- HEADERS PARA PERMITIR EJECUCIÓN CROSS-ORIGIN ----
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        
        // Permitir ejecución segura desde otro dominio
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
        
        // Asegurar que el navegador lo interprete como JavaScript
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        
        res.send(script);
    } catch (error) {
        console.error("Error en /places-medano/mapa-js:", error);
        res.status(500).send("// Error cargando Google Maps JS");
    }
});

module.exports = router;