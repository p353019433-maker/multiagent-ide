import type { ToolDefinition } from './types';

/**
 * Built-in Agent tools. The model invokes these by name; the renderer
 * (or main process) executes them and feeds the result back.
 */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or workspace-relative path to the file.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create a new file or fully overwrite an existing file. User must approve before the change is applied.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write.' },
        content: { type: 'string', description: 'Full file contents.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace a specific block of text in a file. The oldString must match exactly once. User must approve before the change is applied.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldString: { type: 'string', description: 'Exact text to find.' },
        newString: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'oldString', 'newString'],
    },
  },
  {
    name: 'list_directory',
    description: 'List the immediate contents of a directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Search across the workspace for a text or regex pattern.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The text or regex to search for.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'run_command',
    description:
      'Execute a shell command in the workspace. Use sparingly; prefer file tools when possible.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run.' },
      },
      required: ['command'],
    },
  },
];

export const AGENT_SYSTEM_PROMPT = `You are an AI coding assistant integrated into a code IDE. You help users by reading, writing, and modifying code in their workspace.

## Capabilities
You have access to tools that let you interact with the user's workspace:
- read_file: Read any file
- write_file: Create or overwrite a file (requires user approval)
- edit_file: Make a targeted edit to a file (requires user approval)
- list_directory: Browse the file tree
- search_files: Search for text in the codebase
- run_command: Execute shell commands

## Guidelines
1. Before making changes, gather context: read relevant files, understand the codebase structure.
2. Make precise, minimal edits. Prefer edit_file over write_file when modifying existing files.
3. Explain your plan briefly before executing tools.
4. After making changes, summarize what you did.
5. If a task is unclear, ask the user before taking destructive actions.
6. Never invent file contents - always read first.

Be direct and concise. Focus on getting the task done.`;
