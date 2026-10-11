import { Button } from '../shared/ui/Button';
import { Notice } from '../shared/ui/Notice';

/**
 * Shown instead of the citizen page when it fails to render (for example an unexpected answer
 * from the server): a calm explanation and a way out, never a technical error.
 */
export function CitizenErrorPage() {
  return (
    <div className="citizen">
      <header className="citizen-header">
        <div className="citizen-header__inner">
          <h1 className="citizen-header__wordmark">Ruta Limpia</h1>
        </div>
      </header>
      <main className="citizen-main">
        <Notice tone="warn" title="No pudimos mostrar la página">
          <p>
            Vuelve a cargarla en unos minutos. Mientras tanto, guíate por el horario de referencia
            de tu zona.
          </p>
        </Notice>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Volver a cargar
        </Button>
      </main>
    </div>
  );
}
