const express = require('express')
const app = express.Router()
const auth = require('../middlewares/authorization')
const mailer = require('../controller/mailController')


app.post('/send', auth, async (req, res) => {

    try {
        const { correo_destino, asunto, mensaje } = req.body

        if (!correo_destino || !asunto || !mensaje) {
            return res.status(400).json({ msg: 'Faltan parámetros obligatorios.', error: true });
        }

        let message = {
            from: process.env.MAIL,
            to: correo_destino,
            subject: asunto,
            text: mensaje
        }

        const info = await mailer.sendMail(message);
        console.log('Email enviado al admin:', info);

        res.status(200).json({
            error: false,
            msg: `Correo enviado.`
        });

    } catch (error) {
        console.error('Error en /send:', error);
        res.status(500).json({ msg: 'Error interno', error: true, details: error.message });
    }

});


module.exports = app
