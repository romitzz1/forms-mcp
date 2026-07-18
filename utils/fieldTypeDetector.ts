// ABOUTME: Intelligent field type detection for Gravity Forms - identifies name, email, phone, team fields automatically
// ABOUTME: Uses pattern matching on field labels and types with confidence scoring for universal search capabilities

import type { FieldMappingCache } from './fieldMappingCache.js';
import type { IGravityForm, IGravityFormField, IGravityFormInput } from './gravityFormsTypes.js';

export type DetectedFieldType = 'name' | 'email' | 'phone' | 'team' | 'text' | 'unknown';

export interface FieldTypeInfo {
    fieldId: string;
    fieldType: DetectedFieldType;
    confidence: number;
    label: string;
}

export type FormFieldMapping = Record<string, FieldTypeInfo>;

export interface CacheStatus {
    hit: boolean;
    source: 'cache' | 'analysis';
    timestamp: Date;
}

export interface AnalysisResult {
    mapping: FormFieldMapping;
    cacheStatus: CacheStatus;
}

export class FieldTypeDetector {
    // Constants for confidence thresholds and scoring
    private static readonly HIGH_CONFIDENCE_THRESHOLD = 0.7;
    private static readonly DEFAULT_TEXT_CONFIDENCE = 0.3;
    private static readonly SPECIAL_CASE_CONFIDENCE = 0.8;
    private static readonly CAPTAIN_CONFIDENCE = 0.85;
    private static readonly USERNAME_CONFIDENCE = 0.6;

    private readonly cache?: FieldMappingCache;

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
            partial: ['team name', 'group name', 'members', 'partners'],
            confidence: { exact: 0.85, partial: 0.75 }
        }
    };

    /**
     * Checks Gravity Forms native field types for perfect-confidence matches, and
     * rules out unsupported native types before label-based heuristics run.
     */
    private detectByNativeType(field: IGravityFormField, fieldType: string, originalLabel: string): FieldTypeInfo | null {
        if (fieldType === 'name') {
            return {
                fieldId: String(field.id),
                fieldType: 'name',
                confidence: 1.0,
                label: originalLabel
            };
        }

        if (fieldType === 'email') {
            return {
                fieldId: String(field.id),
                fieldType: 'email',
                confidence: 1.0,
                label: originalLabel
            };
        }

        if (fieldType === 'phone') {
            return {
                fieldId: String(field.id),
                fieldType: 'phone',
                confidence: 1.0,
                label: originalLabel
            };
        }

        // For unsupported native field types, mark as unknown. Several non-text types are
        // allowed through to label heuristics: choice fields (checkbox/radio/select/multiselect)
        // because team-signup/opt-in fields are commonly implemented as choices (audit A10);
        // and 'hidden' because forms frequently pre-fill identity data (First Name, Email, etc.)
        // from the logged-in user's profile into hidden fields — those hold real, searchable
        // values, and a non-identity label simply won't match any pattern and stays unknown.
        const labelSearchableTypes = ['text', 'textarea', 'checkbox', 'radio', 'select', 'multiselect', 'hidden'];
        if (fieldType && !labelSearchableTypes.includes(fieldType)) {
            return {
                fieldId: String(field.id),
                fieldType: 'unknown',
                confidence: 0,
                label: originalLabel
            };
        }

        return null;
    }

    /**
     * Handles compound-phrase special cases and exclusions that must be checked
     * before the general pattern-matching passes (most specific first).
     */
    private detectSpecialCaseType(field: IGravityFormField, label: string, originalLabel: string): FieldTypeInfo | null {
        // Username should be text, not name
        if (label.includes('username') || label.includes('user name')) {
            return {
                fieldId: String(field.id),
                fieldType: 'text',
                confidence: FieldTypeDetector.USERNAME_CONFIDENCE,
                label: originalLabel
            };
        }

        // When a label contains BOTH a team keyword and an explicit email keyword
        // (e.g. "Team Email", "Team Captain Email"), email wins — the field holds an
        // email address. Previously team was checked first and swallowed these. Uses
        // 'email'/'e-mail' (unambiguous) — NOT the broad 'mail'. Pure email labels fall
        // through to normal detection, which assigns full email confidence (audit A13).
        if (label.includes('team') && (label.includes('email') || label.includes('e-mail'))) {
            return {
                fieldId: String(field.id),
                fieldType: 'email',
                confidence: FieldTypeDetector.SPECIAL_CASE_CONFIDENCE,
                label: originalLabel
            };
        }

        // "Team Captain" -> name (captain is a person, even if on a team)
        if (label.includes('team') && label.includes('captain')) {
            return {
                fieldId: String(field.id),
                fieldType: 'name',
                confidence: FieldTypeDetector.CAPTAIN_CONFIDENCE,
                label: originalLabel
            };
        }

        // "Team Member" or "Team List" -> team
        if (label.includes('team') && (label.includes('member') || label.includes('list'))) {
            return {
                fieldId: String(field.id),
                fieldType: 'team',
                confidence: FieldTypeDetector.SPECIAL_CASE_CONFIDENCE,
                label: originalLabel
            };
        }

        // "Contact Name" or "Contact Name Field" -> name
        if (label.includes('contact') && (label.includes('name') || label.includes('field'))) {
            return {
                fieldId: String(field.id),
                fieldType: 'name',
                confidence: FieldTypeDetector.SPECIAL_CASE_CONFIDENCE,
                label: originalLabel
            };
        }

        // Generic "Captain" (without team context) -> name
        if (label.includes('captain')) {
            return {
                fieldId: String(field.id),
                fieldType: 'name',
                confidence: FieldTypeDetector.CAPTAIN_CONFIDENCE,
                label: originalLabel
            };
        }

        return null;
    }

    /**
     * Exact-match pass followed by a priority-ordered partial-match pass
     * (team > name to avoid conflicts).
     */
    private detectByPatternMatching(field: IGravityFormField, label: string, originalLabel: string): FieldTypeInfo | null {
        // Second pass: exact matches only
        for (const [type, config] of Object.entries(this.patterns)) {
            for (const pattern of config.exact) {
                if (label === pattern) {
                    return {
                        fieldId: String(field.id),
                        fieldType: type as DetectedFieldType,
                        confidence: config.confidence.exact,
                        label: originalLabel
                    };
                }
            }
        }

        // Third pass: partial matches with priority order (team > name to avoid conflicts)
        const priorityOrder = ['team', 'email', 'phone', 'name'] as const;

        for (const type of priorityOrder) {
            const config = this.patterns[type];

            // Check exact patterns that contain the keyword
            for (const pattern of config.exact) {
                if (label.includes(pattern)) {
                    return {
                        fieldId: String(field.id),
                        fieldType: type as DetectedFieldType,
                        confidence: config.confidence.exact,
                        label: originalLabel
                    };
                }
            }

            // Check partial patterns
            for (const pattern of config.partial) {
                if (label.includes(pattern)) {
                    return {
                        fieldId: String(field.id),
                        fieldType: type as DetectedFieldType,
                        confidence: config.confidence.partial,
                        label: originalLabel
                    };
                }
            }
        }

        return null;
    }

    /**
     * Detects field type for a single form field
     */
    public detectFieldType(field: IGravityFormField | null | undefined): FieldTypeInfo {
        if (!field?.id) {
            return {
                fieldId: 'unknown',
                fieldType: 'unknown',
                confidence: 0,
                label: (field?.label ?? '')
            };
        }

        // Handle empty or null labels
        if (!field.label) {
            return {
                fieldId: String(field.id),
                fieldType: 'unknown',
                confidence: 0,
                label: ''
            };
        }

        const originalLabel = field.label;
        const label = originalLabel.toLowerCase().trim();
        const fieldType = field.type?.toLowerCase() ?? '';

        // First check Gravity Forms native field types for perfect confidence
        const nativeTypeResult = this.detectByNativeType(field, fieldType, originalLabel);
        if (nativeTypeResult) {
            return nativeTypeResult;
        }

        // Pattern matching for text/textarea fields.
        // First pass: handle special cases and exclusions before general patterns.
        const specialCaseResult = this.detectSpecialCaseType(field, label, originalLabel);
        if (specialCaseResult) {
            return specialCaseResult;
        }

        const patternResult = this.detectByPatternMatching(field, label, originalLabel);
        if (patternResult) {
            return patternResult;
        }

        // Default to text with low confidence for text/textarea fields
        if (['text', 'textarea'].includes(fieldType)) {
            return {
                fieldId: String(field.id),
                fieldType: 'text',
                confidence: FieldTypeDetector.DEFAULT_TEXT_CONFIDENCE,
                label: originalLabel
            };
        }

        // Unknown field type
        return {
            fieldId: String(field.id),
            fieldType: 'unknown',
            confidence: 0,
            label: originalLabel
        };
    }

    /**
     * Reads a form's field mapping from cache, handling cache errors by
     * falling back to a cache miss (analysis then runs from scratch).
     */
    private getCachedMapping(formId: string): FormFieldMapping | null {
        if (!this.cache) {
            return null;
        }

        try {
            const cachedMapping = this.cache.get(formId);
            if (cachedMapping) {
                return cachedMapping;
            }
        } catch (error) {
            // Cache error - fallback to analysis
            // Only log if cache has logging enabled
            if (this.cache?.getOptions()?.enableLogging) {
                console.warn('FieldTypeDetector: Cache error, falling back to analysis:', error);
            }
        }

        return null;
    }

    /**
     * Analyzes every field in a form's field list into a field type mapping,
     * expanding composite Name fields to their sub-input ids.
     */
    private buildFieldMapping(fields: IGravityFormField[], formId: string): FormFieldMapping {
        const mapping: FormFieldMapping = {};

        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];

            // Skip null/undefined fields
            if (!field) {
                continue;
            }

            let fieldToAnalyze: IGravityFormField;
            let fieldId: string;

            if (field.id) {
                // Field has ID, use as-is (no unnecessary object spreading)
                fieldToAnalyze = field;
                fieldId = String(field.id);
            } else {
                // Generate collision-resistant ID for fields missing IDs
                fieldId = `malformed_${formId}_${i}_${Date.now()}`;
                fieldToAnalyze = { ...field, id: fieldId };
            }

            const fieldInfo = this.detectFieldType(fieldToAnalyze);

            // Composite Gravity Forms Name fields (advanced/extended format) store their
            // value only under sub-input keys (e.g. "6.3" for first name, "6.6" for last
            // name) - the parent field id ("6") never appears on the entry. Expand the
            // mapping to the sub-input ids so downstream lookups (e.g. entry[fieldId])
            // find the actual data instead of silently matching nothing.
            if (fieldInfo.fieldType === 'name' && Array.isArray(fieldToAnalyze.inputs) && fieldToAnalyze.inputs.length > 0) {
                for (const input of fieldToAnalyze.inputs) {
                    if (input?.id) {
                        mapping[input.id] = {
                            fieldId: input.id,
                            fieldType: 'name',
                            confidence: fieldInfo.confidence,
                            label: this.resolveInputLabel(input, fieldInfo.label)
                        };
                    }
                }
            } else {
                mapping[fieldId] = fieldInfo;
            }
        }

        return mapping;
    }

    /**
     * Resolves the label for a composite Name field's sub-input, falling back to
     * the parent field's label when the sub-input has no label of its own
     * (including when it's present but an empty string).
     */
    private resolveInputLabel(input: IGravityFormInput, fallbackLabel: string): string {
        if (input.label) {
            return input.label;
        }
        return fallbackLabel;
    }

    /**
     * Stores a freshly computed field mapping in cache, tolerating cache errors.
     */
    private cacheMapping(formId: string, mapping: FormFieldMapping): void {
        if (!this.cache) {
            return;
        }

        try {
            this.cache.set(formId, mapping);
        } catch (error) {
            // Cache error - continue without caching
            // Only log if cache has logging enabled
            if (this.cache?.getOptions()?.enableLogging) {
                console.warn('FieldTypeDetector: Failed to cache results:', error);
            }
        }
    }

    /**
     * Analyzes all fields in a form and returns field type mapping
     */
    public analyzeFormFields(formDefinition: IGravityForm): FormFieldMapping {
        return this.analyzeFormFieldsWithStatus(formDefinition).mapping;
    }

    /**
     * Analyzes form fields with cache status information
     */
    public analyzeFormFieldsWithStatus(formDefinition: IGravityForm): AnalysisResult {
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
        const cachedMapping = this.getCachedMapping(formId);
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

        // Perform field analysis
        const mapping = this.buildFieldMapping(formDefinition.fields, formId);

        // Cache the results if cache is available
        this.cacheMapping(formId, mapping);

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
        const targetTypes = fieldTypes ?? ['name', 'email', 'phone', 'team'];

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
    public getCacheStats(): ReturnType<FieldMappingCache['getCacheStats']> | null {
        return this.cache?.getCacheStats() ?? null;
    }
}
