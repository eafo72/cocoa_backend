/* Importing the express module and creating an instance of it. */
const express = require('express')
const app = express.Router()
const bcryptjs = require('bcryptjs')
const jwt = require('jsonwebtoken')
const auth = require('../middlewares/authorization')
const db = require('../config/db')
const mailer = require('../controller/mailController')

const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client('418513888701-ii4jt41t9iv0um2v2b1mjt037efnucae.apps.googleusercontent.com');

const crypto = require('crypto');
const ENC = '907b12470477dce0917bf3c199c17bcb';
const IV = "e51836c72ec9e466";
const ALGO = "aes-256-cbc"

const encrypt = ((text) => {
	let cipher = crypto.createCipheriv(ALGO, ENC, IV);
	let encrypted = cipher.update(text, 'utf8', 'base64');
	encrypted += cipher.final('base64');
	return encrypted;
});

const decrypt = ((text) => {
	let decipher = crypto.createDecipheriv(ALGO, ENC, IV);
	let decrypted = decipher.update(text, 'base64', 'utf8');
	return (decrypted + decipher.final('utf8'));
});

//app.get('/obtener', auth, async (req, res) => {
app.get('/clientes', async (req, res) => {
	try {

		let query = `SELECT id, nombres, apellidos, telefono, correo, isClient, status 
                        FROM usuario 
                        WHERE isClient=1`;
		let clientes = await db.pool.query(query);
		res.json(clientes[0]);

	} catch (error) {
		res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
	}
})
app.get('/todos', async (req, res) => {
	try {

		let query = `SELECT id, nombres, apellidos, telefono, correo, isClient, isAdmin, isOperator, isInvestor, isPartner, isGuia, isSpecialist, isEventual, status 
                        FROM usuario 
                        WHERE isClient = 1 OR isAdmin = 1 OR isOperator = 1 OR isInvestor = 1 OR isPartner = 1 OR isGuia = 1 OR isSpecialist = 1 OR isEventual = 1`;
		let usuarios = await db.pool.query(query);
		res.json(usuarios[0]);

	} catch (error) {
		res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
	}
})
// CREAR UN USUARIO JWT
app.post('/crear', async (req, res) => {
	try {
		let { nombres, apellidos, correo, password, telefono, telefono_emergencia, tipo_usuario, empresa_id = 20 } = req.body

		let errors = Array();

		if (!nombres) {
			errors.push({ msg: "El campo nombres debe de contener un valor" });
		}
		if (!apellidos) {
			errors.push({ msg: "El campo apellidos debe de contener un valor" });
		}
		if (!correo) {
			errors.push({ msg: "El campo correo debe de contener un valor" });
		}
		if (!password) {
			errors.push({ msg: "El campo password debe de contener un valor" });
		}
		if (!tipo_usuario) {
			errors.push({ msg: "El campo tipo_usuario debe de contener un valor" });
		}
		if (!telefono) {
			telefono = null;
		}
		if (!telefono_emergencia) {
			telefono_emergencia = null;
		}
		if (!empresa_id){
			errors.push({ msg: "El campo empresa_id debe de contener un valor" });
		}

		// Validar que tipo_usuario sea uno de los valores permitidos
		const tiposPermitidos = ['Administrador', 'Cliente', 'Inversionista', 'Partner', 'Tour Operador', 'Colaborador', 'Especialista', 'Eventual'];
		if (!tiposPermitidos.includes(tipo_usuario)) {
			errors.push({ msg: "El campo tipo_usuario debe ser: Administrador, Cliente, Inversionista, Partner, Tour Operador, Colaborador, Especialista o Eventual" });
		}

		if (errors.length >= 1) {

			return res.status(400)
				.json({
					msg: 'Errores en los parametros',
					error: true,
					details: errors
				});

		}

		//Verificamos no exista el correo en la DB
		let query = `SELECT *
                        FROM usuario 
                        WHERE correo='${correo}'`;

		let existCorreo = await db.pool.query(query);

		if (existCorreo[0].length >= 1) {
			return res.status(400)
				.json({
					msg: 'El correo ya esta registrado',
					error: true,
				});
		}

		const salt = await bcryptjs.genSalt(10);
		const hashedPassword = await bcryptjs.hash(password, salt);

		let today = new Date();
		let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
		let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
		let fecha = date + ' ' + time;

		// Determinar qué campo establecer según el tipo de usuario
		let isAdmin = 0, isClient = 0, isInvestor = 0, isPartner = 0, isOperator = 0, isGuia = 0, isSpecialist = 0, isEventual = 0;
		
		switch(tipo_usuario) {
			case 'Administrador':
				isAdmin = 1;
				break;
			case 'Cliente':
				isClient = 1;
				break;
			case 'Inversionista':
				isInvestor = 1;
				break;
			case 'Partner':
				isPartner = 1;
				break;
			case 'Tour Operador':
				isOperator = 1;
				break;
			case 'Colaborador':
				isGuia = 1;
				break;
			case 'Especialista':
				isSpecialist = 1;
				break;
			case 'Eventual':
				isEventual = 1;
				break;
		}

		query = `INSERT INTO usuario 
					(nombres, apellidos, telefono, telefono_emergencia, correo, password, empresa_id, isAdmin, isClient, isInvestor, isPartner, isOperator, isGuia, isSpecialist, isEventual, created_at, updated_at) 
					VALUES 
					('${nombres}', '${apellidos}', '${telefono}', '${telefono_emergencia}', '${correo}', '${hashedPassword}', '${empresa_id}', ${isAdmin}, ${isClient}, ${isInvestor}, ${isPartner}, ${isOperator}, ${isGuia}, ${isSpecialist}, ${isEventual}, '${fecha}', '${fecha}')`;


		let result = await db.pool.query(query);
		result = result[0];

		const payload = {
			user: {
				id: result.insertId,
			}
		}

		jwt.sign(payload, process.env.SECRET, { expiresIn: 36000 }, (error, token) => {
			if (error) throw error
			res.status(200).json({ error: false, token: token })
			//res.json(respuestaDB)
		})
	} catch (error) {
		console.log(error);
		return res.status(400).json({
			msg: error,
		})
	}
})

// INICIAR SESIÓN
app.post('/login', async (req, res) => {
	try {
		const { email, password } = req.body

		let errors = Array();

		if (!email) {
			errors.push({ msg: "El campo email debe de contener un valor" });
		}
		if (!password) {
			errors.push({ msg: "El campo password debe de contener un valor" });
		}

		if (errors.length >= 1) {

			return res.status(400)
				.json({
					msg: 'Errores en los parametros',
					error: true,
					details: errors
				});

		}

		let query = `SELECT * 
						FROM usuario
						WHERE correo = '${email}' 
						AND status = 1`;

		let user = await db.pool.query(query);

		user = user[0];

		if (user.length === 0) {
			return res.status(400).json({ msg: 'El usuario no existe' })
		}

		user = user[0];

		const passCorrecto = await bcryptjs.compare(password, user.password)

		if (!passCorrecto) {
			return res.status(400).json({ msg: 'Password incorrecto' })
		}

		const payload = {
			user: {
				id: user.id
			},
		}

		//firma del jwt
		if (email && passCorrecto) {
			jwt.sign(payload, process.env.SECRET, { expiresIn: 3600000 }, (error, token) => {
				if (error) throw error

				res.status(200).json({ error: false, token: token })
			})
		} else {
			res.json({ msg: 'Hubo un error', error })
		}

	} catch (error) {
		console.log(error);
		res.json({ msg: 'Hubo un error', error })
	}
})

app.post('/resetpass', async (req, res) => {
	try {
		let correoClient = req.body.correo;

		// 1. Validar que el correo se haya enviado
		if (!correoClient) {
			return res.status(400).json({
				msg: 'El campo correo debe de contener un valor',
				error: true
			});
		}

		// 2. Buscar usuario, verificar estado activo y que tenga una contraseña
		let query = `SELECT id, password FROM usuario WHERE correo='${correoClient}' AND status = 1`;
		let client = await db.pool.query(query);

		// 3. Verificar si el usuario existe y si tiene una contraseña (no es de Google)
		if (client[0].length === 0) {
			return res.status(404).json({
				msg: "No se encontró el usuario o no está activo.",
				error: true
			});
		}

		const user = client[0][0];

		if (user.password === null) {
			return res.status(400).json({
				msg: "Tu usuario se registró con Google y no puede generar una nueva contraseña directamente.",
				error: true
			});
		}

		let today = new Date();
		let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
		let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
		let fecha = date + ' ' + time;

		// 4. Generar y enviar la nueva contraseña
		let newpass = Math.random().toString(36).substring(0, 6);
		let message = {
			from: process.env.MAIL,
			to: correoClient,
			subject: "Cambio de Contraseña",
			html: `<p>Su nueva contraseña es: <strong>${newpass}</strong></p>`,
		}

		await mailer.sendMail(message);

		// 5. Actualizar la contraseña en la base de datos
		const salt = await bcryptjs.genSalt(10);
		const hashedPassword = await bcryptjs.hash(newpass, salt);

		query = `UPDATE usuario SET
					password    = '${hashedPassword}', 
					updated_at  = '${fecha}'
					WHERE id    = ${user.id}`;

		await db.pool.query(query);

		res.status(200).json({ error: false, msg: "Se ha enviado el correo electrónico" });

	} catch (error) {
		console.error(error);
		res.status(500).json({ msg: 'Hubo un error en el servidor', error: true, details: error.message });
	}
});

app.get('/obtener/:id', async (req, res) => {
	try {
		let clientId = req.params.id;

		if (!clientId) {
			return res.status(400)
				.json({
					msg: 'El id debe de tener algun valor',
					error: true
				});
		}

		let query = `SELECT id, nombres, apellidos, telefono, telefono_emergencia, correo, isClient, isAdmin, isInvestor, isPartner, isOperator, isGuia, isSpecialist, isEventual, status, created_at, name_on_card, card_number, expires_month, expires_year, cvc 
						FROM usuario 
						WHERE id=${clientId} 
						`;

		let client = await db.pool.query(query);

		//console.log(client[0]);


		if (client[0][0]["card_number"] != '') {
			if (client[0][0]["card_number"] !== null && client[0][0]["card_number"] !== '' && client[0][0]["card_number"] !== 'null') {
				client[0][0]["card_number"] = decrypt(client[0][0]["card_number"]);
			}
		}
		if (client[0][0]["expires_month"] != '') {
			if (client[0][0]["expires_month"] !== null && client[0][0]["expires_month"] !== '' && client[0][0]["expires_month"] !== 'null') {
				client[0][0]["expires_month"] = decrypt(client[0][0]["expires_month"]);
			}
		}
		if (client[0][0]["expires_year"] != '') {
			if (client[0][0]["expires_year"] !== null && client[0][0]["expires_year"] !== '' && client[0][0]["expires_year"] !== 'null') {
				client[0][0]["expires_year"] = decrypt(client[0][0]["expires_year"]);
			}
		}
		if (client[0][0]["cvc"] != '') {
			if (client[0][0]["cvc"] !== null && client[0][0]["cvc"] !== '' && client[0][0]["cvc"] !== 'null') {
				client[0][0]["cvc"] = decrypt(client[0][0]["cvc"]);
			}
		}

		// Determinar tipo_usuario basado en los flags
		const userData = client[0][0];
		let tipo_usuario = null;

		if (userData.isAdmin === 1) {
			tipo_usuario = 'Administrador';
		} else if (userData.isClient === 1) {
			tipo_usuario = 'Cliente';
		} else if (userData.isInvestor === 1) {
			tipo_usuario = 'Inversionista';
		} else if (userData.isPartner === 1) {
			tipo_usuario = 'Partner';
		} else if (userData.isOperator === 1) {
			tipo_usuario = 'Tour Operador';
		} else if (userData.isGuia === 1) {
			tipo_usuario = 'Colaborador';
		} else if (userData.isSpecialist === 1) {
			tipo_usuario = 'Especialista';
		} else if (userData.isEventual === 1) {
			tipo_usuario = 'Eventual';
		}

		// Agregar tipo_usuario al objeto de respuesta
		client[0][0].tipo_usuario = tipo_usuario;

		res.status(200).json(client[0]);

	} catch (error) {
		res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
	}
})

// VERIFICAR
app.post('/verificar', auth, async (req, res) => {
	//CONFIRMAMOS QUE EL USUARIO EXISTA EN LA BD Y RETORNAMOS SUS DATOS EXCLUYENDO EL PASSW
	try {
		let query = `SELECT id, nombres, apellidos, telefono, telefono_emergencia, correo, isClient, isAdmin, isSuperAdmin, isGuia, isInvestor, isPartner, isSpecialist, isOperator, isEventual, saldo, status, created_at, empresa_id FROM usuario WHERE id='${req.user.id}'`;
		let client = await db.pool.query(query);

		res.status(200).json(client[0]);

	} catch (error) {
		res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
	}
})

//VERIFICAR LA EXISTENCIA DE UN CORREO Y QUE SEA DE UN USUARIO TIPO CLIENTE
app.post('/verificarCorreo', async (req, res) => {
	let correoClient = req.body.correo;

	let errors = Array();

	if (!correoClient) {
		errors.push({ msg: "El campo correo debe de contener un valor" });
	}

	if (errors.length >= 1) {

		return res.status(400)
			.json({
				msg: 'Errores en los parametros',
				error: true,
				details: errors
			});

	}


	let query = `SELECT *
                        FROM usuario 
                        WHERE correo='${correoClient}' AND isClient = 1`;

	let existCorreo = await db.pool.query(query);

	if (existCorreo[0].length >= 1) {
		res.status(200).json({ "existe": true });
	} else {
		res.status(200).json({ "existe": false });
	}

})

app.put('/set', async (req, res) => {
	try {
		let { id, nombres, apellidos, password, telefono, telefono_emergencia, card_number, name_on_card, expires_month, expires_year, cvc,  tipo_usuario } = req.body

		let errors = Array();

		if (!id) {
			errors.push({ msg: "El campo id debe de contener un valor valido" });
		}
		if (!nombres) {
			errors.push({ msg: "El campo nombres debe de contener un valor" });
		}
		if (!apellidos) {
			errors.push({ msg: "El campo apellidos debe de contener un valor" });
		}
		if (!tipo_usuario) {
			errors.push({ msg: "El campo tipo_usuario debe de contener un valor" });
		}
		if (!telefono) {
			telefono = null;
		}
		if (!telefono_emergencia) {
			telefono_emergencia = null;
		}
		if (!card_number) {
			card_number = null;
		} else {
			card_number = encrypt(card_number);
		}
		if (!name_on_card) {
			name_on_card = null;
		}
		if (!expires_month) {
			expires_month = null;
		} else {
			expires_month = encrypt(expires_month);
		}
		if (!expires_year) {
			expires_year = null;
		} else {
			expires_year = encrypt(expires_year);
		}
		if (!cvc) {
			cvc = null;
		} else {
			cvc = encrypt(cvc);
		}

		// Validar que tipo_usuario sea uno de los valores permitidos
		const tiposPermitidos = ['Administrador', 'Cliente', 'Inversionista', 'Partner', 'Tour Operador', 'Colaborador', 'Especialista', 'Eventual'];
		if (!tiposPermitidos.includes(tipo_usuario)) {
			errors.push({ msg: "El campo tipo_usuario debe ser: Administrador, Cliente, Inversionista, Partner, Tour Operador, Colaborador, Especialista o Eventual" });
		}
		
		if (errors.length >= 1) {

			return res.status(400)
				.json({
					msg: 'Errores en los parametros',
					error: true,
					details: errors
				});

		}

		let today = new Date();
		let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
		let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
		let fecha = date + ' ' + time;

		// Determinar qué campo establecer según el tipo de usuario
		let isAdmin = 0, isClient = 0, isInvestor = 0, isPartner = 0, isOperator = 0, isGuia = 0, isSpecialist = 0, isEventual = 0;
		
		switch(tipo_usuario) {
			case 'Administrador':
				isAdmin = 1;
				break;
			case 'Cliente':
				isClient = 1;
				break;
			case 'Inversionista':
				isInvestor = 1;
				break;
			case 'Partner':
				isPartner = 1;
				break;
			case 'Tour Operador':
				isOperator = 1;
				break;
			case 'Colaborador':
				isGuia = 1;
				break;	
			case 'Especialista':
				isSpecialist = 1;
				break;	
			case 'Eventual':
				isEventual = 1;
				break;	
		}


		let query = ``;

		if (password) {
			const salt = await bcryptjs.genSalt(10);
			const hashedPassword = await bcryptjs.hash(password, salt);

			query = `UPDATE usuario  SET
                        nombres              = '${nombres}', 
                        apellidos            = '${apellidos}',
                        telefono             = '${telefono}', 
						telefono_emergencia  = '${telefono_emergencia}', 
						password             = '${hashedPassword}',
						card_number			 = '${card_number}', 
						name_on_card		 = '${name_on_card}', 
						expires_month		 = '${expires_month}', 
						expires_year		 = '${expires_year}', 
						cvc					 = '${cvc}', 
						isAdmin				 = ${isAdmin},
						isClient			 = ${isClient},
						isInvestor			 = ${isInvestor},
						isPartner			 = ${isPartner},
						isOperator			 = ${isOperator},
						isGuia				 = ${isGuia},
						isSpecialist		 = ${isSpecialist},
						isEventual			 = ${isEventual},
                        updated_at           = '${fecha}'
                        WHERE id             = ${id}`;
		} else {
			query = `UPDATE usuario  SET
                        nombres              = '${nombres}', 
                        apellidos            = '${apellidos}',
                        telefono             = '${telefono}', 
						telefono_emergencia  = '${telefono_emergencia}', 
						card_number			 = '${card_number}', 
						name_on_card		 = '${name_on_card}', 
						expires_month		 = '${expires_month}', 
						expires_year		 = '${expires_year}', 
						cvc					 = '${cvc}', 
						isAdmin				 = ${isAdmin},
						isClient			 = ${isClient},
						isInvestor			 = ${isInvestor},
						isPartner			 = ${isPartner},
						isOperator			 = ${isOperator},
						isGuia				 = ${isGuia},
						isSpecialist		 = ${isSpecialist},
						isEventual			 = ${isEventual},
                        updated_at           = '${fecha}'
                        WHERE id             = ${id}`;
		}

		let result = await db.pool.query(query);
		result = result[0];

		const payload = {
			cliente: {
				id: result.insertId,
			}
		}

		res.status(200).json({ error: false, msg: "Registro actualizado con exito" })

	} catch (error) {
		res.status(400).json({ error: true, details: error })
	}
})

app.put('/delete', async (req, res) => {
	try {
		let clientId = req.body.id;

		if (!clientId) {
			return res.status(400)
				.json({
					msg: 'El id debe ser un numero entero',
					error: true
				});
		}

		let today = new Date();
		let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
		let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
		let fecha = date + ' ' + time;

		let query = `UPDATE usuario  SET
                        status      = 0,
                        updated_at  = '${fecha}'
                        WHERE id    = ${clientId}`;

		let result = await db.pool.query(query);
		result = result[0];

		res.status(200).json({ error: false, msg: "Se ha dado de baja al cliente con exito" })

	} catch (error) {
		res.status(400).json({ error: true, details: error })
	}
})

app.put('/active', async (req, res) => {
	try {
		let clientId = req.body.id;

		if (!clientId) {
			return res.status(400)
				.json({
					msg: 'El id debe ser un numero entero',
					error: true
				});
		}

		let today = new Date();
		let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
		let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
		let fecha = date + ' ' + time;

		let query = `UPDATE usuario  SET
                        status      = 1,
                        updated_at  = '${fecha}'
                        WHERE id    = ${clientId}`;

		let result = await db.pool.query(query);
		result = result[0];

		res.status(200).json({ error: false, msg: "Se ha reactivado al cliente con exito" })

	} catch (error) {
		res.status(400).json({ error: true, details: error })
	}
})

app.post('/contacto', async (req, res) => {
	try {
		let { nombre, telefono, correo, mensaje } = req.body

		let errors = Array();

		if (!nombre) {
			errors.push({ msg: "El campo nombre debe de contener un valor valido" });
		}
		if (!correo) {
			errors.push({ msg: "El campo correo debe de contener un valor" });
		}
		if (!mensaje) {
			errors.push({ msg: "El campo mensaje debe de contener un valor" });
		}
		if (!telefono) {
			errors.push({ msg: "El campo telefono debe de contener un valor" });
		}

		if (errors.length >= 1) {

			return res.status(400)
				.json({
					msg: 'Errores en los parametros',
					error: true,
					details: errors
				});

		}

		let message = {
			from: process.env.MAIL, // sender address
			to: process.env.MAIL, // list of receivers
			subject: "Contactanos", // Subject line
			text: "", // plain text body
			html: `<p><strong>Datos de contacto:<strong></p><p><strong>Nombre:<strong> ${nombre}</p><p><strong>Teléfono:<strong> ${telefono}</p><p><strong>Correo:<strong> ${correo}</p><p><strong>Mensaje:<strong> ${mensaje}</p>`, // html body
		}

		const info = await mailer.sendMail(message);
		console.log(info);

		res.status(200).json({ error: false, msg: "Se ha enviado el correo electronico" })

	} catch (error) {
		console.log(error);
		res.status(500).json({ msg: 'Hubo un error obteniendo los datos', error: true, details: error })
	}
});

//login con google
app.post('/google-login', async (req, res) => {
	const { id_token } = req.body;
	let payload;
	if (!id_token) {
		return res.status(400).json({ msg: 'ID Token de Google no proporcionado', error: true });
	}
	try {
		// Para ver el contenido del token de Google
		const decodedToken = jwt.decode(id_token);
		//console.log("Aca ando Contenido del token decodificado:", decodedToken);
	} catch (err) {
		console.error("Aca ando No se pudo decodificar el token para depuración");
	}

	try {
		// 1. Verifica el token de Google
		const client = new OAuth2Client('418513888701-ii4jt41t9iv0um2v2b1mjt037efnucae.apps.googleusercontent.com');
		const ticket = await client.verifyIdToken({
			idToken: id_token,
			audience: '418513888701-ii4jt41t9iv0um2v2b1mjt037efnucae.apps.googleusercontent.com',
		});
		payload = ticket.getPayload();

		console.log("Datos del token de Google:", {
			email: payload.email,
			nombres: payload.given_name,
			apellidos: payload.family_name
		});
	} catch (error) {
		console.error("Error verificando token de Google:", error);
		return res.status(401).json({ msg: 'Token de Google no válido', error: true });
	}
	const { email, given_name, family_name } = payload;
	let user;
	try {
		// 2. Busca si el usuario ya existe por su correo
		let query = `SELECT * FROM usuario WHERE correo = ?`;
		let [rows] = await db.pool.query(query, [email]);
		if (rows.length > 0) {
			// Si el usuario existe, usa su registro
			user = rows[0];
			console.log("Usuario encontrado en BD:", user.nombres);
		} else {
			// 3. Si es un usuario nuevo, crea un nuevo registro sin contraseña, usando la estructura completa de tu API de registro.
			console.log("Usuario no encontrado. Creando nuevo registro...");

			const nombres = given_name || '';
			const apellidos = family_name || '';
			const telefono = null;
			const telefono_emergencia = null;

			// Obtiene la fecha y hora actuales
			let today = new Date();
			let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
			let time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds();
			let fecha = date + ' ' + time;
			const createUserQuery = `
		  INSERT INTO usuario 
			(nombres, apellidos, telefono, telefono_emergencia, correo, password, isClient, created_at, updated_at) 
		  VALUES 
			(?, ?, ?, ?, ?, ?, ?, ?, ?)
		`;
			const [insertResult] = await db.pool.query(
				createUserQuery,
				[nombres, apellidos, telefono, telefono_emergencia, email, null, 1, fecha, fecha]
			);

			const newUserId = insertResult.insertId;
			// Vuelve a buscar el usuario recién creado para obtener todos sus datos
			let [newRows] = await db.pool.query(`SELECT * FROM usuario WHERE correo = ?`, [email]);
			user = newRows[0];
			console.log("Nuevo usuario creado con ID:", newUserId);
		}
		// 4. Genera y devuelve un token de sesión (JWT) para tu aplicación
		const sessionPayload = { user: { id: user.id } };
		jwt.sign(sessionPayload, process.env.SECRET, { expiresIn: '1h' }, (error, token) => {
			if (error) {
				console.error("Error al generar JWT:", error);
				return res.status(500).json({ msg: 'Error al generar el token de sesión', error: true });
			}
			// 5. Devuelve el token Y los datos del usuario para el frontend
			res.status(200).json({
				error: false,
				token: token,
				nombres: user.nombres,
				apellidos: user.apellidos,
				correo: user.correo,
				telefono: user.telefono || ''
			});
		});
	} catch (error) {
		console.error("Error en el flujo de Google Login:", error);
		res.status(500).json({ msg: 'Hubo un error en el servidor', error: true, details: error.message });
	}
});

// ==========================================================
// 🚀 LOGIN PARA PORTAL CAUTIVO (ARUBA) - EMAIL Y GOOGLE LOGIN
// ==========================================================

// users.js - Endpoint exclusivo Portal Cautivo
app.post('/loginInternet', async (req, res) => {
  try {
    const { email, password, id_token } = req.body;

    // LOGIN NORMAL
    if (email && password) {
      const [rows] = await db.pool.query(
        `SELECT * FROM usuario WHERE correo = ? AND status = 1`,
        [email]
      );

      if (rows.length === 0) {
        return res.status(401).json({ success: false, msg: 'Usuario no encontrado' });
      }

      const user = rows[0];
      const ok = await bcryptjs.compare(password, user.password);

      if (!ok) {
        return res.status(401).json({ success: false, msg: 'Contraseña incorrecta' });
      }

      return res.json({ success: true });
    }

    // LOGIN GOOGLE
    if (id_token) {
      const ticket = await googleClient.verifyIdToken({
        idToken: id_token,
        audience: '418513888701-ii4jt41t9iv0um2v2b1mjt037efnucae.apps.googleusercontent.com',
      });

      const payload = ticket.getPayload();
      // Aquí puedes insertar o validar usuario si quieres

      return res.json({ success: true });
    }

    return res.status(400).json({ success: false, msg: 'Datos insuficientes' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: 'Error servidor' });
  }
});

module.exports = app



