const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: path.join(__dirname, '../images'),
    filename: (req, file, cb) => {
        let today = new Date();
        let date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();

        let name = `${date}-${file.originalname}`;
        
        cb(null, name);


    },
});

const upload = multer({ storage })

const uploadFields = upload.fields([
  { name: 'foto', maxCount: 1 },
  { name: 'identificacion', maxCount: 1 }
]);

exports.upload = (req, res, next) => {

  // Si no es multipart, no procesar nada
  if (!req.headers['content-type'] || !req.headers['content-type'].includes('multipart/form-data')) {
    return next();
  }

  uploadFields(req, res, (err) => {
    // Si hay error, lo ignoramos y seguimos
    if (err) {
      console.log("Multer ignorado:", err.message);
      return next();
    }

    next();
  });
};;