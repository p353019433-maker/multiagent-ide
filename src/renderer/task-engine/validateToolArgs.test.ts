/**
 * Tests for the tool-argument validator.
 *
 * The BUILTIN_TOOLS schemas are the contract the model is told about, but
 * nothing enforced them at runtime — a missing `content` became the string
 * "undefined" written to disk, and a non-string `command` reached the danger
 * classifier as undefined. These tests pin the validator that closes that gap.
 */
import { describe, it, expect } from 'vitest';
import { validateToolArgs } from './validateToolArgs';
import { BUILTIN_TOOLS } from '@shared/tools';

const schemaFor = (name: string) =>
  BUILTIN_TOOLS.find((t) => t.name === name)!.parameters;

describe('validateToolArgs', () => {
  it('accepts a valid argument set', () => {
    expect(validateToolArgs({ path: 'a.ts', content: 'x' }, schemaFor('write_file'))).toBeNull();
  });

  it('rejects a missing required field', () => {
    const err = validateToolArgs({ path: 'a.ts' }, schemaFor('write_file'));
    expect(err).toMatch(/content/);
    expect(err).toMatch(/必填|required|缺少/i);
  });

  it('rejects a wrong type (number where string expected)', () => {
    const err = validateToolArgs({ path: 123 }, schemaFor('read_file'));
    expect(err).toMatch(/path/);
    expect(err).toMatch(/string/i);
  });

  it('rejects a non-string command before it reaches the danger classifier', () => {
    const err = validateToolArgs({ command: 42 }, schemaFor('run_command'));
    expect(err).toMatch(/command/);
    expect(err).toMatch(/string/i);
  });

  it('rejects a non-array where an array is expected', () => {
    const err = validateToolArgs({ paths: 'a.ts' }, schemaFor('read_multiple_files'));
    expect(err).toMatch(/paths/);
    expect(err).toMatch(/array/i);
  });

  it('rejects a wrong enum value', () => {
    const err = validateToolArgs(
      { url: 'http://x', extract_mode: 'bogus' },
      schemaFor('web_fetch')
    );
    expect(err).toMatch(/extract_mode/);
    expect(err).toMatch(/enum|取值/i);
  });

  it('accepts optional fields when absent', () => {
    expect(validateToolArgs({ query: 'foo' }, schemaFor('web_search'))).toBeNull();
  });

  it('accepts an empty argument set when nothing is required', () => {
    expect(validateToolArgs({}, schemaFor('git_status'))).toBeNull();
  });

  it("tolerates extra unknown fields (models emit them) without error", () => {
    expect(
      validateToolArgs({ path: 'a.ts', content: 'x', surprise: true }, schemaFor('write_file'))
    ).toBeNull();
  });
});
