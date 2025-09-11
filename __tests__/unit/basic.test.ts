// ABOUTME: Basic test to verify Jest setup is working
// ABOUTME: Simple tests that don't require complex module mocking

describe('Basic Test Suite', () => {
  test('Jest is working correctly', () => {
    expect(1 + 1).toBe(2);
  });

  test('Environment variables can be set and read', () => {
    const originalValue = process.env.TEST_VAR;
    process.env.TEST_VAR = 'test_value';
    
    expect(process.env.TEST_VAR).toBe('test_value');
    
    // Restore original value
    if (originalValue === undefined) {
      delete process.env.TEST_VAR;
    } else {
      process.env.TEST_VAR = originalValue;
    }
  });

  test('Mock functions work correctly', () => {
    const mockFn = jest.fn();
    mockFn('test');
    
    expect(mockFn).toHaveBeenCalledWith('test');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  test('Global fetch mock is available', () => {
    expect(global.fetch).toBeDefined();
    expect(typeof global.fetch).toBe('function');
  });
});