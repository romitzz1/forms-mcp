#!/usr/bin/env node

/**
 * Universal Search MCP Configuration Setup Tool
 * 
 * This interactive tool helps users configure their personal .mcp.json file
 * for the Enhanced Gravity Forms MCP Server with Universal Search capabilities.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

class MCPSetup {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        this.config = {
            mcpServers: {
                "gravity-forms-enhanced": {
                    command: "node",
                    args: [],
                    env: {}
                }
            }
        };
        
        this.currentDir = __dirname;
        this.defaultCachePath = path.join(this.currentDir, 'data', 'forms-cache.db');
        this.defaultIndexPath = path.join(this.currentDir, 'dist', 'index.js');
    }

    async question(prompt) {
        return new Promise((resolve) => {
            this.rl.question(prompt, resolve);
        });
    }

    async run() {
        console.log('🚀 Enhanced Gravity Forms MCP Server - Configuration Setup');
        console.log('===========================================================\n');
        
        console.log('This tool will help you create a personal .mcp.json configuration file');
        console.log('with all 20 tools including the new Universal Search capabilities!\n');
        
        try {
            // Collect configuration data
            await this.collectBasicInfo();
            await this.collectGravityFormsConfig();
            await this.collectCacheConfig();
            await this.collectPerformanceConfig();
            
            // Generate configuration
            this.generateConfig();
            
            // Save configuration
            await this.saveConfig();
            
            // Show completion message
            this.showCompletionMessage();
            
        } catch (error) {
            console.error('❌ Setup failed:', error.message);
            process.exit(1);
        } finally {
            this.rl.close();
        }
    }

    async collectBasicInfo() {
        console.log('📂 Project Configuration');
        console.log('========================\n');
        
        const currentPath = await this.question(
            `Current project directory detected as:\n${this.currentDir}\n\nIs this correct? (y/n): `
        );
        
        if (currentPath.toLowerCase() !== 'y') {
            const newPath = await this.question('Enter the correct path to your forms-mcp directory: ');
            this.currentDir = path.resolve(newPath);
            this.defaultCachePath = path.join(this.currentDir, 'data', 'forms-cache.db');
            this.defaultIndexPath = path.join(this.currentDir, 'dist', 'index.js');
        }
        
        // Verify index.js exists
        if (!fs.existsSync(this.defaultIndexPath)) {
            console.log('⚠️  Warning: index.js not found at expected location.');
            console.log('   Make sure to run "npm run build" before using the MCP server.\n');
        }
        
        console.log('✅ Project path configured\n');
    }

    async collectGravityFormsConfig() {
        console.log('🔗 Gravity Forms API Configuration');
        console.log('==================================\n');
        
        console.log('The configuration will use placeholder values for API credentials.');
        console.log('You will need to update these in your .mcp.json file:\n');
        
        console.log('📝 Required API credentials:');
        console.log('• WordPress site URL (e.g., https://yoursite.com)');
        console.log('• Consumer Key (get from: Forms → Settings → REST API → Create Key)');
        console.log('• Consumer Secret (from the same location)\n');
        
        const proceed = await this.question('Continue with placeholder values? (Y/n): ');
        
        if (proceed.toLowerCase() === 'n') {
            throw new Error('Setup cancelled by user');
        }
        
        this.config.mcpServers["gravity-forms-enhanced"].env = {
            GRAVITY_FORMS_BASE_URL: "https://your-wordpress-site.com",
            GRAVITY_FORMS_CONSUMER_KEY: "ck_your_consumer_key_here",
            GRAVITY_FORMS_CONSUMER_SECRET: "cs_your_consumer_secret_here",
            GRAVITY_FORMS_AUTH_METHOD: "basic"
        };
        
        console.log('✅ Placeholder credentials set\n');
    }

    async collectCacheConfig() {
        console.log('⚡ Cache Configuration (Performance Optimization)');
        console.log('=================================================\n');
        
        const enableCache = await this.question('Enable form caching for better performance? (Y/n): ');
        const cacheEnabled = enableCache.toLowerCase() !== 'n';
        
        let cacheDbPath = this.defaultCachePath;
        let cacheMaxAge = '300';
        
        if (cacheEnabled) {
            const customPath = await this.question(
                `Cache database path [${this.defaultCachePath}]: `
            );
            
            if (customPath.trim()) {
                cacheDbPath = path.resolve(customPath);
            }
            
            const customAge = await this.question(
                'Cache expiry time in seconds [300 = 5 minutes]: '
            );
            
            if (customAge.trim()) {
                const age = parseInt(customAge);
                if (age > 0) {
                    cacheMaxAge = customAge;
                }
            }
            
            // Ensure cache directory exists
            const cacheDir = path.dirname(cacheDbPath);
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
                console.log(`📁 Created cache directory: ${cacheDir}`);
            }
        }
        
        Object.assign(this.config.mcpServers["gravity-forms-enhanced"].env, {
            GRAVITY_FORMS_CACHE_ENABLED: cacheEnabled.toString(),
            GRAVITY_FORMS_CACHE_DB_PATH: cacheDbPath,
            GRAVITY_FORMS_CACHE_MAX_AGE_SECONDS: cacheMaxAge
        });
        
        console.log('✅ Cache configuration set\n');
    }

    async collectPerformanceConfig() {
        console.log('🎯 Universal Search Performance Configuration');
        console.log('============================================\n');
        
        console.log('The Universal Search system includes advanced caching and monitoring.');
        console.log('These settings optimize search performance across all forms.\n');
        
        const enableSearchCache = await this.question('Enable search result caching? (Y/n): ');
        const searchCacheEnabled = enableSearchCache.toLowerCase() !== 'n';
        
        let searchCacheAge = '900000';  // 15 minutes
        let searchCacheSize = '100';
        
        if (searchCacheEnabled) {
            const customAge = await this.question(
                'Search cache expiry time in milliseconds [900000 = 15 minutes]: '
            );
            
            if (customAge.trim()) {
                const age = parseInt(customAge);
                if (age > 0) {
                    searchCacheAge = customAge;
                }
            }
            
            const customSize = await this.question(
                'Maximum cached search results [100]: '
            );
            
            if (customSize.trim()) {
                const size = parseInt(customSize);
                if (size > 0) {
                    searchCacheSize = customSize;
                }
            }
        }
        
        const enableMonitoring = await this.question('Enable performance monitoring? (Y/n): ');
        const monitoringEnabled = enableMonitoring.toLowerCase() !== 'n';
        
        const environment = await this.question('Environment (production/development) [production]: ');
        const nodeEnv = environment.trim() || 'production';
        
        Object.assign(this.config.mcpServers["gravity-forms-enhanced"].env, {
            SEARCH_CACHE_ENABLED: searchCacheEnabled.toString(),
            SEARCH_CACHE_MAX_AGE_MS: searchCacheAge,
            SEARCH_CACHE_MAX_SIZE: searchCacheSize,
            PERFORMANCE_MONITORING_ENABLED: monitoringEnabled.toString(),
            NODE_ENV: nodeEnv
        });
        
        console.log('✅ Performance settings configured\n');
    }

    generateConfig() {
        // Set the command arguments
        this.config.mcpServers["gravity-forms-enhanced"].args = [this.defaultIndexPath];
        
        console.log('⚙️  Generating configuration...\n');
    }

    async saveConfig() {
        const outputPath = path.join(this.currentDir, '.mcp.json');
        
        // Check if file already exists
        if (fs.existsSync(outputPath)) {
            const overwrite = await this.question(
                `⚠️  .mcp.json already exists at ${outputPath}\n   Overwrite? (y/N): `
            );
            
            if (overwrite.toLowerCase() !== 'y') {
                const newPath = await this.question('Enter new filename: ');
                const resolvedPath = path.resolve(newPath);
                fs.writeFileSync(resolvedPath, JSON.stringify(this.config, null, 2));
                console.log(`✅ Configuration saved to: ${resolvedPath}\n`);
                return;
            }
        }
        
        // Save the configuration
        fs.writeFileSync(outputPath, JSON.stringify(this.config, null, 2));
        console.log(`✅ Configuration saved to: ${outputPath}\n`);
        
        // Create backup of example files
        const backupDir = path.join(this.currentDir, 'config-backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir);
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const backupPath = path.join(backupDir, `.mcp.json.backup-${timestamp}`);
        fs.copyFileSync(outputPath, backupPath);
        console.log(`📋 Backup created: ${backupPath}\n`);
    }

    showCompletionMessage() {
        console.log('🎉 Setup Complete!');
        console.log('==================\n');
        
        console.log('Your Enhanced Gravity Forms MCP Server is now configured with:');
        console.log('✅ All 20 tools (8 core + 8 enhanced + 4 universal search tools)');
        console.log('✅ Universal Search capabilities for intelligent name searching');
        console.log('✅ Advanced caching for optimal performance');
        console.log('✅ Performance monitoring and optimization\n');
        
        console.log('🚀 Next Steps:');
        console.log('==============\n');
        
        console.log('1. 🔑 UPDATE API CREDENTIALS in .mcp.json:');
        console.log('   • Replace "https://your-wordpress-site.com" with your actual site URL');
        console.log('   • Replace "ck_your_consumer_key_here" with your real Consumer Key');
        console.log('   • Replace "cs_your_consumer_secret_here" with your real Consumer Secret');
        console.log('   • Get credentials from: WordPress → Forms → Settings → REST API → Create Key\n');
        
        console.log('2. Build the project:');
        console.log('   npm run build\n');
        
        console.log('3. Test the configuration:');
        console.log('   npm start\n');
        
        console.log('4. Use in Claude:');
        console.log('   • Copy .mcp.json to your Claude configuration directory');
        console.log('   • Restart Claude to load the new MCP server');
        console.log('   • Try: "search_entries_by_name" for universal name searching\n');
        
        console.log('📚 Available Tools:');
        console.log('===================');
        console.log('• search_entries_by_name - Universal name search (NEW!)');
        console.log('• search_entries_universal - Advanced multi-field search (NEW!)');  
        console.log('• get_field_mappings - Field structure analysis (NEW!)');
        console.log('• get_forms, get_entries, submit_form, create_entry, etc.');
        console.log('• Plus 16 other powerful form management tools\n');
        
        console.log('For detailed usage examples, see the documentation files:');
        console.log('• docs/UniversalSearchGuide.md - Complete user guide');
        console.log('• docs/APIReference.md - Full API documentation');
        console.log('• docs/ConfigurationGuide.md - Configuration options\n');
        
        console.log('🎯 Transform your form searching from manual pagination');
        console.log('   to intelligent single-command searching!');
    }
}

// Run the setup if called directly
if (require.main === module) {
    const setup = new MCPSetup();
    setup.run().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = MCPSetup;