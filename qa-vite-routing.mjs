import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local Vite test port'));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

const root = process.cwd();
const port = await getAvailablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const vite = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port)],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
);
const output = [];

for (const stream of [vite.stdout, vite.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => output.push(chunk));
}

async function waitForVite() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (vite.exitCode != null) {
      throw new Error(`Vite exited with ${vite.exitCode}:\n${output.join('')}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Retry while the development server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Vite:\n${output.join('')}`);
}

async function expectSpa(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const body = await response.text();
  assert.equal(response.status, 200, `${pathname} must return the SPA entry document`);
  assert.match(body, /<title>newapp<\/title>/, `${pathname} must not be sent to the backend proxy`);
}

async function expectProxy(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const body = await response.text();
  assert.doesNotMatch(body, /<title>newapp<\/title>/, `${pathname} must remain a backend proxy route`);
}

try {
  await waitForVite();
  for (const pathname of [
    '/tools',
    '/tools/',
    '/genome',
    '/genome/files',
    '/genome/run',
    '/genome/jobs',
    '/genome/jobs/sample',
    '/genome/jobs/sample/result',
    '/genome/jobs/sample/downloads',
    '/genome/jobs/sample/result?tab=summary',
  ]) {
    await expectSpa(pathname);
  }
  for (const pathname of [
    '/tools/domain-search?sequence=TEST',
    '/genome/GCF_000002315.6_GRCg6a_primary_35.fna',
  ]) {
    await expectProxy(pathname);
  }
  console.log('Vite SPA/proxy routing regression tests passed.');
} finally {
  if (vite.exitCode == null) {
    vite.kill('SIGTERM');
    await Promise.race([
      once(vite, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}
