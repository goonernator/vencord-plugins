/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { Avatar, Button, ChannelStore, Flex, Forms, GuildStore, React, ScrollerThin, SelectedChannelStore, showToast, Text, Toasts, UserStore, useState } from "@webpack/common";
import type { ReactNode } from "react";

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
}

interface LogEntry {
    timestamp: number;
    userId: string;
    username: string;
    globalName?: string;
    channelId: string;
    channelName: string;
    guildId?: string;
    guildName?: string;
    action: "join" | "leave";
    sessionDuration?: number; // Duration in milliseconds for leave events
    // Persistent user data for post-restart display
    userAvatar?: string; // Avatar hash for persistent avatar display
    userAvatarUrl?: string; // Full avatar URL as fallback
    userDiscriminator?: string; // User discriminator if available
    // Additional persistent user data for @mentions
    userData?: {
        id: string;
        username: string;
        globalName?: string;
        avatar?: string;
        discriminator?: string;
    };
}

// Lazy-loaded Discord components and stores with error handling
// These might fail if Discord updates change module signatures
let VoiceStateStore: any;
let UserMentionComponent: any;
let HeaderBarIcon: any;

try {
    VoiceStateStore = findByPropsLazy("getVoiceStatesForChannel", "getCurrentClientVoiceChannelId");
} catch (error) {
    console.warn("VoiceChannelLogger: Failed to find VoiceStateStore", error);
}

try {
    UserMentionComponent = findComponentByCodeLazy(".USER_MENTION)");
} catch (error) {
    console.warn("VoiceChannelLogger: Failed to find UserMentionComponent", error);
    // Try alternative patterns for UserMentionComponent
    try {
        UserMentionComponent = findComponentByCodeLazy("USER_MENTION");
    } catch (error2) {
        try {
            UserMentionComponent = findComponentByCodeLazy("@");
        } catch (error3) {
            console.warn("VoiceChannelLogger: All UserMentionComponent patterns failed, setting to null");
            // Set to null instead of fallback span to force custom implementation
            UserMentionComponent = null;
        }
    }
}

try {
    HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '.iconBadge,"top"');
} catch (error) {
    console.warn("VoiceChannelLogger: Failed to find HeaderBarIcon", error);
    // Fallback to a simple button
    HeaderBarIcon = ({ onClick, tooltip, icon, className }: any) => {
        return React.createElement("button", {
            onClick,
            title: tooltip,
            className: className || "vc-voice-logger-btn",
            style: { background: "none", border: "none", cursor: "pointer" }
        }, icon());
    };
}

// Logger instance with descriptive color for console output
const logger = new Logger("VoiceChannelLogger", "#7289da");

// Storage and styling constants
const LOG_KEY = "VoiceChannelLogger_logs";
const cl = classNameFactory("vc-vcl-modal-");

// Timing constants (milliseconds)
const TOAST_SUPPRESSION_DURATION = 2000; // Standard suppression for channel switches
const INITIALIZATION_SUPPRESSION_DURATION = 5000; // Extended suppression during Discord startup

// Plugin state management
let lastUserChannelId: string | null = null; // Current user's voice channel for context tracking
let suppressToastsUntil: number = 0; // Timestamp for toast suppression expiration
let pluginInitialized: boolean = false; // Plugin initialization status flag
let initializationSuppressUntil: number = 0; // Timestamp for init suppression period end
let initializationStartTime: number = 0; // Timestamp when initialization began
const processedUsersDuringInit: Set<string> = new Set(); // Users already processed during startup
const userSessions: Map<string, number> = new Map(); // Maps userId → joinTimestamp for duration tracking

// Plugin settings organized by functional categories for easier navigation and management
const settings = definePluginSettings({
    // Core Logging Behavior
    enableFileLogging: {
        type: OptionType.BOOLEAN,
        description: "Save voice channel logs to persistent storage",
        default: true,
    },
    trackSessionDuration: {
        type: OptionType.BOOLEAN,
        description: "Track how long users stay in voice channels",
        default: true,
    },
    maxLogEntries: {
        type: OptionType.NUMBER,
        description: "Maximum number of log entries to keep (0 = unlimited)",
        default: 1000,
    },

    // Filtering Options
    logOwnActions: {
        type: OptionType.BOOLEAN,
        description: "Log your own voice channel actions",
        default: false,
    },
    onlyLogJoins: {
        type: OptionType.BOOLEAN,
        description: "Only log when users join your channel (ignore leaves)",
        default: false,
    },
    userFilter: {
        type: OptionType.STRING,
        description: "Only log specific users (comma-separated user IDs, leave empty for all)",
        default: "",
    },

    // Notification Settings
    showToastNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications when users join/leave",
        default: true,
    },
    suppressToastsForExistingUsers: {
        type: OptionType.BOOLEAN,
        description: "Don't show toasts for users already in channel (when joining or on Discord restart)",
        default: true,
    },
    toastDuration: {
        type: OptionType.NUMBER,
        description: "Toast notification duration in seconds",
        default: 3,
    },

    // UI & Display Settings
    logsPerPage: {
        type: OptionType.NUMBER,
        description: "Number of logs to display per page (lower = better performance)",
        default: 50,
    },

    // Debug Options
    enableDebugLogging: {
        type: OptionType.BOOLEAN,
        description: "Enable basic console logging (reduces console spam compared to detailed debug mode)",
        default: false,
    }
});

// ===== Utility Functions =====

/**
 * Formats timestamp to localized date/time string
 */
function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}

/**
 * Returns color for action type (join/leave) using Discord's color scheme
 */
function getActionColor(action: string): string {
    switch (action) {
        case "join": return "#43b581"; // Discord green
        case "leave": return "#f04747"; // Discord red
        default: return "#99aab5"; // Discord gray
    }
}

/**
 * Returns emoji icon for voice action type
 */
function getActionIcon(action: string): string {
    switch (action) {
        case "join": return "✅"; // Check mark
        case "leave": return "❌"; // X mark
        default: return "📝"; // Note
    }
}

/**
 * Saves log entry to persistent storage with FIFO cleanup
 */
async function saveLogEntry(entry: LogEntry) {
    // Skip if file logging is disabled
    if (!settings.store.enableFileLogging) return;

    try {
        // Update logs with DataStore's atomic update method
        await DataStore.update(LOG_KEY, (logs: LogEntry[] = []) => {
            // Add new entry at beginning (most recent first)
            logs.unshift(entry);

            // Enforce max entry limit with FIFO cleanup
            const maxEntries = settings.store.maxLogEntries;
            if (maxEntries > 0 && logs.length > maxEntries) {
                logs.length = maxEntries; // Truncate oldest entries
            }

            return logs;
        });
    } catch (error) {
        logger.error("Failed to save log entry:", error);
    }
}

/**
 * Formats log entry into human-readable console message
 */
function formatLogMessage(entry: LogEntry): string {
    const timestamp = new Date(entry.timestamp).toLocaleString();
    const displayName = entry.globalName || entry.username;
    const guild = entry.guildName ? ` in ${entry.guildName}` : "";

    // Add session duration for leave events
    let sessionInfo = "";
    if (entry.sessionDuration && entry.action === "leave") {
        const duration = formatDuration(entry.sessionDuration);
        sessionInfo = ` (session: ${duration})`;
    }

    // Format message based on action type
    switch (entry.action) {
        case "join":
            return `[${timestamp}] ${displayName} (${entry.userId}) joined voice channel "${entry.channelName}"${guild}`;
        case "leave":
            return `[${timestamp}] ${displayName} (${entry.userId}) left voice channel "${entry.channelName}"${guild}${sessionInfo}`;
        default:
            return `[${timestamp}] ${displayName} (${entry.userId}) - ${entry.action} in "${entry.channelName}"${guild}`;
    }
}

/**
 * Converts milliseconds to readable duration string (e.g., "2h 15m 30s")
 */
function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    // Show hours, minutes, seconds format based on duration
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    // Show only seconds for short durations
    else {
        return `${seconds}s`;
    }
}

/**
 * Processes a voice channel event by logging, saving, and optionally showing notifications
 * Central hub for all voice event processing with configurable output methods
 * @param entry - The log entry containing all event data
 * @param suppressToast - Whether to skip showing toast notification (for initialization/spam prevention)
 */
function logVoiceEvent(entry: LogEntry, suppressToast: boolean = false) {
    // Console logging only when debug mode is enabled to reduce spam
    // Provides essential info for troubleshooting without overwhelming output
    if (settings.store.enableDebugLogging) {
        const displayName = entry.globalName || entry.username;
        const actionText = entry.action === "join" ? "joined" : "left";
        logger.info(`${displayName} ${actionText} ${entry.channelName}`);
    }

    // Save to persistent storage if file logging is enabled
    if (settings.store.enableFileLogging) {
        saveLogEntry(entry);
    }

    // Show toast notification unless suppressed or disabled in settings
    // Suppression is used during initialization and channel switches to prevent spam
    if (settings.store.showToastNotifications && !suppressToast) {
        showToastNotification(entry);
    }
}

/**
 * Displays a toast notification for voice channel events
 * Uses different toast types and colors based on action (join = green, leave = neutral)
 * @param entry - The log entry to create a notification for
 */
function showToastNotification(entry: LogEntry) {
    const displayName = entry.globalName || entry.username;
    const actionText = entry.action === "join" ? "joined" : "left";
    const location = entry.guildName ? ` in ${entry.guildName}` : ""; // Add guild context if available

    // Construct user-friendly message
    const toastMessage = `${displayName} ${actionText} ${entry.channelName}${location}`;

    // Use success type (green) for joins, message type (neutral) for leaves
    const toastType = entry.action === "join" ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE;

    // Show toast with user-configured duration
    showToast(toastMessage, toastType, {
        duration: settings.store.toastDuration * 1000 // Convert seconds to milliseconds
    });
}

/**
 * Determines the type of voice channel action from a voice state update
 * Analyzes current and previous channel IDs to detect joins and leaves
 * @param state - Discord voice state object containing channel information
 * @returns Action type or null if no relevant action detected
 */
function getActionType(state: VoiceState): "join" | "leave" | null {
    const { channelId, oldChannelId } = state;

    // User joined a channel (new channel, no previous channel)
    if (channelId && !oldChannelId) return "join";

    // User left a channel (no current channel, had previous channel)
    if (!channelId && oldChannelId) return "leave";

    // Channel switch or no change - not logged as separate join/leave
    return null;
}

/**
 * Log entry row component for displaying individual voice channel events
 * Displays user avatar, name, action indicator, channel info, and session duration
 * Uses persistent avatar data and Discord's UserMentionComponent for native interactions
 * Includes robust fallback click handlers for user profile access
 */
function LogEntryRow({ log }: { log: LogEntry; }) {
    const displayName = log.globalName || log.username;
    const location = log.guildName ? `${log.channelName} in ${log.guildName}` : log.channelName;

    // Enhanced user data handling with comprehensive fallback chain
    // Tries multiple sources to ensure avatar displays even after Discord restarts
    const user = UserStore.getUser(log.userId);

    // Avatar URL resolution with multiple fallback strategies
    let avatarUrl: string;
    // Priority 1: Current user data with avatar method
    if (user?.getAvatarURL) {
        avatarUrl = user.getAvatarURL(undefined, 32);
    }
    // Priority 2: Stored full avatar URL from when user was online
    else if (log.userAvatarUrl) {
        avatarUrl = log.userAvatarUrl;
    }
    // Priority 3: Construct from stored avatar hash
    else if (log.userAvatar) {
        avatarUrl = `https://cdn.discordapp.com/avatars/${log.userId}/${log.userAvatar}.png?size=32`;
    }
    // Priority 4: User exists but getAvatarURL method might be missing
    else if (user?.avatar) {
        avatarUrl = `https://cdn.discordapp.com/avatars/${log.userId}/${user.avatar}.png?size=32`;
    }
    // Final fallback: Default Discord avatar based on user ID
    else {
        avatarUrl = `https://cdn.discordapp.com/embed/avatars/${parseInt(log.userId) % 5}.png`;
    }

    // Enhanced user click handler with multiple fallback strategies
    const handleUserClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        try {
            // Method 1: Try to dynamically import openUserProfile
            try {
                const { openUserProfile } = await import("@utils/discord");
                if (openUserProfile && typeof openUserProfile === "function") {
                    openUserProfile(log.userId);
                    return;
                }
            } catch (error) {
                console.warn("VoiceChannelLogger: openUserProfile not available", error);
            }

            // Method 2: Try to find and use openUserProfileModal
            try {
                const UserProfileModal = findByPropsLazy("openUserProfileModal");
                if (UserProfileModal?.openUserProfileModal) {
                    UserProfileModal.openUserProfileModal({ userId: log.userId });
                    return;
                }
            } catch (error) {
                console.warn("VoiceChannelLogger: openUserProfileModal not available", error);
            }

            // Method 3: Try to find profile modal through different patterns
            try {
                const ProfileUtils = findByPropsLazy("getUserProfile", "fetchProfile");
                if (ProfileUtils?.getUserProfile) {
                    ProfileUtils.getUserProfile(log.userId);
                    return;
                }
            } catch (error) {
                console.warn("VoiceChannelLogger: ProfileUtils not available", error);
            }

            // Final fallback: Copy user ID to clipboard with toast notification
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(log.userId);
                showToast("User ID copied to clipboard", Toasts.Type.SUCCESS);
            } else {
                // Fallback for older browsers
                const textArea = document.createElement("textarea");
                textArea.value = log.userId;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand("copy");
                document.body.removeChild(textArea);
                showToast("User ID copied to clipboard", Toasts.Type.SUCCESS);
            }
        } catch (error) {
            console.error("VoiceChannelLogger: Error in handleUserClick", error);
            showToast("Failed to open user profile", Toasts.Type.FAILURE);
        }
    };

    // Enhanced user component renderer with proper Discord integration
    const renderUserComponent = () => {
        // If UserMentionComponent is available and properly loaded, use it
        if (UserMentionComponent && typeof UserMentionComponent === "function") {
            return (
                <UserMentionComponent
                    className="mention"
                    userId={log.userId}
                    channelId={log.channelId}
                >
                    <Text variant="text-md/semibold" style={{ color: "#b9bbbe", wordBreak: "break-word", cursor: "pointer" }}>
                        {displayName}
                    </Text>
                </UserMentionComponent>
            );
        }

        // Fallback: Custom clickable span with manual profile opening
        return (
            <span
                className="mention"
                onClick={handleUserClick}
                style={{
                    color: "#b9bbbe",
                    fontWeight: "600",
                    cursor: "pointer",
                    textDecoration: "none",
                    borderRadius: "3px",
                    padding: "0 2px",
                    backgroundColor: "rgba(88, 101, 242, 0.3)",
                    transition: "background-color 0.2s ease"
                }}
                onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor = "rgba(88, 101, 242, 0.5)";
                }}
                onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = "rgba(88, 101, 242, 0.3)";
                }}
                title={`Click to open ${displayName}'s profile`}
            >
                @{displayName}
            </span>
        );
    };

    return (
        <div style={{
            display: "flex",
            alignItems: "center",
            padding: "12px",
            marginBottom: "6px",
            backgroundColor: "var(--background-secondary-alt)",
            borderRadius: "8px",
            border: "1px solid var(--background-modifier-accent)",
            borderLeft: `4px solid ${getActionColor(log.action)}`, // Color-coded left border
            cursor: "pointer",
            transition: "all 0.2s ease-in-out",
            position: "relative"
        }}
            onMouseEnter={e => {
                const actionColor = getActionColor(log.action);
                const backgroundColor = log.action === "join"
                    ? "rgba(67, 181, 129, 0.1)" // Green tint for joins
                    : "rgba(240, 71, 71, 0.1)"; // Red tint for leaves

                e.currentTarget.style.backgroundColor = backgroundColor;
                e.currentTarget.style.border = `1px solid ${actionColor}`;
                e.currentTarget.style.borderLeft = `4px solid ${actionColor}`;
                e.currentTarget.style.boxShadow = `0 2px 8px rgba(0, 0, 0, 0.15), 0 0 0 1px ${actionColor}33`;
            }}
            onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = "var(--background-secondary-alt)";
                e.currentTarget.style.border = "1px solid var(--background-modifier-accent)";
                e.currentTarget.style.borderLeft = `4px solid ${getActionColor(log.action)}`;
                e.currentTarget.style.boxShadow = "none";
            }}>
            {/* User Avatar with Action Indicator - Now clickable */}
            <div
                style={{ marginRight: "12px", flexShrink: 0, position: "relative", cursor: "pointer" }}
                onClick={handleUserClick}
                title={`Click to open ${displayName}'s profile`}
            >
                <Avatar
                    src={avatarUrl}
                    size="SIZE_32"
                    aria-label={displayName}
                />
                {/* Small colored dot indicating join/leave action */}
                <div
                    style={{
                        position: "absolute",
                        bottom: "-2px",
                        right: "-2px",
                        width: "12px",
                        height: "12px",
                        backgroundColor: getActionColor(log.action),
                        borderRadius: "50%",
                        border: "2px solid var(--background-primary)"
                    }}
                />
            </div>

            {/* Main Content Area */}
            <div style={{ flexGrow: 1, minWidth: 0 }}>
                {/* User Info Row */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                    {/* Enhanced clickable user mention with proper Discord integration */}
                    {renderUserComponent()}

                    {/* Show username if different from global name */}
                    {log.globalName && log.username !== log.globalName && (
                        <Text variant="text-xs/normal" style={{ color: "#b9bbbe", fontStyle: "italic" }}>
                            (@{log.username})
                        </Text>
                    )}

                    {/* Action badge with color coding */}
                    <div style={{
                        padding: "2px 6px",
                        backgroundColor: getActionColor(log.action),
                        borderRadius: "12px",
                        fontSize: "10px",
                        fontWeight: "600",
                        color: "white",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px"
                    }}>
                        {log.action}
                    </div>
                </div>

                {/* Channel and Timestamp Info */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", fontSize: "12px" }}>
                    <span style={{ color: "#b9bbbe" }}>📍 {location}</span>
                    <span style={{ color: "#b9bbbe" }}>🕒 {formatTimestamp(log.timestamp)}</span>
                    {/* Session duration for leave events */}
                    {log.sessionDuration && log.action === "leave" && (
                        <span style={{ color: "var(--text-brand)", fontWeight: "600" }}>
                            ⏱️ {formatDuration(log.sessionDuration)}
                        </span>
                    )}
                </div>

                {/* User ID (for debugging/admin purposes) - Now clickable */}
                <Text
                    variant="text-xs/normal"
                    style={{
                        color: "#b9bbbe",
                        fontFamily: "monospace",
                        marginTop: "4px",
                        opacity: 0.8,
                        cursor: "pointer"
                    }}
                    onClick={handleUserClick}
                    title={`Click to open ${displayName}'s profile`}
                >
                    ID: {log.userId}
                </Text>
            </div>
        </div>
    );
}

/**
 * Main modal component for displaying voice channel logs with filtering and pagination
 * Features: real-time filtering, search, pagination, statistics, and performance optimization
 * Uses React hooks for state management and memoization for performance
 */
function VoiceLogsModal({ modalProps }: { modalProps: ModalProps; }) {
    // State management for modal functionality
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<"all" | "join" | "leave">("all");
    const [searchTerm, setSearchTerm] = useState("");
    const [currentPage, setCurrentPage] = useState(0);

    // Performance optimization: clamp pagination size between reasonable limits
    const LOGS_PER_PAGE = Math.max(10, Math.min(settings.store.logsPerPage || 50, 200));

    // Load logs when component mounts
    React.useEffect(() => {
        loadLogs();
    }, []);

    /**
     * Log filtering function to filter logs by action type and search term
     * Filters logs by action type and search term, resets pagination when filters change
     */
    const filteredLogs = logs.filter(log => {
        // Filter by action type (all, join, leave)
        const matchesFilter = filter === "all" || log.action === filter;

        // Filter by search term (username or global name)
        const matchesSearch = searchMatches(log, searchTerm);

        return matchesFilter && matchesSearch;
    });

    // Reset to first page when filters change
    React.useEffect(() => {
        setCurrentPage(0);
    }, [filteredLogs.length]);

    /**
     * Loads voice channel logs from persistent storage
     * Handles loading state and error cases gracefully
     */
    async function loadLogs() {
        try {
            setLoading(true);
            const storedLogs = await DataStore.get(LOG_KEY) as LogEntry[] || [];
            setLogs(storedLogs);
        } catch (error) {
            console.error("Failed to load voice logs:", error);
        } finally {
            setLoading(false);
        }
    }

    /**
     * Clears all stored logs from persistent storage and UI state
     * Provides immediate UI feedback
     */
    async function clearAllLogs() {
        try {
            await DataStore.set(LOG_KEY, []);
            setLogs([]);
        } catch (error) {
            console.error("Failed to clear logs:", error);
        }
    }

    /**
     * Simple but effective search function for filtering logs by username
     * Case-insensitive search across username and global name fields
     * @param log - Log entry to check
     * @param searchTerm - Search string to match against
     * @returns True if log matches search criteria
     */
    function searchMatches(log: LogEntry, searchTerm: string): boolean {
        if (!searchTerm || !searchTerm.trim()) return true;

        const term = searchTerm.toLowerCase().trim();

        // Safe string checking with null/undefined protection
        const username = log.username || "";
        const globalName = log.globalName || "";

        return username.toLowerCase().includes(term) ||
            globalName.toLowerCase().includes(term);
    }

    // Pagination calculations with performance optimization
    const totalPages = Math.max(1, Math.ceil(filteredLogs.length / LOGS_PER_PAGE));
    const startIndex = currentPage * LOGS_PER_PAGE;
    const endIndex = startIndex + LOGS_PER_PAGE;
    const currentPageLogs = filteredLogs.slice(startIndex, endIndex);

    // Statistics calculations for the dashboard
    const statistics = {
        joinCount: logs.filter(l => l.action === "join").length,
        leaveCount: logs.filter(l => l.action === "leave").length,
        uniqueUsers: new Set(logs.map(l => l.userId)).size,
        totalSessions: logs.filter(l => l.sessionDuration).length,
        avgSessionDuration: (() => {
            const totalSessions = logs.filter(l => l.sessionDuration).length;
            return totalSessions > 0
                ? logs.filter(l => l.sessionDuration).reduce((sum, l) => sum + (l.sessionDuration || 0), 0) / totalSessions
                : 0;
        })()
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            {/* Modal Header with Title and Close Button */}
            <ModalHeader className={cl("head")}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <Text variant="heading-lg/semibold" style={{ color: "var(--header-primary)" }}>
                            Voice Channel Logs
                        </Text>
                        {/* Show filtered count if different from total */}
                        {filteredLogs.length !== logs.length && (
                            <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
                                ({filteredLogs.length} of {logs.length})
                            </Text>
                        )}
                    </div>
                    <ModalCloseButton onClick={modalProps.onClose} />
                </div>
            </ModalHeader>

            <ModalContent className={cl("contents")} style={{ padding: "20px" }}>
                {/* Statistics Dashboard - Memoized for Performance */}
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: "12px",
                    marginBottom: "20px",
                    padding: "16px",
                    backgroundColor: "var(--background-secondary)",
                    borderRadius: "12px",
                    border: "1px solid var(--background-modifier-accent)"
                }}>
                    <div style={{ textAlign: "center" }}>
                        <Text variant="text-lg/bold" style={{ color: "var(--text-brand)", display: "block" }}>
                            {logs.length}
                        </Text>
                        <Text variant="text-xs/normal" style={{ color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            Total Events
                        </Text>
                    </div>
                    <div style={{ textAlign: "center" }}>
                        <Text variant="text-lg/bold" style={{ color: "var(--status-positive)", display: "block" }}>
                            {statistics.joinCount}
                        </Text>
                        <Text variant="text-xs/normal" style={{ color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            Joins
                        </Text>
                    </div>
                    <div style={{ textAlign: "center" }}>
                        <Text variant="text-lg/bold" style={{ color: "var(--status-danger)", display: "block" }}>
                            {statistics.leaveCount}
                        </Text>
                        <Text variant="text-xs/normal" style={{ color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            Leaves
                        </Text>
                    </div>
                    {/* Average session display removed */}
                </div>

                {/* Filter and Control Section - Optimized Layout */}
                <div className={classes(Margins.bottom20)}>
                    <Flex justify={Flex.Justify.BETWEEN} align={Flex.Align.CENTER} wrap={Flex.Wrap.WRAP} style={{ gap: "16px" }}>
                        {/* Filter Buttons with Dynamic Counts */}
                        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
                            <Forms.FormTitle tag="h5" style={{ margin: 0, color: "var(--header-secondary)" }}>Filter:</Forms.FormTitle>
                            <div style={{ display: "flex", gap: "8px" }}>
                                <Button
                                    size={Button.Sizes.SMALL}
                                    color={filter === "all" ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                                    onClick={() => setFilter("all")}
                                    style={{
                                        minWidth: "80px",
                                        transition: "all 0.2s ease",
                                        fontWeight: "600"
                                    }}
                                >
                                    All ({logs.length})
                                </Button>
                                <Button
                                    size={Button.Sizes.SMALL}
                                    color={filter === "join" ? Button.Colors.GREEN : Button.Colors.PRIMARY}
                                    onClick={() => setFilter("join")}
                                    style={{
                                        minWidth: "80px",
                                        transition: "all 0.2s ease",
                                        fontWeight: "600"
                                    }}
                                >
                                    Joins ({statistics.joinCount})
                                </Button>
                                <Button
                                    size={Button.Sizes.SMALL}
                                    color={filter === "leave" ? Button.Colors.RED : Button.Colors.PRIMARY}
                                    onClick={() => setFilter("leave")}
                                    style={{
                                        minWidth: "80px",
                                        transition: "all 0.2s ease",
                                        fontWeight: "600"
                                    }}
                                >
                                    Leaves ({statistics.leaveCount})
                                </Button>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <Button
                                size={Button.Sizes.SMALL}
                                color={Button.Colors.PRIMARY}
                                onClick={loadLogs}
                                disabled={loading}
                                style={{
                                    transition: "all 0.2s ease",
                                    fontWeight: "600"
                                }}
                            >
                                {loading ? "🔄 Loading..." : "🔄 Refresh"}
                            </Button>
                            <Button
                                size={Button.Sizes.SMALL}
                                color={Button.Colors.RED}
                                onClick={clearAllLogs}
                                style={{
                                    transition: "all 0.2s ease",
                                    fontWeight: "600"
                                }}
                            >
                                🗑️ Clear Logs
                            </Button>
                        </div>
                    </Flex>

                    {/* Search Input with Results Counter */}
                    <div className={classes(Margins.top8)} style={{ position: "relative", zIndex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                            <Forms.FormTitle tag="h5" style={{ margin: 0, color: "var(--header-secondary)" }}>Search:</Forms.FormTitle>
                            {searchTerm && (
                                <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
                                    {filteredLogs.length} result{filteredLogs.length !== 1 ? "s" : ""} found
                                </Text>
                            )}
                        </div>
                        <input
                            type="text"
                            placeholder="Search by username..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            style={{
                                width: "100%",
                                padding: "10px 12px",
                                backgroundColor: "var(--input-background)",
                                border: "1px solid var(--input-border)",
                                borderRadius: "6px",
                                color: "#b9bbbe",
                                fontSize: "14px",
                                fontFamily: "var(--font-primary)",
                                outline: "none",
                                transition: "border-color 0.15s ease",
                                boxSizing: "border-box"
                            }}
                            onFocus={e => {
                                e.target.style.borderColor = "var(--brand-500)";
                                e.target.style.boxShadow = "0 0 0 1px var(--brand-500)";
                            }}
                            onBlur={e => {
                                e.target.style.borderColor = "var(--input-border)";
                                e.target.style.boxShadow = "none";
                            }}
                        />
                    </div>
                </div>

                {/* Optimized Pagination Controls */}
                {totalPages > 1 && (
                    <div style={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        gap: "12px",
                        marginBottom: "16px",
                        padding: "12px",
                        backgroundColor: "var(--background-secondary)",
                        borderRadius: "8px"
                    }}>
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            disabled={currentPage === 0}
                            onClick={() => setCurrentPage(0)}
                        >
                            ⏮️ First
                        </Button>
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            disabled={currentPage === 0}
                            onClick={() => setCurrentPage(currentPage - 1)}
                        >
                            ◀️ Prev
                        </Button>
                        <Text variant="text-sm/normal" style={{ color: "#b9bbbe", minWidth: "100px", textAlign: "center" }}>
                            Page {currentPage + 1} of {totalPages}
                        </Text>
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            disabled={currentPage === totalPages - 1}
                            onClick={() => setCurrentPage(currentPage + 1)}
                        >
                            Next ▶️
                        </Button>
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            disabled={currentPage === totalPages - 1}
                            onClick={() => setCurrentPage(totalPages - 1)}
                        >
                            Last ⏭️
                        </Button>
                    </div>
                )}

                {/* Performance Warning for Large Datasets */}
                {filteredLogs.length > 100 && (
                    <div style={{
                        padding: "8px 12px",
                        backgroundColor: "var(--info-warning-background)",
                        borderRadius: "6px",
                        marginBottom: "16px",
                        border: "1px solid var(--info-warning-foreground)"
                    }}>
                        <Text variant="text-sm/normal" style={{ color: "var(--info-warning-foreground)" }}>
                            📊 Showing {currentPageLogs.length} of {filteredLogs.length} logs (Page {currentPage + 1}/{totalPages})
                        </Text>
                    </div>
                )}

                {/* Main Content Area with Optimized Rendering */}
                <div style={{ height: "500px", position: "relative" }}>
                    {loading ? (
                        // Professional loading state with animation
                        <div style={{
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            height: "100%",
                            flexDirection: "column",
                            gap: "16px"
                        }}>
                            <div style={{
                                width: "32px",
                                height: "32px",
                                border: "3px solid var(--background-modifier-accent)",
                                borderTop: "3px solid var(--brand-500)",
                                borderRadius: "50%",
                                animation: "spin 1s linear infinite"
                            }} />
                            <Text variant="text-md/normal" style={{ color: "var(--text-muted)" }}>Loading logs...</Text>
                        </div>
                    ) : filteredLogs.length === 0 ? (
                        // Enhanced empty state with actionable guidance
                        <div style={{
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            height: "100%",
                            flexDirection: "column",
                            gap: "16px",
                            padding: "40px"
                        }}>
                            <div style={{ fontSize: "48px", opacity: 0.5 }}>🔍</div>
                            <Text variant="text-lg/semibold" style={{ color: "var(--header-primary)", textAlign: "center" }}>
                                {searchTerm ? "No matching logs found" : "No logs found"}
                            </Text>
                            {searchTerm ? (
                                <div style={{ textAlign: "center" }}>
                                    <Text variant="text-sm/normal" style={{ color: "var(--text-muted)", marginBottom: "12px" }}>
                                        Try adjusting your search or filter
                                    </Text>
                                    <div style={{ display: "flex", justifyContent: "center" }}>
                                        <Button
                                            size={Button.Sizes.SMALL}
                                            color={Button.Colors.PRIMARY}
                                            onClick={() => setSearchTerm("")}
                                        >
                                            Clear Search
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <Text variant="text-sm/normal" style={{ color: "var(--text-muted)", textAlign: "center" }}>
                                    Join some voice channels to start logging activity
                                </Text>
                            )}
                        </div>
                    ) : (
                        // Optimized log list with CSS animation and pagination info
                        <ScrollerThin style={{ paddingRight: "8px" }}>
                            <style>{`
                                @keyframes spin {
                                    0% { transform: rotate(0deg); }
                                    100% { transform: rotate(360deg); }
                                }
                            `}</style>
                            {currentPageLogs.map(log => (
                                <LogEntryRow key={`${log.timestamp}-${log.userId}-${log.action}`} log={log} />
                            ))}

                            {/* Clean pagination info at bottom */}
                            {totalPages > 1 && (
                                <div style={{
                                    padding: "16px",
                                    textAlign: "center",
                                    color: "var(--text-muted)",
                                    fontSize: "12px",
                                    borderTop: "1px solid var(--background-modifier-accent)",
                                    marginTop: "8px"
                                }}>
                                    Showing entries {startIndex + 1}-{Math.min(endIndex, filteredLogs.length)} of {filteredLogs.length}
                                </div>
                            )}
                        </ScrollerThin>
                    )}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

/**
 * Opens the voice logs modal with error boundary protection
 * Provides a clean interface for accessing the log viewer from anywhere in the plugin
 */
function openVoiceLogsModal() {
    openModal(props =>
        <ErrorBoundary>
            <VoiceLogsModal modalProps={props} />
        </ErrorBoundary>
    );
}

/**
 * Optimized header button component for voice logger access
 * Always visible regardless of voice channel status for better accessibility
 * Uses Discord's native HeaderBarIcon component for consistent styling
 * Memoized to prevent unnecessary re-renders when Discord UI updates
 */
/**
 * Header button component for voice logger access
 * Always visible regardless of voice channel status for better accessibility
 * Uses Discord's native HeaderBarIcon component for consistent styling
 */
function VoiceLoggerHeaderButton() {
    const currentUser = UserStore.getCurrentUser();

    // Always show button regardless of voice channel status
    // Users should be able to view logs even when not in voice channels
    if (!currentUser) return null;

    return (
        <HeaderBarIcon
            className="vc-voice-logger-btn"
            onClick={() => openVoiceLogsModal()}
            tooltip="View Voice Channel Logs"
            icon={() => (
                <svg
                    aria-hidden="true"
                    role="img"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    style={{
                        scale: "1.0",
                        fill: "var(--interactive-normal)",
                        transition: "fill 0.2s ease"
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.fill = "var(--interactive-hover)";
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.fill = "var(--interactive-normal)";
                    }}
                >
                    {/* Custom microphone icon without square elements */}
                    <g>
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2a1 1 0 1 1 2 0v2a5 5 0 0 0 10 0v-2a1 1 0 1 1 2 0Z" />
                        <path d="M12 19a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Z" />
                    </g>
                </svg>
            )}
        />
    );
}

/**
 * Fragment wrapper component for injecting the header button into Discord's toolbar
 * Uses strategic positioning to avoid conflicts with other Vencord plugins
 * Inserts the voice logger button early in the toolbar (position 1) to prevent conflicts
 * with plugins like Vencord Toolbox that insert near the end of the children array
 * @param children - Array of React elements representing Discord's header toolbar buttons
 */
function HeaderFragmentWrapper({ children }: { children: ReactNode[]; }) {
    // Insert at position 1 (second element) to avoid conflicts with Vencord Toolbox
    // This positioning strategy ensures coexistence with other header button plugins
    const insertPosition = Math.min(1, children.length);

    children.splice(
        insertPosition, 0,
        <ErrorBoundary noop key="voice-logger-header-btn">
            <VoiceLoggerHeaderButton />
        </ErrorBoundary>
    );

    return <>{children}</>;
}



// ===== Console Command Functions =====

/**
 * Exports logs as JSON string for backup or analysis
 */
export async function exportLogs(): Promise<string> {
    try {
        const logs = await DataStore.get(LOG_KEY) as LogEntry[] || [];
        return JSON.stringify(logs, null, 2); // Pretty-printed JSON
    } catch (error) {
        logger.error("Failed to export logs:", error);
        return "[]"; // Return empty array on error
    }
}

/**
 * Clears all stored logs with user feedback
 */
export async function clearLogs(): Promise<void> {
    try {
        await DataStore.set(LOG_KEY, []);
        logger.info("Voice channel logs cleared");
        showToast("Voice channel logs cleared", Toasts.Type.SUCCESS);
    } catch (error) {
        logger.error("Failed to clear logs:", error);
        showToast("Failed to clear logs", Toasts.Type.FAILURE);
    }
}

/**
 * Displays logs in browser console for quick viewing
 */
export async function openLogsInConsole(): Promise<void> {
    try {
        const logs = await DataStore.get(LOG_KEY) as LogEntry[] || [];

        if (logs.length === 0) {
            logger.info("No voice channel logs found");
            showToast("No logs found", Toasts.Type.MESSAGE);
            return;
        }

        logger.info(`Found ${logs.length} voice channel log entries:`);
        logs.forEach((log, index) => {
            logger.info(`${index + 1}. ${formatLogMessage(log)}`);
        });

        showToast(`Displayed ${logs.length} log entries in console`, Toasts.Type.SUCCESS);
    } catch (error) {
        logger.error("Failed to display logs:", error);
        showToast("Failed to display logs", Toasts.Type.FAILURE);
    }
}

/**
 * Opens the logs GUI modal
 */
export function openLogsGUI(): void {
    openVoiceLogsModal();
}

/**
 * Alias for opening logs modal (for console access)
 */
export function openVoiceLogsModalLocal(): void {
    openVoiceLogsModal();
}




// Main plugin definition with error handling
export default definePlugin({
    name: "VoiceChannelLogger",
    description: "Logs users joining/leaving your active voice channel with timestamps and user details. Includes toast notifications, GUI for viewing logs, and console commands for log management.",
    authors: [{ name: "kylie", id: 624679903068946454n }],

    settings,

    patches: [
        {
            find: ".controlButtonWrapper,",
            replacement: {
                match: /(?<=function (\i).{0,100}\()\i.Fragment,(?=.+?toolbar:\1\(\))/,
                replace: "$self.HeaderFragmentWrapper,"
            },
            // Make patch optional to prevent plugin loading failure
            noWarn: true
        }
    ],

    HeaderFragmentWrapper: ErrorBoundary.wrap(HeaderFragmentWrapper, {
        fallback: () => React.createElement("span", { style: { color: "red" } }, "Failed to render Voice Logger button :("),
        onError: error => {
            logger.error("HeaderFragmentWrapper error:", error);
        }
    }),

    flux: {
        /**
         * Optimized voice state update handler with comprehensive error handling
         * Processes Discord voice state changes to detect join/leave events
         * Implements smart suppression logic to prevent spam during initialization
         * Features enhanced user/channel data resolution with fallback mechanisms
         */
        async VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            // Early validation - exit immediately if invalid data received
            if (!voiceStates || !Array.isArray(voiceStates) || voiceStates.length === 0) {
                if (voiceStates && !Array.isArray(voiceStates)) {
                    logger.warn("Invalid voiceStates received:", voiceStates);
                }
                return;
            }

            // Safely get current user and channel info with error handling
            let currentUser, myChannelId;
            try {
                currentUser = UserStore.getCurrentUser();
                myChannelId = SelectedChannelStore.getVoiceChannelId();
            } catch (error) {
                logger.warn("Failed to get current user or channel:", error);
                return;
            }

            // Performance optimization: minimal debug logging only when enabled
            if (settings.store.enableDebugLogging && voiceStates.length > 0) {
                logger.info(`Processing ${voiceStates.length} voice state updates`);
            }

            // Track when the current user joins/leaves voice channels
            const myState = voiceStates.find(state => state.userId === currentUser?.id);

            // Handle plugin initialization and Discord restarts
            if (!pluginInitialized && myChannelId && currentUser) {
                pluginInitialized = true;
                lastUserChannelId = myChannelId;
                initializationStartTime = Date.now();
                processedUsersDuringInit.clear();

                if (settings.store.suppressToastsForExistingUsers) {
                    initializationSuppressUntil = Date.now() + INITIALIZATION_SUPPRESSION_DURATION;

                    // Safe call to VoiceStateStore with fallback
                    let usersInChannel;
                    try {
                        usersInChannel = VoiceStateStore?.getVoiceStatesForChannel?.(myChannelId);
                    } catch (error) {
                        logger.warn("Failed to get voice states for channel:", error);
                        usersInChannel = null;
                    }

                    if (usersInChannel) {
                        Object.keys(usersInChannel).forEach(userId => {
                            if (userId !== currentUser.id) {
                                processedUsersDuringInit.add(userId);
                            }
                        });
                    }

                    if (settings.store.enableDebugLogging) {
                        const userCount = usersInChannel ? Object.keys(usersInChannel).length : 0;
                        logger.info(`Plugin initialized with ${userCount} users in channel. Suppressing duplicates for ${INITIALIZATION_SUPPRESSION_DURATION}ms`);
                    }
                }
            }

            // Handle user channel switching with smart suppression
            if (myState && currentUser && settings.store.suppressToastsForExistingUsers) {
                const userJoinedNewChannel = myState.channelId && myState.channelId !== lastUserChannelId;

                if (userJoinedNewChannel && pluginInitialized) {
                    suppressToastsUntil = Date.now() + TOAST_SUPPRESSION_DURATION;
                    if (settings.store.enableDebugLogging) {
                        logger.info(`User joined new channel, suppressing toasts for ${TOAST_SUPPRESSION_DURATION}ms`);
                    }
                }

                lastUserChannelId = myState.channelId || null;
            } else if (myState && currentUser) {
                lastUserChannelId = myState.channelId || null;
                if (!pluginInitialized) {
                    pluginInitialized = true;
                    initializationStartTime = Date.now();
                    processedUsersDuringInit.clear();
                }
            }

            // Exit early if we don't have the required context for logging
            if (!currentUser || !myChannelId) {
                return;
            }

            // Clean up processed users set after initialization period expires
            if (Date.now() > initializationSuppressUntil && processedUsersDuringInit.size > 0) {
                processedUsersDuringInit.clear();
            }

            // Process voice state updates with error handling
            let eventsProcessed = 0;
            let eventsSkipped = 0;

            for (const state of voiceStates) {
                try {
                    const { userId, channelId, oldChannelId } = state;

                    if (!userId) {
                        eventsSkipped++;
                        continue;
                    }

                    const isMe = userId === currentUser?.id;
                    if (isMe && !settings.store.logOwnActions) {
                        eventsSkipped++;
                        continue;
                    }

                    // Apply user filtering if configured
                    if (settings.store.userFilter && settings.store.userFilter.trim()) {
                        const allowedUsers = settings.store.userFilter.split(",").map(id => id.trim());
                        if (!allowedUsers.includes(userId)) {
                            eventsSkipped++;
                            continue;
                        }
                    }

                    // Check if this event relates to our current voice channel
                    const joiningMyChannel = channelId === myChannelId;
                    const leavingMyChannel = oldChannelId === myChannelId;
                    const interactingWithMyChannel = joiningMyChannel || leavingMyChannel;

                    if (!interactingWithMyChannel) {
                        eventsSkipped++;
                        continue;
                    }

                    // Determine the specific action type
                    let action: "join" | "leave" | null = null;
                    if (joiningMyChannel && !leavingMyChannel) {
                        action = "join";
                    } else if (leavingMyChannel && !joiningMyChannel) {
                        action = "leave";
                    }

                    if (!action) {
                        eventsSkipped++;
                        continue;
                    }

                    // Apply "joins only" filter if enabled
                    if (settings.store.onlyLogJoins && action === "leave") {
                        eventsSkipped++;
                        continue;
                    }

                    // Handle initialization suppression for join events
                    const isInInitializationSuppression = Date.now() < initializationSuppressUntil;
                    if (isInInitializationSuppression && action === "join") {
                        if (processedUsersDuringInit.has(userId)) {
                            eventsSkipped++;
                            continue;
                        }
                        processedUsersDuringInit.add(userId);
                    }

                    // Create a minimal log entry for essential functionality
                    const user = UserStore.getUser(userId) || {
                        id: userId,
                        username: `User_${userId.slice(-4)}`,
                        globalName: undefined
                    };

                    const relevantChannelId = channelId || oldChannelId;
                    const channel = ChannelStore.getChannel(relevantChannelId!) || {
                        id: relevantChannelId,
                        name: `Channel_${relevantChannelId?.slice(-4) || "Unknown"}`,
                        guild_id: null
                    };

                    const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;

                    // Session duration tracking
                    let sessionDuration: number | undefined;
                    if (settings.store.trackSessionDuration) {
                        if (action === "join") {
                            userSessions.set(userId, Date.now());
                        } else if (action === "leave") {
                            const joinTime = userSessions.get(userId);
                            if (joinTime) {
                                sessionDuration = Date.now() - joinTime;
                                userSessions.delete(userId);
                            }
                        }
                    }

                    // Enhanced user data collection for persistent display
                    let userAvatar: string | undefined;
                    let userAvatarUrl: string | undefined;
                    let userDiscriminator: string | undefined;

                    // Collect avatar information from current user data
                    if (user && typeof user === "object") {
                        userAvatar = user.avatar;
                        userDiscriminator = user.discriminator;
                        // Try to get full avatar URL if user has getAvatarURL method
                        if (user.getAvatarURL && typeof user.getAvatarURL === "function") {
                            try {
                                userAvatarUrl = user.getAvatarURL(undefined, 32);
                            } catch (error) {
                                // Fallback to manual construction if method fails
                                if (userAvatar) {
                                    userAvatarUrl = `https://cdn.discordapp.com/avatars/${user.id}/${userAvatar}.png?size=32`;
                                }
                            }
                        } else if (userAvatar) {
                            // Manual construction when method is not available
                            userAvatarUrl = `https://cdn.discordapp.com/avatars/${user.id}/${userAvatar}.png?size=32`;
                        }
                    }

                    const logEntry: LogEntry = {
                        timestamp: Date.now(),
                        userId: user.id,
                        username: user.username,
                        globalName: user.globalName,
                        channelId: relevantChannelId!,
                        channelName: channel.name || "Unknown Channel",
                        guildId: channel.guild_id,
                        guildName: guild?.name,
                        action: action,
                        sessionDuration: sessionDuration,
                        // Enhanced persistent user data
                        userAvatar: userAvatar,
                        userAvatarUrl: userAvatarUrl,
                        userDiscriminator: userDiscriminator,
                        userData: {
                            id: user.id,
                            username: user.username,
                            globalName: user.globalName,
                            avatar: userAvatar,
                            discriminator: userDiscriminator
                        }
                    };

                    // Determine toast suppression
                    const isInNormalSuppression = Date.now() < suppressToastsUntil;
                    const shouldSuppressToast = settings.store.suppressToastsForExistingUsers &&
                        (isInNormalSuppression || isInInitializationSuppression) &&
                        action === "join";

                    logVoiceEvent(logEntry, shouldSuppressToast);
                    eventsProcessed++;

                } catch (error) {
                    logger.error("Error processing voice state update:", error);
                    eventsSkipped++;
                }
            }

            // Provide summary only when there's meaningful activity
            if (eventsProcessed > 0 || (eventsSkipped > 0 && settings.store.enableDebugLogging)) {
                const summary = `Voice events: ${eventsProcessed} logged, ${eventsSkipped} skipped`;
                if (settings.store.enableDebugLogging && eventsSkipped > 0) {
                    logger.info(summary);
                } else if (eventsProcessed > 0) {
                    logger.info(summary);
                }
            }
        }
    },

    /**
     * Initialize plugin and display available commands
     */
    start() {
        logger.info("Voice Channel Logger started");
        logger.info("Available commands:");
        logger.info("  - Vencord.Plugins.plugins.VoiceChannelLogger.exportLogs() - Export logs as JSON");
        logger.info("  - Vencord.Plugins.plugins.VoiceChannelLogger.clearLogs() - Clear all logs");
        logger.info("  - Vencord.Plugins.plugins.VoiceChannelLogger.openLogsInConsole() - Display logs in console");
        logger.info("  - Vencord.Plugins.plugins.VoiceChannelLogger.openLogsGUI() - Open logs GUI modal");

        // Reset all plugin state to ensure clean startup
        this.resetPluginState();
    },

    /**
     * Clean up plugin state on shutdown
     */
    stop() {
        logger.info("Voice Channel Logger stopped");
        this.resetPluginState();
    },

    /**
     * Reset all plugin state variables
     */
    resetPluginState() {
        pluginInitialized = false;
        lastUserChannelId = null;
        suppressToastsUntil = 0;
        initializationSuppressUntil = 0;
        processedUsersDuringInit.clear();
        initializationStartTime = 0;
        userSessions.clear();
    },

    // Export functions for console access
    exportLogs,
    clearLogs,
    openLogsInConsole,
    openLogsGUI,
    openVoiceLogsModalLocal
});
