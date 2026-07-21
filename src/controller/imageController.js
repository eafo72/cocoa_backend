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

exports.upload = upload.array('image', 10);