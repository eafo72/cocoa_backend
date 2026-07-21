let obtenerPrimeraLetra = (nombre) => {
    let string = "";
    for (let i = 0; i < nombre.length; i++) {
        
        if(i >= 2){
            break;
        }

        string += nombre[i].charAt(0);
        
    }

    return string;
}

module.exports = obtenerPrimeraLetra;