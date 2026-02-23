import { useEffect, useCallback, useMemo } from "react";
import { useHarness } from "./hooks/useHarness";
import { useTheme } from "./hooks/useTheme";
import { useAppStore } from "./stores/useAppStore";
import {
  MASTRA_BASE_URL,
  authHeaders,
} from "./mastra-client";
import Sidebar from "./Sidebar";
import CommandPalette from "./components/CommandPalette";
import HomePage from "./pages/HomePage";
import ChatsListPage from "./pages/ChatsListPage";
import ActiveChatPage from "./pages/ActiveChatPage";
import ActivityPage from "./pages/ActivityPage";
import FilesPage from "./pages/FilesPage";
import SuperpowersPage from "./pages/SuperpowersPage";
import SettingsPage from "./pages/SettingsPage";
import ScheduledTasksPage from "./pages/ScheduledTasksPage";
import AppsPage from "./pages/AppsPage";
import type { StagedFile } from "./types/harness";

export default function App() {
  const theme = useTheme();

  // ── Harness hook (replaces useChat) ──
  const harness = useHarness();

  // ── Store state ──
  const currentPage = useAppStore((s) => s.currentPage);
  const showCommandPalette = useAppStore((s) => s.showCommandPalette);
  // ── Store actions ──
  const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette);

  // ── Initialize harness on mount ──
  useEffect(() => {
    harness.init().then((session) => {
      if (session) {
        useAppStore.setState({
          threadId: session.currentThreadId,
        });
      }
    }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync thread ID between store and harness ──
  const storeThreadId = useAppStore((s) => s.threadId);
  useEffect(() => {
    if (harness.currentThreadId) {
      useAppStore.setState({ threadId: harness.currentThreadId });
    }
  }, [harness.currentThreadId]);

  // When store threadId changes (e.g., user clicks a thread), sync to harness
  useEffect(() => {
    if (storeThreadId && storeThreadId !== harness.currentThreadId) {
      harness.switchThread(storeThreadId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeThreadId]);

  // ── Cmd+K ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggleCommandPalette();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleCommandPalette]);

  const isLoading = harness.status === "streaming";

  // ── Notification count for sidebar badge ──
  const notificationCount = useMemo(() => {
    let count = harness.backgroundNotifications.length;
    harness.activeThreads.forEach((s) => { if (s.running) count++; });
    return count;
  }, [harness.backgroundNotifications, harness.activeThreads]);

  // ── Send from Home — create thread + send message ──
  const handleSendFromHome = useCallback(() => {
    const state = useAppStore.getState();
    const trimmed = state.input.trim();
    const files = state.stagedFiles as StagedFile[];
    if (!trimmed && files.length === 0) return;

    // Extract base64 images for harness
    const images = files
      .filter((f) => f.mediaType.startsWith("image/"))
      .map((f) => f.url.split(",")[1]) // Extract base64 from data URL
      .filter(Boolean);

    useAppStore.setState({
      input: "",
      stagedFiles: [],
      currentPage: "active-chat",
    });

    harness
      .sendMessage(trimmed || "", images.length > 0 ? images : undefined)
      .catch(console.error);
  }, [harness]);

  // ── Send in active chat — direct ──
  const handleSendInChat = useCallback(() => {
    const state = useAppStore.getState();
    const trimmed = state.input.trim();
    const files = state.stagedFiles as StagedFile[];
    if (!trimmed && files.length === 0) return;

    const images = files
      .filter((f) => f.mediaType.startsWith("image/"))
      .map((f) => f.url.split(",")[1])
      .filter(Boolean);

    useAppStore.setState({ input: "", stagedFiles: [] });

    harness
      .sendMessage(trimmed || "", images.length > 0 ? images : undefined)
      .catch(console.error);
  }, [harness]);

  return (
    <div className="flex h-screen overflow-hidden bg-background [background-size:24px_24px] [background-image:radial-gradient(#CBCCC9_1px,transparent_1px)] dark:[background-image:radial-gradient(#333333_1px,transparent_1px)]">
      <Sidebar notificationCount={notificationCount} />

      <div className="flex flex-col flex-1 min-w-0">
        {currentPage === "home" && (
          <HomePage onSend={handleSendFromHome} disabled={isLoading} />
        )}
        {currentPage === "chats" && <ChatsListPage />}
        {currentPage === "active-chat" && (
          <ActiveChatPage
            messages={harness.displayMessages}
            onSend={handleSendInChat}
            onStop={harness.abort}
            error={harness.error}
            isLoading={isLoading}
            isDark={theme.isDark}
            toolStates={harness.toolStates}
            subagentStates={harness.subagentStates}
            pendingQuestion={harness.pendingQuestion}
            pendingToolApproval={harness.pendingToolApproval}
            pendingPlanApproval={harness.pendingPlanApproval}
            tasks={harness.tasks}
            onResolveToolApproval={harness.resolveToolApproval}
            onRespondToQuestion={harness.respondToQuestion}
            onRespondToPlanApproval={harness.respondToPlanApproval}
            currentModeId={harness.currentModeId}
            onSwitchMode={harness.switchMode}
          />
        )}
        {currentPage === "activity" && (
          <ActivityPage
            backgroundNotifications={harness.backgroundNotifications}
            activeThreads={harness.activeThreads}
            onRespondToQuestion={harness.respondToBackgroundQuestion}
            onRespondToToolApproval={harness.respondToBackgroundToolApproval}
            onRespondToPlanApproval={harness.respondToBackgroundPlanApproval}
          />
        )}
        {currentPage === "files" && <FilesPage />}
        {currentPage === "superpowers" && <SuperpowersPage />}
        {currentPage === "settings" && (
          <SettingsPage themeMode={theme.mode} onThemeChange={theme.setMode} />
        )}
        {currentPage === "scheduled-tasks" && <ScheduledTasksPage />}
        {currentPage === "apps" && <AppsPage />}
      </div>

      {showCommandPalette && <CommandPalette />}
    </div>
  );
}
