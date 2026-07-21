const express = require("express");
const router = express.Router();
require("dotenv").config();
const fetch = require("node-fetch");

// ⚙️ Tu API key (misma que usas para Places)
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// Verificación inicial
if (!API_KEY) {
    console.warn("ADVERTENCIA: GOOGLE_PLACES_API_KEY no está definida en process.env. La traducción fallará.");
}

const { Translate } = require("@google-cloud/translate").v2;

const translateClient = new Translate({
    key: API_KEY
});

/**
 * POST /traductor/translate
 * Body: { text: string, targetLang: string, sourceLang?: string }
 */
router.post("/translate", async (req, res) => {
    const { text, targetLang, sourceLang = "es" } = req.body;

    if (!text || !targetLang) {
        return res.status(400).json({
            error: true,
            msg: "Missing parameters: text or targetLang"
        });
    }

    try {
        console.log(`🔵 Traduciendo "${text.substring(0, 40)}..." a ${targetLang}`);

        const [translated] = await translateClient.translate(text, {
            from: sourceLang,
            to: targetLang
        });

        return res.json({
            error: false,
            translatedText: translated
        });

    } catch (e) {
        console.error("🔴 Error Google API:", e.message);

        return res.status(500).json({
            error: true,
            msg: "Translation failed",
            details: e.message
        });
    }
});

module.exports = router;