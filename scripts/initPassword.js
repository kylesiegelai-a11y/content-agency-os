#!/usr/bin/env node

/**
 * Initialize Master Password
 * Prompts for a master password, hashes it with bcryptjs, and saves to data/auth.json
 * Usage: node scripts/initPassword.js
 */

const bcrypt = require('bcryptjs');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

function hidePassword() {
  // For better UX, we would use a package like 'prompt-sync' with { echo: '*' }
  // But for now, we'll work with standard readline
  return prompt('Master Password: ');
}

async function initializePassword() {
  try {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║     Master Password Initialization                     ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');

    // Check if auth.json already exists
    if (fs.existsSync(AUTH_FILE)) {
      const response = await prompt('auth.json already exists. Overwrite? (yes/no): ');
      if (response.toLowerCase() !== 'yes') {
        console.log('[✓] Initialization cancelled');
        rl.close();
        process.exit(0);
      }
    }

    // Prompt for password
    console.log('');
    console.log('Password requirements:');
    console.log('  • Minimum 12 characters');
    console.log('  • At least one uppercase letter');
    console.log('  • At least one number');
    console.log('  • At least one special character');
    console.log('');

    let password = await hidePassword();

    // Validate password strength
    const validatePassword = (pwd) => {
      const errors = [];
      const minLength = 12;

      if (pwd.length < minLength) {
        errors.push(`Password must be at least ${minLength} characters long`);
      }
      if (!/[!@#$%^&*()_+\-=\[\]{};:'",.<>?/\\|` + '`' + '~]/.test(pwd)) {
        errors.push('Password must contain at least one special character');
      }
      if (!/\d/.test(pwd)) {
        errors.push('Password must contain at least one number');
      }
      if (!/[A-Z]/.test(pwd)) {
        errors.push('Password must contain at least one uppercase letter');
      }

      return {
        isValid: errors.length === 0,
        errors
      };
    };

    const validation = validatePassword(password);
    if (!validation.isValid) {
      console.log('');
      console.log('[✗] Password validation failed:');
      validation.errors.forEach((err) => {
        console.log(`  • ${err}`);
      });
      rl.close();
      process.exit(1);
    }

    // Confirm password
    const confirmPassword = await hidePassword();
    if (password !== confirmPassword) {
      console.log('');
      console.log('[✗] Passwords do not match');
      rl.close();
      process.exit(1);
    }

    // Hash password
    console.log('');
    console.log('[*] Hashing password...');
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    // Create auth.json
    const authData = {
      masterPassword: hash,
      createdAt: new Date().toISOString(),
      algorithm: 'bcryptjs',
      saltRounds: 10
    };

    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Write to file
    fs.writeFileSync(AUTH_FILE, JSON.stringify(authData, null, 2), 'utf8');

    console.log('[✓] Master password initialized successfully');
    console.log(`[✓] Saved to: ${AUTH_FILE}`);
    console.log('');
    console.log('You can now use this password with the authentication system.');
    console.log('');

    rl.close();
    process.exit(0);

  } catch (error) {
    console.error('[✗] Error initializing password:', error.message);
    rl.close();
    process.exit(1);
  }
}

// Run initialization
initializePassword();
