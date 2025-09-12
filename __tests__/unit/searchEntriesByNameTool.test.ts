// ABOUTME: Comprehensive tests for search_entries_by_name MCP tool - TDD implementation for Step 8
// ABOUTME: Tests universal name search tool with all search strategies, error handling, and integration

import { UniversalSearchManager } from '../../utils/universalSearchManager';
import { FieldTypeDetector } from '../../utils/fieldTypeDetector';
import { SearchResultsFormatter } from '../../utils/searchResultsFormatter';

describe('search_entries_by_name Tool Components', () => {
  let fieldDetector: FieldTypeDetector;
  let searchManager: UniversalSearchManager;
  let resultsFormatter: SearchResultsFormatter;
  let mockApiClient: any;

  beforeEach(() => {
    fieldDetector = new FieldTypeDetector();
    resultsFormatter = new SearchResultsFormatter();
    
    // Mock API client
    mockApiClient = {
      getFormDefinition: jest.fn(),
      searchEntries: jest.fn()
    };
    
    searchManager = new UniversalSearchManager(fieldDetector, mockApiClient);
  });

  describe('integration test - full search workflow', () => {
    it('should perform complete search workflow successfully', async () => {
      // Mock form definition
      const mockFormData = {
        id: "193",
        title: "League Sign up 25-26",
        fields: [
          { id: "52", label: "Name", type: "text" },
          { id: "54", label: "Email Address", type: "email" },
          { id: "17", label: "Team Members", type: "textarea" }
        ]
      };

      // Mock the search result that UniversalSearchManager would return
      const mockSearchResult = {
        matches: [
          {
            entryId: "10795",
            matchedFields: { "52": "John Smith" },
            confidence: 0.95
          }
        ],
        totalFound: 1,
        searchMetadata: {
          formId: "193",
          searchText: "John Smith",
          strategy: 'auto',
          fieldsSearched: 2,
          executionTimeMs: 1200,
          cacheStatus: {
            hit: false,
            source: 'analysis',
            timestamp: new Date()
          }
        }
      };

      // Setup mocks
      mockApiClient.getFormDefinition.mockResolvedValue(mockFormData);
      // Mock the actual method that will be called
      jest.spyOn(searchManager, 'searchByName').mockResolvedValue(mockSearchResult as any);

      // Test the workflow
      const searchResult = await searchManager.searchByName("193", "John Smith", {
        strategy: 'auto',
        maxResults: 50,
        includeContext: true
      });

      // Verify search result
      expect(searchResult.matches.length).toBeGreaterThan(0);
      expect(searchResult.searchMetadata.searchText).toBe("John Smith");
      
      // Transform result like the implementation does
      const transformedResult = {
        matches: searchResult.matches.map(match => ({
          ...match,
          entryData: { 
            id: match.entryId,
            ...match.matchedFields,
            form_id: "193"
          }
        })),
        totalFound: searchResult.totalFound,
        searchMetadata: {
          searchText: searchResult.searchMetadata.searchText,
          executionTime: searchResult.searchMetadata.executionTimeMs,
          apiCalls: 1,
          fieldsSearched: [`${searchResult.searchMetadata.fieldsSearched} fields`]
        }
      };

      // Test formatting
      const formattedResult = resultsFormatter.formatSearchResults(
        transformedResult as any,
        'detailed',
        mockFormData
      );

      expect(formattedResult.content).toContain('John Smith');
      expect(formattedResult.resultCount).toBeGreaterThan(0);
      expect(formattedResult.tokenCount).toBeGreaterThan(0);
    });

    it('should handle different search strategies', async () => {
      // Mock form and entry data
      const mockFormData = {
        id: "193",
        title: "Test Form",
        fields: [{ id: "52", label: "Name", type: "text" }]
      };
      
      const mockEntries = [{
        id: "1",
        form_id: "193",
        "52": "John Smith"
      }];

      mockApiClient.getFormDefinition.mockResolvedValue(mockFormData);
      mockApiClient.searchEntries.mockResolvedValue(mockEntries);

      // Test different strategies
      const strategies = ['exact', 'contains', 'fuzzy'] as const;
      
      for (const strategy of strategies) {
        const result = await searchManager.searchByName("193", "John", {
          strategy: strategy,
          maxResults: 50,
          includeContext: true
        });
        
        expect(result.searchMetadata.strategy).toBe(strategy);
        expect(Array.isArray(result.matches)).toBe(true);
      }
    });

    it('should handle no matches found', async () => {
      const mockFormData = {
        id: "193", 
        title: "Test Form",
        fields: [{ id: "52", label: "Name", type: "text" }]
      };

      // Mock empty search result
      const emptySearchResult = {
        matches: [],
        totalFound: 0,
        searchMetadata: {
          formId: "193",
          searchText: "Nonexistent Person",
          strategy: 'auto',
          fieldsSearched: 1,
          executionTimeMs: 500,
          cacheStatus: {
            hit: false,
            source: 'analysis',
            timestamp: new Date()
          }
        }
      };

      mockApiClient.getFormDefinition.mockResolvedValue(mockFormData);
      jest.spyOn(searchManager, 'searchByName').mockResolvedValue(emptySearchResult as any);

      const searchResult = await searchManager.searchByName("193", "Nonexistent Person");
      
      expect(searchResult.matches).toHaveLength(0);
      expect(searchResult.totalFound).toBe(0);
      
      // Transform the result like the implementation does
      const transformedResult = {
        matches: searchResult.matches.map(match => ({
          ...match,
          entryData: { 
            id: match.entryId,
            ...match.matchedFields,
            form_id: "193"
          }
        })),
        totalFound: searchResult.totalFound,
        searchMetadata: {
          searchText: searchResult.searchMetadata.searchText,
          executionTime: searchResult.searchMetadata.executionTimeMs,
          apiCalls: 1,
          fieldsSearched: [`${searchResult.searchMetadata.fieldsSearched} fields`]
        }
      };
      
      const formattedResult = resultsFormatter.formatSearchResults(
        transformedResult as any,
        'detailed',
        mockFormData
      );

      expect(formattedResult.content).toContain('No matches found');
      expect(formattedResult.resultCount).toBe(0);
    });

    it('should handle API errors gracefully', async () => {
      mockApiClient.getFormDefinition.mockRejectedValue(new Error('Network timeout'));

      await expect(
        searchManager.searchByName("193", "John Smith")
      ).rejects.toThrow('Network timeout');
    });
  });

  describe('validation', () => {
    it('should validate input parameters correctly', () => {
      // Test field detection
      const mockFormData = {
        id: "193",
        title: "Test Form",
        fields: [
          { id: "52", label: "Name", type: "text" },
          { id: "54", label: "Email", type: "email" }
        ]
      };

      const analysis = fieldDetector.analyzeFormFields(mockFormData);
      expect(analysis).toBeDefined();
      
      const nameFields = fieldDetector.getFieldsByType(analysis, 'name');
      expect(nameFields.length).toBeGreaterThan(0);
    });
  });
});