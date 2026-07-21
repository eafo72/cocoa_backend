function checkRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'Permiso denegado' });
    }
    next();
  };
}

module.exports = checkRole;
