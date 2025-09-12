// ABOUTME: Intelligent field type detection for Gravity Forms - identifies name, email, phone, team fields automatically
// ABOUTME: Uses pattern matching on field labels and types with confidence scoring for universal search capabilities

import { FieldMappingCache } from './fieldMappingCache';

export type DetectedFieldType = 'name' | 'email' | 'phone' | 'team' | 'text' | 'unknown';

export interface FieldTypeInfo {
    fieldId: string;
    fieldType: DetectedFieldType;
    confidence: number;
    label: string;
}

export interface FormFieldMapping {
    [fieldId: string]: FieldTypeInfo;
}

export interface CacheStatus {
    hit: boolean;
    source: 'cache' | 'analysis';
    timestamp: Date;
}

export interface AnalysisResult {
    mapping: FormFieldMapping;
    cacheStatus: CacheStatus;
}

interface GravityFormField {
    id?: string;
    label?: string | null;
    type?: string;
}

interface GravityForm {
    id: string;
    title?: string;
    fields: (GravityFormField | null | undefined)[];
}

export class FieldTypeDetector {
    // Constants for confidence thresholds and scoring
    private static readonly HIGH_CONFIDENCE_THRESHOLD = 0.7;
    private static readonly DEFAULT_TEXT_CONFIDENCE = 0.3;
    private static readonly SPECIAL_CASE_CONFIDENCE = 0.8;
    private static readonly CAPTAIN_CONFIDENCE = 0.85;
    private static readonly USERNAME_CONFIDENCE = 0.6;

    private cache?: FieldMappingCache;

    constructor(cache?: FieldMappingCache) {
        this.cache = cache;
    }

    private readonly patterns = {
        name: {
            exact: ['name', 'full name', 'first name', 'last name', 'attendee', 'participant', 'member'],
            partial: ['person'], // Removed 'captain' - handled as special case
            confidence: { exact: 0.95, partial: 0.75 }
        },
        email: {
            exact: ['email', 'e-mail', 'mail'],
            partial: ['email address', 'mail address'],
            confidence: { exact: 0.95, partial: 0.85 }
        },
        phone: {
            exact: ['phone', 'tel', 'mobile', 'cell'],
            partial: ['phone number', 'telephone', 'contact number', 'cell phone'],
            confidence: { exact: 0.90, partial: 0.80 }
        },
        team: {
            exact: ['team', 'group', 'with', 'partner', 'squad'],
            partial: ['team name', 'team members', 'group name', 'members', 'partners'],
            confidence: { exact: 0.85, partial: 0.75 }
        }
    };

    /**
     * Detects field type for a single form field
     */
    public detectFieldType(field: GravityFormField | null | undefined): FieldTypeInfo {
        if (!field || !field.id) {
            return {
                fieldId: field?.id || 'unknown',
                fieldType: 'unknown',
                confidence: 0,
                label: (field?.label ?? '') as string
            };
        }

        // Handle empty or null labels
        if (!field.label) {
            return {
                fieldId: field.id,
                fieldType: 'unknown',
                confidence: 0,
                label: ''
            };
        }

        const label = field.label.toLowerCase().trim();
        const fieldType = field.type?.toLowerCase() || '';

        // First check Gravity Forms native field types for perfect confidence
        if (fieldType === 'name') {
            return {
                fieldId: field.id,
                fieldType: 'name',
                confidence: 1.0,
                label: field.label
            };
        }
        
        if (fieldType === 'email') {
            return {
                fieldId: field.id,
                fieldType: 'email',
                confidence: 1.0,
                label: field.label
            };
        }
        
        if (fieldType === 'phone') {
            return {
                fieldId: field.id,
                fieldType: 'phone',
                confidence: 1.0,
                label: field.label
            };
        }

        // For unsupported native field types, mark as unknown
        if (fieldType && !['text', 'textarea'].includes(fieldType)) {
            return {
                fieldId: field.id,
                fieldType: 'unknown',
                confidence: 0,
                label: field.label
            };
        }

        // Pattern matching for text/textarea fields
        
        // First pass: handle special cases and exclusions before general patterns
        
        // Username should be text, not name
        if (label.includes('username') || label.includes('user name')) {
            return {
                fieldId: field.id,
                fieldType: 'text',
                confidence: FieldTypeDetector.USERNAME_CONFIDENCE,
                label: field.label
            };
        }

        // Handle compound phrases with priority (most specific first)
        
        // "Team Captain" -> name (captain is a person, even if on a team)
        if (label.includes('team') && label.includes('captain')) {
            return {
                fieldId: field.id,
                fieldType: 'name',
                confidence: FieldTypeDetector.CAPTAIN_CONFIDENCE,
                label: field.label
            };
        }

        // "Team Member" or "Team List" -> team
        if (label.includes('team') && (label.includes('member') || label.includes('list'))) {
            return {
                fieldId: field.id,
                fieldType: 'team',
                confidence: FieldTypeDetector.SPECIAL_CASE_CONFIDENCE,
                label: field.label
            };
        }

        // "Contact Name" or "Contact Name Field" -> name  
        if (label.includes('contact') && (label.includes('name') || label.includes('field'))) {
            return {
                fieldId: field.id,
                fieldType: 'name',
                confidence: FieldTypeDetector.SPECIAL_CASE_CONFIDENCE,
                label: field.label
            };
        }

        // Generic "Captain" (without team context) -> name
        if (label.includes('captain')) {
            return {
                fieldId: field.id,
                fieldType: 'name',
                confidence: FieldTypeDetector.CAPTAIN_CONFIDENCE,
                label: field.label
            };
        }
        
        // Second pass: exact matches only
        for (const [type, config] of Object.entries(this.patterns)) {
            for (const pattern of config.exact) {
                if (label === pattern) {
                    return {
                        fieldId: field.id,
                        fieldType: type as DetectedFieldType,
                        confidence: config.confidence.exact,
                        label: field.label
                    };
                }
            }
        }

        // Third pass: partial matches with priority order (team > name to avoid conflicts)
        const priorityOrder: (keyof typeof this.patterns)[] = ['team', 'email', 'phone', 'name'];
        
        for (const type of priorityOrder) {
            const config = this.patterns[type];
            
            // Check exact patterns that contain the keyword
            for (const pattern of config.exact) {
                if (label.includes(pattern)) {
                    return {
                        fieldId: field.id,
                        fieldType: type as DetectedFieldType,
                        confidence: config.confidence.exact,
                        label: field.label
                    };
                }
            }
            
            // Check partial patterns
            for (const pattern of config.partial) {
                if (label.includes(pattern)) {
                    return {
                        fieldId: field.id,
                        fieldType: type as DetectedFieldType,
                        confidence: config.confidence.partial,
                        label: field.label
                    };
                }
            }
        }

        // Default to text with low confidence for text/textarea fields
        if (['text', 'textarea'].includes(fieldType)) {
            return {
                fieldId: field.id,
                fieldType: 'text',
                confidence: FieldTypeDetector.DEFAULT_TEXT_CONFIDENCE,
                label: field.label
            };
        }

        // Unknown field type
        return {
            fieldId: field.id,
            fieldType: 'unknown',
            confidence: 0,
            label: field.label
        };
    }

    /**
     * Analyzes all fields in a form and returns field type mapping
     */
    public analyzeFormFields(formDefinition: GravityForm): FormFieldMapping {
        return this.analyzeFormFieldsWithStatus(formDefinition).mapping;
    }

    /**
     * Analyzes form fields with cache status information
     */
    public analyzeFormFieldsWithStatus(formDefinition: GravityForm): AnalysisResult {
        const formId = formDefinition.id;
        
        if (!formDefinition?.fields || !Array.isArray(formDefinition.fields)) {
            return {
                mapping: {},
                cacheStatus: {
                    hit: false,
                    source: 'analysis',
                    timestamp: new Date()
                }
            };
        }

        // Try cache first if available
        if (this.cache) {
            try {
                const cachedMapping = this.cache.get(formId);
                if (cachedMapping) {
                    return {
                        mapping: cachedMapping,
                        cacheStatus: {
                            hit: true,
                            source: 'cache',
                            timestamp: new Date()
                        }
                    };
                }
            } catch (error) {
                // Cache error - fallback to analysis
                console.warn('FieldTypeDetector: Cache error, falling back to analysis:', error);
            }
        }

        // Perform field analysis
        const mapping: FormFieldMapping = {};

        for (let i = 0; i < formDefinition.fields.length; i++) {
            const field = formDefinition.fields[i];
            
            // Skip null/undefined fields
            if (!field) {
                continue;
            }

            let fieldToAnalyze: GravityFormField;
            let fieldId: string;

            if (field.id) {
                // Field has ID, use as-is (no unnecessary object spreading)
                fieldToAnalyze = field;
                fieldId = field.id;
            } else {
                // Generate collision-resistant ID for fields missing IDs
                fieldId = `malformed_${formDefinition.id}_${i}_${Date.now()}`;
                fieldToAnalyze = { ...field, id: fieldId };
            }

            const fieldInfo = this.detectFieldType(fieldToAnalyze);
            mapping[fieldId] = fieldInfo;
        }

        // Cache the results if cache is available
        if (this.cache) {
            try {
                this.cache.set(formId, mapping);
            } catch (error) {
                // Cache error - continue without caching
                console.warn('FieldTypeDetector: Failed to cache results:', error);
            }
        }

        return {
            mapping,
            cacheStatus: {
                hit: false,
                source: 'analysis',
                timestamp: new Date()
            }
        };
    }

    /**
     * Filters mapping to return only name fields
     */
    public getNameFields(mapping: FormFieldMapping): FieldTypeInfo[] {
        return Object.values(mapping)
            .filter(field => field.fieldType === 'name')
            .sort((a, b) => b.confidence - a.confidence); // Sort by confidence descending
    }

    /**
     * Filters mapping to return only email fields
     */
    public getEmailFields(mapping: FormFieldMapping): FieldTypeInfo[] {
        return Object.values(mapping)
            .filter(field => field.fieldType === 'email')
            .sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Filters mapping to return all text-based fields (name, email, phone, team, text)
     */
    public getAllTextFields(mapping: FormFieldMapping): FieldTypeInfo[] {
        const textBasedTypes: DetectedFieldType[] = ['name', 'email', 'phone', 'team', 'text'];
        
        return Object.values(mapping)
            .filter(field => textBasedTypes.includes(field.fieldType))
            .sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Gets fields by specific type
     */
    public getFieldsByType(mapping: FormFieldMapping, fieldType: DetectedFieldType): FieldTypeInfo[] {
        return Object.values(mapping)
            .filter(field => field.fieldType === fieldType)
            .sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Gets high-confidence fields (>= 0.7) of specified types
     */
    public getHighConfidenceFields(mapping: FormFieldMapping, fieldTypes?: DetectedFieldType[]): FieldTypeInfo[] {
        const targetTypes = fieldTypes || ['name', 'email', 'phone', 'team'];
        
        return Object.values(mapping)
            .filter(field => targetTypes.includes(field.fieldType) && field.confidence >= FieldTypeDetector.HIGH_CONFIDENCE_THRESHOLD)
            .sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Gets mapping statistics for debugging and analysis
     */
    public getMappingStats(mapping: FormFieldMapping): {
        totalFields: number;
        fieldTypeCounts: Record<DetectedFieldType, number>;
        averageConfidence: number;
        highConfidenceCount: number;
    } {
        const fields = Object.values(mapping);
        const fieldTypeCounts: Record<DetectedFieldType, number> = {
            name: 0, email: 0, phone: 0, team: 0, text: 0, unknown: 0
        };

        let totalConfidence = 0;
        let highConfidenceCount = 0;

        for (const field of fields) {
            fieldTypeCounts[field.fieldType]++;
            totalConfidence += field.confidence;
            if (field.confidence >= FieldTypeDetector.HIGH_CONFIDENCE_THRESHOLD) {
                highConfidenceCount++;
            }
        }

        return {
            totalFields: fields.length,
            fieldTypeCounts,
            averageConfidence: fields.length > 0 ? totalConfidence / fields.length : 0,
            highConfidenceCount
        };
    }

    /**
     * Gets the cache instance if available
     */
    public getCache(): FieldMappingCache | undefined {
        return this.cache;
    }

    /**
     * Invalidates cache for a specific form or all forms
     */
    public invalidateCache(formId?: string): void {
        if (this.cache) {
            this.cache.invalidate(formId);
        }
    }

    /**
     * Gets cache statistics if cache is available
     */
    public getCacheStats() {
        return this.cache?.getCacheStats() || null;
    }
}