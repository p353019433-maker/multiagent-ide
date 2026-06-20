import { describe, expect, it } from 'vitest';
import { stripThink, transcriptText, type DiscussionMessage } from './agentDiscussion';

describe('stripThink', () => {
  it('removes a closed <think> block and keeps the answer', () => {
    expect(stripThink('<think>reasoning here</think>最终答案')).toBe('最终答案');
  });

  it('handles a think block surrounded by content', () => {
    expect(stripThink('前言<think>x</think>结论')).toBe('前言结论');
  });

  it('returns empty when the model only produced an unclosed think block', () => {
    expect(stripThink('<think>still thinking, never finished')).toBe('');
  });

  it('trims plain answers and tolerates empty/null', () => {
    expect(stripThink('  hi  ')).toBe('hi');
    expect(stripThink('')).toBe('');
    expect(stripThink(null)).toBe('');
    expect(stripThink(undefined)).toBe('');
  });
});

describe('transcriptText', () => {
  it('labels each message by agent name', () => {
    const t: DiscussionMessage[] = [
      { agentId: 'a', agentName: 'A', round: 1, text: '观点甲' },
      { agentId: 'b', agentName: 'B', round: 1, text: '观点乙' },
    ];
    expect(transcriptText(t)).toBe('【A】观点甲\n\n【B】观点乙');
  });
});
