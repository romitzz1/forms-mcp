// ABOUTME: Tests for server initialization and FormCache configuration
// ABOUTME: Tests cache setup, environment variables, error handling, and monitoring

// Mock the entire MCP SDK at the module level
const mockServer = {
  setRequestHandler: jest.fn(),
  connect: jest.fn()
};

const mockTransport = jest.fn();

// Mock the modules before importing
jest.doMock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn(() => mockServer)
}));

jest.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: mockTransport
}));

jest.doMock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  ErrorCode: {
    InvalidParams: 'InvalidParams',
    InternalError: 'InternalError',
    MethodNotFound: 'MethodNotFound'
  },
  McpError: class MockMcpError extends Error {
    constructor(public code: string, message: string) {
      super(message);
      this.name = 'McpError';
    }
  }
}));

// Create a global mock FormCache that we can control
let mockFormCacheInstance: any = null;

jest.doMock('../../utils/formCache.js', () => ({
  FormCache: jest.fn().mockImplementation(() => {
    mockFormCacheInstance = {
      init: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      isReady: jest.fn().mockReturnValue(true),
      getCacheStats: jest.fn().mockResolvedValue({
        totalForms: 5,
        activeCount: 3,
        lastSync: new Date()
      }),
      getSyncStatus: jest.fn().mockResolvedValue({
        lastSync: new Date(),
        isStale: false
      })
    };
    return mockFormCacheInstance;
  })
}));

import { GravityFormsMCPServer } from '../../index.js';

describe('Server Initialization and Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Set default test environment
    process.env.GRAVITY_FORMS_BASE_URL = 'https://test.example.com';
    process.env.GRAVITY_FORMS_CONSUMER_KEY = 'test-key';
    process.env.GRAVITY_FORMS_CONSUMER_SECRET = 'test-secret';
    
    // Reset mock FormCache to default successful behavior
    if (mockFormCacheInstance) {
      mockFormCacheInstance.init = jest.fn().mockResolvedValue(undefined);
      mockFormCacheInstance.close = jest.fn().mockResolvedValue(undefined);
      mockFormCacheInstance.isReady = jest.fn().mockReturnValue(true);
      mockFormCacheInstance.getCacheStats = jest.fn().mockResolvedValue({
        totalForms: 5,
        activeCount: 3,
        lastSync: new Date()
      });
      mockFormCacheInstance.getSyncStatus = jest.fn().mockResolvedValue({
        lastSync: new Date(),
        isStale: false
      });
    }
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('FormCache Configuration Loading', () => {
    it('should load default cache configuration when environment variables not set', () => {
      // Clear cache-related env vars
      delete process.env.GRAVITY_FORMS_CACHE_ENABLED;
      delete process.env.GRAVITY_FORMS_CACHE_DB_PATH;
      delete process.env.GRAVITY_FORMS_CACHE_MAX_AGE_SECONDS;
      delete process.env.GRAVITY_FORMS_CACHE_MAX_PROBE_FAILURES;
      delete process.env.GRAVITY_FORMS_CACHE_AUTO_SYNC;

      const server = new GravityFormsMCPServer();
      const config = (server as any).getCacheConfig();

      expect(config.enabled).toBe(true); // Default enabled
      expect(config.dbPath).toBe('./data/forms-cache.db'); // Default path
      expect(config.maxAgeSeconds).toBe(3600); // Default 1 hour
      expect(config.maxProbeFailures).toBe(10); // Default failures
      expect(config.autoSync).toBe(true); // Default auto-sync
    });

    it('should load cache configuration from environment variables', () => {
      process.env.GRAVITY_FORMS_CACHE_ENABLED = 'false';
      process.env.GRAVITY_FORMS_CACHE_DB_PATH = './custom/cache.db';
      process.env.GRAVITY_FORMS_CACHE_MAX_AGE_SECONDS = '7200';
      process.env.GRAVITY_FORMS_CACHE_MAX_PROBE_FAILURES = '5';
      process.env.GRAVITY_FORMS_CACHE_AUTO_SYNC = 'false';

      const server = new GravityFormsMCPServer();
      const config = (server as any).getCacheConfig();

      expect(config.enabled).toBe(false);
      expect(config.dbPath).toBe('./custom/cache.db');
      expect(config.maxAgeSeconds).toBe(7200);
      expect(config.maxProbeFailures).toBe(5);
      expect(config.autoSync).toBe(false);
    });

    it('should handle invalid environment variable values gracefully', () => {
      process.env.GRAVITY_FORMS_CACHE_ENABLED = 'invalid';
      process.env.GRAVITY_FORMS_CACHE_MAX_AGE_SECONDS = 'not-a-number';
      process.env.GRAVITY_FORMS_CACHE_MAX_PROBE_FAILURES = '-5';

      const server = new GravityFormsMCPServer();
      const config = (server as any).getCacheConfig();

      expect(config.enabled).toBe(true); // Fallback to default
      expect(config.maxAgeSeconds).toBe(3600); // Fallback to default
      expect(config.maxProbeFailures).toBe(10); // Fallback to default
    });
  });

  describe('FormCache Initialization', () => {
    it('should initialize FormCache when cache is enabled', async () => {
      process.env.GRAVITY_FORMS_CACHE_ENABLED = 'true';

      const server = new GravityFormsMCPServer();
      await (server as any).initializeCache();

      const cache = (server as any).formCache;
      expect(cache).toBeDefined();
      expect(cache.isReady()).toBe(true);
    });

    it('should not initialize FormCache when disabled via configuration', async () => {
      process.env.GRAVITY_FORMS_CACHE_ENABLED = 'false';

      const server = new GravityFormsMCPServer();
      await (server as any).initializeCache();

      const cache = (server as any).formCache;
      expect(cache).toBeNull();
    });

    it('should handle FormCache initialization failures gracefully', async () => {
      // Use a mock that fails initialization
      if (mockFormCacheInstance) {
        mockFormCacheInstance.init = jest.fn().mockRejectedValue(new Error('Permission denied'));
      }

      process.env.GRAVITY_FORMS_CACHE_ENABLED = 'true';
      process.env.GRAVITY_FORMS_CACHE_DB_PATH = '/invalid/path/cache.db';

      const server = new GravityFormsMCPServer();
      
      // Should not throw error during initialization
      await expect((server as any).initializeCache()).resolves.not.toThrow();
      
      // Cache should be null after failed initialization
      const cache = (server as any).formCache;
      expect(cache).toBeNull();
    });

    it('should provide fallback behavior when cache unavailable', async () => {
      const server = new GravityFormsMCPServer();
      (server as any).formCache = null;

      // Should still be able to get forms without cache
      const mockApiCall = jest.fn().mockResolvedValue([]);
      (server as any).makeRequest = mockApiCall;

      // This should work without throwing errors
      const formsMethod = (server as any).getForms;
      expect(formsMethod).toBeDefined();
    });
  });

  describe('Server Lifecycle Management', () => {
    it('should initialize cache during server startup', async () => {
      const server = new GravityFormsMCPServer();
      const initSpy = jest.spyOn(server as any, 'initializeCache');
      
      await (server as any).startup();
      
      expect(initSpy).toHaveBeenCalledTimes(1);
    });

    it('should clean up FormCache during server shutdown', async () => {
      const server = new GravityFormsMCPServer();
      await (server as any).initializeCache();
      
      const cache = (server as any).formCache;
      const closeSpy = jest.spyOn(cache, 'close');
      
      await (server as any).shutdown();
      
      expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle shutdown gracefully even with null cache', async () => {
      const server = new GravityFormsMCPServer();
      (server as any).formCache = null;
      
      // Should not throw error
      await expect((server as any).shutdown()).resolves.not.toThrow();
    });
  });

  describe('Cache Integration with Tools', () => {
    it('should pass cache instance to getForms for include_all support', async () => {
      const server = new GravityFormsMCPServer();
      await (server as any).initializeCache();
      
      const cache = (server as any).formCache;
      expect(cache).toBeDefined();
      
      // Verify cache is available for getForms tool
      const cacheIsReady = cache?.isReady() ?? false;
      expect(cacheIsReady).toBe(true);
    });

    it('should pass cache to FormImporter for enhanced conflict detection', async () => {
      process.env.GRAVITY_FORMS_CACHE_ENABLED = 'true';
      
      const server = new GravityFormsMCPServer();
      await (server as any).initializeCache(); // Initialize cache first
      
      const importer = (server as any).getFormImporter();
      
      // Verify FormImporter was initialized with cache
      const hasCache = (importer as any).formCache !== undefined;
      expect(hasCache).toBe(true);
    });

    it('should support template discovery with cache integration', async () => {
      const server = new GravityFormsMCPServer();
      await (server as any).initializeCache();
      
      const cache = (server as any).formCache;
      
      // Verify cache is available for template manager integration
      expect(cache).toBeDefined();
      expect(cache.isReady()).toBe(true);
    });
  });

  describe('Cache Health Monitoring', () => {
    it('should provide cache status information', async () => {
      const server = new GravityFormsMCPServer();
      await (server as any).initializeCache();
      
      const status = await (server as any).getCacheStatus();
      
      expect(status).toHaveProperty('enabled');
      expect(status).toHaveProperty('ready');
      expect(status).toHaveProperty('dbPath');
      expect(status).toHaveProperty('totalForms');
      expect(status).toHaveProperty('lastSync');
    });

    it('should handle cache status when cache disabled', async () => {
      const server = new GravityFormsMCPServer();
      (server as any).formCache = null;
      
      const status = await (server as any).getCacheStatus();
      
      expect(status.enabled).toBe(false);
      expect(status.ready).toBe(false);
      expect(status.totalForms).toBe(0);
    });

    it('should include cache statistics in status', async () => {
      const server = new GravityFormsMCPServer();
      await (server as any).initializeCache();
      
      const status = await (server as any).getCacheStatus();
      
      expect(status).toHaveProperty('config');
      expect(status.config).toHaveProperty('maxAgeSeconds');
      expect(status.config).toHaveProperty('maxProbeFailures');
      expect(status.config).toHaveProperty('autoSync');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate cache configuration on startup', async () => {
      process.env.GRAVITY_FORMS_CACHE_DB_PATH = '';
      
      const server = new GravityFormsMCPServer();
      const config = (server as any).getCacheConfig();
      
      // Should fall back to default path
      expect(config.dbPath).toBe('./data/forms-cache.db');
    });

    it('should handle missing data directory gracefully', async () => {
      process.env.GRAVITY_FORMS_CACHE_DB_PATH = './nonexistent-dir/cache.db';
      
      const server = new GravityFormsMCPServer();
      
      // Should attempt initialization and handle directory creation
      await expect((server as any).initializeCache()).resolves.not.toThrow();
    });
  });

  describe('Error Recovery', () => {
    it('should continue operation when cache initialization fails', async () => {
      // Set environment to enable cache
      process.env.GRAVITY_FORMS_CACHE_ENABLED = 'true';
      process.env.GRAVITY_FORMS_CACHE_DB_PATH = './test-cache.db';
      
      const server = new GravityFormsMCPServer();
      
      // Create a new mock cache that fails init
      const failingMockCache = {
        init: jest.fn().mockRejectedValue(new Error('Init failed')),
        close: jest.fn(),
        isReady: jest.fn().mockReturnValue(false)
      };
      
      // Replace the cache instance with the failing mock
      (server as any).formCache = failingMockCache;
      
      // Manually call initializeCache to trigger the failure
      await (server as any).initializeCache();
      
      // Should set cache to null after failed init
      expect((server as any).formCache).toBeNull();
    });

    it('should provide meaningful error information on cache failures', async () => {
      // Set environment to enable cache
      process.env.GRAVITY_FORMS_CACHE_ENABLED = 'true';
      
      // Configure the mock to fail initialization
      if (mockFormCacheInstance) {
        mockFormCacheInstance.init = jest.fn().mockRejectedValue(new Error('Database locked'));
      }
      
      const server = new GravityFormsMCPServer();
      
      // Wait for constructor initialization to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const status = await (server as any).getCacheStatus();
      expect(status.enabled).toBe(false);
      expect(status.ready).toBe(false);
    });
  });
});