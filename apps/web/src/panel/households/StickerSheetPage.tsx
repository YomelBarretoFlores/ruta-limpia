import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Button } from '../../shared/ui/Button';
import { Notice } from '../../shared/ui/Notice';
import { errorMessage } from '../components/errors';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../components/use-async';
import { usePanelDeps } from '../panel-deps';
import { stickerCodes, stickerPoint, stickerQrSvg, type StickerData } from './sticker-qr';

/**
 * `/panel/hogares/stickers?codigos=…`: one sticker per household, ready to print: the QR of the
 * household's link, its code, its point and how to use it. Plain black on white.
 */
export function StickerSheetPage() {
  const { api, print } = usePanelDeps();
  const [params] = useSearchParams();
  const key = stickerCodes(params.get('codigos')).join(',');
  const load = useCallback(async (): Promise<StickerData[]> => {
    const codes = key === '' ? [] : key.split(',');
    return Promise.all(
      codes.map(async (code) => {
        const sticker = await api.getSticker(code);
        return {
          code: sticker.code,
          pointCode: stickerPoint(sticker.url),
          url: sticker.url,
          svg: await stickerQrSvg(sticker.url),
        };
      }),
    );
  }, [api, key]);
  const stickers = useAsync(load);

  return (
    <>
      <div className="no-print">
        <p className="back-link">
          <Link to="/panel/hogares">Volver a los hogares</Link>
        </p>
        <PageHeader
          title="Stickers para imprimir"
          kicker={`${key === '' ? 0 : key.split(',').length} hogares seleccionados`}
          actions={
            <Button
              className="button--compact"
              disabled={stickers.data === undefined || stickers.data.length === 0}
              onClick={print}
            >
              Imprimir
            </Button>
          }
        />
        <p className="panel-section__note">
          Imprime en papel adhesivo, en blanco y negro. Cada sticker va en la puerta del hogar que
          indica su código.
        </p>
      </div>
      {key === '' && (
        <Notice tone="warn" title="No hay hogares seleccionados">
          <p>Vuelve a la lista de hogares y marca los que necesitan sticker.</p>
        </Notice>
      )}
      {stickers.status === 'error' && (
        <Notice tone="danger" title="No se pudieron preparar los stickers">
          <p>{errorMessage(stickers.error)}</p>
        </Notice>
      )}
      {stickers.data === undefined && stickers.status === 'loading' && key !== '' && (
        <p className="panel-loading">Preparando los stickers…</p>
      )}
      {stickers.data !== undefined && (
        <ul className="sticker-sheet" aria-label="Stickers">
          {stickers.data.map((sticker) => (
            <li key={sticker.code} className="sticker">
              <div
                className="sticker__qr"
                role="img"
                aria-label={`Código QR de ${sticker.code}`}
                // Generated locally by the QR library from the sticker link: paths only, no text.
                dangerouslySetInnerHTML={{ __html: sticker.svg }}
              />
              <div className="sticker__text">
                <p className="sticker__code">{sticker.code}</p>
                <p className="sticker__point">Punto {sticker.pointCode}</p>
                <p className="sticker__instruction">Escanea para recibir avisos del camión</p>
                <p className="sticker__brand">Ruta Limpia · Independencia</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
