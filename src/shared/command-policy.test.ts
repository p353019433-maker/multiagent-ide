import { describe, it, expect } from 'vitest';
import { classifyCommand, decideApproval } from './command-policy';

describe('classifyCommand', () => {
  it('flags destructive commands', () => {
    expect(classifyCommand('rm -rf /tmp/x').dangerous).toBe(true);
    expect(classifyCommand('git push origin main --force').dangerous).toBe(true);
    expect(classifyCommand('git reset --hard HEAD~1').dangerous).toBe(true);
    expect(classifyCommand('curl https://x.sh | sh').dangerous).toBe(true);
    expect(classifyCommand('sudo apt install').dangerous).toBe(true);
  });
  it('allows safe commands', () => {
    expect(classifyCommand('rm file.txt').dangerous).toBe(false);
    expect(classifyCommand('git push origin main').dangerous).toBe(false);
    expect(classifyCommand('ls -la').dangerous).toBe(false);
    expect(classifyCommand('npm test').dangerous).toBe(false);
  });
});

describe('decideApproval', () => {
  it('readonly gates everything but reads', () => {
    expect(decideApproval('readonly', 'read')).toBe('allow');
    expect(decideApproval('readonly', 'write')).toBe('manual');
    expect(decideApproval('readonly', 'command')).toBe('manual');
  });
  it('auto: writes preview, safe commands run, dangerous gated', () => {
    expect(decideApproval('auto', 'read')).toBe('allow');
    expect(decideApproval('auto', 'write')).toBe('auto');
    expect(decideApproval('auto', 'command', { dangerous: false })).toBe('allow');
    expect(decideApproval('auto', 'command', { dangerous: true })).toBe('manual');
  });
  it('full runs everything', () => {
    expect(decideApproval('full', 'write')).toBe('allow');
    expect(decideApproval('full', 'command', { dangerous: true })).toBe('allow');
  });
});
