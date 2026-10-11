/** The incident errors of the API, in words. */
export const INCIDENT_ERRORS = {
  unknown_route: 'La ruta ya no está activa. Elige otra ruta arriba.',
  unknown_point: 'El punto ya no pertenece a la ruta. Elige otro punto.',
  unknown_trip: 'No se encontró el viaje. Elige otro o deja el campo vacío.',
  trip_route_mismatch: 'Ese viaje recorre otra ruta. Elige un viaje de esta ruta.',
} as const;
