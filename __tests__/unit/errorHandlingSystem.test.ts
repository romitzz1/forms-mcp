// ABOUTME: Comprehensive test suite for universal search error handling and resilience
// ABOUTME: Tests error classification, graceful degradation, recovery mechanisms, and circuit breakers

import {
  ApiError,
  CacheError,
  CircuitBreaker,
  ErrorClassifier,
  ErrorMonitor,
  FieldDetectionError,
  FormAccessError,
  GracefulDegradationManager,
  RecoveryManager,
  SearchError,
  ValidationError
} from '../../utils/errorHandlingSystem.js';
import type { ApiClient } from '../../utils/universalSearchManager.js';

describe('Universal Search Error Handling System', () => {
  describe('Error Classification System', () => {
    it('should create base SearchError with proper context', () => {
      const error = new SearchError('Test error', 'TEST_ERROR', { formId: '123' });
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SearchError);
      expect(error.message).toBe('Test error');
      expect(error.errorCode).toBe('TEST_ERROR');
      expect(error.context).toStrictEqual({ formId: '123' });
      expect(error.timestamp).toBeInstanceOf(Date);
      expect(error.retryable).toBe(false);
      expect(error.severity).toBe('medium');
    });

    it('should create FormAccessError with proper classification', () => {
      const error = new FormAccessError('Form not found', 404, { formId: '999' });
      
      expect(error).toBeInstanceOf(SearchError);
      expect(error.errorCode).toBe('FORM_ACCESS_ERROR');
      expect(error.httpStatus).toBe(404);
      expect(error.retryable).toBe(false);
      expect(error.severity).toBe('high');
    });

    it('should create FieldDetectionError with medium severity', () => {
      const error = new FieldDetectionError('Field analysis failed', { fieldCount: 0 });
      
      expect(error).toBeInstanceOf(SearchError);
      expect(error.errorCode).toBe('FIELD_DETECTION_ERROR');
      expect(error.retryable).toBe(true);
      expect(error.severity).toBe('medium');
    });

    it('should create ApiError with retryable classification', () => {
      const error = new ApiError('Rate limit exceeded', 429, true, { endpoint: '/forms' });
      
      expect(error).toBeInstanceOf(SearchError);
      expect(error.errorCode).toBe('API_ERROR');
      expect(error.httpStatus).toBe(429);
      expect(error.retryable).toBe(true);
      expect(error.severity).toBe('medium');
    });

    it('should create ValidationError as non-retryable', () => {
      const error = new ValidationError('Invalid search text', { searchText: '' });
      
      expect(error).toBeInstanceOf(SearchError);
      expect(error.errorCode).toBe('VALIDATION_ERROR');
      expect(error.retryable).toBe(false);
      expect(error.severity).toBe('low');
    });
  });

  describe('Error Classifier', () => {
    let classifier: ErrorClassifier;

    beforeEach(() => {
      classifier = new ErrorClassifier();
    });

    it('should classify API timeout errors as retryable', () => {
      const error = new Error('ETIMEDOUT: Connection timeout');
      const classified = classifier.classifyError(error, 'api_call');
      
      expect(classified).toBeInstanceOf(ApiError);
      expect(classified.retryable).toBe(true);
      expect(classified.severity).toBe('medium');
    });

    it('should classify authentication errors as non-retryable', () => {
      const error = new Error('401 Unauthorized');
      const classified = classifier.classifyError(error, 'api_call');
      
      expect(classified).toBeInstanceOf(FormAccessError);
      expect(classified.retryable).toBe(false);
      expect(classified.severity).toBe('high');
    });

    it('should classify form not found errors correctly', () => {
      const error = new Error('404 Not Found');
      const classified = classifier.classifyError(error, 'form_access');
      
      expect(classified).toBeInstanceOf(FormAccessError);
      expect(classified.httpStatus).toBe(404);
      expect(classified.retryable).toBe(false);
    });

    it('should classify rate limit errors as retryable', () => {
      const error = new Error('429 Too Many Requests');
      const classified = classifier.classifyError(error, 'api_call');
      
      expect(classified).toBeInstanceOf(ApiError);
      expect(classified.retryable).toBe(true);
      expect(classified.httpStatus).toBe(429);
    });

    it('should classify malformed data as field detection error', () => {
      const error = new Error('Invalid field structure');
      const classified = classifier.classifyError(error, 'field_detection');
      
      expect(classified).toBeInstanceOf(FieldDetectionError);
      expect(classified.retryable).toBe(true);
    });
  });

  describe('Graceful Degradation Manager', () => {
    let degradationManager: GracefulDegradationManager;
    let mockApiClient: ApiClient;

    beforeEach(() => {
      const searchEntriesMock = jest.fn();
      const getFormDefinitionMock = jest.fn();
      mockApiClient = {
        searchEntries: searchEntriesMock,
        getFormDefinition: getFormDefinitionMock,
      } as ApiClient;
      degradationManager = new GracefulDegradationManager(mockApiClient);
    });

    it('should fallback to standard search when universal search fails', async () => {
      const searchError = new FieldDetectionError('Field analysis failed');
      (mockApiClient.searchEntries as jest.Mock).mockResolvedValue([
        { id: '123', '52': 'John Smith' }
      ]);

      const result = await degradationManager.handleSearchFailure(
        '123',
        'John Smith',
        searchError,
        { strategy: 'exact', maxResults: 50, includeContext: true }
      );

      expect(result.fallbackUsed).toBe(true);
      expect(result.fallbackType).toBe('standard_search');
      expect(result.matches).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockApiClient.searchEntries).toHaveBeenCalled();
    });

    it('should skip cache when cache system fails', async () => {
      const cacheError = new CacheError('Cache corruption detected');
      
      const result = await degradationManager.handleCacheFailure(
        '123',
        cacheError,
        function() { return Promise.resolve({ id: '123', title: 'Test Form' }); }
      );

      expect(result.cacheBypass).toBe(true);
      expect(result.data).toStrictEqual({ id: '123', title: 'Test Form' });
    });

    it('should provide simplified field detection on complex analysis failure', () => {
      const complexError = new FieldDetectionError('Complex analysis timeout');
      
      const result = degradationManager.handleFieldDetectionFailure(
        { id: '123', fields: [{ id: '1', label: 'Name', type: 'text' }] },
        complexError
      );

      expect(result.simplifiedDetection).toBe(true);
      expect(result.fieldMapping['1']).toStrictEqual({
        fieldId: '1',
        fieldType: 'name',
        confidence: 0.7,
        label: 'Name'
      });
    });
  });

  describe('Recovery Manager with Circuit Breaker', () => {
    let recoveryManager: RecoveryManager;
    let mockOperation: jest.Mock;

    beforeEach(() => {
      recoveryManager = new RecoveryManager({
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2
      });
      mockOperation = jest.fn();
    });

    it('should retry transient failures with exponential backoff', async () => {
      mockOperation
        .mockRejectedValueOnce(new ApiError('Timeout', 408, true))
        .mockRejectedValueOnce(new ApiError('Timeout', 408, true))
        .mockResolvedValueOnce('success');

      const result = await recoveryManager.executeWithRetry(
        'test_operation',
        mockOperation
      );

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      mockOperation.mockRejectedValue(new ValidationError('Invalid input'));

      await expect(
        recoveryManager.executeWithRetry('test_operation', mockOperation)
      ).rejects.toThrow('Invalid input');

      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should implement circuit breaker for repeated failures', async () => {
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 1000,
        monitoringWindowMs: 5000
      });

      // Simulate failures to trip the circuit
      for (let i = 0; i < 4; i++) {
        try {
          await circuitBreaker.execute('test', () => {
            throw new ApiError('Server error', 500, false);
          });
        } catch {
          // Expected failures
        }
      }

      // Circuit should now be open
      await expect(
        circuitBreaker.execute('test', mockOperation)
      ).rejects.toThrow('Circuit breaker is OPEN');

      expect(mockOperation).not.toHaveBeenCalled();
    });

    it('should half-open circuit after reset timeout', async () => {
      jest.useFakeTimers();
      
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 1000,
        monitoringWindowMs: 5000
      });

      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute('test', () => {
            throw new ApiError('Server error', 500, false);
          });
        } catch {
          // Expected failures
        }
      }

      // Fast-forward time
      jest.advanceTimersByTime(1100);

      // Should now be half-open and allow one test call
      mockOperation.mockResolvedValue('recovery success');
      const result = await circuitBreaker.execute('test', mockOperation);

      expect(result).toBe('recovery success');
      expect(mockOperation).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('Error Monitoring and Metrics', () => {
    let errorMonitor: ErrorMonitor;

    beforeEach(() => {
      errorMonitor = new ErrorMonitor({
        trackingWindowMs: 60000,
        alertThresholds: {
          error_rate: 0.1, // 10%
          high_severity_rate: 0.05 // 5%
        }
      });
    });

    it('should track error rates by type', () => {
      errorMonitor.recordError(new ApiError('Timeout', 408, true));
      errorMonitor.recordError(new ValidationError('Invalid input'));
      errorMonitor.recordError(new ApiError('Rate limit', 429, true));
      
      // Record some successes
      errorMonitor.recordSuccess('api_call');
      errorMonitor.recordSuccess('validation');

      const metrics = errorMonitor.getMetrics();
      
      expect(metrics.totalErrors).toBe(3);
      expect(metrics.totalOperations).toBe(5);
      expect(metrics.errorRate).toBe(0.6); // 3/5
      expect(metrics.errorsByType.API_ERROR).toBe(2);
      expect(metrics.errorsByType.VALIDATION_ERROR).toBe(1);
    });

    it('should detect high error rate alerts', () => {
      // Generate high error rate (20% > 10% threshold) with low severity errors
      for (let i = 0; i < 8; i++) {
        errorMonitor.recordError(new ValidationError('Invalid input'));
      }
      for (let i = 0; i < 32; i++) {
        errorMonitor.recordSuccess('api_call');
      }

      const alerts = errorMonitor.checkAlerts();
      
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('HIGH_ERROR_RATE');
      expect(alerts[0].severity).toBe('WARNING');
      expect(alerts[0].details.current_rate).toBe(0.2);
    });

    it('should track performance degradation', () => {
      // Record some slow operations
      errorMonitor.recordPerformanceMetric('search_by_name', 3000); // 3 seconds
      errorMonitor.recordPerformanceMetric('search_by_name', 2500);
      errorMonitor.recordPerformanceMetric('field_detection', 1500);

      const metrics = errorMonitor.getMetrics();
      
      expect(metrics.performanceMetrics.search_by_name.avgResponseTime).toBe(2750);
      expect(metrics.performanceMetrics.search_by_name.callCount).toBe(2);
      expect(metrics.performanceMetrics.field_detection.avgResponseTime).toBe(1500);
    });
  });

  describe('User Experience Error Messages', () => {
    let classifier: ErrorClassifier;

    beforeEach(() => {
      classifier = new ErrorClassifier();
    });

    it('should provide clear, actionable error messages', () => {
      const formNotFoundError = new FormAccessError('Form not found', 404, { formId: '999' });
      const userMessage = classifier.getUserFriendlyMessage(formNotFoundError);
      
      expect(userMessage).toBe(
        'Form with ID "999" was not found. Please verify the form ID is correct and the form is active.'
      );
    });

    it('should provide suggested fixes for common problems', () => {
      const validationError = new ValidationError('Search text too short', { searchText: 'a' });
      const userMessage = classifier.getUserFriendlyMessage(validationError);
      
      expect(userMessage).toBe(
        'Search text "a" is too short. Please provide at least 2 characters for better search results.'
      );
    });

    it('should provide fallback options when advanced features fail', () => {
      const fieldDetectionError = new FieldDetectionError('Complex form analysis failed');
      const userMessage = classifier.getUserFriendlyMessage(fieldDetectionError);
      
      expect(userMessage).toContain('automatic field detection failed');
      expect(userMessage).toContain('falling back to standard search');
      expect(userMessage).toContain('use get_field_mappings tool');
    });
  });

  describe('Integration with Existing System', () => {
    it('should work with existing FormCache errors', () => {
      const cacheError = new Error('Database connection failed');
      const classifier = new ErrorClassifier();
      
      const classified = classifier.classifyError(cacheError, 'cache_operation');
      
      expect(classified).toBeInstanceOf(CacheError);
      expect(classified.errorCode).toBe('CACHE_ERROR');
      expect(classified.severity).toBe('medium');
    });

    it('should integrate with existing MCP error handling', () => {
      const mcpError = new Error('Invalid tool parameters');
      const classifier = new ErrorClassifier();
      
      const classified = classifier.classifyError(mcpError, 'tool_validation');
      
      expect(classified).toBeInstanceOf(ValidationError);
      expect(classified.errorCode).toBe('VALIDATION_ERROR');
    });
  });
});