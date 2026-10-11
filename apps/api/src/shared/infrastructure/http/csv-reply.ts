import type { FastifyReply } from 'fastify';

/**
 * Sends a CSV file as a download: UTF-8 (the text starts with the BOM Excel needs), and an
 * attachment with a plain ASCII file name.
 */
export function sendCsv(reply: FastifyReply, fileName: string, csv: string) {
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${fileName}"`)
    .send(csv);
}
