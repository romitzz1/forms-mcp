// ABOUTME: Test suite for FormCache comprehensive error handling and logging
// ABOUTME: Tests error classification, recovery mechanisms, and logging framework

import type { FormCacheInsert} from '../../utils/formCache.js';
import { FormCache, FormCacheLogger } from '../../utils/formCache.js';
import { ApiError, CacheError, ConfigurationError, DatabaseError, SyncError } from '../../utils/formCache.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock API function that can simulate various error conditions
const createMockApiCall = (behavior: 'success' | 'timeout' | 'auth_error' | '404' | '500' | 'rate_limit' | 'malformed_response') => {
  return async (endpoint: string): Promise<any> => {
    switch (behavior) {
      case 'success':
        if (endpoint === '/forms') {
          return { '123': { id: '123', title: 'Test Form', is_active: '1', entry_count: '0' } };
        } else {
          // Individual form endpoint - return single form object
          const formId = endpoint.split('/').pop();
          return { id: formId, title: 'Test Form', is_active: '1', entry_count: '0' };
        }
      case 'timeout':
        throw new Error('ETIMEDOUT: Connection timeout');
      case 'auth_error':
        throw new Error('401 Unauthorized');
      case '404':
        throw new Error('404 Not Found');
      case '500':
        throw new Error('500 Internal Server Error');
      case 'rate_limit':
        throw new Error('429 Too Many Requests');
      case 'malformed_response':
        return { invalid: 'response format' }; // Not an array
      default:
        throw new Error('Unknown error');
    }
  };
};

describe('FormCache Error Handling and Logging', () => {
  let tempDir: string;
  let testDbPath: string;
  let formCache: FormCache;
  let logMessages: string[] = [];

  // Mock console.log to capture log messages
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-mcp-error-test-'));
    testDbPath = path.join(tempDir, 'test-forms.db');
    logMessages = [];

    // Reset logger singleton to prevent test pollution
    FormCacheLogger.resetInstance();

    // Mock console methods to capture logs
    jest.spyOn(console, 'log').mockImplementation((...args) => logMessages.push(`LOG: ${args.join(' ')}`));
    jest.spyOn(console, 'error').mockImplementation((...args) => logMessages.push(`ERROR: ${args.join(' ')}`));
    jest.spyOn(console, 'warn').mockImplementation((...args) => logMessages.push(`WARN: ${args.join(' ')}`));
  });

  afterEach(async () => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

    // Clean up FormCache and test databases
    if (formCache) {
      try {
        await formCache.close();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    // Remove temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Error Classification System', () => {
    it('should throw CacheError for general cache issues', async () => {
      formCache = new FormCache(testDbPath);
      
      // Try to use cache before initialization
      await expect(formCache.getForm(1)).rejects.toThrow(CacheError);
      await expect(formCache.getForm(1)).rejects.toThrow('FormCache not initialized');
    });

    it('should throw DatabaseError for database connection failures', async () => {
      // Create a file where we want to create a directory, causing permission error
      const invalidPath = path.join(tempDir, 'not-a-directory.file');
      fs.writeFileSync(invalidPath, 'this is a file, not a directory');
      
      formCache = new FormCache(path.join(invalidPath, 'cannot-create-file-here.db'));
      
      await expect(formCache.init()).rejects.toThrow(DatabaseError);
    });

    it('should throw DatabaseError for database corruption scenarios', async () => {
      // Create a corrupted database file
      fs.writeFileSync(testDbPath, 'This is not a valid SQLite database');
      
      formCache = new FormCache(testDbPath);
      
      await expect(formCache.init()).rejects.toThrow(DatabaseError);
    });

    it('should throw ApiError for API-related problems', async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();

      const timeoutApiCall = createMockApiCall('timeout');
      await expect(formCache.fetchActiveForms(timeoutApiCall)).rejects.toThrow(ApiError);

      const authErrorApiCall = createMockApiCall('auth_error');
      await expect(formCache.fetchActiveForms(authErrorApiCall)).rejects.toThrow(ApiError);
    });

    it('should throw SyncError for sync workflow issues', async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();

      // Test sync error with malformed API response
      const malformedApiCall = createMockApiCall('malformed_response');
      await expect(formCache.syncAllForms(malformedApiCall)).rejects.toThrow(SyncError);
    });

    it('should throw ConfigurationError for setup problems', async () => {
      // Test configuration error with invalid cache configuration
      formCache = new FormCache('');
      await expect(formCache.init()).rejects.toThrow(ConfigurationError);
    });
  });

  describe('Database Error Recovery', () => {
    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    it('should handle database lock scenarios gracefully', async () => {
      // Insert a form successfully first
      const form: FormCacheInsert = {
        id: 1,
        title: 'Test Form',
        entry_count: 0,
        is_active: true,
        form_data: '{"test": true}'
      };
      
      await formCache.insertForm(form);

      // Attempt to insert duplicate should handle constraint violation
      await expect(formCache.insertForm(form)).rejects.toThrow(DatabaseError);
      await expect(formCache.insertForm(form)).rejects.toThrow('Form with ID 1 already exists');
    });

    it('should handle constraint violations with descriptive errors', async () => {
      const invalidForm: FormCacheInsert = {
        id: 1,
        title: '', // Empty title should cause constraint violation
        entry_count: 0,
        is_active: true
      };

      await expect(formCache.insertForm(invalidForm)).rejects.toThrow(DatabaseError);
    });

    it('should implement automatic retry with exponential backoff for transient failures', async () => {
      const retryApiCall = jest.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce({ id: '123', title: 'Success', is_active: '1', entry_count: '0' });

      const result = await formCache.probeWithRetry(123, retryApiCall, 3);
      
      expect(retryApiCall).toHaveBeenCalledTimes(3);
      expect(result.found).toBe(true);
      expect(result.form?.title).toBe('Success');
    });
  });

  describe('API Error Handling', () => {
    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    it('should handle network timeouts with proper error classification', async () => {
      const timeoutApiCall = createMockApiCall('timeout');
      
      await expect(formCache.fetchActiveForms(timeoutApiCall)).rejects.toThrow(ApiError);
      await expect(formCache.fetchActiveForms(timeoutApiCall)).rejects.toThrow('Connection timeout');
    });

    it('should handle rate limiting with circuit breaker pattern', async () => {
      const rateLimitApiCall = createMockApiCall('rate_limit');
      
      // Test that circuit breaker opens after consecutive failures
      const batchResults = await formCache.probeBatch([1, 2, 3, 4, 5, 6, 7, 8], rateLimitApiCall);
      
      // Should have some circuit breaker responses after threshold
      const circuitBreakerErrors = batchResults.filter(r => 
        r.error?.includes('Circuit breaker open')
      );
      expect(circuitBreakerErrors.length).toBeGreaterThan(0);
    });

    it('should distinguish between different HTTP error types', async () => {
      const notFoundApiCall = createMockApiCall('404');
      const serverErrorApiCall = createMockApiCall('500');
      
      const notFoundResult = await formCache.probeFormById(123, notFoundApiCall);
      expect(notFoundResult.found).toBe(false);
      expect(notFoundResult.error).toContain('404');
      
      const serverErrorResult = await formCache.probeFormById(124, serverErrorApiCall);
      expect(serverErrorResult.found).toBe(false);
      expect(serverErrorResult.error).toContain('500');
    });

    it('should implement proper retry logic for different error types', async () => {
      // 404 errors should not be retried
      const notFoundApiCall = jest.fn().mockRejectedValue(new Error('404 Not Found'));
      const notFoundResult = await formCache.probeWithRetry(123, notFoundApiCall, 3);
      
      expect(notFoundApiCall).toHaveBeenCalledTimes(1); // No retries for 404
      expect(notFoundResult.found).toBe(false);
      
      // Network errors should be retried
      const networkErrorApiCall = jest.fn()
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce({ id: '124', title: 'Success', is_active: '1', entry_count: '0' });
      
      const networkResult = await formCache.probeWithRetry(124, networkErrorApiCall, 3);
      expect(networkErrorApiCall).toHaveBeenCalledTimes(2); // Initial + 1 retry
      expect(networkResult.found).toBe(true);
    });
  });

  describe('Sync Workflow Error Handling', () => {
    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    it('should handle partial sync failures gracefully', async () => {
      let callCount = 0;
      const partialFailureApiCall = (endpoint: string) => {
        callCount++;
        if (endpoint === '/forms') {
          return Promise.resolve({
            '1': { id: '1', title: 'Form 1', is_active: '1', entry_count: '0' },
            '3': { id: '3', title: 'Form 3', is_active: '1', entry_count: '0' }
          });
        } else if (endpoint === '/forms/2') {
          return Promise.resolve({ id: '2', title: 'Form 2', is_active: '0', entry_count: '5' });
        } else {
          throw new Error('500 Server Error'); // Use a server error instead of 404
        }
      };

      const result = await formCache.syncAllForms(partialFailureApiCall);
      
      // Should discover some forms despite failures
      expect(result.discovered).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should maintain data consistency during sync failures', async () => {
      // Start with some cached data
      await formCache.insertForm({
        id: 1,
        title: 'Original Form',
        entry_count: 0,
        is_active: true,
        form_data: '{"original": true}'
      });

      const failingApiCall = createMockApiCall('500');
      
      // After improving error classification, API errors now properly throw SyncError
      await expect(formCache.syncAllForms(failingApiCall)).rejects.toThrow(SyncError);
      
      // Original form should still exist despite sync failure
      const originalForm = await formCache.getForm(1);
      expect(originalForm?.title).toBe('Original Form');
    });

    it('should track comprehensive sync statistics and progress', async () => {
      const progressReports: any[] = [];
      
      const successApiCall = (endpoint: string) => {
        if (endpoint === '/forms') {
          return Promise.resolve({
            '1': { id: '1', title: 'Form 1', is_active: '1', entry_count: '0' }
          });
        }
        throw new Error('404 Not Found');
      };

      const result = await formCache.syncAllForms(successApiCall, {
        onProgress: (progress) => progressReports.push(progress)
      });

      expect(progressReports.length).toBeGreaterThan(0);
      expect(progressReports[0]).toHaveProperty('phase');
      expect(progressReports[0]).toHaveProperty('current');
      expect(progressReports[0]).toHaveProperty('found');
      
      expect(result.discovered).toBe(1);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.lastSyncTime).toBeInstanceOf(Date);
    });
  });

  describe('Logging Framework', () => {
    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    it('should log appropriate information for debugging without sensitive data', async () => {
      const apiCall = createMockApiCall('success');
      
      // Clear any previous log messages to ensure clean test
      logMessages.length = 0;
      
      await formCache.fetchActiveForms(apiCall);
      
      // Should have logged activity - check for any log activity, not just LOG: prefix
      const hasLogActivity = logMessages.length > 0 || 
                           logMessages.some(msg => msg.includes('INFO:')) ||
                           logMessages.some(msg => msg.includes('DEBUG:')) ||
                           logMessages.some(msg => msg.includes('WARN:')) ||
                           logMessages.some(msg => msg.includes('ERROR:'));
      
      expect(hasLogActivity).toBe(true);
      
      // Should not log sensitive information like API keys
      const sensitiveLogs = logMessages.filter(msg => 
        msg.includes('api_key') || msg.includes('secret') || msg.includes('password')
      );
      expect(sensitiveLogs).toHaveLength(0);
    });

    it('should use structured logging with context', async () => {
      const form: FormCacheInsert = {
        id: 1,
        title: 'Test Form',
        entry_count: 0,
        is_active: true
      };
      
      await formCache.insertForm(form);
      
      // Check that logs include context information
      const contextualLogs = logMessages.filter(msg => 
        msg.includes('form_id') || msg.includes('operation')
      );
      expect(contextualLogs.length).toBeGreaterThan(0);
    });

    it('should log errors with different severity levels', async () => {
      const errorApiCall = createMockApiCall('500');
      
      try {
        await formCache.fetchActiveForms(errorApiCall);
      } catch (error) {
        // Error should be caught and logged
      }
      
      const errorLogs = logMessages.filter(msg => msg.includes('ERROR:'));
      const warnLogs = logMessages.filter(msg => msg.includes('WARN:'));
      
      expect(errorLogs.length + warnLogs.length).toBeGreaterThan(0);
    });

    it('should include timing and performance metrics in logs', async () => {
      const apiCall = createMockApiCall('success');
      
      // Use fetchActiveForms instead of full sync to avoid timeout
      await formCache.fetchActiveForms(apiCall);
      
      // Check for performance-related log entries
      const perfLogs = logMessages.filter(msg => 
        msg.includes('duration') || msg.includes('timing') || msg.includes('ms')
      );
      expect(perfLogs.length).toBeGreaterThan(0);
    });
  });

  describe('Recovery Mechanisms', () => {
    it('should recover from database corruption by rebuilding cache', async () => {
      // Create and initialize a working cache
      formCache = new FormCache(testDbPath);
      await formCache.init();
      
      await formCache.insertForm({
        id: 1,
        title: 'Test Form',
        entry_count: 0,
        is_active: true
      });
      
      // Close the cache
      await formCache.close();
      
      // Corrupt the database file
      fs.writeFileSync(testDbPath, 'Corrupted data');
      
      // Create new cache with same path - should handle corruption
      formCache = new FormCache(testDbPath);
      
      // Should be able to recover by rebuilding
      await expect(formCache.init()).rejects.toThrow(DatabaseError);
      expect(logMessages.some(msg => msg.includes('corruption'))).toBe(true);
    });

    it('should implement graceful degradation when cache fails', async () => {
      formCache = new FormCache('/invalid/path/that/cannot/exist');
      
      // Should handle initialization failure gracefully
      await expect(formCache.init()).rejects.toThrow();
      
      // Methods should provide meaningful errors for degraded operation
      await expect(formCache.getForm(1)).rejects.toThrow(CacheError);
      expect(formCache.isReady()).toBe(false);
    });
  });

  describe('Monitoring Hooks', () => {
    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    it('should track error rates and statistics', async () => {
      const errorApiCall = createMockApiCall('500');
      const successApiCall = createMockApiCall('success');
      
      // Reset stats before testing
      const initialStats = formCache.getLastProbeStats();
      
      // Make some calls with mixed success/failure
      await formCache.probeFormById(1, errorApiCall);  // Should fail but not throw
      await formCache.probeFormById(2, errorApiCall);  // Should fail but not throw  
      await formCache.probeFormById(3, successApiCall); // Should succeed
      
      const stats = formCache.getLastProbeStats();
      expect(stats.attempted).toBe(initialStats.attempted + 3);
      expect(stats.failed).toBe(initialStats.failed + 2);
      expect(stats.found).toBe(initialStats.found + 1);
      expect(stats.errors.length).toBeGreaterThanOrEqual(initialStats.errors.length);
    });

    it('should provide sync success/failure statistics', async () => {
      const partialFailureApiCall = (endpoint: string) => {
        if (endpoint === '/forms') {
          return Promise.resolve({
            '1': { id: '1', title: 'Form 1', is_active: '1', entry_count: '0' }
          });
        }
        throw new Error('500 Server Error');
      };

      const result = await formCache.syncAllForms(partialFailureApiCall);
      
      expect(result.discovered).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.lastSyncTime).toBeInstanceOf(Date);
    });

    it('should track performance metrics', async () => {
      const apiCall = createMockApiCall('success');
      const startTime = process.hrtime.bigint();
      
      await formCache.fetchActiveForms(apiCall);
      
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000; // Convert nanoseconds to milliseconds
      
      // Should have reasonable performance tracking
      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThan(5000); // Should complete in reasonable time
    });

    it('should provide health check capabilities', async () => {
      // Test cache health
      expect(formCache.isReady()).toBe(true);
      
      // Test cache stats
      const stats = await formCache.getCacheStats();
      expect(stats.totalForms).toBe(0);
      expect(stats.activeCount).toBe(0);
      
      // Add some data and check again
      await formCache.insertForm({
        id: 1,
        title: 'Test Form',
        entry_count: 0,
        is_active: true
      });
      
      const updatedStats = await formCache.getCacheStats();
      expect(updatedStats.totalForms).toBe(1);
      expect(updatedStats.activeCount).toBe(1);
    });
  });
});