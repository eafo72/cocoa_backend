// emailTemplate-tour-operador.js - Template para confirmación de compras múltiples sin QR ni password

module.exports = function generarEmailTourOperador(data) {
  // Datos de marca
  const COLOR_ROJO = '#a01e24';   // Museo Red oficial
  const COLOR_NEUTRO = '#1D1A14'; // Museo Neutral (Texto) oficial
  const COLOR_FONDO = '#FFFFFF';  // Fondo blanco
  const URL_RESERVACIONES = 'https://boleto.museocasakahlo.org/'; // URL para ver reservaciones

  // Función de utilidad para aplicar estilo de texto
  const styleText = (color = COLOR_NEUTRO, weight = 'normal', size = '16px') =>
    `font-family: Arial, sans-serif; color: ${color}; font-weight: ${weight}; font-size: ${size}; line-height: 1.5;`;

  // Función para generar la tabla de reservaciones
  const generarTablaReservaciones = (reservaciones) => {
    let tabla = `
      <table width="100%" cellpadding="5" cellspacing="0" border="1" style="border-collapse:collapse; margin: 15px 0;">
        <tr style="background-color:#f5f5f5">
          <th style="text-align:left; padding: 8px;">ID Reservación</th>
          <th style="text-align:center; padding: 8px;">Fecha</th>
          <th style="text-align:center; padding: 8px;">Hora</th>
          <th style="text-align:center; padding: 8px;">Boletos</th>
          <th style="text-align:right; padding: 8px;">Subtotal</th>
        </tr>
    `;

    // Calcular el total sumando los subtotales
    let totalCalculado = 0;

    reservaciones.forEach(reservacion => {
      const subtotal = Number(reservacion.subtotal) || 0;
      totalCalculado += subtotal;
      
      tabla += `
        <tr>
          <td style="padding: 8px; font-weight: bold;">${reservacion.id_reservacion}</td>
          <td style="padding: 8px; text-align: center;">${reservacion.fecha_ida}</td>
          <td style="padding: 8px; text-align: center;">${reservacion.horaCompleta}</td>
          <td style="padding: 8px; text-align: center;">${reservacion.boletos}</td>
          <td style="padding: 8px; text-align: right;">$${subtotal.toFixed(2)}</td>
        </tr>
      `;
    });

    tabla += `
        <tr style="font-weight: bold; background-color: #f9f9f9;">
          <td colspan="4" style="padding: 8px; text-align: right;">TOTAL:</td>
          <td style="padding: 8px; text-align: right;">$${totalCalculado.toFixed(2)}</td>
        </tr>
      </table>
    `;

    return tabla;
  };

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Confirmación de Compras Múltiples - Museo Casa Kahlo</title>
      </head>
      <body style="margin:0; padding:0; background-color:${COLOR_FONDO};">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="margin:auto; background-color: ${COLOR_FONDO};">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: ${COLOR_FONDO}; border-collapse: collapse;">
                
                <tr>
                  <td align="center" style="padding: 20px 40px 0 40px;">
                    <h1 style="${styleText(COLOR_ROJO, 'bolder', '40px')} text-transform: uppercase; margin: 0 0 5px 0; letter-spacing: 2px;">
                      MUSEO CASA KAHLO
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding: 5px 40px 20px 40px;">
                    <h2 style="${styleText(COLOR_ROJO, 'bold', '24px')} text-transform: uppercase; margin: 0;">¡TUS RESERVACIONES HAN SIDO</h2>
                    <h2 style="${styleText(COLOR_ROJO, 'bold', '24px')} text-transform: uppercase; margin: 0;">CONFIRMADAS!</h2>
                  </td>
                </tr>
                
                <tr>
                  <td align="center" style="padding:0 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color: ${COLOR_ROJO}; color: ${COLOR_FONDO}; font-weight: bold; font-size: 18px; padding: 10px; text-align: center; font-family: Arial, sans-serif;">
                          Resumen de tus compras
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <tr>
                  <td style="padding: 20px 40px 10px 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="${styleText()}">
                      <tr>
                        <td style="padding-bottom: 5px;">
                          <b style="color:${COLOR_ROJO};">Hola ${data.nombre_cliente},</b> has realizado las siguientes reservaciones:
                        </td>
                      </tr>
                    </table>
                    
                    <div style="margin:15px 0;">
                      ${generarTablaReservaciones(data.reservaciones)}
                    </div>

                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="${styleText()} margin-top: 15px;">
                      <tr>
                        <td width="50%" style="padding-bottom: 5px;">
                          <b>Total de boletos adquiridos:</b> ${data.total_boletos}
                        </td>
                        <td width="50%" style="padding-bottom: 5px; text-align: right;">
                          <b>Total pagado con saldo:</b> $${Number(data.total_descontado).toFixed(2)}
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top: 10px; text-align: right;">
                          <b>Saldo restante:</b> $${Number(data.saldo_restante).toFixed(2)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                
                
                

                <tr>
                  <td style="padding: 0 40px 20px 40px;">
                    <hr style="border: 0; border-top: 1px solid #ccc; width: 100%; margin: 10px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="${styleText()}">
                      <tr>
                        <td width="100%" align="left" style="padding: 10px 0; vertical-align: top; border-right: 1px solid #ffffff00;">
                          <p style="margin: 0; ${styleText(COLOR_NEUTRO, 'normal', '15px')} line-height: 1.3;">
                            <span style="font-weight: bold; color: ${COLOR_NEUTRO};">Ubicación:</span>
                            <br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Aguayo 54, Del Carmen, Coyoacán,
                            <br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;04100, CDMX
                          </p>
                          <p style="margin: 5px 0 0 23px; font-size: 14px;">
                            <a href="https://maps.app.goo.gl/9R17eVrZeTkxyNt88" style="color: #1976d2; text-decoration: underline;">Ver en Google Maps</a>
                          </p>
                        </td>
                      </tr>
                    </table>
                    <hr style="border: 0; border-top: 1px solid #ccc; width: 100%; margin: 10px 0;">
                  </td>
                </tr>

               
                <tr>
                  <td align="center" style="padding:10px 40px 0 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color: ${COLOR_ROJO}; color: ${COLOR_FONDO}; font-weight: bold; font-size: 18px; padding: 10px; text-align: center; font-family: Arial, sans-serif;">
                          Términos y Condiciones
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <tr>
                  <td style="padding: 20px 40px 20px 40px; text-align: left;">
                    <p style="${styleText()} margin-bottom: 15px;">
                      Te recordamos que tu reservación es tu acceso al recorrido, queda estrictamente prohibido realizar copias o transferencias no autorizadas. Consulta <a href="https://boleto.museocasakahlo.org/pages/terminos.html" target="_blank" style="color: #1976d2; text-decoration: underline;">términos y condiciones del boleto digital</a>.
                    </p>
                    <p style="${styleText()} margin-bottom: 15px;">
                      Las reservaciones son personales e intransferibles. Cualquier cambio debe solicitarse con al menos 24 horas de anticipación.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding: 10px 40px;">
                    <p style="${styleText(COLOR_ROJO, 'bold', '18px')} text-transform: uppercase; margin: 0 0 10px 0;">
                      MÁS AMOR, MÁS FAMILIA, MÁS MÉXICO
                    </p>
                    <hr style="border: 0; border-top: 1px solid #ccc; width: 80%; margin: 10px auto;">
                  </td>
                </tr>
                
                <tr>
                  <td align="center" style="padding: 10px 40px 20px 40px;">
                    <p style="${styleText('12px')} margin: 0 0 10px 0;">
                      No responda a este correo. Para cualquier consulta, escriba a <a href="mailto:contacto@museocasakahlo.org" style="color: #1976d2; text-decoration: underline;">contacto@museocasakahlo.org</a>
                    </p>
                    <p style="font-size: 12px; color: ${COLOR_NEUTRO}; margin: 0;">
                      <a href="https://boleto.museocasakahlo.org/pages/terminos.html" target="_blank" style="color: #1976d2; text-decoration: underline; margin: 0 5px;">Términos y Condiciones</a> | 
                      <a href="https://boleto.museocasakahlo.org/pages/aviso-privacidad.html" target="_blank" style="color: #1976d2; text-decoration: underline; margin: 0 5px;">Aviso de Privacidad</a>
                    </p>
                    <p style="font-size: 12px; color: #999; margin: 10px 0 0 0;">
                      ©Copyright 2025 Museo Casa Kahlo
                    </p>
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
