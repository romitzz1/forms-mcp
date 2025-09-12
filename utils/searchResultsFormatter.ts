// ABOUTME: SearchResultsFormatter - Consistent, optimized formatting for all search results
// ABOUTME: Handles multiple output modes, token management, and match highlighting for universal search

import { FieldTypeInfo } from './fieldTypeDetector';

export type OutputMode = 'detailed' | 'summary' | 'minimal' | 'auto';

export interface SearchMatch {
  entryId: string;
  matchedFields: { [fieldId: string]: string };
  confidence: number;
  entryData: { [key: string]: any };
}

export interface SearchResult {
  matches: SearchMatch[];
  totalFound: number;
  searchMetadata: {
    searchText: string;
    executionTime: number;
    apiCalls: number;
    fieldsSearched: string[];
    [key: string]: any;
  };
}

export interface FormattedResult {
  content: string;
  tokenCount: number;
  resultCount: number;
  metadata: {
    searchText: string;
    executionTime: number;
    apiCalls: number;
    fieldsSearched: string[];
    outputMode: OutputMode;
    [key: string]: any;
  };
}

export interface MatchHighlight {
  fieldLabel: string;
  matchedValue: string;
  confidence: number;
}

export interface ResultSummary {
  entryId: string;
  primaryName: string;
  email: string;
  highlights: MatchHighlight[];
}

export interface FormInfo {
  id: string;
  title: string;
  fields: Array<{ id: string; label: string; [key: string]: any }>;
}

export class SearchResultsFormatter {
  private readonly TOKEN_RATIO = 4; // Approximate characters per token
  private readonly MAX_TOKEN_LIMIT = 25000;

  constructor() {}

  /**
   * Format search results in the specified output mode
   */
  formatSearchResults(
    searchResult: SearchResult,
    outputMode: OutputMode,
    formInfo: FormInfo
  ): FormattedResult {
    const actualMode = outputMode === 'auto' 
      ? this.selectAutoMode(searchResult.matches.length) 
      : outputMode;

    let content: string;
    
    if (searchResult.matches.length === 0) {
      content = this.formatNoResults(searchResult, formInfo);
    } else {
      switch (actualMode) {
        case 'detailed':
          content = this.formatDetailedResults(searchResult, formInfo);
          break;
        case 'summary':
          content = this.formatSummaryResults(searchResult, formInfo);
          break;
        case 'minimal':
          content = this.formatMinimalResults(searchResult, formInfo);
          break;
        default:
          content = this.formatDetailedResults(searchResult, formInfo);
      }
    }

    const tokenCount = this.estimateResponseSize(content);
    
    // Auto-switch to more compact mode if we exceed token limits
    if (tokenCount > this.MAX_TOKEN_LIMIT && actualMode !== 'minimal') {
      const compactMode = actualMode === 'detailed' ? 'summary' : 'minimal';
      return this.formatSearchResults(searchResult, compactMode, formInfo);
    }

    return {
      content,
      tokenCount,
      resultCount: searchResult.matches.length,
      metadata: {
        ...searchResult.searchMetadata,
        outputMode: actualMode
      }
    };
  }

  /**
   * Estimate response size in tokens using character count
   */
  estimateResponseSize(content: string): number {
    return Math.ceil(content.length / this.TOKEN_RATIO);
  }

  /**
   * Highlight matched fields in entry data
   */
  highlightMatches(
    entry: { [key: string]: any },
    searchText: string,
    matchedFields: { [fieldId: string]: string },
    fieldMapping: { [fieldId: string]: FieldTypeInfo }
  ): MatchHighlight[] {
    const highlights: MatchHighlight[] = [];

    Object.entries(matchedFields).forEach(([fieldId, matchedValue]) => {
      const fieldInfo = fieldMapping[fieldId];
      const fieldLabel = fieldInfo?.label || `Field ${fieldId}`;
      
      // Calculate match confidence based on how well the search text matches
      const confidence = this.calculateMatchConfidence(searchText, matchedValue);
      
      highlights.push({
        fieldLabel,
        matchedValue,
        confidence
      });
    });

    // Sort by field type priority first, then by confidence
    return highlights.sort((a, b) => {
      const aFieldId = Object.keys(matchedFields).find(id => {
        const info = fieldMapping[id];
        return info?.label === a.fieldLabel;
      });
      const bFieldId = Object.keys(matchedFields).find(id => {
        const info = fieldMapping[id];
        return info?.label === b.fieldLabel;
      });
      
      const aFieldType = aFieldId ? fieldMapping[aFieldId]?.fieldType : 'unknown';
      const bFieldType = bFieldId ? fieldMapping[bFieldId]?.fieldType : 'unknown';
      
      // Priority: name > email > team > others
      const typePriority: { [key: string]: number } = {
        'name': 4,
        'email': 3,
        'team': 2,
        'phone': 1,
        'text': 0,
        'unknown': 0
      };
      
      const aPriority = typePriority[aFieldType] || 0;
      const bPriority = typePriority[bFieldType] || 0;
      
      if (aPriority !== bPriority) {
        return bPriority - aPriority; // Higher priority first
      }
      
      return b.confidence - a.confidence; // Then by confidence
    });
  }

  /**
   * Create detailed view with full entry information
   */
  createDetailedView(matches: SearchMatch[], fieldMapping: { [fieldId: string]: FieldTypeInfo } = {}): string {
    return matches.map((match, index) => {
      const entry = match.entryData;
      const confidenceLabel = this.getConfidenceLabel(match.confidence);
      
      let result = `Entry #${match.entryId} (${confidenceLabel} Confidence: ${match.confidence.toFixed(2)})\n`;
      
      // Add key fields in priority order
      const keyFields = this.extractKeyFields(entry);
      keyFields.forEach(field => {
        result += `- ${field.label}: ${field.value}\n`;
      });
      
      return result;
    }).join('\n');
  }

  /**
   * Create compact summary view
   */
  createSummaryView(matches: SearchMatch[]): string {
    return matches.map(match => {
      const entry = match.entryData;
      const name = this.extractPrimaryName(entry);
      const email = this.extractPrimaryEmail(entry);
      
      let line = `#${match.entryId}: ${name}`;
      if (email) {
        line += ` (${email})`;
      }
      
      const paymentStatus = entry.payment_status || entry.payment_amount;
      if (paymentStatus) {
        line += ` - ${paymentStatus}`;
      }
      
      return line;
    }).join('\n');
  }

  /**
   * Create very compact minimal view
   */
  createMinimalView(matches: SearchMatch[]): string {
    const entryIds = matches.map(m => m.entryId).slice(0, 20); // Limit to first 20
    const remaining = matches.length > 20 ? ` (+${matches.length - 20} more)` : '';
    return `Entries: ${entryIds.join(', ')}${remaining}`;
  }

  /**
   * Get confidence level label
   */
  getConfidenceLabel(confidence: number): string {
    if (confidence >= 0.8) return 'High';
    if (confidence >= 0.6) return 'Medium';
    return 'Low';
  }

  /**
   * Select appropriate output mode based on result count
   */
  selectAutoMode(resultCount: number): 'detailed' | 'summary' | 'minimal' {
    if (resultCount <= 10) return 'detailed';
    if (resultCount <= 50) return 'summary';
    return 'minimal';
  }

  private formatNoResults(searchResult: SearchResult, formInfo: FormInfo): string {
    const executionTime = (searchResult.searchMetadata.executionTime / 1000).toFixed(1);
    return `No matches found for "${searchResult.searchMetadata.searchText}" in form ${formInfo.id} (${formInfo.title}).\n\n` +
           `Search completed in ${executionTime}s using fields: ${searchResult.searchMetadata.fieldsSearched.join(', ')}.`;
  }

  private formatDetailedResults(searchResult: SearchResult, formInfo: FormInfo): string {
    const { matches, totalFound, searchMetadata } = searchResult;
    const executionTime = (searchMetadata.executionTime / 1000).toFixed(1);
    
    let result = `Found ${totalFound} match${totalFound !== 1 ? 'es' : ''} for "${searchMetadata.searchText}" in form ${formInfo.id} (${formInfo.title}):\n\n`;
    
    result += this.createDetailedView(matches);
    
    result += `\n\nSearch completed in ${executionTime}s using auto-detected name fields.`;
    
    return result;
  }

  private formatSummaryResults(searchResult: SearchResult, formInfo: FormInfo): string {
    const { matches, totalFound, searchMetadata } = searchResult;
    const executionTime = (searchMetadata.executionTime / 1000).toFixed(1);
    
    let result = `${totalFound} match${totalFound !== 1 ? 'es' : ''} found for "${searchMetadata.searchText}" in form ${formInfo.id}:\n\n`;
    
    result += this.createSummaryView(matches);
    
    result += `\n\nCompleted in ${executionTime}s (${searchMetadata.apiCalls} API call${searchMetadata.apiCalls !== 1 ? 's' : ''}).`;
    
    return result;
  }

  private formatMinimalResults(searchResult: SearchResult, formInfo: FormInfo): string {
    const { matches, totalFound, searchMetadata } = searchResult;
    
    let result = `${totalFound} matches found:\n`;
    result += this.createMinimalView(matches);
    
    const executionTime = (searchMetadata.executionTime / 1000).toFixed(1);
    result += `\n(${executionTime}s, ${searchMetadata.apiCalls} API calls)`;
    
    return result;
  }

  private calculateMatchConfidence(searchText: string, matchedValue: string): number {
    if (!searchText || !matchedValue) return 0;
    
    const searchLower = searchText.toLowerCase();
    const matchLower = matchedValue.toLowerCase();
    
    // Exact match gets highest confidence
    if (matchLower === searchLower) return 1.0;
    
    // Contains match gets high confidence
    if (matchLower.includes(searchLower)) return 0.85;
    
    // Partial word matches get medium confidence
    const searchWords = searchLower.split(/\s+/);
    const matchWords = matchLower.split(/\s+/);
    const matchingWords = searchWords.filter(word => 
      matchWords.some(mWord => mWord.includes(word) || word.includes(mWord))
    );
    
    if (matchingWords.length > 0) {
      return 0.7 * (matchingWords.length / searchWords.length);
    }
    
    return 0.3; // Low confidence for weak matches
  }

  private extractKeyFields(entry: { [key: string]: any }): Array<{ label: string; value: string }> {
    const keyFields: Array<{ label: string; value: string }> = [];
    
    // Extract name fields (common field IDs: 52, 55, 1.3/1.6 for first/last name)
    const nameFields = ['52', '55', '1.3', '1.6', '2', '3'];
    nameFields.forEach(fieldId => {
      if (entry[fieldId]) {
        const label = fieldId.includes('.') ? 
          (fieldId.endsWith('.3') ? 'First Name' : 'Last Name') : 'Name';
        keyFields.push({ label: `${label}`, value: `${entry[fieldId]} (field ${fieldId})` });
      }
    });
    
    // Extract email fields (common field IDs: 50, 54)
    const emailFields = ['50', '54', '4', '5'];
    emailFields.forEach(fieldId => {
      if (entry[fieldId] && entry[fieldId].includes('@')) {
        keyFields.push({ label: 'Email', value: `${entry[fieldId]} (field ${fieldId})` });
      }
    });
    
    // Extract payment information
    if (entry.payment_amount && entry.payment_status) {
      keyFields.push({ 
        label: 'Payment', 
        value: `${entry.payment_amount} ${entry.payment_status}` 
      });
    } else if (entry.payment_status) {
      keyFields.push({ label: 'Payment', value: entry.payment_status });
    }
    
    // Extract date
    if (entry.date_created) {
      keyFields.push({ label: 'Date', value: entry.date_created });
    }
    
    return keyFields;
  }

  private extractPrimaryName(entry: { [key: string]: any }): string {
    // Try common name field IDs in order of preference
    const nameFields = ['52', '55', '2', '3'];
    for (const fieldId of nameFields) {
      if (entry[fieldId]) {
        return entry[fieldId];
      }
    }
    
    // Try composite name from first/last name fields
    const firstName = entry['1.3'] || entry['2.3'];
    const lastName = entry['1.6'] || entry['2.6'];
    if (firstName || lastName) {
      return [firstName, lastName].filter(Boolean).join(' ');
    }
    
    return 'Unknown';
  }

  private extractPrimaryEmail(entry: { [key: string]: any }): string | null {
    // Try common email field IDs
    const emailFields = ['54', '50', '4', '5'];
    for (const fieldId of emailFields) {
      if (entry[fieldId] && entry[fieldId].includes('@')) {
        return entry[fieldId];
      }
    }
    return null;
  }
}