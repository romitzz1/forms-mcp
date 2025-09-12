// ABOUTME: Modern ESLint flat configuration for TypeScript with comprehensive best practices
// ABOUTME: Includes type-aware linting, performance optimizations, and maintainability rules

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jestPlugin from 'eslint-plugin-jest';

export default tseslint.config(
  // Global ignores (replaces .eslintignore)
  {
    ignores: [
      'dist/**',
      'build/**',
      'out/**',
      'node_modules/**',
      'coverage/**',
      '.nyc_output/**',
      '**/*.d.ts.map',
      '**/*.js.map',
      '**/*.log',
      'logs/**',
      '*.tmp',
      '*.temp',
      '.cache/**',
      'docs/build/**',
      '.git/**',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
    ],
  },
  
  // Base configuration for all files
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended],
    rules: {
      // General JS/TS rules that don't require type information
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-unreachable': 'error',
      'complexity': ['warn', 15],
      'max-depth': ['warn', 4],
      'max-lines-per-function': ['warn', {
        max: 100,
        skipBlankLines: true,
        skipComments: true,
      }],
    },
  },
  
  // TypeScript-specific configuration with type checking
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylistic,
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    rules: {
      // === TYPE SAFETY & QUALITY ===
      
      // Prevent unsafe any usage
      '@typescript-eslint/no-explicit-any': 'error',
      
      // Require type annotations where beneficial
      '@typescript-eslint/explicit-function-return-type': ['warn', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: true,
      }],
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      
      // Prevent potential runtime errors
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      
      // === CODE STYLE & CONSISTENCY ===
      
      // Naming conventions
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE'],
        },
        {
          selector: 'function',
          format: ['camelCase'],
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'interface',
          format: ['PascalCase'],
          prefix: ['I'],
        },
        {
          selector: 'enum',
          format: ['PascalCase'],
        },
        {
          selector: 'enumMember',
          format: ['UPPER_CASE'],
        },
      ],
      
      // Import/export organization
      'sort-imports': ['error', {
        ignoreCase: true,
        ignoreDeclarationSort: true,
        ignoreMemberSort: false,
      }],
      
      // Consistent code style
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        disallowTypeAnnotations: false,
      }],
      '@typescript-eslint/array-type': ['error', {
        default: 'array-simple',
      }],
      
      // === PERFORMANCE & BEST PRACTICES ===
      
      // Prevent performance anti-patterns
      '@typescript-eslint/prefer-readonly': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      
      // Async/await best practices
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: false, // Allow async event handlers
      }],
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      
      // Dead code detection
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      'no-unused-expressions': 'off', // Use TypeScript version
      '@typescript-eslint/no-unused-expressions': 'error',
      
      // === MODERN TYPESCRIPT FEATURES ===
      
      // Encourage modern syntax
      '@typescript-eslint/prefer-as-const': 'error',
      '@typescript-eslint/prefer-for-of': 'warn',
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      
      // Generic constraints and usage
      '@typescript-eslint/no-unnecessary-type-constraint': 'error',
      
      // Interface vs type preference
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-empty-interface': ['error', {
        allowSingleExtends: true,
      }],
      
      // === DISABLED RULES (Too strict or not applicable) ===
      
      // These rules are valuable but may be too strict for rapid development
      '@typescript-eslint/explicit-member-accessibility': 'off',
      '@typescript-eslint/member-ordering': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },
  
  // JavaScript configuration files (no TypeScript parser)
  {
    files: ['*.config.{js,cjs,mjs}', 'jest.config.*'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script', // CommonJS for .cjs files
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        global: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-undef': 'off', // Node.js globals
    },
  },
  
  // Test files configuration with Jest-specific rules
  {
    files: ['**/*.test.{ts,js}', '**/*.spec.{ts,js}', '**/__tests__/**/*.{ts,js}'],
    plugins: {
      jest: jestPlugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...jestPlugin.environments.globals.globals,
      },
    },
    rules: {
      // Jest-specific rules
      ...jestPlugin.configs.recommended.rules,
      
      // Enhanced Jest rules (using available rules only)
      'jest/consistent-test-it': ['error', {
        fn: 'it',
        withinDescribe: 'it',
      }],
      'jest/expect-expect': 'error',
      'jest/no-disabled-tests': 'warn',
      'jest/no-focused-tests': 'error',
      'jest/no-identical-title': 'error',
      'jest/prefer-to-have-length': 'warn',
      'jest/prefer-strict-equal': 'warn',
      'jest/prefer-spy-on': 'warn',
      'jest/no-test-return-statement': 'error',
      'jest/valid-describe-callback': 'error',
      'jest/valid-expect': 'error',
      'jest/valid-title': 'error',
      
      // Relaxed TypeScript rules for tests
      '@typescript-eslint/no-explicit-any': 'warn', // Allow any in tests with warning
      '@typescript-eslint/no-non-null-assertion': 'off', // Allow ! operator in tests
      '@typescript-eslint/no-empty-function': 'off', // Allow empty functions for mocks
      '@typescript-eslint/explicit-function-return-type': 'off', // Don't require return types in tests
      '@typescript-eslint/explicit-module-boundary-types': 'off', // Don't require boundary types in tests
      '@typescript-eslint/no-unsafe-assignment': 'warn', // Warn instead of error for test mocks
      '@typescript-eslint/no-unsafe-member-access': 'warn', // Warn instead of error for test mocks
      '@typescript-eslint/no-unsafe-call': 'warn', // Warn instead of error for test mocks
      '@typescript-eslint/no-unsafe-return': 'warn', // Warn instead of error for test mocks
      '@typescript-eslint/no-unsafe-argument': 'warn', // Warn instead of error for test mocks
      'max-lines-per-function': 'off', // Allow longer test functions
      'complexity': 'off', // Tests can be complex
      'max-depth': 'off', // Tests can be deeply nested
      
      // Test-specific naming conventions (more flexible)
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variable',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
          // Allow test helper functions with underscores
          filter: {
            regex: '^(setup|teardown|mock|stub)_',
            match: false,
          },
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        // More relaxed interface naming for test types
        {
          selector: 'interface',
          format: ['PascalCase'],
          // Don't require I prefix for test interfaces
        },
      ],
      
      // Allow console in tests for debugging
      'no-console': 'warn',
      
      // Allow unused vars in tests (for setup/teardown)
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_|^(setup|teardown|mock)',
        ignoreRestSiblings: true,
      }],
    },
  }
);