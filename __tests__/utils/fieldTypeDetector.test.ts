// ABOUTME: Comprehensive tests for FieldTypeDetector class that identifies field types in Gravity Forms
// ABOUTME: Tests automatic detection of name, email, phone, team fields with confidence scoring

import type { FormFieldMapping } from '../../utils/fieldTypeDetector';
import { DetectedFieldType, FieldTypeDetector, FieldTypeInfo } from '../../utils/fieldTypeDetector';
import { FieldMappingCache } from '../../utils/fieldMappingCache';

describe('FieldTypeDetector', () => {
    let detector: FieldTypeDetector;

    beforeEach(() => {
        detector = new FieldTypeDetector();
    });

    describe('Field Type Detection by Labels', () => {
        describe('Name Field Detection', () => {
            it('should detect standard name fields with high confidence', () => {
                const testFields = [
                    { id: '1', label: 'Name', type: 'text' },
                    { id: '2', label: 'Full Name', type: 'text' },
                    { id: '3', label: 'First Name', type: 'text' },
                    { id: '4', label: 'Last Name', type: 'text' },
                    { id: '5', label: 'Attendee Name', type: 'text' },
                    { id: '6', label: 'Participant', type: 'text' },
                    { id: '7', label: 'Member Name', type: 'text' }
                ];

                testFields.forEach(field => {
                    const result = detector.detectFieldType(field);
                    expect(result.fieldType).toBe('name');
                    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
                    expect(result.fieldId).toBe(field.id);
                    expect(result.label).toBe(field.label);
                });
            });

            it('should detect Gravity Forms name field type', () => {
                const field = { id: '52', label: 'Contact Name', type: 'name' };
                const result = detector.detectFieldType(field);
                
                expect(result.fieldType).toBe('name');
                expect(result.confidence).toBe(1.0);
            });

            it('should handle case-insensitive name detection', () => {
                const testFields = [
                    { id: '1', label: 'NAME', type: 'text' },
                    { id: '2', label: 'First name', type: 'text' },
                    { id: '3', label: 'FULL NAME', type: 'text' }
                ];

                testFields.forEach(field => {
                    const result = detector.detectFieldType(field);
                    expect(result.fieldType).toBe('name');
                    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
                });
            });
        });

        describe('Email Field Detection', () => {
            it('should detect email fields with high confidence', () => {
                const testFields = [
                    { id: '50', label: 'Email', type: 'text' },
                    { id: '54', label: 'Email Address', type: 'text' },
                    { id: '51', label: 'E-mail', type: 'text' },
                    { id: '52', label: 'Mail', type: 'text' },
                    { id: '53', label: 'Contact Email', type: 'text' }
                ];

                testFields.forEach(field => {
                    const result = detector.detectFieldType(field);
                    expect(result.fieldType).toBe('email');
                    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
                });
            });

            it('should detect Gravity Forms email field type', () => {
                const field = { id: '54', label: 'Contact Email', type: 'email' };
                const result = detector.detectFieldType(field);
                
                expect(result.fieldType).toBe('email');
                expect(result.confidence).toBe(1.0);
            });
        });

        describe('Phone Field Detection', () => {
            it('should detect phone fields with high confidence', () => {
                const testFields = [
                    { id: '10', label: 'Phone', type: 'text' },
                    { id: '11', label: 'Phone Number', type: 'text' },
                    { id: '12', label: 'Tel', type: 'text' },
                    { id: '13', label: 'Mobile', type: 'text' },
                    { id: '14', label: 'Cell Phone', type: 'text' },
                    { id: '15', label: 'Contact Number', type: 'text' }
                ];

                testFields.forEach(field => {
                    const result = detector.detectFieldType(field);
                    expect(result.fieldType).toBe('phone');
                    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
                });
            });

            it('should detect Gravity Forms phone field type', () => {
                const field = { id: '15', label: 'Contact Phone', type: 'phone' };
                const result = detector.detectFieldType(field);
                
                expect(result.fieldType).toBe('phone');
                expect(result.confidence).toBe(1.0);
            });
        });

        describe('Team/Group Field Detection', () => {
            it('should detect team and group fields', () => {
                const testFields = [
                    { id: '17', label: 'Team', type: 'text' },
                    { id: '18', label: 'Team Name', type: 'text' },
                    { id: '19', label: 'Group', type: 'text' },
                    { id: '20', label: 'With', type: 'text' },
                    { id: '21', label: 'Partner', type: 'text' },
                    { id: '22', label: 'Squad', type: 'text' },
                    { id: '23', label: 'Team Members', type: 'textarea' }
                ];

                testFields.forEach(field => {
                    const result = detector.detectFieldType(field);
                    expect(result.fieldType).toBe('team');
                    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
                });
            });
        });

        describe('Text Field Detection', () => {
            it('should detect generic text fields with low confidence', () => {
                const testFields = [
                    { id: '30', label: 'Comments', type: 'text' },
                    { id: '31', label: 'Notes', type: 'textarea' },
                    { id: '32', label: 'Description', type: 'text' }
                ];

                testFields.forEach(field => {
                    const result = detector.detectFieldType(field);
                    expect(result.fieldType).toBe('text');
                    expect(result.confidence).toBeLessThan(0.7);
                });
            });
        });

        describe('Unknown Field Detection', () => {
            it('should mark unsupported fields as unknown', () => {
                const testFields = [
                    { id: '40', label: 'File Upload', type: 'fileupload' },
                    { id: '41', label: 'Hidden Field', type: 'hidden' },
                    { id: '42', label: 'Date Field', type: 'date' }
                ];

                testFields.forEach(field => {
                    const result = detector.detectFieldType(field);
                    expect(result.fieldType).toBe('unknown');
                    expect(result.confidence).toBe(0);
                });
            });
        });
    });

    describe('Form Field Analysis', () => {
        it('should analyze complete form field mapping', () => {
            const mockForm = {
                id: '193',
                title: 'League Sign up 25-26',
                fields: [
                    { id: '52', label: 'Name', type: 'text' },
                    { id: '54', label: 'Email Address', type: 'email' },
                    { id: '55', label: 'Full Name', type: 'text' },
                    { id: '17', label: 'Team Members', type: 'textarea' },
                    { id: '50', label: 'Username', type: 'text' },
                    { id: '32', label: 'Notes/Comments', type: 'textarea' }
                ]
            };

            const mapping = detector.analyzeFormFields(mockForm);

            // Check that all fields are analyzed
            expect(Object.keys(mapping)).toHaveLength(6);

            // Check specific field type detections
            expect(mapping['52'].fieldType).toBe('name');
            expect(mapping['52'].confidence).toBeGreaterThanOrEqual(0.9);

            expect(mapping['54'].fieldType).toBe('email');
            expect(mapping['54'].confidence).toBe(1.0);

            expect(mapping['55'].fieldType).toBe('name');
            expect(mapping['17'].fieldType).toBe('team');
            expect(mapping['50'].fieldType).toBe('text'); // Username is generic text
            expect(mapping['32'].fieldType).toBe('text'); // Comments are generic text
        });

        it('should handle forms with no fields', () => {
            const emptyForm = {
                id: '999',
                title: 'Empty Form',
                fields: []
            };

            const mapping = detector.analyzeFormFields(emptyForm);
            expect(Object.keys(mapping)).toHaveLength(0);
        });

        it('should handle malformed form fields', () => {
            const malformedForm = {
                id: '888',
                title: 'Malformed Form',
                fields: [
                    { id: '1' }, // Missing label and type
                    { id: '2', label: 'Name' }, // Missing type
                    { label: 'Email', type: 'text' }, // Missing id
                    null, // Null field
                    undefined // Undefined field
                ]
            };

            const mapping = detector.analyzeFormFields(malformedForm);
            
            // Should handle malformed fields gracefully
            expect(mapping['1']).toBeDefined();
            expect(mapping['1'].fieldType).toBe('unknown');
            expect(mapping['2']).toBeDefined();
            expect(mapping['2'].fieldType).toBe('name');
            
            // Field without ID should get generated ID (check pattern, not exact match due to timestamp)
            const generatedIdKey = Object.keys(mapping).find(key => key.startsWith('malformed_888_2_'));
            expect(generatedIdKey).toBeDefined();
            expect(mapping[generatedIdKey!].fieldType).toBe('email');
        });
    });

    describe('Field Type Filtering Methods', () => {
        let sampleMapping: FormFieldMapping;

        beforeEach(() => {
            sampleMapping = {
                '52': { fieldId: '52', fieldType: 'name', confidence: 0.95, label: 'Name' },
                '55': { fieldId: '55', fieldType: 'name', confidence: 0.90, label: 'Full Name' },
                '54': { fieldId: '54', fieldType: 'email', confidence: 1.0, label: 'Email Address' },
                '15': { fieldId: '15', fieldType: 'phone', confidence: 0.85, label: 'Phone' },
                '17': { fieldId: '17', fieldType: 'team', confidence: 0.80, label: 'Team Members' },
                '32': { fieldId: '32', fieldType: 'text', confidence: 0.30, label: 'Comments' }
            };
        });

        it('should filter name fields', () => {
            const nameFields = detector.getNameFields(sampleMapping);
            
            expect(nameFields).toHaveLength(2);
            expect(nameFields[0].fieldId).toBe('52');
            expect(nameFields[1].fieldId).toBe('55');
            expect(nameFields.every(field => field.fieldType === 'name')).toBe(true);
        });

        it('should filter email fields', () => {
            const emailFields = detector.getEmailFields(sampleMapping);
            
            expect(emailFields).toHaveLength(1);
            expect(emailFields[0].fieldId).toBe('54');
            expect(emailFields[0].fieldType).toBe('email');
        });

        it('should filter all text fields (including generic text)', () => {
            const textFields = detector.getAllTextFields(sampleMapping);
            
            // Should include name, email, phone, team, and text fields
            expect(textFields.length).toBeGreaterThanOrEqual(5);
            expect(textFields.some(field => field.fieldType === 'text')).toBe(true);
        });

        it('should return empty arrays for missing field types', () => {
            const emptyMapping: FormFieldMapping = {};
            
            expect(detector.getNameFields(emptyMapping)).toHaveLength(0);
            expect(detector.getEmailFields(emptyMapping)).toHaveLength(0);
            expect(detector.getAllTextFields(emptyMapping)).toHaveLength(0);
        });
    });

    describe('Confidence Scoring', () => {
        it('should assign high confidence to exact keyword matches', () => {
            const exactMatches = [
                { id: '1', label: 'Name', type: 'text' },
                { id: '2', label: 'Email', type: 'text' },
                { id: '3', label: 'Phone', type: 'text' }
            ];

            exactMatches.forEach(field => {
                const result = detector.detectFieldType(field);
                expect(result.confidence).toBeGreaterThanOrEqual(0.9);
            });
        });

        it('should assign medium confidence to partial matches', () => {
            const partialMatches = [
                { id: '1', label: 'Contact Name Field', type: 'text' },
                { id: '2', label: 'Team Member List', type: 'text' }
            ];

            partialMatches.forEach(field => {
                const result = detector.detectFieldType(field);
                expect(result.confidence).toBeGreaterThanOrEqual(0.7);
                expect(result.confidence).toBeLessThan(0.9);
            });
        });

        it('should assign low confidence to weak indicators', () => {
            const weakMatches = [
                { id: '1', label: 'User Info', type: 'text' },
                { id: '2', label: 'Contact Details', type: 'text' }
            ];

            weakMatches.forEach(field => {
                const result = detector.detectFieldType(field);
                expect(result.confidence).toBeLessThan(0.7);
            });
        });

        it('should assign perfect confidence to Gravity Forms field types', () => {
            const nativeFields = [
                { id: '1', label: 'Contact Name', type: 'name' },
                { id: '2', label: 'Contact Email', type: 'email' },
                { id: '3', label: 'Contact Phone', type: 'phone' }
            ];

            nativeFields.forEach(field => {
                const result = detector.detectFieldType(field);
                expect(result.confidence).toBe(1.0);
            });
        });
    });

    describe('Special Case Logic Verification', () => {
        it('should correctly handle captain/team field conflicts', () => {
            const conflictFields = [
                { id: '1', label: 'Team Captain', type: 'text' },      // Should be name
                { id: '2', label: 'Captain', type: 'text' },          // Should be name  
                { id: '3', label: 'Team Members', type: 'text' },     // Should be team
                { id: '4', label: 'Team Name', type: 'text' },        // Should be team
                { id: '5', label: 'Captain Team List', type: 'text' }, // Should be name (captain takes priority)
                { id: '6', label: 'Team', type: 'text' }              // Should be team
            ];

            const results = conflictFields.map(field => ({
                label: field.label,
                result: detector.detectFieldType(field)
            }));

            // Verify specific logic
            expect(results[0].result.fieldType).toBe('name'); // Team Captain -> name
            expect(results[1].result.fieldType).toBe('name'); // Captain -> name
            expect(results[2].result.fieldType).toBe('team'); // Team Members -> team  
            expect(results[3].result.fieldType).toBe('team'); // Team Name -> team
            expect(results[4].result.fieldType).toBe('name'); // Captain Team List -> name (captain priority)
            expect(results[5].result.fieldType).toBe('team'); // Team -> team

            // Verify confidence scores are using constants appropriately
            expect(results[0].result.confidence).toBe(0.85); // CAPTAIN_CONFIDENCE
            expect(results[2].result.confidence).toBe(0.8);  // SPECIAL_CASE_CONFIDENCE
        });

        it('should handle compound phrase detection correctly', () => {
            const compoundFields = [
                { id: '1', label: 'Contact Name Field', type: 'text' },
                { id: '2', label: 'Contact Name', type: 'text' },
                { id: '3', label: 'Team Member List', type: 'text' },
                { id: '4', label: 'Username', type: 'text' },
                { id: '5', label: 'User Name', type: 'text' }
            ];

            const results = compoundFields.map(field => detector.detectFieldType(field));

            expect(results[0].fieldType).toBe('name');  // Contact Name Field -> name
            expect(results[0].confidence).toBe(0.8);    // SPECIAL_CASE_CONFIDENCE
            expect(results[1].fieldType).toBe('name');  // Contact Name -> name
            expect(results[2].fieldType).toBe('team');  // Team Member List -> team
            expect(results[3].fieldType).toBe('text');  // Username -> text  
            expect(results[3].confidence).toBe(0.6);    // USERNAME_CONFIDENCE
            expect(results[4].fieldType).toBe('text');  // User Name -> text
        });
    });

    describe('Edge Cases and Error Handling', () => {
        it('should handle fields with empty or null labels', () => {
            const edgeCaseFields = [
                { id: '1', label: '', type: 'text' },
                { id: '2', label: null, type: 'text' },
                { id: '3', label: undefined, type: 'text' }
            ];

            edgeCaseFields.forEach(field => {
                const result = detector.detectFieldType(field);
                expect(result.fieldType).toBe('unknown');
                expect(result.confidence).toBe(0);
            });
        });

        it('should handle fields with special characters in labels', () => {
            const specialCharFields = [
                { id: '1', label: 'Name (Required)', type: 'text' },
                { id: '2', label: 'E-mail *', type: 'text' },
                { id: '3', label: 'Phone # (Optional)', type: 'text' }
            ];

            specialCharFields.forEach(field => {
                const result = detector.detectFieldType(field);
                expect(result.fieldType).not.toBe('unknown');
                expect(result.confidence).toBeGreaterThan(0);
            });
        });

        it('should handle very long field labels', () => {
            const longLabel = 'This is a very long field label that contains the word name somewhere in the middle of the text to test how the detection works';
            const field = { id: '1', label: longLabel, type: 'text' };
            
            const result = detector.detectFieldType(field);
            expect(result.fieldType).toBe('name');
            expect(result.confidence).toBeGreaterThan(0);
        });

        it('should handle international characters', () => {
            const internationalFields = [
                { id: '1', label: 'Nom (Français)', type: 'text' },
                { id: '2', label: 'Correo Electrónico', type: 'text' },
                { id: '3', label: 'Teléfono', type: 'text' }
            ];

            // These should fall back to text classification
            internationalFields.forEach(field => {
                const result = detector.detectFieldType(field);
                expect(result).toBeDefined();
                expect(result.fieldId).toBe(field.id);
            });
        });
    });

    describe('Real-world Form Scenarios', () => {
        it('should analyze standard contact form', () => {
            const contactForm = {
                id: '1',
                title: 'Contact Form',
                fields: [
                    { id: '1.3', label: 'First Name', type: 'text' },
                    { id: '1.6', label: 'Last Name', type: 'text' },
                    { id: '2', label: 'Email', type: 'email' },
                    { id: '3', label: 'Phone', type: 'phone' },
                    { id: '4', label: 'Message', type: 'textarea' }
                ]
            };

            const mapping = detector.analyzeFormFields(contactForm);
            
            expect(mapping['1.3'].fieldType).toBe('name');
            expect(mapping['1.6'].fieldType).toBe('name');
            expect(mapping['2'].fieldType).toBe('email');
            expect(mapping['3'].fieldType).toBe('phone');
            expect(mapping['4'].fieldType).toBe('text');
        });

        it('should analyze event registration form', () => {
            const eventForm = {
                id: '193',
                title: 'Event Registration',
                fields: [
                    { id: '52', label: 'Participant Name', type: 'text' },
                    { id: '54', label: 'Email Address', type: 'email' },
                    { id: '17', label: 'Team/Group Name', type: 'text' },
                    { id: '18', label: 'Additional Team Members', type: 'textarea' },
                    { id: '25', label: 'Special Requirements', type: 'textarea' }
                ]
            };

            const mapping = detector.analyzeFormFields(eventForm);
            
            expect(mapping['52'].fieldType).toBe('name');
            expect(mapping['54'].fieldType).toBe('email');
            expect(mapping['17'].fieldType).toBe('team');
            expect(mapping['18'].fieldType).toBe('team');
            expect(mapping['25'].fieldType).toBe('text');
        });

        it('should analyze complex multi-step form', () => {
            const complexForm = {
                id: '500',
                title: 'Complex Registration Form',
                fields: [
                    // Personal Info Section
                    { id: '1', label: 'Full Name', type: 'name' },
                    { id: '2', label: 'Email Address', type: 'email' },
                    { id: '3', label: 'Phone Number', type: 'phone' },
                    
                    // Emergency Contact
                    { id: '10', label: 'Emergency Contact Name', type: 'text' },
                    { id: '11', label: 'Emergency Contact Phone', type: 'text' },
                    
                    // Team Information
                    { id: '20', label: 'Team Name', type: 'text' },
                    { id: '21', label: 'Team Captain', type: 'text' },
                    { id: '22', label: 'Additional Team Members', type: 'textarea' },
                    
                    // Other
                    { id: '30', label: 'Comments', type: 'textarea' },
                    { id: '31', label: 'How did you hear about us?', type: 'text' }
                ]
            };

            const mapping = detector.analyzeFormFields(complexForm);
            
            // Personal info should be detected correctly
            expect(mapping['1'].fieldType).toBe('name');
            expect(mapping['2'].fieldType).toBe('email');
            expect(mapping['3'].fieldType).toBe('phone');
            
            // Emergency contact should be detected as name/phone
            expect(mapping['10'].fieldType).toBe('name');
            expect(mapping['11'].fieldType).toBe('phone');
            
            // Team info should be detected
            expect(mapping['20'].fieldType).toBe('team');
            expect(mapping['21'].fieldType).toBe('name'); // Team Captain is a name
            expect(mapping['22'].fieldType).toBe('team');
            
            // Generic fields
            expect(mapping['30'].fieldType).toBe('text');
            expect(mapping['31'].fieldType).toBe('text');
        });
    });

    describe('Cache Integration', () => {
        it('should use cache when available for form analysis', () => {
            const cache = new FieldMappingCache();
            const detectorWithCache = new FieldTypeDetector(cache);

            const mockForm = {
                id: '500',
                title: 'Cached Form',
                fields: [
                    { id: '1', label: 'Name', type: 'text' },
                    { id: '2', label: 'Email', type: 'email' }
                ]
            };

            // First call should analyze and cache
            const firstResult = detectorWithCache.analyzeFormFields(mockForm);
            expect(firstResult['1'].fieldType).toBe('name');
            expect(firstResult['2'].fieldType).toBe('email');

            // Verify cache was populated
            const stats1 = cache.getCacheStats();
            expect(stats1.entryCount).toBe(1);

            // Second call should use cache
            const secondResult = detectorWithCache.analyzeFormFields(mockForm);
            expect(secondResult).toEqual(firstResult);

            // Verify cache hit
            const stats2 = cache.getCacheStats();
            expect(stats2.hitRate).toBeGreaterThan(0);
        });

        it('should fallback to analysis when cache miss', () => {
            const cache = new FieldMappingCache();
            const detectorWithCache = new FieldTypeDetector(cache);

            const form1 = {
                id: '501',
                title: 'Form 1',
                fields: [{ id: '1', label: 'Name', type: 'text' }]
            };

            const form2 = {
                id: '502', 
                title: 'Form 2',
                fields: [{ id: '1', label: 'Email', type: 'email' }]
            };

            // Analyze different forms
            const result1 = detectorWithCache.analyzeFormFields(form1);
            const result2 = detectorWithCache.analyzeFormFields(form2);

            expect(result1['1'].fieldType).toBe('name');
            expect(result2['1'].fieldType).toBe('email');
            expect(cache.getCacheStats().entryCount).toBe(2);
        });

        it('should work without cache (backward compatibility)', () => {
            const detectorWithoutCache = new FieldTypeDetector();

            const mockForm = {
                id: '503',
                title: 'Non-cached Form',
                fields: [{ id: '1', label: 'Phone', type: 'phone' }]
            };

            const result = detectorWithoutCache.analyzeFormFields(mockForm);
            expect(result['1'].fieldType).toBe('phone');
        });

        it('should handle cache errors gracefully', () => {
            // Create a cache that will throw errors
            const failingCache = new FieldMappingCache();
            const originalGet = failingCache.get.bind(failingCache);
            failingCache.get = () => { throw new Error('Cache error'); };

            const detectorWithFailingCache = new FieldTypeDetector(failingCache);

            const mockForm = {
                id: '504',
                title: 'Error Test Form',
                fields: [{ id: '1', label: 'Name', type: 'text' }]
            };

            // Should fallback to analysis despite cache error
            expect(() => {
                const result = detectorWithFailingCache.analyzeFormFields(mockForm);
                expect(result['1'].fieldType).toBe('name');
            }).not.toThrow();
        });

        it('should return cache status in analysis results', () => {
            const cache = new FieldMappingCache();
            const detectorWithCache = new FieldTypeDetector(cache);

            const mockForm = {
                id: '505',
                title: 'Status Test Form',
                fields: [{ id: '1', label: 'Name', type: 'text' }]
            };

            // First call - should be cache miss
            const result1 = detectorWithCache.analyzeFormFieldsWithStatus(mockForm);
            expect(result1.mapping['1'].fieldType).toBe('name');
            expect(result1.cacheStatus.hit).toBe(false);
            expect(result1.cacheStatus.source).toBe('analysis');

            // Second call - should be cache hit
            const result2 = detectorWithCache.analyzeFormFieldsWithStatus(mockForm);
            expect(result2.mapping['1'].fieldType).toBe('name');
            expect(result2.cacheStatus.hit).toBe(true);
            expect(result2.cacheStatus.source).toBe('cache');
        });

        it('should respect cache invalidation', () => {
            const cache = new FieldMappingCache();
            const detectorWithCache = new FieldTypeDetector(cache);

            const mockForm = {
                id: '506',
                title: 'Invalidation Test Form',
                fields: [{ id: '1', label: 'Name', type: 'text' }]
            };

            // Analyze and cache
            detectorWithCache.analyzeFormFields(mockForm);
            expect(cache.getCacheStats().entryCount).toBe(1);

            // Invalidate specific form
            cache.invalidate('506');
            expect(cache.getCacheStats().entryCount).toBe(0);

            // Should re-analyze after invalidation
            const result = detectorWithCache.analyzeFormFields(mockForm);
            expect(result['1'].fieldType).toBe('name');
            expect(cache.getCacheStats().entryCount).toBe(1);
        });
    });
});