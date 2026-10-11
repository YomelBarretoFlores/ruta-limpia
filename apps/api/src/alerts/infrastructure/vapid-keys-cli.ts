import webPush from 'web-push';

/**
 * Prints a new VAPID key pair as `.env` lines: `pnpm --filter api vapid:generate`.
 * Generate the keys once per deployment and keep them: changing them invalidates every existing
 * browser subscription.
 */
const { publicKey, privateKey } = webPush.generateVAPIDKeys();
const subject = process.argv[2] ?? 'mailto:soporte@example.org';

process.stdout.write(
  [
    '# Web Push (VAPID). Keep VAPID_PRIVATE_KEY secret; set VAPID_SUBJECT to a real contact.',
    `VAPID_PUBLIC_KEY=${publicKey}`,
    `VAPID_PRIVATE_KEY=${privateKey}`,
    `VAPID_SUBJECT=${subject}`,
    '',
  ].join('\n'),
);
