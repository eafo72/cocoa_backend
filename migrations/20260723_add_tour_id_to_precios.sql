ALTER TABLE precios
    ADD COLUMN tour_id INT NULL AFTER contexto;

ALTER TABLE precios_promocionales
    ADD COLUMN tour_id INT NULL AFTER precio_id;

CREATE INDEX idx_precios_tour_contexto_clave
    ON precios (tour_id, contexto, clave);

CREATE INDEX idx_precios_promocionales_tour_precio_fecha
    ON precios_promocionales (tour_id, precio_id, activo, fecha_inicio_promo, fecha_fin_promo);
