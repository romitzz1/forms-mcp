// ABOUTME: Unit tests for UniversalSearchManager - intelligent multi-field search coordination
// ABOUTME: Tests search strategies, field detection integration, confidence scoring, and API integration

import { UniversalSearchManager } from '../../utils/universalSearchManager';
import { FieldTypeDetector, FormFieldMapping, DetectedFieldType } from '../../utils/fieldTypeDetector';
import { FieldMappingCache } from '../../utils/fieldMappingCache';

// Mock dependencies
jest.mock('../../utils/fieldTypeDetector');
jest.mock('../../utils/fieldMappingCache');

describe('UniversalSearchManager', () => {
    let searchManager: UniversalSearchManager;
    let mockFieldDetector: jest.Mocked<FieldTypeDetector>;
    let mockCache: jest.Mocked<FieldMappingCache>;
    let mockApiClient: any;

    const mockFormMapping: FormFieldMapping = {
        '52': { fieldId: '52', fieldType: 'name', confidence: 0.95, label: 'Name' },
        '1.3': { fieldId: '1.3', fieldType: 'name', confidence: 0.90, label: 'First Name' },
        '1.6': { fieldId: '1.6', fieldType: 'name', confidence: 0.90, label: 'Last Name' },
        '54': { fieldId: '54', fieldType: 'email', confidence: 0.95, label: 'Email Address' },
        '17': { fieldId: '17', fieldType: 'team', confidence: 0.85, label: 'Team Members' },
        '50': { fieldId: '50', fieldType: 'text', confidence: 0.60, label: 'Username' }
    };

    const mockForm = {
        id: '193',
        title: 'League Sign up 25-26',
        fields: Object.keys(mockFormMapping).map(id => ({
            id,
            label: mockFormMapping[id].label,
            type: 'text'
        }))
    };

    const mockEntries = [
        {
            id: '10795',
            form_id: '193',
            '52': 'John Smith',
            '54': 'john.smith@email.com',
            '17': 'Team Alpha',
            date_created: '2025-09-03 15:43:56',
            payment_status: 'Paid'
        },
        {
            id: '10792',
            form_id: '193',
            '52': 'Jane Doe',
            '54': 'jane.doe@email.com',
            '17': 'Team Beta with John Smith mentioned',
            date_created: '2025-09-02 14:30:22',
            payment_status: 'Unpaid'
        }
    ];

    beforeEach(() => {
        mockFieldDetector = new FieldTypeDetector() as jest.Mocked<FieldTypeDetector>;
        mockCache = new FieldMappingCache() as jest.Mocked<FieldMappingCache>;
        
        mockApiClient = {
            getFormDefinition: jest.fn().mockImplementation(async () => {
                // Add small delay to simulate real API call
                await new Promise(resolve => setTimeout(resolve, 1));
                return mockForm;
            }),
            searchEntries: jest.fn().mockImplementation(async () => {
                // Add small delay to simulate real API call
                await new Promise(resolve => setTimeout(resolve, 1));
                return mockEntries;
            })
        };

        searchManager = new UniversalSearchManager(mockFieldDetector, mockApiClient);

        // Setup default mocks
        mockFieldDetector.analyzeFormFieldsWithStatus.mockReturnValue({
            mapping: mockFormMapping,
            cacheStatus: { hit: false, source: 'analysis', timestamp: new Date() }
        });

        mockFieldDetector.getNameFields.mockReturnValue([
            { fieldId: '52', fieldType: 'name', confidence: 0.95, label: 'Name' },
            { fieldId: '1.3', fieldType: 'name', confidence: 0.90, label: 'First Name' },
            { fieldId: '1.6', fieldType: 'name', confidence: 0.90, label: 'Last Name' }
        ]);

        mockFieldDetector.getEmailFields.mockReturnValue([
            { fieldId: '54', fieldType: 'email', confidence: 0.95, label: 'Email Address' }
        ]);

        mockFieldDetector.getFieldsByType.mockImplementation((mapping: FormFieldMapping, fieldType: DetectedFieldType) => {
            return Object.values(mapping).filter(field => field.fieldType === fieldType);
        });
    });

    describe('Constructor and Initialization', () => {
        it('should initialize with field detector and API client', () => {
            expect(searchManager).toBeDefined();
            expect(searchManager['fieldDetector']).toBe(mockFieldDetector);
            expect(searchManager['apiClient']).toBe(mockApiClient);
        });

        it('should set default search options', () => {
            const defaultOptions = searchManager['defaultOptions'];
            expect(defaultOptions.strategy).toBe('auto');
            expect(defaultOptions.maxResults).toBe(50);
            expect(defaultOptions.includeContext).toBe(true);
        });
    });

    describe('searchByName', () => {
        it('should execute name search across multiple detected name fields', async () => {
            const result = await searchManager.searchByName('193', 'John Smith');

            expect(mockFieldDetector.analyzeFormFieldsWithStatus).toHaveBeenCalledWith(mockForm);
            expect(mockFieldDetector.getNameFields).toHaveBeenCalledWith(mockFormMapping);
            expect(mockApiClient.searchEntries).toHaveBeenCalledWith(
                '193',
                expect.objectContaining({
                    field_filters: expect.arrayContaining([
                        { key: '52', value: 'John Smith', operator: 'contains' },
                        { key: '1.3', value: 'John Smith', operator: 'contains' },
                        { key: '1.6', value: 'John Smith', operator: 'contains' }
                    ])
                })
            );
            
            expect(result.matches).toHaveLength(2);
            expect(result.totalFound).toBe(2);
        });

        it('should handle exact search strategy', async () => {
            await searchManager.searchByName('193', 'John Smith', { strategy: 'exact' });

            expect(mockApiClient.searchEntries).toHaveBeenCalledWith(
                '193',
                expect.objectContaining({
                    field_filters: expect.arrayContaining([
                        { key: '52', value: 'John Smith', operator: '=' },
                        { key: '1.3', value: 'John Smith', operator: '=' },
                        { key: '1.6', value: 'John Smith', operator: '=' }
                    ])
                })
            );
        });

        it('should handle contains search strategy', async () => {
            await searchManager.searchByName('193', 'John', { strategy: 'contains' });

            expect(mockApiClient.searchEntries).toHaveBeenCalledWith(
                '193',
                expect.objectContaining({
                    field_filters: expect.arrayContaining([
                        { key: '52', value: 'John', operator: 'contains' },
                        { key: '1.3', value: 'John', operator: 'contains' },
                        { key: '1.6', value: 'John', operator: 'contains' }
                    ])
                })
            );
        });

        it('should calculate match confidence correctly', async () => {
            const result = await searchManager.searchByName('193', 'John Smith');

            const firstMatch = result.matches.find(m => m.entryId === '10795');
            expect(firstMatch?.confidence).toBeGreaterThan(0.9); // Direct name match

            const secondMatch = result.matches.find(m => m.entryId === '10792');
            expect(secondMatch?.confidence).toBeLessThan(0.8); // Team mention match
        });

        it('should include matched field context', async () => {
            const result = await searchManager.searchByName('193', 'John Smith');

            const firstMatch = result.matches.find(m => m.entryId === '10795');
            expect(firstMatch?.matchedFields['52']).toBe('John Smith');
            
            const secondMatch = result.matches.find(m => m.entryId === '10792');
            expect(secondMatch?.matchedFields['17']).toContain('John Smith');
        });

        it('should respect maxResults option', async () => {
            const result = await searchManager.searchByName('193', 'John', { maxResults: 1 });
            expect(result.matches).toHaveLength(1);
        });

        it('should handle no matches gracefully', async () => {
            mockApiClient.searchEntries.mockResolvedValueOnce([]);
            const result = await searchManager.searchByName('193', 'NonexistentName');

            expect(result.matches).toHaveLength(0);
            expect(result.totalFound).toBe(0);
        });
    });

    describe('searchByEmail', () => {
        it('should execute email search across detected email fields', async () => {
            const result = await searchManager.searchByEmail('193', 'john.smith@email.com');

            expect(mockFieldDetector.getEmailFields).toHaveBeenCalledWith(mockFormMapping);
            expect(mockApiClient.searchEntries).toHaveBeenCalledWith(
                '193',
                expect.objectContaining({
                    field_filters: [
                        { key: '54', value: 'john.smith@email.com', operator: 'contains' }
                    ]
                })
            );
            
            expect(result.matches).toBeDefined();
        });

        it('should handle partial email search', async () => {
            await searchManager.searchByEmail('193', '@email.com');

            expect(mockApiClient.searchEntries).toHaveBeenCalledWith(
                '193',
                expect.objectContaining({
                    field_filters: [
                        { key: '54', value: '@email.com', operator: 'contains' }
                    ]
                })
            );
        });
    });

    describe('searchUniversal', () => {
        it('should search across multiple field types', async () => {
            const result = await searchManager.searchUniversal('193', 'John', ['name', 'team']);

            expect(mockApiClient.searchEntries).toHaveBeenCalledWith(
                '193',
                expect.objectContaining({
                    field_filters: expect.arrayContaining([
                        { key: '52', value: 'John', operator: 'contains' },
                        { key: '1.3', value: 'John', operator: 'contains' },
                        { key: '1.6', value: 'John', operator: 'contains' },
                        { key: '17', value: 'John', operator: 'contains' }
                    ])
                })
            );
        });

        it('should handle single field type', async () => {
            const result = await searchManager.searchUniversal('193', 'john@email.com', ['email']);

            expect(mockApiClient.searchEntries).toHaveBeenCalledWith(
                '193',
                expect.objectContaining({
                    field_filters: [
                        { key: '54', value: 'john@email.com', operator: 'contains' }
                    ]
                })
            );
        });

        it('should handle empty field types by searching all text fields', async () => {
            mockFieldDetector.getAllTextFields.mockReturnValue(Object.values(mockFormMapping));
            
            await searchManager.searchUniversal('193', 'search text', []);

            expect(mockFieldDetector.getAllTextFields).toHaveBeenCalledWith(mockFormMapping);
        });
    });

    describe('buildFieldFilters', () => {
        it('should build correct field filters for name fields', () => {
            const nameFields = [
                { fieldId: '52', fieldType: 'name' as DetectedFieldType, confidence: 0.95, label: 'Name' },
                { fieldId: '1.3', fieldType: 'name' as DetectedFieldType, confidence: 0.90, label: 'First Name' }
            ];

            const filters = searchManager.buildFieldFilters(nameFields, 'John Smith', 'contains');

            expect(filters).toEqual([
                { key: '52', value: 'John Smith', operator: 'contains' },
                { key: '1.3', value: 'John Smith', operator: 'contains' }
            ]);
        });

        it('should handle different operators', () => {
            const fields = [
                { fieldId: '52', fieldType: 'name' as DetectedFieldType, confidence: 0.95, label: 'Name' }
            ];

            const exactFilters = searchManager.buildFieldFilters(fields, 'John Smith', 'exact');
            expect(exactFilters[0].operator).toBe('=');

            const containsFilters = searchManager.buildFieldFilters(fields, 'John', 'contains');
            expect(containsFilters[0].operator).toBe('contains');
        });

        it('should handle empty fields array', () => {
            const filters = searchManager.buildFieldFilters([], 'search text', 'contains');
            expect(filters).toEqual([]);
        });
    });

    describe('calculateMatchConfidence', () => {
        it('should calculate high confidence for exact matches in name fields', () => {
            const entry = mockEntries[0]; // John Smith in field 52
            const matchedFields = { '52': 'John Smith' };
            
            const confidence = searchManager.calculateMatchConfidence(entry, 'John Smith', matchedFields);
            expect(confidence).toBeGreaterThan(0.9);
        });

        it('should calculate medium confidence for partial matches', () => {
            const entry = mockEntries[1]; // Jane Doe, but John Smith mentioned in team field
            const matchedFields = { '17': 'Team Beta with John Smith mentioned' };
            
            const confidence = searchManager.calculateMatchConfidence(entry, 'John Smith', matchedFields);
            expect(confidence).toBeLessThan(0.9);
            expect(confidence).toBeGreaterThan(0.5);
        });

        it('should handle multiple matched fields', () => {
            const entry = { ...mockEntries[0] };
            const matchedFields = { '52': 'John Smith', '54': 'john.smith@email.com' };
            
            const confidence = searchManager.calculateMatchConfidence(entry, 'John Smith', matchedFields);
            expect(confidence).toBeGreaterThan(0.9); // Multiple field matches boost confidence
        });

        it('should handle empty matched fields', () => {
            const confidence = searchManager.calculateMatchConfidence(mockEntries[0], 'John Smith', {});
            expect(confidence).toBe(0);
        });
    });

    describe('Error Handling', () => {
        it('should handle API errors gracefully', async () => {
            mockApiClient.getFormDefinition.mockRejectedValueOnce(new Error('Form not found'));

            await expect(searchManager.searchByName('999', 'John Smith'))
                .rejects.toThrow('Form not found');
        });

        it('should handle field detection failures', async () => {
            mockFieldDetector.analyzeFormFieldsWithStatus.mockImplementation(() => {
                throw new Error('Field analysis failed');
            });

            await expect(searchManager.searchByName('193', 'John Smith'))
                .rejects.toThrow('Field analysis failed');
        });

        it('should handle search API failures', async () => {
            mockApiClient.searchEntries.mockRejectedValueOnce(new Error('Search API error'));

            await expect(searchManager.searchByName('193', 'John Smith'))
                .rejects.toThrow('Search API error');
        });

        it('should validate input parameters', async () => {
            await expect(searchManager.searchByName('', 'John Smith'))
                .rejects.toThrow('Form ID is required');

            await expect(searchManager.searchByName('193', ''))
                .rejects.toThrow('Search text is required');
        });
    });

    describe('Search Metadata', () => {
        it('should include search metadata in results', async () => {
            const result = await searchManager.searchByName('193', 'John Smith');

            expect(result.searchMetadata).toBeDefined();
            expect(result.searchMetadata.formId).toBe('193');
            expect(result.searchMetadata.searchText).toBe('John Smith');
            expect(result.searchMetadata.strategy).toBe('auto');
            expect(result.searchMetadata.fieldsSearched).toBeGreaterThan(0);
        });

        it('should track execution time', async () => {
            const result = await searchManager.searchByName('193', 'John Smith');
            
            expect(result.searchMetadata.executionTimeMs).toBeGreaterThan(0);
        });

        it('should include cache status information', async () => {
            const result = await searchManager.searchByName('193', 'John Smith');
            
            expect(result.searchMetadata.cacheStatus).toBeDefined();
            expect(result.searchMetadata.cacheStatus.source).toBe('analysis');
        });
    });
});