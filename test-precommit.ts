// ABOUTME: Test file to verify pre-commit hook works with new TypeScript files
// ABOUTME: This validates that our tsconfig.json fix resolves the inclusion issue

export interface ITestConfig {
    name: string;
    enabled: boolean;
}

export const createTestConfig = (name: string): ITestConfig => {
    return {
        name,
        enabled: true,
    };
};

export default createTestConfig;