/**
 * Approval hook — owns the mode-aware approval gate extracted from TaskPanel.
 *
 * Three modes (see command-policy):
 *  - readonly: every write/command/external action needs manual approval
 *  - auto:     workspace writes auto-accept after a countdown; dangerous
 *              commands still require manual approval
 *  - full:     no prompts
 */

import { useEffect, useRef, useState } from 'react';
import {
  type ApprovalMode,
  DEFAULT_APPROVAL_MODE,
  decideApproval,
} from '@shared/command-policy';

export type ApprovalAction =
  | 'write'
  | 'edit'
  | 'replace_in_file'
  | 'search_and_replace'
  | 'github'
  | 'command';

export interface PendingApproval {
  toolCallId: string;
  filePath: string;
  action: ApprovalAction;
  before: string;
  after: string;
  /** When true the approval auto-accepts after a countdown; otherwise manual. */
  countdown: boolean;
  /** Optional danger reason shown to the user (dangerous commands). */
  dangerReason?: string;
  resolve: (approved: boolean) => void;
}

export type GateActionFn = (
  toolCallId: string,
  label: string,
  kind: 'write' | 'command' | 'external',
  before: string,
  after: string,
  action: ApprovalAction,
  opts?: { dangerous?: boolean; dangerReason?: string }
) => Promise<boolean>;

const AUTO_ACCEPT_MS = 5000;

export function useApproval() {
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(DEFAULT_APPROVAL_MODE);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const pendingApprovalRef = useRef<PendingApproval | null>(null);
  pendingApprovalRef.current = pendingApproval;

  // Ref so the gate (called outside render, deep in tool execution) reads the
  // current mode without stale-closure issues.
  const approvalModeRef = useRef<ApprovalMode>(DEFAULT_APPROVAL_MODE);
  approvalModeRef.current = approvalMode;

  const autoApproveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (autoApproveTimeout.current) clearTimeout(autoApproveTimeout.current);
      pendingApprovalRef.current?.resolve(false);
      pendingApprovalRef.current = null;
    };
  }, []);

  // Load persisted mode once.
  useEffect(() => {
    window.api.store.get('approvalMode').then((m) => {
      if (m === 'readonly' || m === 'auto' || m === 'full') setApprovalMode(m);
    });
  }, []);

  const changeApprovalMode = (m: ApprovalMode) => {
    setApprovalMode(m);
    window.api.store.set('approvalMode', m);
  };

  const requestApproval = (
    toolCallId: string,
    filePath: string,
    action: ApprovalAction,
    before: string,
    after: string,
    opts?: { countdown?: boolean; dangerReason?: string }
  ): Promise<boolean> => {
    const countdown = opts?.countdown ?? true;
    return new Promise((resolve) => {
      if (autoApproveTimeout.current) {
        clearTimeout(autoApproveTimeout.current);
        autoApproveTimeout.current = null;
      }
      pendingApprovalRef.current?.resolve(false);
      const pending: PendingApproval = {
        toolCallId,
        filePath,
        action,
        before,
        after,
        countdown,
        dangerReason: opts?.dangerReason,
        resolve,
      };
      pendingApprovalRef.current = pending;
      setPendingApproval(pending);
      if (countdown) {
        // Auto-accept after the countdown — user can reject before that.
        autoApproveTimeout.current = setTimeout(() => {
          setPendingApproval((prev) => {
            if (prev?.toolCallId === toolCallId) {
              prev.resolve(true);
              autoApproveTimeout.current = null;
              pendingApprovalRef.current = null;
              return null;
            }
            return prev;
          });
        }, AUTO_ACCEPT_MS);
      }
    });
  };

  /**
   * Central gate for a write/command/external action. Resolves the policy for
   * the current mode and either runs immediately, shows a countdown preview, or
   * blocks for manual approval. Returns true if the action may proceed.
   */
  const gateAction: GateActionFn = (toolCallId, label, kind, before, after, action, opts) => {
    const decision = decideApproval(approvalModeRef.current, kind, { dangerous: opts?.dangerous });
    if (decision === 'allow') return Promise.resolve(true);
    return requestApproval(toolCallId, label, action, before, after, {
      countdown: decision === 'auto',
      dangerReason: opts?.dangerReason,
    });
  };

  const handleApprove = () => {
    if (autoApproveTimeout.current) clearTimeout(autoApproveTimeout.current);
    pendingApproval?.resolve(true);
    pendingApprovalRef.current = null;
    setPendingApproval(null);
  };

  const handleReject = () => {
    if (autoApproveTimeout.current) clearTimeout(autoApproveTimeout.current);
    pendingApproval?.resolve(false);
    pendingApprovalRef.current = null;
    setPendingApproval(null);
  };

  return {
    approvalMode,
    changeApprovalMode,
    pendingApproval,
    gateAction,
    handleApprove,
    handleReject,
  };
}
