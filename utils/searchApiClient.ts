// ABOUTME: API client adapter for UniversalSearchManager to integrate with GravityFormsMCPServer
// ABOUTME: Provides clean interface for form definition retrieval and entry searching with error handling

import { ApiClient } from './universalSearchManager';

export class SearchApiClient implements ApiClient {
    private baseUrl: string;
    private consumerKey: string;
    private consumerSecret: string;

    constructor(baseUrl: string, consumerKey: string, consumerSecret: string) {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.consumerKey = consumerKey;
        this.consumerSecret = consumerSecret;
        
        // Validate configuration
        this.validateConfig();
    }

    /**
     * Get form definition from Gravity Forms API
     */
    async getFormDefinition(formId: string): Promise<any> {
        if (!formId || typeof formId !== 'string' || formId.trim() === '') {
            throw new Error('Form ID is required and must be a non-empty string');
        }

        try {
            const endpoint = `/forms/${formId.trim()}`;
            const form = await this.makeRequest(endpoint);
            
            if (!form) {
                throw new Error(`Form ${formId} not found`);
            }

            return form;
        } catch (error) {
            if (error instanceof Error) {
                // Enhance error messages for common cases
                if (error.message.includes('404') || error.message.includes('Not Found')) {
                    throw new Error(`Form ${formId} not found. Please verify the form ID exists.`);
                }
                if (error.message.includes('403') || error.message.includes('Forbidden')) {
                    throw new Error(`Access denied to form ${formId}. Please check API permissions.`);
                }
                if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                    throw new Error('API authentication failed. Please verify consumer key and secret.');
                }
                throw error;
            }
            throw new Error(`Failed to retrieve form ${formId}: Unknown error`);
        }
    }

    /**
     * Search entries using Gravity Forms API with field filters
     */
    async searchEntries(formId: string, searchParams: any): Promise<any[]> {
        if (!formId || typeof formId !== 'string' || formId.trim() === '') {
            throw new Error('Form ID is required and must be a non-empty string');
        }

        try {
            const endpoint = `/forms/${formId.trim()}/entries`;
            const params = new URLSearchParams();

            // Build search parameter as JSON object per Gravity Forms API
            if (searchParams) {
                const searchObject: any = {};

                // Handle field_filters (primary search mechanism)
                if (searchParams.field_filters && Array.isArray(searchParams.field_filters)) {
                    const validFilters = searchParams.field_filters
                        .filter((filter: any) => filter && filter.key != null && filter.value != null)
                        .map((filter: any) => {
                            const sanitizedKey = String(filter.key).trim();
                            const sanitizedValue = String(filter.value).trim();
                            const sanitizedOperator = filter.operator ? String(filter.operator).trim() : 'contains';
                            
                            return sanitizedKey !== '' ? {
                                key: sanitizedKey,
                                value: sanitizedValue,
                                operator: sanitizedOperator
                            } : null;
                        })
                        .filter(Boolean);
                    
                    if (validFilters.length > 0) {
                        searchObject.field_filters = validFilters;
                    }
                }

                // Handle other search parameters
                if (searchParams.status) {
                    searchObject.status = searchParams.status;
                }

                if (searchParams.date_range) {
                    searchObject.date_range = searchParams.date_range;
                }

                // Add search parameter if we have something to search for
                if (Object.keys(searchObject).length > 0) {
                    params.append('search', JSON.stringify(searchObject));
                }
            }

            // Add default pagination to prevent overwhelming responses
            params.append('paging[page_size]', '100'); // Reasonable limit for search results

            const queryString = params.toString();
            const fullEndpoint = queryString ? `${endpoint}?${queryString}` : endpoint;
            
            const entries = await this.makeRequest(fullEndpoint);
            
            // Ensure we return an array
            if (!Array.isArray(entries)) {
                return [];
            }

            return entries;
        } catch (error) {
            if (error instanceof Error) {
                // Enhance error messages for common cases
                if (error.message.includes('404') || error.message.includes('Not Found')) {
                    throw new Error(`Form ${formId} not found for entry search. Please verify the form ID exists.`);
                }
                if (error.message.includes('403') || error.message.includes('Forbidden')) {
                    throw new Error(`Access denied to entries for form ${formId}. Please check API permissions.`);
                }
                throw error;
            }
            throw new Error(`Failed to search entries in form ${formId}: Unknown error`);
        }
    }

    /**
     * Make authenticated request to Gravity Forms API
     */
    private async makeRequest(endpoint: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: any): Promise<any> {
        const url = `${this.baseUrl}/wp-json/gf/v2${endpoint}`;
        
        const headers: any = {
            'Authorization': this.createAuthHeader(),
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        const config: RequestInit = {
            method,
            headers
        };

        if (body && (method === 'POST' || method === 'PUT')) {
            config.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, config);
            
            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
                
                try {
                    const errorData = JSON.parse(errorText);
                    if (errorData.message) {
                        errorMessage = errorData.message;
                    } else if (errorData.error) {
                        errorMessage = errorData.error;
                    }
                } catch {
                    // Keep original error message if JSON parsing fails
                }
                
                throw new Error(errorMessage);
            }

            const responseText = await response.text();
            
            // Handle empty responses
            if (!responseText.trim()) {
                return null;
            }

            try {
                return JSON.parse(responseText);
            } catch (parseError) {
                throw new Error(`Invalid JSON response from API: ${parseError instanceof Error ? parseError.message : 'Parse error'}`);
            }
        } catch (error) {
            if (error instanceof TypeError && error.message.includes('fetch')) {
                throw new Error(`Network error: Unable to connect to ${this.baseUrl}. Please verify the base URL is correct.`);
            }
            throw error;
        }
    }

    /**
     * Create Basic Authentication header
     */
    private createAuthHeader(): string {
        const credentials = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
        return `Basic ${credentials}`;
    }

    /**
     * Validate API configuration
     */
    private validateConfig(): void {
        if (!this.baseUrl || typeof this.baseUrl !== 'string') {
            throw new Error('Base URL is required for SearchApiClient');
        }

        if (!this.consumerKey || typeof this.consumerKey !== 'string') {
            throw new Error('Consumer key is required for SearchApiClient');
        }

        if (!this.consumerSecret || typeof this.consumerSecret !== 'string') {
            throw new Error('Consumer secret is required for SearchApiClient');
        }

        // Validate base URL format
        try {
            new URL(this.baseUrl);
        } catch {
            throw new Error(`Invalid base URL format: ${this.baseUrl}`);
        }
    }

    /**
     * Test API connection and authentication
     */
    async testConnection(): Promise<boolean> {
        try {
            // Try to get forms list to test authentication
            await this.makeRequest('/forms');
            return true;
        } catch (error) {
            throw new Error(`API connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}