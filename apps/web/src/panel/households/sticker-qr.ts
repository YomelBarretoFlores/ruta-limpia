import QRCode from 'qrcode';

/**
 * The sticker's QR code as an SVG document (black modules on white, a quiet zone of two modules,
 * medium error correction so a scuffed sticker still scans). Generated in the browser: the link
 * never leaves the panel.
 */
export function stickerQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

export interface StickerData {
  readonly code: string;
  readonly pointCode: string;
  readonly url: string;
  readonly svg: string;
}

/** The household codes of the sheet (`?codigos=H-001,H-002`), cleaned and without repeats. */
export function stickerCodes(value: string | null): string[] {
  const codes = (value ?? '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^H-\d{3,}$/.test(code));
  return [...new Set(codes)];
}

/** The point code in a sticker link (`…/?r=RI-01&p=P08&h=H-001`). */
export function stickerPoint(url: string): string {
  try {
    return new URL(url).searchParams.get('p') ?? '—';
  } catch {
    return '—';
  }
}
