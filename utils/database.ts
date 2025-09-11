// ABOUTME: Database utility for SQLite connection management
// ABOUTME: Handles database initialization, connections, and cleanup

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export class DatabaseManager {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'forms-cache.db');
  }

  /**
   * Initialize database connection and create database file if needed
   */
  init(): void {
    try {
      // Don't reinitialize if already connected
      if (this.db && this.isReady()) {
        return;
      }

      // Ensure directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Create database connection
      this.db = new Database(this.dbPath);
      
      // Test connection
      this.db.prepare('SELECT 1').get();
      
    } catch (error) {
      this.db = null;
      throw new Error(`Failed to initialize database: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch (error) {
        // Ignore close errors for cleanup scenarios
      } finally {
        this.db = null;
      }
    }
  }

  /**
   * Check if database connection is ready
   */
  isReady(): boolean {
    if (!this.db) {
      return false;
    }

    try {
      // Test if connection is still valid
      this.db.prepare('SELECT 1').get();
      return true;
    } catch (error) {
      this.db = null;
      return false;
    }
  }

  /**
   * Get the database path
   */
  getPath(): string {
    return this.dbPath;
  }
}