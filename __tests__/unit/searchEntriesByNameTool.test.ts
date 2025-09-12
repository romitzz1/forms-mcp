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

      // Mock entries data
      const mockEntries = [
        {
          id: "10795",
          form_id: "193",
          date_created: "2025-09-03 15:43:56",
          payment_status: "Paid",
          payment_amount: "$200.00",
          "52": "John Smith",
          "54": "john.smith@email.com"
        }
      ];

      // Setup mocks
      mockApiClient.getFormDefinition.mockResolvedValue(mockFormData);
      mockApiClient.searchEntries.mockResolvedValue(mockEntries);

      // Test the workflow
      const searchResult = await searchManager.searchByName("193", "John Smith", {
        strategy: 'auto',
        maxResults: 50,
        includeContext: true
      });

      // Verify search result
      expect(searchResult.matches.length).toBeGreaterThan(0);
      expect(searchResult.searchMetadata.searchText).toBe("John Smith");
      
      // Test formatting
      const formattedResult = resultsFormatter.formatSearchResults(
        searchResult as any,
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

      mockApiClient.getFormDefinition.mockResolvedValue(mockFormData);
      mockApiClient.searchEntries.mockResolvedValue([]); // No entries

      const searchResult = await searchManager.searchByName("193", "Nonexistent Person");
      
      expect(searchResult.matches).toHaveLength(0);
      expect(searchResult.totalFound).toBe(0);
      
      const formattedResult = resultsFormatter.formatSearchResults(
        searchResult as any,
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