// ABOUTME: Jest test setup file for global mocks and configurations
// ABOUTME: Sets up common test environment, fetch mocks, and global test utilities

import { GravityFormsMocks } from './mocks/gravityFormsMocks';

// Mock fetch globally
global.fetch = GravityFormsMocks.createMockFetch();

// Mock console.error to avoid noise in tests
global.console.error = jest.fn();