import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** Same image as `infra/docker-compose.yml`. */
const IMAGE = 'postgis/postgis:16-3.5';

/**
 * Starts one PostGIS container for the integration run and shares its URL with the tests.
 * The official PostGIS image is published for linux/amd64 only, so the platform is pinned: Docker
 * Desktop on Apple Silicon runs it under emulation (slower start, same behavior).
 * Set `TEST_DATABASE_URL` to reuse an existing, disposable database instead of a container.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const external = process.env['TEST_DATABASE_URL'];
  if (external !== undefined && external !== '') {
    project.provide('databaseUrl', external);
    return () => Promise.resolve();
  }

  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(IMAGE)
    .withPlatform('linux/amd64')
    .withDatabase('ruta_limpia_test')
    .withUsername('ruta_limpia')
    .withPassword('ruta_limpia')
    .withStartupTimeout(180_000)
    .start();
  project.provide('databaseUrl', container.getConnectionUri());
  return async () => {
    await container.stop();
  };
}
