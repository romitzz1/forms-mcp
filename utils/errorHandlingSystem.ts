// ABOUTME: Comprehensive error handling system for universal search functionality
// ABOUTME: Provides error classification, graceful degradation, recovery mechanisms, and monitoring

import type { DetectedFieldType, FormFieldMapping } from './fieldTypeDetector.js';
import type { ApiClient, SearchOptions } from './universalSearchManager.js';

// =====================================
// Error Classification System
// =====================================

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ErrorContext = 'api_call' | 'form_access' | 'field_detection' | 'cache_operation' | 'validation' | 'tool_validation';

/**
 * Base error class for all universal search errors
 */
export class SearchError extends Error {
  public readonly errorCode: string;
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: Date;
  public readonly retryable: boolean;
  public readonly severity: ErrorSeverity;

  constructor(
    message: string, 
    errorCode = 'SEARCH_ERROR', 
    context?: Record<string, unknown>,
    retryable = false,
    severity: ErrorSeverity = 'medium'
  ) {
    super(message);
    this.name = 'SearchError';
    this.errorCode = errorCode;
    this.context = context;
    this.timestamp = new Date();
    this.retryable = retryable;
    this.severity = severity;
  }
}

/**
 * Form access errors (form not found, permission denied, etc.)
 */
export class FormAccessError extends SearchError {
  public readonly httpStatus?: number;

  constructor(message: string, httpStatus?: number, context?: Record<string, unknown>) {
    super(message, 'FORM_ACCESS_ERROR', context, false, 'high');
    this.name = 'FormAccessError';
    this.httpStatus = httpStatus;
  }
}

/**
 * Field detection and analysis errors
 */
export class FieldDetectionError extends SearchError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'FIELD_DETECTION_ERROR', context, true, 'medium');
    this.name = 'FieldDetectionError';
  }
}

/**
 * API communication errors
 */
export class ApiError extends SearchError {
  public readonly httpStatus?: number;

  constructor(message: string, httpStatus?: number, retryable = false, context?: Record<string, unknown>) {
    const severity: ErrorSeverity = httpStatus && httpStatus >= 500 ? 'high' : 'medium';
    super(message, 'API_ERROR', context, retryable, severity);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
  }
}

/**
 * Cache system errors
 */
export class CacheError extends SearchError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CACHE_ERROR', context, true, 'medium');
    this.name = 'CacheError';
  }
}

/**
 * Input validation errors
 */
export class ValidationError extends SearchError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', context, false, 'low');
    this.name = 'ValidationError';
  }
}

// =====================================
// Error Classification Logic
// =====================================

export class ErrorClassifier {
  /**
   * Classify raw errors into structured SearchError instances
   */
  public classifyError(error: Error, context: ErrorContext): SearchError {
    const message = error.message;
    const lowerMessage = message.toLowerCase();

    // Form access errors have priority over API errors for 401, 403, 404
    if (context === 'form_access' || (this.isFormAccessError(lowerMessage) && !context.startsWith('api'))) {
      return this.classifyFormAccessError(error, message);
    }

    // Authentication and permission errors are form access errors even in API context
    if (this.isAuthError(lowerMessage)) {
      return this.classifyFormAccessError(error, message);
    }

    // API-related errors (but not auth/access errors)
    if (context === 'api_call' || this.isApiError(lowerMessage)) {
      return this.classifyApiError(error, message);
    }

    // Field detection errors
    if (context === 'field_detection') {
      return new FieldDetectionError(message, { originalError: error.name });
    }

    // Cache operation errors
    if (context === 'cache_operation') {
      return new CacheError(message, { originalError: error.name });
    }

    // Validation errors
    if (context === 'validation' || context === 'tool_validation') {
      return new ValidationError(message, { originalError: error.name });
    }

    // Default to generic SearchError
    return new SearchError(message, 'UNKNOWN_ERROR', { originalError: error.name }, false, 'medium');
  }

  private isApiError(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    return lowerMessage.includes('timeout') || 
           lowerMessage.includes('etimedout') ||
           lowerMessage.includes('network') ||
           (lowerMessage.includes('connection') && !lowerMessage.includes('database')) ||
           /\d{3}[\s:]/.test(message) || // HTTP status codes with space or colon
           lowerMessage.includes('http') ||
           lowerMessage.includes('request failed') ||
           lowerMessage.includes('fetch failed');
  }

  private isFormAccessError(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    return lowerMessage.includes('not found') ||
           lowerMessage.includes('unauthorized') ||
           lowerMessage.includes('forbidden') ||
           lowerMessage.includes('access denied') ||
           lowerMessage.includes('permission denied') ||
           lowerMessage.includes('invalid form');
  }

  private isAuthError(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    // More flexible patterns for authentication errors
    return /40[134]/.test(message) || // 401, 403, 404 anywhere in message
           lowerMessage.includes('unauthorized') ||
           lowerMessage.includes('forbidden') ||
           lowerMessage.includes('not found') ||
           lowerMessage.includes('authentication') ||
           lowerMessage.includes('permission') ||
           lowerMessage.includes('access denied');
  }

  private classifyApiError(error: Error, message: string): ApiError {
    // Extract HTTP status code if present
    const statusMatch = message.match(/(\d{3})/);
    const status = statusMatch ? parseInt(statusMatch[1]) : undefined;

    // Determine if retryable
    let retryable = false;
    if (status) {
      retryable = status >= 500 || status === 408 || status === 429; // Server errors, timeout, rate limit
    } else if (message.toLowerCase().includes('timeout') || 
               message.toLowerCase().includes('etimedout')) {
      retryable = true;
    }

    return new ApiError(message, status, retryable, { originalError: error.name });
  }

  private classifyFormAccessError(error: Error, message: string): FormAccessError {
    const statusMatch = message.match(/(\d{3})/);
    const status = statusMatch ? parseInt(statusMatch[1]) : undefined;

    return new FormAccessError(message, status, { originalError: error.name });
  }

  /**
   * Generate user-friendly error messages with actionable suggestions
   */
  public getUserFriendlyMessage(error: SearchError): string {
    switch (error.errorCode) {
      case 'FORM_ACCESS_ERROR':
        return this.getFormAccessErrorMessage(error);
      case 'FIELD_DETECTION_ERROR':
        return this.getFieldDetectionErrorMessage(error);
      case 'API_ERROR':
        return this.getApiErrorMessage(error);
      case 'VALIDATION_ERROR':
        return this.getValidationErrorMessage(error);
      case 'CACHE_ERROR':
        return `Cache system error: ${error.message}. Continuing with direct API access. Performance may be slower.`;
      default:
        return `Search error: ${error.message}. Please try again or contact support if the problem persists.`;
    }
  }

  private getFormAccessErrorMessage(error: SearchError): string {
    if (error instanceof FormAccessError) {
      if (error.httpStatus === 404) {
        const formId = (error.context?.formId as string) ?? 'specified';
        return `Form with ID "${formId}" was not found. Please verify the form ID is correct and the form is active.`;
      }
      if (error.httpStatus === 401 || error.httpStatus === 403) {
        return 'Access denied to the form. Please check your API credentials and permissions.';
      }
    }
    return `Unable to access the form: ${error.message}. Please verify the form exists and is accessible.`;
  }

  private getFieldDetectionErrorMessage(error: SearchError): string {
    return `automatic field detection failed: ${error.message}. falling back to standard search. ` +
           'use get_field_mappings tool to inspect the form structure manually.';
  }

  private getApiErrorMessage(error: SearchError): string {
    if (error instanceof ApiError) {
      if (error.httpStatus === 429) {
        return 'Rate limit exceeded. Please wait a moment before trying again.';
      }
      if (error.httpStatus === 408 || error.message.toLowerCase().includes('timeout')) {
        return 'Request timeout. The server is taking too long to respond. Please try again.';
      }
      if (error.httpStatus && error.httpStatus >= 500) {
        return 'Server error occurred. This is likely a temporary issue. Please try again in a few moments.';
      }
    }
    return `API communication error: ${error.message}. Please check your connection and try again.`;
  }

  private getValidationErrorMessage(error: SearchError): string {
    if (error.context?.searchText) {
      const searchText = error.context.searchText;
      if (typeof searchText === 'string' && searchText.length < 2) {
        return `Search text "${searchText}" is too short. Please provide at least 2 characters for better search results.`;
      }
    }
    return `Invalid input: ${error.message}. Please check your parameters and try again.`;
  }
}

// =====================================
// Graceful Degradation Manager
// =====================================

export interface IDegradationResult {
  success: boolean;
  fallbackUsed: boolean;
  fallbackType?: string;
  data?: unknown;
  matches?: unknown[];
  cacheBypass?: boolean;
  simplifiedDetection?: boolean;
  fieldMapping?: FormFieldMapping;
  error?: string;
  originalCacheError?: string;
  directOperationError?: string;
}

export class GracefulDegradationManager {
  private readonly apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Handle search failures with fallback to standard search
   */
  public async handleSearchFailure(
    formId: string,
    searchText: string,
    error: SearchError,
    options: SearchOptions
  ): Promise<IDegradationResult> {
    try {
      // Try multiple common field IDs that are typically used for names
      const commonNameFields = ['1', '2', '3', '52', '55', '1.3', '1.6']; // Common patterns for name fields
      const fieldFilters = commonNameFields.map(fieldId => ({
        key: fieldId,
        value: searchText,
        operator: 'contains' // Use contains for better matching
      }));

      const searchParams = {
        search: {
          field_filters: fieldFilters
        },
        paging: { page_size: options.maxResults }
      };

      const entries = await this.apiClient.searchEntries(formId, searchParams);
      
      return {
        success: true,
        fallbackUsed: true,
        fallbackType: 'standard_search',
        matches: entries.map((entry: Record<string, unknown>) => {
          // Find which fields actually matched
          const matchedFields: Record<string, string> = {};
          
          commonNameFields.forEach(fieldId => {
            const fieldValue = entry[fieldId];
            if (fieldValue && typeof fieldValue === 'string' && 
                fieldValue.toLowerCase().includes(searchText.toLowerCase())) {
              matchedFields[fieldId] = fieldValue;
            }
          });

          return {
            entryId: typeof entry.id === 'string' ? entry.id : (typeof entry.id === 'number' ? String(entry.id) : ''),
            matchedFields,
            confidence: Object.keys(matchedFields).length > 0 ? 0.6 : 0.3
          };
        }).filter(match => Object.keys(match.matchedFields).length > 0) // Only return actual matches
      };
    } catch (fallbackError) {
      return {
        success: false,
        fallbackUsed: true,
        fallbackType: 'standard_search',
        error: fallbackError instanceof Error ? fallbackError.message : 'Unknown fallback error'
      };
    }
  }

  /**
   * Handle cache failures by bypassing cache
   */
  public async handleCacheFailure<T>(
    cacheKey: string,
    cacheError: CacheError,
    directOperation: () => Promise<T>
  ): Promise<IDegradationResult & { data?: T }> {
    try {
      const data = await directOperation();
      return {
        success: true,
        fallbackUsed: true,
        fallbackType: 'cache_bypass',
        cacheBypass: true,
        data
      };
    } catch (directError) {
      // If direct operation also fails, return failure with context
      return {
        success: false,
        fallbackUsed: true,
        fallbackType: 'cache_bypass',
        cacheBypass: true,
        error: `Cache failure (${cacheError.message}) followed by direct operation failure: ${
          directError instanceof Error ? directError.message : 'Unknown error'
        }`,
        originalCacheError: cacheError.message,
        directOperationError: directError instanceof Error ? directError.message : 'Unknown error'
      };
    }
  }

  /**
   * Handle field detection failures with simplified detection
   */
  public handleFieldDetectionFailure(
    formDefinition: unknown,
    _error: FieldDetectionError
  ): IDegradationResult {
    // Simplified field detection using basic heuristics
    const fieldMapping: FormFieldMapping = {};
    
    // Type guard for form definition
    if (
      typeof formDefinition === 'object' && 
      formDefinition !== null && 
      'fields' in formDefinition &&
      Array.isArray((formDefinition as { fields: unknown }).fields)
    ) {
      const formDef = formDefinition as { fields: Array<{ id: string; label?: string }> };
      for (const field of formDef.fields) {
        const label = field.label?.toLowerCase() ?? '';
        let fieldType: DetectedFieldType = 'text';
        let confidence = 0.7;

        if (label.includes('name')) {
          fieldType = 'name';
          confidence = 0.7;
        } else if (label.includes('email')) {
          fieldType = 'email';
          confidence = 0.8;
        } else if (label.includes('phone')) {
          fieldType = 'phone';
          confidence = 0.8;
        }

        fieldMapping[field.id] = {
          fieldId: field.id,
          fieldType,
          confidence,
          label: field.label ?? ''
        };
      }
    }

    return {
      success: true,
      fallbackUsed: true,
      fallbackType: 'simplified_detection',
      simplifiedDetection: true,
      fieldMapping
    };
  }
}

// =====================================
// Recovery Manager with Circuit Breaker
// =====================================

export interface IRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export class RecoveryManager {
  private readonly config: IRetryConfig;
  private readonly defaultConfig: IRetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2
  };

  constructor(config?: Partial<IRetryConfig>) {
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Execute operation with retry logic for transient failures
   */
  public async executeWithRetry<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    let lastError: SearchError | undefined;
    
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const searchError = error instanceof SearchError ? error : 
                          new SearchError(error instanceof Error ? error.message : 'Unknown error');
        
        lastError = searchError;
        
        // Don't retry non-retryable errors
        if (!searchError.retryable) {
          throw searchError;
        }
        
        // Don't retry on last attempt
        if (attempt === this.config.maxRetries - 1) {
          break;
        }
        
        // Calculate backoff delay
        const delay = Math.min(
          this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, attempt),
          this.config.maxDelayMs
        );
        
        await this.sleep(delay);
      }
    }
    
    throw lastError ?? new SearchError(`Operation ${operationName} failed after ${this.config.maxRetries} attempts`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =====================================
// Circuit Breaker Implementation
// =====================================

export interface ICircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  monitoringWindowMs: number;
}

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export class CircuitBreaker {
  private readonly config: ICircuitBreakerConfig;
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private nextAttemptTime = 0;
  private isExecuting = false; // Prevent concurrent state changes

  constructor(config: ICircuitBreakerConfig) {
    this.config = config;
  }

  /**
   * Execute operation through circuit breaker with thread-safe state management
   */
  public async execute<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
    // Thread-safe state check and transition
    const canExecute = this.checkAndTransitionState(operationName);
    if (!canExecute.allowed) {
      throw new SearchError(canExecute.reason, 'CIRCUIT_OPEN');
    }

    // Execute the operation
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Thread-safe state check and transition logic
   */
  private checkAndTransitionState(operationName: string): { allowed: boolean; reason: string } {
    // Prevent concurrent execution during state transitions
    if (this.isExecuting && this.state === CircuitState.HALF_OPEN) {
      return {
        allowed: false,
        reason: `Circuit breaker is HALF_OPEN and testing in progress for ${operationName}`
      };
    }

    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        return {
          allowed: false,
          reason: `Circuit breaker is OPEN for ${operationName} (retry after ${new Date(this.nextAttemptTime).toISOString()})`
        };
      } else {
        // Transition to HALF_OPEN and mark as executing
        this.state = CircuitState.HALF_OPEN;
        this.isExecuting = true;
      }
    }

    return { allowed: true, reason: 'Execution allowed' };
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
    this.isExecuting = false;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.isExecuting = false;

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.resetTimeoutMs;
    }
  }

  public getState(): CircuitState {
    return this.state;
  }

  public getFailureCount(): number {
    return this.failureCount;
  }
}

// =====================================
// Error Monitoring and Metrics
// =====================================

export interface IMonitoringConfig {
  trackingWindowMs: number;
  alertThresholds: {
    error_rate: number;
    high_severity_rate: number;
  };
}

export interface IErrorMetrics {
  totalErrors: number;
  totalOperations: number;
  errorRate: number;
  highSeverityRate: number;
  errorsByType: Record<string, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  performanceMetrics: Record<string, {
    avgResponseTime: number;
    callCount: number;
  }>;
}

export interface IAlert {
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  timestamp: Date;
  details: Record<string, unknown>;
}

export class ErrorMonitor {
  private readonly config: IMonitoringConfig;
  private errors: Array<{ error: SearchError; timestamp: Date }> = [];
  private operations: Array<{ success: boolean; timestamp: Date }> = [];
  private performanceData: Array<{ operation: string; duration: number; timestamp: Date }> = [];

  constructor(config: IMonitoringConfig) {
    this.config = config;
  }

  public recordError(error: SearchError): void {
    this.errors.push({ error, timestamp: new Date() });
    this.operations.push({ success: false, timestamp: new Date() });
    this.cleanup();
  }

  public recordSuccess(_operation: string): void {
    this.operations.push({ success: true, timestamp: new Date() });
    this.cleanup();
  }

  public recordPerformanceMetric(operation: string, durationMs: number): void {
    this.performanceData.push({ operation, duration: durationMs, timestamp: new Date() });
    this.cleanup();
  }

  public getMetrics(): IErrorMetrics {
    const now = Date.now();
    const windowStart = now - this.config.trackingWindowMs;

    const recentErrors = this.errors.filter(e => e.timestamp.getTime() > windowStart);
    const recentOperations = this.operations.filter(op => op.timestamp.getTime() > windowStart);
    const recentPerformance = this.performanceData.filter(p => p.timestamp.getTime() > windowStart);

    const errorsByType: Record<string, number> = {};
    const errorsBySeverity: Record<ErrorSeverity, number> = {
      low: 0, medium: 0, high: 0, critical: 0
    };

    recentErrors.forEach(({ error }) => {
      errorsByType[error.errorCode] = (errorsByType[error.errorCode] ?? 0) + 1;
      errorsBySeverity[error.severity]++;
    });

    const performanceMetrics: Record<string, { avgResponseTime: number; callCount: number; totalTime: number }> = {};
    recentPerformance.forEach(({ operation, duration }) => {
      performanceMetrics[operation] ??= { avgResponseTime: 0, callCount: 0, totalTime: 0 };
      
      const current = performanceMetrics[operation];
      current.totalTime += duration;
      current.callCount++;
      current.avgResponseTime = current.totalTime / current.callCount; // More efficient calculation
    });

    // Remove totalTime from final result (internal calculation only)
    const finalPerformanceMetrics: Record<string, { avgResponseTime: number; callCount: number }> = {};
    Object.entries(performanceMetrics).forEach(([operation, metrics]) => {
      finalPerformanceMetrics[operation] = {
        avgResponseTime: metrics.avgResponseTime,
        callCount: metrics.callCount
      };
    });

    const totalErrors = recentErrors.length;
    const totalOperations = recentOperations.length;
    const errorRate = totalOperations > 0 ? totalErrors / totalOperations : 0;
    const highSeverityErrors = errorsBySeverity.high + errorsBySeverity.critical;
    const highSeverityRate = totalOperations > 0 ? highSeverityErrors / totalOperations : 0;

    return {
      totalErrors,
      totalOperations,
      errorRate,
      highSeverityRate,
      errorsByType,
      errorsBySeverity,
      performanceMetrics: finalPerformanceMetrics
    };
  }

  public checkAlerts(): IAlert[] {
    const metrics = this.getMetrics();
    const alerts: IAlert[] = [];

    // High error rate alert
    if (metrics.errorRate > this.config.alertThresholds.error_rate) {
      alerts.push({
        type: 'HIGH_ERROR_RATE',
        severity: 'WARNING',
        message: `Error rate (${(metrics.errorRate * 100).toFixed(1)}%) exceeds threshold (${(this.config.alertThresholds.error_rate * 100).toFixed(1)}%)`,
        timestamp: new Date(),
        details: {
          current_rate: metrics.errorRate,
          threshold: this.config.alertThresholds.error_rate,
          total_errors: metrics.totalErrors,
          total_operations: metrics.totalOperations
        }
      });
    }

    // High severity error rate alert
    if (metrics.highSeverityRate > this.config.alertThresholds.high_severity_rate) {
      alerts.push({
        type: 'HIGH_SEVERITY_ERRORS',
        severity: 'CRITICAL',
        message: `High severity error rate (${(metrics.highSeverityRate * 100).toFixed(1)}%) exceeds threshold (${(this.config.alertThresholds.high_severity_rate * 100).toFixed(1)}%)`,
        timestamp: new Date(),
        details: {
          current_rate: metrics.highSeverityRate,
          threshold: this.config.alertThresholds.high_severity_rate,
          high_severity_errors: metrics.errorsBySeverity.high + metrics.errorsBySeverity.critical
        }
      });
    }

    return alerts;
  }

  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.config.trackingWindowMs;

    this.errors = this.errors.filter(e => e.timestamp.getTime() > cutoff);
    this.operations = this.operations.filter(op => op.timestamp.getTime() > cutoff);
    this.performanceData = this.performanceData.filter(p => p.timestamp.getTime() > cutoff);
  }
}