/** iPhone/iPad: Web Push works only from the installed app (iOS/iPadOS 16.4 or newer). */
export function IosInstallSteps() {
  return (
    <div className="install-steps">
      <h3 className="install-steps__title">Para recibir avisos en iPhone o iPad</h3>
      <p>Primero agrega Ruta Limpia a tu pantalla de inicio:</p>
      <ol className="install-steps__list">
        <li>
          Toca el botón <strong>Compartir</strong> (el cuadrado con una flecha hacia arriba).
        </li>
        <li>
          Elige <strong>Agregar a pantalla de inicio</strong>.
        </li>
        <li>
          Toca <strong>Agregar</strong>.
        </li>
        <li>Abre Ruta Limpia desde el ícono en tu pantalla de inicio.</li>
        <li>
          Vuelve a esta sección y toca <strong>Activar avisos</strong>.
        </li>
      </ol>
      <p className="field__note">Se necesita iOS 16.4 o una versión más reciente.</p>
    </div>
  );
}
