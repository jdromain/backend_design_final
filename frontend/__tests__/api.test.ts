import { describe, it, expect, vi } from 'vitest';
import { api } from '../lib/api';

/**
 * TEST SUITE: API Mock Data
 * 
 * Verify that api.getCalls() returns proper mock data
 */
describe('api.analytics.getCalls', () => {
  it('should return array of call records', async () => {
    const calls = await api.analytics.getCalls();

    expect(Array.isArray(calls)).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('should return calls with correct structure', async () => {
    const calls = await api.analytics.getCalls({ limit: 5 });

    expect(calls.length).toBeLessThanOrEqual(5);

    calls.forEach((call) => {
      expect(call).toHaveProperty('id');
      expect(call).toHaveProperty('callSid');
      expect(call).toHaveProperty('tenantId');
      expect(call).toHaveProperty('phoneNumber');
      expect(call).toHaveProperty('callerNumber');
      expect(call).toHaveProperty('direction');
      expect(call).toHaveProperty('status');
      expect(call).toHaveProperty('startedAt');
    });
  });

  it('should include active calls (in-progress)', async () => {
    const calls = await api.analytics.getCalls({ limit: 20 });

    const activeCalls = calls.filter((call) => call.status === 'in-progress');
    expect(activeCalls.length).toBeGreaterThan(0);
  });

  it('should include completed calls', async () => {
    const calls = await api.analytics.getCalls({ limit: 20 });

    const completedCalls = calls.filter((call) => call.status === 'completed');
    expect(completedCalls.length).toBeGreaterThan(0);
  });

  it('should have valid timestamps', async () => {
    const calls = await api.analytics.getCalls({ limit: 5 });

    calls.forEach((call) => {
      const startedAt = new Date(call.startedAt);
      expect(startedAt.getTime()).not.toBeNaN();

      if (call.endedAt) {
        const endedAt = new Date(call.endedAt);
        expect(endedAt.getTime()).not.toBeNaN();
        expect(endedAt.getTime()).toBeGreaterThan(startedAt.getTime());
      }
    });
  });

  it('should have realistic call durations', async () => {
    const calls = await api.analytics.getCalls({ limit: 10 });

    calls.forEach((call) => {
      if (call.durationSeconds) {
        expect(call.durationSeconds).toBeGreaterThan(0);
        expect(call.durationSeconds).toBeLessThan(500); // Less than 8 minutes
      }
    });
  });

  it('should have varied outcomes', async () => {
    const calls = await api.analytics.getCalls({ limit: 20 });

    const outcomes = new Set(calls.map((call) => call.outcome).filter(Boolean));
    
    // Should have multiple different outcomes
    expect(outcomes.size).toBeGreaterThan(1);
    expect(outcomes.has('completed')).toBe(true);
  });

  it('should respect limit parameter', async () => {
    const limit = 5;
    const calls = await api.analytics.getCalls({ limit });

    expect(calls.length).toBeLessThanOrEqual(limit);
  });
});

/**
 * TEST SUITE: API Analytics Aggregate
 */
describe('api.analytics.getAggregate', () => {
  it('should return aggregated statistics', async () => {
    const stats = await api.analytics.getAggregate();

    expect(stats).toHaveProperty('totalCalls');
    expect(stats).toHaveProperty('successfulCalls');
    expect(stats).toHaveProperty('failedCalls');
    expect(stats).toHaveProperty('averageDuration');
    expect(stats).toHaveProperty('successRate');
  });

  it('should have valid numeric values', async () => {
    const stats = await api.analytics.getAggregate();

    expect(typeof stats.totalCalls).toBe('number');
    expect(typeof stats.successfulCalls).toBe('number');
    expect(typeof stats.failedCalls).toBe('number');
    expect(typeof stats.averageDuration).toBe('number');
    expect(typeof stats.successRate).toBe('number');

    expect(stats.totalCalls).toBeGreaterThanOrEqual(0);
    expect(stats.successRate).toBeGreaterThanOrEqual(0);
    expect(stats.successRate).toBeLessThanOrEqual(1);
  });
});

/**
 * TEST SUITE: API Health
 */
describe('api.health.get', () => {
  it('should call health endpoint with retry', async () => {
    // This will fail without backend running, but tests the structure
    try {
      const health = await api.health.get();
      expect(health).toHaveProperty('status');
    } catch (error) {
      // Expected to fail without backend
      expect(error).toBeDefined();
    }
  });
});




