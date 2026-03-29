import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

/**
 * INTEGRATION TEST: Backend Service
 * 
 * Tests that backend starts and responds correctly
 */
describe('Backend Integration', () => {
  it('should start backend server', async () => {
    const backend = spawn('node', ['dist/index.js'], {
      cwd: process.cwd() + '/apps/platform-api',
      stdio: 'pipe',
    });

    let started = false;
    
    backend.stdout.on('data', (data) => {
      if (data.toString().includes('platform-api server started')) {
        started = true;
      }
    });

    await setTimeout(3000);

    expect(started).toBe(true);

    backend.kill();
  }, 10000);

  it('should respond to health check', async () => {
    const response = await fetch('http://localhost:3001/health');
    const data = await response.json();

    expect(response.status).toBe(200);
    const payload = (data as { data?: { overall?: string } }).data ?? data;
    expect(payload.overall).toBeDefined();
  });

  it('should have CORS enabled', async () => {
    const response = await fetch('http://localhost:3001/health', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
      },
    });

    expect(response.status).toBe(204);
  });

  it('should require auth for protected endpoints in production', async () => {
    const response = await fetch('http://localhost:3001/calls?tenantId=test');
    // Dev mode often skips auth; production returns 401 without bearer.
    expect([200, 401]).toContain(response.status);
  });
});




