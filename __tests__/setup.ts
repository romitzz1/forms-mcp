// ABOUTME: Jest test setup file for global mocks and configurations
// ABOUTME: Sets up common test environment, fetch mocks, a temp export dir, and global test utilities

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GravityFormsMocks } from './mocks/gravityFormsMocks';

// Mock fetch globally
global.fetch = GravityFormsMocks.createMockFetch();

// Mock console.error to avoid noise in tests
jest.spyOn(global.console, 'error').mockImplementation();

// Exports written by any test land in a throwaway dir, never the repo's ./exports or the user's home
const testExportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-mcp-test-exports-'));
process.env.GRAVITY_FORMS_EXPORT_DIR = testExportDir;

afterAll(() => {
  fs.rmSync(testExportDir, { recursive: true, force: true });
});