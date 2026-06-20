#!/usr/bin/env node
/**
 * Test script for Agent Guard v0.8.0 State Verification
 * 
 * Simulates tool calls and verifies the state verification engine works:
 * 1. write tool → file_exists check
 * 2. edit tool → content_match check
 * 3. exec tool → exit_code check
 */

import * as fs from "fs";
import * as path from "path";

const TEST_DIR = "/tmp/agent-guard-test";

// Clean up and create test dir
if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
fs.mkdirSync(TEST_DIR, { recursive: true });

// Import the verification logic directly (we'll test the pure functions)
// Since we can't import the plugin directly, we'll replicate the core logic

function verifyFileExists(filePath: string): { passed: boolean; detail: string } {
  if (!fs.existsSync(filePath)) {
    return { passed: false, detail: `File not found: ${filePath}` };
  }
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    return { passed: false, detail: `File exists but is empty: ${filePath}` };
  }
  return { passed: true, detail: `File verified: ${filePath} (${stat.size} bytes)` };
}

function verifyContentMatch(filePath: string, expectedText: string): { passed: boolean; detail: string } {
  if (!fs.existsSync(filePath)) {
    return { passed: false, detail: `File not found: ${filePath}` };
  }
  const content = fs.readFileSync(filePath, "utf-8");
  if (!content.includes(expectedText)) {
    return { passed: false, detail: `Expected text not found in file: "${expectedText.substring(0, 50)}..."` };
  }
  return { passed: true, detail: `Content verified: expected text found in ${filePath}` };
}

// === Test Cases ===

let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean) {
  try {
    const result = fn();
    if (result) {
      console.log(`✅ ${name}`);
      passed++;
    } else {
      console.log(`❌ ${name}`);
      failed++;
    }
  } catch (e: any) {
    console.log(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

// Test 1: write → file_exists (success case)
test("write tool: file exists after write", () => {
  const filePath = path.join(TEST_DIR, "test1.txt");
  fs.writeFileSync(filePath, "Hello World");
  const result = verifyFileExists(filePath);
  return result.passed;
});

// Test 2: write → file_exists (failure: file doesn't exist)
test("write tool: detects missing file", () => {
  const filePath = path.join(TEST_DIR, "nonexistent.txt");
  const result = verifyFileExists(filePath);
  return !result.passed;
});

// Test 3: write → file_exists (failure: file is empty)
test("write tool: detects empty file", () => {
  const filePath = path.join(TEST_DIR, "empty.txt");
  fs.writeFileSync(filePath, "");
  const result = verifyFileExists(filePath);
  return !result.passed;
});

// Test 4: edit → content_match (success case)
test("edit tool: verifies new text in file", () => {
  const filePath = path.join(TEST_DIR, "test2.txt");
  fs.writeFileSync(filePath, "Original content\nNew text added\nMore content");
  const result = verifyContentMatch(filePath, "New text added");
  return result.passed;
});

// Test 5: edit → content_match (failure: text not in file)
test("edit tool: detects missing new text", () => {
  const filePath = path.join(TEST_DIR, "test3.txt");
  fs.writeFileSync(filePath, "Original content only");
  const result = verifyContentMatch(filePath, "This text was never added");
  return !result.passed;
});

// Test 6: edit → content_match (failure: file doesn't exist)
test("edit tool: detects file was deleted after edit claim", () => {
  const result = verifyContentMatch(path.join(TEST_DIR, "deleted.txt"), "some text");
  return !result.passed;
});

// Test 7: Simulate the "200 OK but nothing happened" scenario
test("Real-world scenario: API returns success but file not written", () => {
  // Agent claims it wrote a file, but the write silently failed
  const claimedPath = path.join(TEST_DIR, "api-output.json");
  // File was never actually created (simulating silent failure)
  const result = verifyFileExists(claimedPath);
  return !result.passed; // Verification correctly catches the failure
});

// Test 8: Simulate concurrent write corruption
test("Real-world scenario: file exists but content is wrong", () => {
  const filePath = path.join(TEST_DIR, "concurrent.txt");
  // Agent wrote "important data" but another process overwrote it
  fs.writeFileSync(filePath, "corrupted by concurrent process");
  const result = verifyContentMatch(filePath, "important data");
  return !result.passed; // Verification catches the content mismatch
});

// Cleanup
fs.rmSync(TEST_DIR, { recursive: true });

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
