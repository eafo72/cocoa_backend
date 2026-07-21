
module.exports = function generarEmail(data) {
  // data: { nombre, fecha, horario, boletos, tablaBoletos, total, qr, ubicacionUrl }
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Confirmación de compra - Museo Casa Kahlo</title>
      </head>
      <body style="margin:0; padding:0; font-family:Arial, sans-serif; background:#e0f7fa;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#e0f7fa" style="margin:auto;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="20" cellspacing="0" border="0" style="background-color: #ffffff; border-radius:8px;">
                <tr>
                  <td style="padding-left: 40px;padding-right: 40px;">
                    <h2 style="color:#00695c; font-weight: bolder; font-family:Arial, sans-serif; text-align:center;">¡Ya tienes tus boletos para Museo Casa Kahlo!</h2>
                    <p style="font-size:16px; color:#004d40; text-align:center;">Resumen de tu compra:</p>
                    <p style="font-size:16px; color:#004d40;">Adquiriste <b>${data.boletos}</b> boletos para:</p>
                    <ul style="list-style:none; padding:0;">
                      <li><span style="font-weight:bold; color:#00695c;">${data.fecha}</span></li>
                      <li><span style="font-weight:bold; color:#00695c;">Horario de recorrido: ${data.horario}</span></li>
                    </ul>
                    <div style="margin:20px 0;">
                      ${data.tablaBoletos}
                    </div>
                    <p style="font-size:16px; color:#004d40;">Para acceder al museo presenta tu código QR en cualquier dispositivo móvil o impresión.</p>
                    <div style="text-align:center; margin:20px 0;">
                      <img src="cid:qrImage" alt="Código QR" style="width:120px; height:120px;" />
                    </div>
                    <p style="font-size:16px; color:#004d40;">Te recomendamos llegar al museo <b>30 minutos antes</b> de que inicie tu recorrido.</p>
                    <p style="font-size:16px; color:#004d40;">Recuerda que NO hay tolerancia. En caso de retraso, podremos incorporarte en el punto del recorrido donde esté tu grupo o reprogramarte para el siguiente recorrido disponible (guiado o libre), sujeto a disponibilidad.</p>
                    <ul style="list-style:none; padding:0;">
                      <li>
                        <span style="font-weight:bold; color:#00695c;">Ubicación:</span>
                        <a href="${data.ubicacionUrl}" style="color:#1976d2; text-decoration:underline;">Aguayo 54, Del Carmen, Coyoacán, 04100, CDMX</a>
                      </li>
                      <li>
                        <span style="font-weight:bold; color:#00695c;">Fecha y hora de acceso:</span> ${data.fecha} - ${data.horario}
                      </li>
                      <li>
                        <span style="font-weight:bold; color:#00695c;">Id Reservación:</span> ${data.idReservacion}
                      </li>
                      ${
                        data.password
                          ? `<li><span style="font-weight:bold; color:#00695c;">Tu contraseña provisional:</span> ${data.password}</li>`
                          : ''
                      }
                    </ul>
                    <p style="font-size:16px; color:#004d40;">Si compraste un boleto con descuento, presenta una identificación vigente que lo compruebe al entrar.</p>
                    <p style="font-size:16px; color:#004d40;">Te recordamos que tu boleto digital es tu acceso al recorrido, queda estrictamente prohibido realizar copias del mismo. Consulta términos y condiciones del boleto digital.</p>
                    <p style="font-style:italic; color:#00695c; text-align:center; font-size:18px;">“Más amor, más familia, más México”</p>
                    <p style="font-size:14px; color:#004d40; text-align:center;">No responda a este correo. Para cualquier consulta, escriba a <a href="mailto:contacto@museocasakahlo.org" style="color:#1976d2; text-decoration:underline;">contacto@museocasakahlo.org</a></p>
                    <ul style="list-style:none; padding:0; text-align:center;">
                      <li><a href="#" style="color:#1976d2; text-decoration:underline;">Aviso de Privacidad</a></li>
                      <li><a href="#" style="color:#1976d2; text-decoration:underline;">Términos y Condiciones del boleto digital</a></li>
                    </ul>
                    <p style="font-size:12px; color:#999; text-align:center;">©Copyright 2025 Museo Casa Kahlo</p>
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
};
  