import { describe, it, expect } from 'vitest';
import { TokenManager } from './token-manager.js';

describe('TokenManager', () => {
  describe('addTokens', () => {
    it('sums input and output when no cache tokens', () => {
      const tm = new TokenManager();
      tm.addTokens(1000, 200);
      expect(tm.getTotal()).toBe(1200);
    });

    it('includes cacheCreation tokens', () => {
      const tm = new TokenManager();
      tm.addTokens(1000, 200, 500);
      expect(tm.getTotal()).toBe(1700);
    });

    it('includes cacheRead tokens', () => {
      const tm = new TokenManager();
      tm.addTokens(1000, 200, 0, 300);
      expect(tm.getTotal()).toBe(1500);
    });

    it('sums all token types', () => {
      const tm = new TokenManager();
      tm.addTokens(1000, 200, 500, 300);
      expect(tm.getTotal()).toBe(2000);
    });

    it('overwrites previous total on each call', () => {
      const tm = new TokenManager();
      tm.addTokens(1000, 200);
      tm.addTokens(500, 100);
      expect(tm.getTotal()).toBe(600);
    });
  });

  describe('getRatio', () => {
    it('returns total / contextLength', () => {
      const tm = new TokenManager();
      tm.addTokens(50000, 0);
      expect(tm.getRatio(100000)).toBe(0.5);
    });

    it('returns 0 when no tokens', () => {
      const tm = new TokenManager();
      expect(tm.getRatio(100000)).toBe(0);
    });
  });

  describe('shouldCompress', () => {
    it('returns true when total > contextLength * thresholdRatio', () => {
      const tm = new TokenManager();
      tm.addTokens(85000, 0);
      expect(tm.shouldCompress(100000, 0.8)).toBe(true);
    });

    it('returns false when total equals threshold', () => {
      const tm = new TokenManager();
      tm.addTokens(80000, 0);
      expect(tm.shouldCompress(100000, 0.8)).toBe(false);
    });

    it('returns false when total below threshold', () => {
      const tm = new TokenManager();
      tm.addTokens(70000, 0);
      expect(tm.shouldCompress(100000, 0.8)).toBe(false);
    });

    it('uses floor for threshold calculation', () => {
      const tm = new TokenManager();
      // contextLength * thresholdRatio = 100000 * 0.75 = 75000
      // 74999 is not > 75000, so shouldCompress should be false
      tm.addTokens(74999, 0);
      expect(tm.shouldCompress(100000, 0.75)).toBe(false);
      // 75001 > 75000, so shouldCompress should be true
      tm.addTokens(75001, 0);
      expect(tm.shouldCompress(100000, 0.75)).toBe(true);
    });
  });

  describe('threshold state', () => {
    it('getLastShownThreshold returns initial 0', () => {
      const tm = new TokenManager();
      expect(tm.getLastShownThreshold()).toBe(0);
    });

    it('updateThreshold stores value', () => {
      const tm = new TokenManager();
      tm.updateThreshold(0.75);
      expect(tm.getLastShownThreshold()).toBe(0.75);
    });

    it('multiple updates overwrite', () => {
      const tm = new TokenManager();
      tm.updateThreshold(0.7);
      tm.updateThreshold(0.8);
      expect(tm.getLastShownThreshold()).toBe(0.8);
    });
  });

  describe('reset', () => {
    it('clears totalTokens to 0', () => {
      const tm = new TokenManager();
      tm.addTokens(1000, 0);
      tm.reset();
      expect(tm.getTotal()).toBe(0);
    });

    it('clears lastShownThreshold to 0', () => {
      const tm = new TokenManager();
      tm.updateThreshold(0.8);
      tm.reset();
      expect(tm.getLastShownThreshold()).toBe(0);
    });
  });
});
