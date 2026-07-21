const mailCambio = (no_boletos, fecha_ida, id_reservacion) => {
    return `
        <table style="background-color: rgb(242 246 252);margin: 0 auto;width: 80%;padding: 40px;display: flex;flex-direction: column;align-items: center;">
            <tr>
                <td style="width: 90%;">
                    <img class="content-head-img" width="100%" src="./head.jpeg" alt="head">
                </td>
            </tr>
            <tr>
                <td style="min-width: 700px;padding-top: 5rem;padding-bottom: 5rem;">
                    <p style="padding-left: 1rem;margin-bottom: 2rem;font-size: large;">Cambio de fecha en su tour exitoso</p>
                    
                    <div style="display: flex;align-items: center;">
                        <img style="margin-right: .5rem;" src="./person.jpeg" width="25px">
                        <p>Numero de boletos: ${no_boletos}</p>
                    </div>
                    
                    <div style="display: flex;align-items: center;">
                        <img style="margin-right: .5rem;" src="./reloj.jpeg" width="25px">
                        <p>Fecha de ida: ${fecha_ida}</p>
                    </div>
                    
                    <div style="display: flex;align-items: center;">
                        <img style="margin-right: .5rem;" src="./palomita.jpeg" width="25px">
                        <p>Id de reservación: ${id_reservacion}</p>
                    </div>
                </td>
            </tr>
            <tr>
                <td style="text-align: center;font-style: italic;width: 70%;padding: 0 3rem;border-top: 1px solid rgb(121 251 191);">
                    <p>Recibiste este correo porque las preferencias de correo electrónico se configuraron para recibir
                        notificaciones de MEXP Tours.</p>
                    <p>Te pedimos que no respondas a este correo electrónico. Si tienes alguna pregunta sobre tu cuenta,
                        contáctanos através de tu cuenta por medio de la aplicación.</p>
                    <p>Copyright©2023 Mexp Tours. Todos los derechos reservados.</p>
                </td>
            </tr>
        </table>`;
}

module.exports = mailCambio;