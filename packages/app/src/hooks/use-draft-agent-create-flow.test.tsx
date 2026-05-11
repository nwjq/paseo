/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDraftAgentCreateFlow } from "./use-draft-agent-create-flow";

describe("useDraftAgentCreateFlow", () => {
  it("passes the submitted cwd through to agent creation", async () => {
    const createRequest = vi.fn(async () => ({ agentId: "agent-1", result: { ok: true } }));
    const onCreateSuccess = vi.fn();
    const { result } = renderHook(() =>
      useDraftAgentCreateFlow({
        draftId: "draft-1",
        getPendingServerId: () => "server-1",
        createRequest,
        buildDraftAgent: (attempt) => attempt,
        onCreateSuccess,
      }),
    );

    await act(async () => {
      await result.current.handleCreateFromInput({
        text: "start",
        attachments: [],
        cwd: "/repo/packages/app",
      });
    });

    expect(createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo/packages/app",
        attempt: expect.objectContaining({ cwd: "/repo/packages/app" }),
      }),
    );
  });
});
