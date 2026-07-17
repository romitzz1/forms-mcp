// ABOUTME: HTTP client for the Gravity Forms REST API v2 (auth headers + request execution)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate transport concerns from tool handlers

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

export interface IGravityFormsClientConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  authMethod: 'basic' | 'oauth';
}

export class GravityFormsClient {
  private readonly baseUrl: string;
  private readonly consumerKey: string;
  private readonly consumerSecret: string;
  private readonly authMethod: 'basic' | 'oauth';

  constructor(config: IGravityFormsClientConfig) {
    this.baseUrl = config.baseUrl;
    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;
    this.authMethod = config.authMethod;
  }

  getAuthHeaders(): Record<string, string> {
    if (this.authMethod === 'basic') {
      const credentials = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
      return {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json'
      };
    }
    // OAuth implementation would go here
    throw new McpError(
      ErrorCode.InvalidParams,
      'OAuth authentication not implemented yet'
    );
  }

  async makeRequest<T = unknown>(endpoint: string, method = 'GET', body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/wp-json/gf/v2${endpoint}`;
    const headers = this.getAuthHeaders();

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorBody = await response.text();
          if (errorBody) {
            errorDetail += ` - ${errorBody}`;
          }
        } catch {
          // Ignore errors reading the response body
        }
        throw new Error(errorDetail);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
