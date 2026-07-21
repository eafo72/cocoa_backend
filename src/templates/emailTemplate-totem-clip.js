module.exports = function generarEmailTotem(data) {

  return `
    <html>
      <body style="font-family: Arial; background:#f5f5f5; padding:20px;">
        
        <div style="max-width:600px; margin:auto; background:white; padding:30px; border-radius:10px;">
          
          <h2 style="color:#a01e24; text-align:center;">
            Nueva venta en Totem
          </h2>

          <p style="font-size:16px;">
            Se ha realizado una compra con tarjeta en el totem.
          </p>

          <hr>

          <p><b>Total:</b> $${data.total} MXN</p>
          <p><b>Fotos:</b> ${data.cantidad}</p>

          <hr>

          <p style="font-size:12px; color:#888;">
            ${new Date().toLocaleString()}
          </p>

        </div>

      </body>
    </html>
  `;
};