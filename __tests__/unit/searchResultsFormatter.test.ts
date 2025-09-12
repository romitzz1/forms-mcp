// ABOUTME: Comprehensive tests for SearchResultsFormatter class - TDD implementation for Step 6
// ABOUTME: Tests formatting capabilities, token management, and various output modes

import { SearchResultsFormatter } from '../../utils/searchResultsFormatter';
import {
  SearchResult,
  SearchMatch,
  OutputMode,
  FormattedResult,
  MatchHighlight,
  ResultSummary
} from '../../utils/searchResultsFormatter';
import { FieldTypeInfo, DetectedFieldType } from '../../utils/fieldTypeDetector';

describe('SearchResultsFormatter', () => {
  let formatter: SearchResultsFormatter;
  
  // Shared test data
  const mockFormInfo = {
    id: "193",
    title: "League Sign up 25-26",
    fields: [
      { id: "52", label: "Name" },
      { id: "54", label: "Email Address" }
    ]
  };

  const singleMatchResult: SearchResult = {
    matches: [{
      entryId: "10795",
      matchedFields: { "52": "John Smith" },
      confidence: 0.95,
      entryData: {
        "id": "10795",
        "form_id": "193",
        "date_created": "2025-09-03 15:43:56",
        "payment_status": "Paid",
        "payment_amount": "$200.00",
        "52": "John Smith",
        "54": "john.smith@email.com"
      }
    }],
    totalFound: 1,
    searchMetadata: {
      searchText: "John Smith",
      executionTime: 1200,
      apiCalls: 1,
      fieldsSearched: ["52"]
    }
  };

  beforeEach(() => {
    formatter = new SearchResultsFormatter();
  });

  describe('constructor', () => {
    it('should create formatter with default configuration', () => {
      expect(formatter).toBeInstanceOf(SearchResultsFormatter);
    });
  });

  describe('formatSearchResults', () => {

    describe('detailed output mode', () => {
      it('should format single match in detailed view', () => {
        const result = formatter.formatSearchResults(
          singleMatchResult,
          'detailed',
          mockFormInfo
        );

        expect(result.content).toContain('Found 1 match for "John Smith"');
        expect(result.content).toContain('Entry #10795 (High Confidence: 0.95)');
        expect(result.content).toContain('Name: John Smith (field 52)');
        expect(result.content).toContain('Email: john.smith@email.com (field 54)');
        expect(result.content).toContain('Payment: $200.00 Paid');
        expect(result.content).toContain('Search completed in 1.2s');
        expect(result.resultCount).toBe(1);
        expect(result.tokenCount).toBeGreaterThan(0);
      });

      it('should format multiple matches with different confidence levels', () => {
        const multiMatchResult: SearchResult = {
          matches: [
            {
              entryId: "10795",
              matchedFields: { "52": "John Smith" },
              confidence: 0.95,
              entryData: {
                "id": "10795",
                "52": "John Smith",
                "54": "john.smith@email.com",
                "payment_status": "Paid"
              }
            },
            {
              entryId: "10792",
              matchedFields: { "17": "John Smith mentioned" },
              confidence: 0.75,
              entryData: {
                "id": "10792",
                "52": "Different Person",
                "17": "Team member: John Smith",
                "payment_status": "Unpaid"
              }
            }
          ],
          totalFound: 2,
          searchMetadata: {
            searchText: "John Smith",
            executionTime: 800,
            apiCalls: 1,
            fieldsSearched: ["52", "17"]
          }
        };

        const result = formatter.formatSearchResults(
          multiMatchResult,
          'detailed',
          mockFormInfo
        );

        expect(result.content).toContain('Found 2 matches');
        expect(result.content).toContain('High Confidence: 0.95');
        expect(result.content).toContain('Medium Confidence: 0.75');
        expect(result.resultCount).toBe(2);
      });
    });

    describe('summary output mode', () => {
      it('should format single match in summary view', () => {
        const result = formatter.formatSearchResults(
          singleMatchResult,
          'summary',
          mockFormInfo
        );

        expect(result.content).toContain('1 match found');
        expect(result.content).toContain('#10795: John Smith');
        expect(result.content).toContain('john.smith@email.com');
        expect(result.content).toContain('Paid');
        expect(result.tokenCount).toBeLessThan(500); // Summary should be compact
      });

      it('should format multiple matches in summary view', () => {
        const multiMatchResult: SearchResult = {
          matches: Array.from({ length: 10 }, (_, i) => ({
            entryId: `1079${i}`,
            matchedFields: { "52": `John Smith ${i}` },
            confidence: 0.9 - (i * 0.05),
            entryData: {
              "id": `1079${i}`,
              "52": `John Smith ${i}`,
              "54": `john${i}@email.com`
            }
          })),
          totalFound: 10,
          searchMetadata: {
            searchText: "John Smith",
            executionTime: 1500,
            apiCalls: 1,
            fieldsSearched: ["52"]
          }
        };

        const result = formatter.formatSearchResults(
          multiMatchResult,
          'summary',
          mockFormInfo
        );

        expect(result.content).toContain('10 matches found');
        expect(result.resultCount).toBe(10);
        expect(result.tokenCount).toBeLessThan(2000); // Summary should be compact even with many results
      });
    });

    describe('minimal output mode', () => {
      it('should format results in minimal view', () => {
        const result = formatter.formatSearchResults(
          singleMatchResult,
          'minimal',
          mockFormInfo
        );

        expect(result.content).toContain('1 match');
        expect(result.content).toContain('10795');
        expect(result.tokenCount).toBeLessThan(200); // Minimal should be very compact
      });
    });

    describe('auto output mode', () => {
      it('should choose detailed mode for small result sets', () => {
        const result = formatter.formatSearchResults(
          singleMatchResult,
          'auto',
          mockFormInfo
        );

        // Should contain detailed view elements
        expect(result.content).toContain('Entry #10795 (High Confidence: 0.95)');
        expect(result.content).toContain('Search completed in 1.2s');
      });

      it('should choose summary mode for medium result sets', () => {
        const mediumResult: SearchResult = {
          matches: Array.from({ length: 25 }, (_, i) => ({
            entryId: `1079${i}`,
            matchedFields: { "52": `John Smith ${i}` },
            confidence: 0.8,
            entryData: { "id": `1079${i}`, "52": `John Smith ${i}` }
          })),
          totalFound: 25,
          searchMetadata: { searchText: "John", executionTime: 1000, apiCalls: 1, fieldsSearched: ["52"] }
        };

        const result = formatter.formatSearchResults(
          mediumResult,
          'auto',
          mockFormInfo
        );

        expect(result.content).toContain('25 matches found');
        // Should not contain detailed view elements
        expect(result.content).not.toContain('High Confidence:');
      });

      it('should choose minimal mode for large result sets', () => {
        const largeResult: SearchResult = {
          matches: Array.from({ length: 100 }, (_, i) => ({
            entryId: `1079${i}`,
            matchedFields: { "52": `John ${i}` },
            confidence: 0.7,
            entryData: { "id": `1079${i}`, "52": `John ${i}` }
          })),
          totalFound: 100,
          searchMetadata: { searchText: "John", executionTime: 2000, apiCalls: 2, fieldsSearched: ["52"] }
        };

        const result = formatter.formatSearchResults(
          largeResult,
          'auto',
          mockFormInfo
        );

        expect(result.content).toContain('100 matches');
        expect(result.tokenCount).toBeLessThan(1000); // Should be very compact
      });
    });

    describe('empty results', () => {
      it('should handle no matches found', () => {
        const emptyResult: SearchResult = {
          matches: [],
          totalFound: 0,
          searchMetadata: {
            searchText: "Nonexistent Person",
            executionTime: 500,
            apiCalls: 1,
            fieldsSearched: ["52"]
          }
        };

        const result = formatter.formatSearchResults(
          emptyResult,
          'detailed',
          mockFormInfo
        );

        expect(result.content).toContain('No matches found for "Nonexistent Person"');
        expect(result.content).toContain('Search completed in 0.5s');
        expect(result.resultCount).toBe(0);
      });
    });
  });

  describe('estimateResponseSize', () => {
    it('should estimate token count using 4:1 character ratio', () => {
      const testString = 'A'.repeat(400); // 400 characters
      const estimation = formatter.estimateResponseSize(testString);
      
      expect(estimation).toBeCloseTo(100, 5); // 400/4 = 100 tokens
    });

    it('should handle empty strings', () => {
      const estimation = formatter.estimateResponseSize('');
      expect(estimation).toBe(0);
    });
  });

  describe('highlightMatches', () => {
    const mockEntry = {
      "id": "10795",
      "52": "John Smith",
      "54": "john.smith@email.com",
      "17": "Team member: John Smith is the captain"
    };

    const mockFieldMapping: { [fieldId: string]: FieldTypeInfo } = {
      "52": { fieldId: "52", fieldType: "name" as DetectedFieldType, confidence: 0.95, label: "Name" },
      "54": { fieldId: "54", fieldType: "email" as DetectedFieldType, confidence: 1.0, label: "Email" },
      "17": { fieldId: "17", fieldType: "team" as DetectedFieldType, confidence: 0.85, label: "Team Notes" }
    };

    it('should highlight exact matches', () => {
      const highlights = formatter.highlightMatches(
        mockEntry,
        "John Smith",
        { "52": "John Smith" },
        mockFieldMapping
      );

      expect(highlights).toHaveLength(1);
      expect(highlights[0].fieldLabel).toBe("Name");
      expect(highlights[0].matchedValue).toBe("John Smith");
      expect(highlights[0].confidence).toBe(1.0); // Exact match
    });

    it('should highlight partial matches', () => {
      const highlights = formatter.highlightMatches(
        mockEntry,
        "John",
        { "52": "John Smith", "17": "Team member: John Smith is the captain" },
        mockFieldMapping
      );

      expect(highlights).toHaveLength(2);
      expect(highlights[0].fieldLabel).toBe("Name");
      expect(highlights[1].fieldLabel).toBe("Team Notes");
      expect(highlights[1].confidence).toBeLessThan(1.0); // Partial match
    });
  });

  describe('createDetailedView', () => {
    it('should create detailed view with all entry information', () => {
      const matches = [{
        entryId: "10795",
        matchedFields: { "52": "John Smith" },
        confidence: 0.95,
        entryData: {
          "id": "10795",
          "form_id": "193",
          "date_created": "2025-09-03 15:43:56",
          "payment_status": "Paid",
          "payment_amount": "$200.00",
          "52": "John Smith",
          "54": "john.smith@email.com"
        }
      }];

      const detailed = formatter.createDetailedView(matches, {});

      expect(detailed).toContain('Entry #10795');
      expect(detailed).toContain('High Confidence: 0.95');
      expect(detailed).toContain('John Smith');
      expect(detailed).toContain('john.smith@email.com');
      expect(detailed).toContain('$200.00 Paid');
    });
  });

  describe('createSummaryView', () => {
    it('should create compact summary view', () => {
      const matches = [{
        entryId: "10795",
        matchedFields: { "52": "John Smith" },
        confidence: 0.95,
        entryData: {
          "id": "10795",
          "52": "John Smith",
          "54": "john.smith@email.com"
        }
      }];

      const summary = formatter.createSummaryView(matches);

      expect(summary).toContain('#10795: John Smith');
      expect(summary).toContain('john.smith@email.com');
      // Should not contain detailed elements
      expect(summary).not.toContain('High Confidence:');
    });
  });

  describe('createMinimalView', () => {
    it('should create very compact minimal view', () => {
      const matches = [{
        entryId: "10795",
        matchedFields: { "52": "John Smith" },
        confidence: 0.95,
        entryData: { "id": "10795", "52": "John Smith" }
      }];

      const minimal = formatter.createMinimalView(matches);

      expect(minimal).toContain('10795');
      expect(minimal.length).toBeLessThan(100); // Very compact
    });
  });

  describe('getConfidenceLabel', () => {
    it('should return correct confidence labels', () => {
      expect(formatter.getConfidenceLabel(0.95)).toBe('High');
      expect(formatter.getConfidenceLabel(0.85)).toBe('High');
      expect(formatter.getConfidenceLabel(0.75)).toBe('Medium');
      expect(formatter.getConfidenceLabel(0.65)).toBe('Medium');
      expect(formatter.getConfidenceLabel(0.45)).toBe('Low');
      expect(formatter.getConfidenceLabel(0.25)).toBe('Low');
    });
  });

  describe('selectAutoMode', () => {
    it('should select detailed mode for small result sets', () => {
      const mode = formatter.selectAutoMode(5);
      expect(mode).toBe('detailed');
    });

    it('should select summary mode for medium result sets', () => {
      const mode = formatter.selectAutoMode(25);
      expect(mode).toBe('summary');
    });

    it('should select minimal mode for large result sets', () => {
      const mode = formatter.selectAutoMode(75);
      expect(mode).toBe('minimal');
    });
  });

  describe('token management', () => {
    it('should prevent token overflow by switching modes automatically', () => {
      // Create a large result set
      const largeResult: SearchResult = {
        matches: Array.from({ length: 200 }, (_, i) => ({
          entryId: `1079${i}`,
          matchedFields: { "52": `Very Long Name ${i} with lots of additional text data` },
          confidence: 0.8,
          entryData: {
            "id": `1079${i}`,
            "52": `Very Long Name ${i} with lots of additional text data`,
            "54": `very.long.email.address.${i}@example.com`,
            "additional_field": "A".repeat(100) // Large field data
          }
        })),
        totalFound: 200,
        searchMetadata: {
          searchText: "Name",
          executionTime: 3000,
          apiCalls: 1,
          fieldsSearched: ["52"]
        }
      };

      const result = formatter.formatSearchResults(
        largeResult,
        'auto',
        { id: "193", title: "Test Form", fields: [] }
      );

      // Should automatically use minimal mode and stay under token limit
      expect(result.tokenCount).toBeLessThan(25000);
      expect(result.content).not.toContain('High Confidence:'); // Not detailed mode
    });
  });

  describe('metadata inclusion', () => {
    it('should include search metadata in results', () => {
      const result = formatter.formatSearchResults(
        singleMatchResult,
        'detailed',
        mockFormInfo
      );

      expect(result.metadata).toBeDefined();
      expect(result.metadata.searchText).toBe("John Smith");
      expect(result.metadata.executionTime).toBe(1200);
      expect(result.metadata.apiCalls).toBe(1);
      expect(result.metadata.fieldsSearched).toEqual(["52"]);
      expect(result.metadata.outputMode).toBe('detailed');
    });
  });
});