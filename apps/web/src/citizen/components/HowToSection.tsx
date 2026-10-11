import { Section } from '../../shared/ui/Section';

/** "Cómo usar Ruta Limpia": four short steps, no illustrations. */
export function HowToSection() {
  return (
    <Section id="como-usar" title="Cómo usar Ruta Limpia">
      <ol className="howto">
        <li>Elige tu punto de referencia, o escanea el QR pegado en tu puerta.</li>
        <li>Activa los avisos: te avisamos cuando el camión esté cerca de tu punto.</li>
        <li>Saca los residuos al recibir el aviso, en bolsas cerradas.</li>
        <li>Si no hay señal del camión, guíate por el horario de referencia.</li>
      </ol>
    </Section>
  );
}
