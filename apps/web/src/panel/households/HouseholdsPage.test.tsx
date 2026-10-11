import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { HouseholdListItem } from '../api/types';
import { panelUser } from '../test/fixtures';
import { fakePanelApi, fakePanelDeps, renderPanel } from '../test/fake-panel-deps';
import { stickerCodes, stickerQrSvg } from './sticker-qr';

function household(code: string, overrides: Partial<HouseholdListItem> = {}): HouseholdListItem {
  return {
    id: `id-${code}`,
    code,
    routeId: 'route-1',
    routeCode: 'RI-01',
    pointCode: 'P08',
    enrolledAt: '2026-10-10T15:00:00.000Z',
    consentAt: '2026-10-10T15:00:00.000Z',
    consentVersion: 'enrollment-2026-10',
    active: true,
    notes: null,
    updatedAt: '2026-10-10T15:00:00.000Z',
    activeSubscriptions: 2,
    lastAlertReceivedAt: '2026-10-20T12:05:00.000Z',
    lastAppViewAt: null,
    ...overrides,
  };
}

const stickerUrl = (code: string) => `https://rutalimpia.example/?r=RI-01&p=P08&h=${code}`;

function setup() {
  const api = fakePanelApi(panelUser('supervisor'));
  api.listHouseholds.mockResolvedValue({
    items: [household('H-001'), household('H-002', { active: false, activeSubscriptions: 0 })],
    page: 1,
    pageSize: 50,
    total: 2,
  });
  api.getSticker.mockImplementation((code) => Promise.resolve({ code, url: stickerUrl(code) }));
  const deps = fakePanelDeps(api);
  renderPanel('/panel/hogares', deps);
  return { api, deps };
}

describe('HouseholdsPage', () => {
  it('lists the households with their use of the alerts', async () => {
    setup();

    const table = await screen.findByRole('table');
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(within(first!).getByText('20/10/2026 07:05')).toBeInTheDocument();
    expect(within(first!).getByText('Activo')).toBeInTheDocument();
    expect(within(second!).getByText('Dado de baja')).toBeInTheDocument();
  });

  it('enrolls a household and tells the new code the API gave it', async () => {
    const { api } = setup();
    api.createHousehold.mockResolvedValue(household('H-012', { pointCode: 'P09' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Inscribir hogar' }));
    const form = screen.getByRole('region', { name: 'Inscribir hogar' });

    await userEvent.click(within(form).getByRole('button', { name: 'Inscribir hogar' }));
    expect(
      within(form).getByText('Elige el punto donde el hogar deja sus residuos.'),
    ).toBeInTheDocument();

    await within(form).findByRole('option', { name: /^P09/ });
    await userEvent.selectOptions(within(form).getByLabelText('Punto de referencia'), 'P09');
    await userEvent.type(within(form).getByLabelText('Notas'), 'Puerta verde');
    await userEvent.click(within(form).getByRole('button', { name: 'Inscribir hogar' }));

    expect(api.createHousehold).toHaveBeenCalledWith({
      routeCode: 'RI-01',
      pointCode: 'P09',
      consentVersion: 'enrollment-2026-10',
      notes: 'Puerta verde',
    });
    expect(
      await screen.findByText('Se inscribió el hogar H-012 en el punto P09.'),
    ).toBeInTheDocument();
  });

  it('takes a household out by deactivating it', async () => {
    const { api } = setup();
    api.updateHousehold.mockResolvedValue(household('H-001', { active: false }));
    await userEvent.click(await screen.findByRole('button', { name: 'Editar H-001' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Hogar activo/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(api.updateHousehold).toHaveBeenCalledWith('H-001', { active: false });
  });

  it('prints one sticker per selected household with the QR of its link', async () => {
    const { api, deps } = setup();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar H-002' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar H-001' }));
    await userEvent.click(screen.getByRole('button', { name: 'Imprimir stickers (2)' }));

    const sheet = await screen.findByRole('list', { name: 'Stickers' });
    const stickers = within(sheet).getAllByRole('listitem');
    expect(stickers).toHaveLength(2);
    expect(api.getSticker.mock.calls.map(([code]) => code)).toEqual(['H-001', 'H-002']);
    const first = stickers[0]!;
    expect(within(first).getByText('H-001')).toBeInTheDocument();
    expect(within(first).getByText('Punto P08')).toBeInTheDocument();
    expect(within(first).getByText('Escanea para recibir avisos del camión')).toBeInTheDocument();
    const qr = within(first).getByRole('img', { name: 'Código QR de H-001' });
    expect(qr.querySelector('svg')).not.toBeNull();
    // The very SVG the QR library draws for this household's link.
    const expected = document.createElement('div');
    expected.innerHTML = await stickerQrSvg(stickerUrl('H-001'));
    expect(qr.innerHTML).toBe(expected.innerHTML);

    await userEvent.click(screen.getByRole('button', { name: 'Imprimir' }));
    expect(deps.print).toHaveBeenCalledOnce();
  });
});

describe('sticker helpers', () => {
  it('keeps only household codes, once each', () => {
    expect(stickerCodes('h-001, H-002,H-001,../x,')).toEqual(['H-001', 'H-002']);
    expect(stickerCodes(null)).toEqual([]);
  });

  it('draws a different QR for a different link', async () => {
    const one = await stickerQrSvg(stickerUrl('H-001'));
    expect(one).toMatch(/^<svg[^>]*viewBox/);
    expect(await stickerQrSvg(stickerUrl('H-002'))).not.toBe(one);
  });
});
